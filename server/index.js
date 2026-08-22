import http from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GdbClient } from './gdb-client.js';
import { adapterFor } from './adapters.js';
import { CVisError, asCVisError, publicError } from './errors.js';
import { createWorkspace, inspectProject, prepareBuild, toProjectRelative, workspacePaths } from './project.js';
import { createId, diagnostics, increment, log, measure, observe } from './observability.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');
const gdbAdapterDir = path.resolve(__dirname, 'gdb');

const config = {
  port: Number(process.env.PORT || 4173),
  workspaceRoot: path.resolve(process.env.CVIS_WORKSPACE_ROOT || '/workspace/projects'),
  traceLimit: Number(process.env.CVIS_TRACE_LIMIT || 5000),
  gdbStopTimeoutMs: Number(process.env.CVIS_GDB_STOP_TIMEOUT_MS || 30000),
  maxUploadBytes: Number(process.env.CVIS_MAX_UPLOAD_BYTES || 35 * 1024 * 1024),
  version: '0.4.0'
};

const activeRuns = new Map();
const PUSH_SWAP_OPERATION_RE = /^(sa|sb|ss|pa|pb|ra|rb|rr|rra|rrb|rrr)$/;

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function send(res, status, payload, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType });
  res.end(payload);
}

function ndjson(res, event) {
  if (res.destroyed || res.writableEnded) return false;
  return res.write(`${JSON.stringify(event)}\n`);
}

async function body(req, maxBytes = 1024 * 1024) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
      throw new CVisError('REQUEST_TOO_LARGE', 'Request body is too large', { stage: 'server', status: 413 });
    }
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new CVisError('INVALID_JSON', 'Request body must be valid JSON', { stage: 'server', status: 400, cause: error });
  }
}

function normalizeFrame(runtimeDir, frame) {
  if (!frame) return null;
  const full = frame.fullname || frame.file || null;
  return {
    ...frame,
    projectPath: full ? toProjectRelative(runtimeDir, full) : null,
    line: frame.line ? Number(frame.line) : null,
    level: frame.level !== undefined ? Number(frame.level) : null
  };
}

function normalizeSnapshot(runtimeDir, adapter, snapshot) {
  if (!snapshot) return null;
  const normalized = {
    ...snapshot,
    frame: normalizeFrame(runtimeDir, snapshot.frame),
    frames: (snapshot.frames ?? []).map((frame) => normalizeFrame(runtimeDir, frame))
  };
  if (adapter.id === 'push_swap') normalized.pushSwap = normalized.adapterState ?? null;
  delete normalized.adapterState;
  return normalized;
}

function isOutsideProject(snapshot) {
  if (snapshot?.status !== 'paused') return false;
  const projectPath = snapshot.frame?.projectPath;
  return !projectPath || path.isAbsolute(projectPath);
}

function pushSwapOperations(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => PUSH_SWAP_OPERATION_RE.test(line));
}

function compactSnapshot(snapshot, adapter, state) {
  const output = snapshot?.targetOutput || '';
  const operations = adapter.id === 'push_swap' ? pushSwapOperations(output) : [];
  const stdoutDelta = output.length >= state.outputLength ? output.slice(state.outputLength) : output;
  const operationsDelta = operations.length >= state.operationCount ? operations.slice(state.operationCount) : operations;
  state.outputLength = output.length;
  state.operationCount = operations.length;
  const compact = { ...snapshot };
  delete compact.targetOutput;
  return { snapshot: compact, stdoutDelta, operationsDelta };
}

function buildDetails(build) {
  return {
    command: build.command ?? null,
    executable: build.executable ?? null,
    stdout: tail(build.stdout),
    stderr: tail(build.stderr)
  };
}

function tail(value, limit = 8000) {
  const text = String(value || '');
  return text.length <= limit ? text : text.slice(text.length - limit);
}

async function nextMeaningfulSnapshot(client, runtimeDir, adapter, previous) {
  const action = adapter.shouldFinish(previous) ? 'finish' : 'step';
  let snapshot = normalizeSnapshot(runtimeDir, adapter, await client.action(action));
  let guard = 0;
  while (snapshot?.status === 'paused' && isOutsideProject(snapshot) && guard < 32) {
    snapshot = normalizeSnapshot(runtimeDir, adapter, await client.action('finish'));
    guard += 1;
  }
  return snapshot;
}

async function streamRun(req, res, payload, context) {
  const workspaceId = String(payload.workspaceId || '');
  const args = Array.isArray(payload.args) ? payload.args.map(String) : [];
  const paths = workspacePaths(config.workspaceRoot, workspaceId);
  const runId = createId('run');
  context.runId = runId;
  const runtimeDir = path.join(paths.runsDir, runId);
  let debuggerClient = null;
  let finished = false;
  let cancelled = false;
  let total = 0;
  const startedAt = performance.now();

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-cvis-request-id': context.requestId,
    'x-cvis-run-id': runId,
    'transfer-encoding': 'chunked'
  });

  res.on('close', () => {
    if (finished) return;
    cancelled = true;
    increment('run.client_disconnect');
    log('warn', 'run.client_disconnect', { requestId: context.requestId, runId, workspaceId });
    void debuggerClient?.interrupt().catch(() => {});
  });

  increment('run.started');
  log('info', 'run.started', { requestId: context.requestId, runId, workspaceId, argsCount: args.length });
  ndjson(res, { type: 'run.started', requestId: context.requestId, runId, workspaceId, traceLimit: config.traceLimit });

  try {
    ndjson(res, { type: 'build.started', runId });
    increment('build.started');
    const build = await measure('build', { requestId: context.requestId, runId, workspaceId }, () => prepareBuild({ sourceDir: paths.sourceDir, runtimeDir }));
    if (!build.ok) {
      increment('build.failed');
      throw new CVisError('BUILD_FAILED', 'The project could not be built with debug symbols', {
        stage: 'build',
        status: 422,
        retryable: true,
        details: buildDetails(build)
      });
    }
    increment('build.succeeded');

    const adapter = adapterFor(build.analysis.profile);
    const executable = build.executable.startsWith('.') ? build.executable : `./${build.executable}`;
    ndjson(res, {
      type: 'build.completed',
      runId,
      build: buildDetails(build),
      analysis: {
        profile: build.analysis.profile,
        cFiles: build.analysis.cFiles.length,
        headerFiles: build.analysis.headerFiles.length,
        mainCandidates: build.analysis.mainCandidates,
        buildSystem: build.analysis.buildSystem?.type ?? 'cc'
      }
    });

    debuggerClient = new GdbClient({
      cwd: runtimeDir,
      executable,
      args,
      adapterScript: adapter.script ? path.join(gdbAdapterDir, adapter.script) : null,
      adapterCommand: adapter.command,
      adapterStatePrefix: adapter.statePrefix,
      tracePolicy: adapter.tracePolicy,
      stopTimeoutMs: config.gdbStopTimeoutMs
    });
    activeRuns.set(runId, { runId, workspaceId, startedAt: Date.now(), debuggerClient });
    debuggerClient.on('stderr', (chunk) => log('warn', 'gdb.stderr', { runId, text: tail(chunk, 1200) }));

    ndjson(res, { type: 'debugger.started', runId, profile: adapter.id });
    const compactState = { outputLength: 0, operationCount: 0 };
    let snapshot = normalizeSnapshot(runtimeDir, adapter, await measure('debugger.start', { runId }, () => debuggerClient.start()));

    while (snapshot && !cancelled) {
      const compact = compactSnapshot(snapshot, adapter, compactState);
      ndjson(res, { type: 'snapshot', runId, index: total, ...compact });
      increment('trace.snapshot');
      total += 1;

      if (snapshot.status === 'exited') break;
      if (total >= config.traceLimit) {
        increment('trace.limit');
        ndjson(res, { type: 'trace.limit', runId, total, limit: config.traceLimit });
        break;
      }

      snapshot = await nextMeaningfulSnapshot(debuggerClient, runtimeDir, adapter, snapshot);
    }

    if (cancelled) {
      increment('run.cancelled');
      ndjson(res, { type: 'run.cancelled', runId, total });
    } else if (snapshot?.status === 'exited') {
      increment('run.completed');
      ndjson(res, { type: 'run.completed', runId, total, durationMs: Math.round(performance.now() - startedAt) });
    }
  } catch (cause) {
    increment('run.failed');
    const error = cause?.code === 'EXEC_TIMEOUT'
      ? new CVisError('DEBUGGER_TIMEOUT', cause.message, {
          stage: 'debugger',
          status: 408,
          retryable: true,
          details: { command: cause.command ?? null, recovered: Boolean(cause.recovered) },
          cause
        })
      : asCVisError(cause, { stage: 'trace' });
    log('error', 'run.failed', { requestId: context.requestId, runId, workspaceId, code: error.code, stage: error.stage, message: error.message });
    ndjson(res, { type: 'error', error: error.toJSON(context) });
  } finally {
    finished = true;
    activeRuns.delete(runId);
    try { await debuggerClient?.stop(); } catch {}
    observe('run.total', performance.now() - startedAt);
    log('info', 'run.finished', { requestId: context.requestId, runId, workspaceId, total, cancelled, durationMs: Math.round(performance.now() - startedAt) });
    if (!res.writableEnded) res.end();
  }
}

async function api(req, res, url, context) {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    return json(res, 200, {
      version: config.version,
      traceLimit: config.traceLimit,
      maxUploadBytes: config.maxUploadBytes,
      gdbStopTimeoutMs: config.gdbStopTimeoutMs,
      capabilities: {
        projectUpload: true,
        folderUpload: true,
        browserTraceReplay: true,
        streamedTrace: true,
        make: true,
        simpleCc: true
      }
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, version: config.version, activeRuns: activeRuns.size, uptimeMs: diagnostics().uptimeMs });
  }

  if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
    return json(res, 200, { version: config.version, activeRuns: activeRuns.size, ...diagnostics() });
  }

  if (req.method === 'POST' && url.pathname === '/api/telemetry') {
    const payload = await body(req, 256 * 1024);
    increment('client.telemetry');
    log('info', 'client.telemetry', {
      requestId: context.requestId,
      event: String(payload.event || 'client.event'),
      level: String(payload.level || 'info'),
      fields: payload.fields ?? null
    });
    return json(res, 202, { accepted: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/workspaces') {
    const payload = await body(req, config.maxUploadBytes);
    const workspaceId = createId('ws');
    const started = performance.now();
    try {
      increment('workspace.started');
      const workspace = await createWorkspace({ workspaceRoot: config.workspaceRoot, workspaceId, files: payload.files });
      const analysis = await inspectProject(workspace.sourceDir);
      increment('workspace.created');
      observe('workspace.create', performance.now() - started);
      log('info', 'workspace.created', {
        requestId: context.requestId,
        workspaceId,
        files: workspace.files.length,
        totalBytes: workspace.totalBytes,
        profile: analysis.profile,
        buildSystem: analysis.buildSystem?.type ?? 'cc'
      });
      return json(res, 201, {
        workspaceId,
        files: workspace.files,
        skipped: workspace.skipped,
        totalBytes: workspace.totalBytes,
        analysis: {
          cFiles: analysis.cFiles,
          headerFiles: analysis.headerFiles,
          mainCandidates: analysis.mainCandidates,
          buildSystem: analysis.buildSystem,
          profile: analysis.profile,
          buildPlan: analysis.buildPlan
        }
      });
    } catch (error) {
      increment('workspace.failed');
      throw asCVisError(error, { stage: 'workspace' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/runs') {
    const payload = await body(req, 256 * 1024);
    await streamRun(req, res, payload, context);
    return true;
  }

  return false;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const candidate = path.resolve(distDir, relative);
  if (!candidate.startsWith(distDir + path.sep) && candidate !== path.join(distDir, 'index.html')) return false;
  try {
    const contents = await readFile(candidate);
    send(res, 200, contents, MIME[path.extname(candidate)] || 'application/octet-stream');
    return true;
  } catch {
    try {
      const index = await readFile(path.join(distDir, 'index.html'));
      send(res, 200, index, MIME['.html']);
      return true;
    } catch {
      return false;
    }
  }
}

await mkdir(config.workspaceRoot, { recursive: true });

const server = http.createServer(async (req, res) => {
  const requestId = String(req.headers['x-cvis-request-id'] || createId('req'));
  const context = { requestId, runId: null };
  const started = performance.now();
  increment('http.request');
  res.setHeader('x-cvis-request-id', requestId);
  res.on('finish', () => {
    const durationMs = performance.now() - started;
    observe('http.request', durationMs);
    log('info', 'http.request', { requestId, method: req.method, path: req.url, status: res.statusCode, durationMs: Math.round(durationMs) });
  });

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await api(req, res, url, context);
      if (handled === false) json(res, 404, { error: { code: 'NOT_FOUND', stage: 'server', message: 'API route not found', requestId } });
      return;
    }
    if (!(await serveStatic(res, url.pathname))) send(res, 404, 'Not found');
  } catch (cause) {
    const error = asCVisError(cause);
    increment('http.error');
    log('error', 'http.error', { requestId, code: error.code, stage: error.stage, message: error.message });
    if (!res.headersSent) json(res, error.status || 500, { error: publicError(error, context) });
    else if (!res.writableEnded) {
      ndjson(res, { type: 'error', error: publicError(error, context) });
      res.end();
    }
  }
});

server.listen(config.port, '0.0.0.0', () => {
  log('info', 'server.started', { port: config.port, version: config.version, workspaceRoot: config.workspaceRoot, traceLimit: config.traceLimit });
});

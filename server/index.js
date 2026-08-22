import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GdbClient } from './gdb-client.js';
import { listSourceFiles, prepareBuild, readSource, toProjectRelative } from './project.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');
const adapterPath = path.resolve(__dirname, 'gdb', 'push_swap.py');

const TRACE_HELPER_FILES = new Set([
  'src/utils.c',
  'src/print_numbers.c',
  'src/benchmark.c'
]);
const TRACE_HELPER_FUNCTIONS = new Set([
  'ft_strlen',
  'ft_strcmp',
  'ft_isspace',
  'ft_isdigit',
  'ft_putstr_fd',
  'ft_putnbr_fd',
  'ft_put_percent_fd'
]);

const config = {
  port: Number(process.env.PORT || 4173),
  sourceDir: path.resolve(process.env.CVIS_SOURCE_DIR || '/workspace/source'),
  runtimeDir: path.resolve(process.env.CVIS_RUNTIME_DIR || '/workspace/run'),
  executable: process.env.CVIS_EXECUTABLE || './push_swap',
  buildCommand: process.env.CVIS_BUILD_COMMAND || 'make re CFLAGS="-Wall -Wextra -Werror -g -O0"',
  adapter: process.env.CVIS_ADAPTER === 'none' ? null : 'push_swap',
  traceLimit: Number(process.env.CVIS_TRACE_LIMIT || 1500),
  gdbStopTimeoutMs: Number(process.env.CVIS_GDB_STOP_TIMEOUT_MS || 30000)
};

let debuggerClient = null;
let lastArgs = [];
let lastBuild = null;
let history = [];
let cursor = -1;
let traceComplete = false;
let traceState = makeTraceState('partial');
let traceTask = null;
let traceCancelRequested = false;

function makeTraceState(status, fields = {}) {
  return {
    status,
    message: null,
    reason: null,
    startedAt: null,
    ...fields
  };
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function send(res, status, payload, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType });
  res.end(payload);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1024 * 1024) throw new Error('Request body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

function normalizeSnapshot(snapshot) {
  if (!snapshot) return null;
  const normalizeFrame = (frame) => {
    if (!frame) return null;
    const full = frame.fullname || frame.file || null;
    return {
      ...frame,
      projectPath: full ? toProjectRelative(config.runtimeDir, full) : null,
      line: frame.line ? Number(frame.line) : null,
      level: frame.level !== undefined ? Number(frame.level) : null
    };
  };
  return {
    ...snapshot,
    frame: normalizeFrame(snapshot.frame),
    frames: (snapshot.frames ?? []).map(normalizeFrame)
  };
}

function isOutsideProject(snapshot) {
  if (snapshot?.status !== 'paused') return false;
  const projectPath = snapshot.frame?.projectPath;
  return !projectPath || path.isAbsolute(projectPath);
}

function isTraceHelper(snapshot) {
  if (snapshot?.status !== 'paused') return false;
  const file = snapshot.frame?.projectPath;
  const fn = snapshot.frame?.func;
  return TRACE_HELPER_FILES.has(file) || TRACE_HELPER_FUNCTIONS.has(fn);
}

function resetExecutionState() {
  history = [];
  cursor = -1;
  traceComplete = false;
  traceState = makeTraceState('partial');
  traceCancelRequested = false;
  traceTask = null;
}

function tracePayload() {
  return {
    ...traceState,
    observed: history.length,
    limit: config.traceLimit,
    resumable: ['timed_out', 'cancelled', 'error'].includes(traceState.status)
  };
}

function sessionPayload() {
  if (cursor < 0 || !history.length) return null;
  return {
    snapshot: history[cursor],
    previousSnapshot: cursor > 0 ? history[cursor - 1] : null,
    index: cursor,
    total: history.length,
    complete: traceComplete,
    latestIndex: history.length - 1,
    traceLimit: config.traceLimit,
    traceLimitReached: traceState.status === 'limit',
    trace: tracePayload()
  };
}

function appendSnapshot(snapshot) {
  history.push(snapshot);
  cursor = history.length - 1;
  if (snapshot?.status === 'exited') {
    traceComplete = true;
    if (traceState.status !== 'running') traceState = makeTraceState('complete');
  }
  return snapshot;
}

function markPartial() {
  if (!traceComplete && traceState.status !== 'running') traceState = makeTraceState('partial');
}

function snapshotSignature(snapshot) {
  if (!snapshot) return '';
  return JSON.stringify([
    snapshot.status,
    snapshot.frame?.projectPath ?? null,
    snapshot.frame?.line ?? null,
    snapshot.operations?.length ?? 0,
    snapshot.targetOutput?.length ?? 0
  ]);
}

async function buildProject() {
  lastBuild = await prepareBuild(config);
  return lastBuild;
}

async function stopDebugger() {
  if (traceTask) {
    traceCancelRequested = true;
    try { await debuggerClient?.interrupt(); } catch {}
    await Promise.race([traceTask.catch(() => {}), sleep(1000)]);
  }
  if (debuggerClient) await debuggerClient.stop();
  debuggerClient = null;
  traceTask = null;
}

async function launchDebugger(args) {
  resetExecutionState();
  debuggerClient = new GdbClient({
    cwd: config.runtimeDir,
    executable: config.executable,
    args,
    adapterScript: config.adapter === 'push_swap' ? adapterPath : null,
    stopTimeoutMs: config.gdbStopTimeoutMs
  });
  appendSnapshot(normalizeSnapshot(await debuggerClient.start()));
  markPartial();
  return sessionPayload();
}

async function startSession(args) {
  await stopDebugger();
  resetExecutionState();
  const build = await buildProject();
  if (!build.ok) {
    const error = new Error('Build failed');
    error.build = build;
    throw error;
  }

  lastArgs = args;
  const session = await launchDebugger(args);
  return { build, session };
}

async function restartSession() {
  if (!lastBuild?.ok) return startSession(lastArgs);
  await stopDebugger();
  const session = await launchDebugger(lastArgs);
  return { build: lastBuild, session };
}

async function captureNextSnapshot({ skipHelpers = false } = {}) {
  if (!debuggerClient) throw new Error('No active debug session');
  if (traceComplete) return history.at(-1);

  let snapshot = normalizeSnapshot(await debuggerClient.action('step'));
  let guard = 0;

  while (
    snapshot.status === 'paused'
    && guard < 32
    && (isOutsideProject(snapshot) || (skipHelpers && isTraceHelper(snapshot)))
  ) {
    snapshot = normalizeSnapshot(await debuggerClient.action('finish'));
    guard += 1;
  }

  return appendSnapshot(snapshot);
}

async function recoverTraceSnapshot() {
  if (!debuggerClient) return false;
  try {
    const snapshot = normalizeSnapshot(await debuggerClient.snapshot());
    if (!snapshot) return false;
    if (snapshotSignature(snapshot) !== snapshotSignature(history.at(-1))) appendSnapshot(snapshot);
    else cursor = history.length - 1;
    return true;
  } catch {
    return false;
  }
}

async function runTraceToEnd() {
  try {
    cursor = history.length - 1;
    while (
      !traceComplete
      && history.length < config.traceLimit
      && !traceCancelRequested
    ) {
      await captureNextSnapshot({ skipHelpers: true });
    }

    if (traceComplete) {
      traceState = makeTraceState('complete');
    } else if (traceCancelRequested) {
      traceState = makeTraceState('cancelled', {
        reason: 'cancelled',
        message: 'Trace cancelled. The observed states remain usable.'
      });
    } else if (history.length >= config.traceLimit) {
      traceState = makeTraceState('limit', {
        reason: 'trace-limit',
        message: `Trace limit of ${config.traceLimit} observed states reached. Use Next to continue manually.`
      });
    }
  } catch (error) {
    await recoverTraceSnapshot();
    if (error.code === 'EXEC_TIMEOUT') {
      traceState = makeTraceState('timed_out', {
        reason: 'timeout',
        message: `${error.message}. The partial trace is still usable and can be resumed.`
      });
    } else {
      traceState = makeTraceState('error', {
        reason: 'debugger-error',
        message: `${error.message}. The partial trace is still available.`
      });
    }
  } finally {
    cursor = history.length - 1;
    traceCancelRequested = false;
    traceTask = null;
  }
}

function startTraceToEnd() {
  if (traceTask || traceState.status === 'running') return;
  if (traceComplete) {
    traceState = makeTraceState('complete');
    return;
  }
  if (history.length >= config.traceLimit) {
    traceState = makeTraceState('limit', {
      reason: 'trace-limit',
      message: `Trace limit of ${config.traceLimit} observed states reached. Use Next to continue manually.`
    });
    return;
  }

  traceCancelRequested = false;
  traceState = makeTraceState('running', { startedAt: Date.now() });
  traceTask = runTraceToEnd();
}

async function cancelTrace() {
  if (traceState.status !== 'running' || !traceTask) return;
  traceCancelRequested = true;
  traceState = { ...traceState, message: 'Cancelling trace…' };
  try { await debuggerClient?.interrupt(); } catch {}
}

async function performAction(action) {
  if (!debuggerClient || !history.length) throw new Error('No active debug session');
  if (traceState.status === 'running' && action !== 'last') throw new Error('Trace is currently running');

  if (action === 'first') {
    cursor = 0;
    return;
  }
  if (action === 'previous') {
    cursor = Math.max(0, cursor - 1);
    return;
  }
  if (action === 'next') {
    if (cursor < history.length - 1) {
      cursor += 1;
      return;
    }
    if (!traceComplete) {
      await captureNextSnapshot();
      markPartial();
    }
    return;
  }
  if (action === 'last') {
    cursor = history.length - 1;
    startTraceToEnd();
    return;
  }
  throw new Error(`Unknown execution action: ${action}`);
}

async function performDebugAction(action) {
  if (!debuggerClient || !history.length) throw new Error('No active debug session');
  if (traceState.status === 'running') throw new Error('Trace is currently running');
  if (traceComplete) return;
  if (!['step', 'next', 'finish', 'continue'].includes(action)) throw new Error(`Unknown debugger action: ${action}`);

  cursor = history.length - 1;
  const snapshot = normalizeSnapshot(await debuggerClient.action(action));
  appendSnapshot(snapshot);
  markPartial();
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/project') {
    const files = await listSourceFiles(config.sourceDir);
    return json(res, 200, {
      sourceDir: config.sourceDir,
      executable: config.executable,
      adapter: config.adapter,
      traceLimit: config.traceLimit,
      gdbStopTimeoutMs: config.gdbStopTimeoutMs,
      files,
      defaults: { args: ['4', '67', '3', '87', '23'] },
      lastBuild
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/session') {
    return json(res, history.length ? 200 : 409, history.length ? { session: sessionPayload() } : { error: 'No active debug session' });
  }

  if (req.method === 'GET' && url.pathname === '/api/source') {
    const relativePath = url.searchParams.get('path');
    if (!relativePath) return json(res, 400, { error: 'Missing source path' });
    const source = await readSource(config.sourceDir, relativePath);
    return json(res, 200, { path: relativePath, source });
  }

  if (req.method === 'POST' && url.pathname === '/api/session/start') {
    const payload = await body(req);
    const args = Array.isArray(payload.args) ? payload.args.map(String) : [];
    try {
      return json(res, 200, await startSession(args));
    } catch (error) {
      return json(res, 400, { error: error.message, build: error.build ?? lastBuild });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/session/action') {
    const payload = await body(req);
    try {
      await performAction(payload.action);
      return json(res, 200, { session: sessionPayload() });
    } catch (error) {
      return json(res, 400, { error: error.message, session: sessionPayload() });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/session/trace/cancel') {
    try {
      await cancelTrace();
      return json(res, 200, { session: sessionPayload() });
    } catch (error) {
      return json(res, 400, { error: error.message, session: sessionPayload() });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/session/debug') {
    const payload = await body(req);
    try {
      await performDebugAction(payload.action);
      return json(res, 200, { session: sessionPayload() });
    } catch (error) {
      return json(res, 400, { error: error.message, session: sessionPayload() });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/session/navigate') {
    if (!history.length) return json(res, 409, { error: 'No active debug session' });
    if (traceState.status === 'running') return json(res, 409, { error: 'Trace is currently running', session: sessionPayload() });
    const payload = await body(req);
    const requested = Number(payload.index);
    if (!Number.isInteger(requested)) return json(res, 400, { error: 'Invalid history index' });
    cursor = Math.min(history.length - 1, Math.max(0, requested));
    return json(res, 200, { session: sessionPayload() });
  }

  if (req.method === 'POST' && url.pathname === '/api/session/restart') {
    try {
      return json(res, 200, await restartSession());
    } catch (error) {
      return json(res, 400, { error: error.message, build: error.build ?? lastBuild });
    }
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await api(req, res, url);
      if (handled === false) json(res, 404, { error: 'Not found' });
      return;
    }
    if (!(await serveStatic(res, url.pathname))) send(res, 404, 'Not found');
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`c_vis listening on http://0.0.0.0:${config.port}`);
  console.log(`source: ${config.sourceDir}`);
});

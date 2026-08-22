import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GdbClient } from './gdb-client.js';
import { listSourceFiles, prepareBuild, readSource, toProjectRelative } from './project.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const adapterPath = path.resolve(__dirname, 'gdb', 'push_swap.py');

const config = {
  port: Number(process.env.PORT || 4173),
  sourceDir: path.resolve(process.env.CVIS_SOURCE_DIR || '/workspace/source'),
  runtimeDir: path.resolve(process.env.CVIS_RUNTIME_DIR || '/workspace/run'),
  executable: process.env.CVIS_EXECUTABLE || './push_swap',
  buildCommand: process.env.CVIS_BUILD_COMMAND || 'make re CFLAGS="-Wall -Wextra -Werror -g -O0"',
  adapter: process.env.CVIS_ADAPTER === 'none' ? null : 'push_swap'
};

let debuggerClient = null;
let lastSnapshot = null;
let lastArgs = [];
let lastBuild = null;

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function text(res, status, payload, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType });
  res.end(payload);
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
  return { ...snapshot, frame: normalizeFrame(snapshot.frame), frames: snapshot.frames.map(normalizeFrame) };
}

async function buildProject() {
  lastBuild = await prepareBuild(config);
  return lastBuild;
}

async function stopDebugger() {
  if (debuggerClient) await debuggerClient.stop();
  debuggerClient = null;
  lastSnapshot = null;
}

async function startSession(args) {
  await stopDebugger();
  const build = await buildProject();
  if (!build.ok) {
    const error = new Error('Build failed');
    error.build = build;
    throw error;
  }
  lastArgs = args;
  debuggerClient = new GdbClient({
    cwd: config.runtimeDir,
    executable: config.executable,
    args,
    adapterScript: config.adapter === 'push_swap' ? adapterPath : null
  });
  lastSnapshot = normalizeSnapshot(await debuggerClient.start());
  return { build, snapshot: lastSnapshot };
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/project') {
    const files = await listSourceFiles(config.sourceDir);
    return json(res, 200, {
      sourceDir: config.sourceDir,
      executable: config.executable,
      adapter: config.adapter,
      files,
      defaults: { args: ['4', '67', '3', '87', '23'] },
      lastBuild
    });
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
    if (!debuggerClient) return json(res, 409, { error: 'No active debug session' });
    const payload = await body(req);
    try {
      lastSnapshot = normalizeSnapshot(await debuggerClient.action(payload.action));
      return json(res, 200, { snapshot: lastSnapshot });
    } catch (error) {
      return json(res, 400, { error: error.message, snapshot: lastSnapshot });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/session/restart') {
    try {
      return json(res, 200, await startSession(lastArgs));
    } catch (error) {
      return json(res, 400, { error: error.message, build: error.build ?? lastBuild });
    }
  }

  return false;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const candidate = path.resolve(publicDir, relative);
  if (!candidate.startsWith(publicDir + path.sep) && candidate !== path.join(publicDir, 'index.html')) return false;
  try {
    const contents = await readFile(candidate);
    text(res, 200, contents, MIME[path.extname(candidate)] || 'application/octet-stream');
    return true;
  } catch {
    return false;
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
    if (!(await serveStatic(res, url.pathname))) text(res, 404, 'Not found');
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`c_vis listening on http://0.0.0.0:${config.port}`);
  console.log(`source: ${config.sourceDir}`);
});

import { ClientError } from './errors.js';

const SKIP_SEGMENTS = new Set(['.git', '.cvis', 'node_modules', 'dist']);
const BINARY_EXTENSIONS = new Set(['.o', '.a', '.so', '.dylib', '.dll', '.exe', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.zip', '.tar', '.gz', '.7z']);
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
let worker;
let sequence = 0;
const pending = new Map();

function analysisWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/project-analysis.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const request = pending.get(event.data?.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.ok) request.resolve(event.data.analysis);
    else request.reject(new ClientError(event.data.error?.message || 'Project analysis failed', { code: 'PROJECT_ANALYSIS_FAILED', stage: 'ingest' }));
  };
  worker.onerror = (event) => {
    for (const request of pending.values()) request.reject(new ClientError(event.message || 'Project analysis worker failed', { code: 'PROJECT_ANALYSIS_FAILED', stage: 'ingest' }));
    pending.clear();
  };
  return worker;
}

function extension(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

function shouldSkip(path) {
  const normalized = String(path || '').replaceAll('\\', '/').replace(/^\.\//, '');
  const parts = normalized.split('/');
  if (parts.some((part) => SKIP_SEGMENTS.has(part))) return true;
  return BINARY_EXTENSIONS.has(extension(normalized));
}

function stripCommonRoot(entries) {
  if (!entries.length) return entries;
  const split = entries.map((entry) => entry.path.split('/').filter(Boolean));
  if (!split.every((parts) => parts.length > 1)) return entries;
  const first = split[0][0];
  if (!split.every((parts) => parts[0] === first)) return entries;
  return entries.map((entry) => ({ ...entry, path: entry.path.split('/').slice(1).join('/') }));
}

export function entriesFromFileList(fileList) {
  return stripCommonRoot([...fileList].map((file) => ({
    path: (file.webkitRelativePath || file.name).replaceAll('\\', '/'),
    file
  })));
}

function readDirectoryEntries(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function entryFile(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(entry, prefix, output) {
  if (entry.isFile) {
    const file = await entryFile(entry);
    output.push({ path: `${prefix}${file.name}`, file });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  while (true) {
    const batch = await readDirectoryEntries(reader);
    if (!batch.length) break;
    for (const child of batch) await walkEntry(child, `${prefix}${entry.name}/`, output);
  }
}

export async function entriesFromDrop(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return entriesFromFileList(dataTransfer?.files || []);
  const output = [];
  for (const entry of entries) await walkEntry(entry, '', output);
  return stripCommonRoot(output);
}

async function readEntries(entries, maxBytes) {
  const accepted = entries.filter((entry) => !shouldSkip(entry.path));
  const skipped = entries.filter((entry) => shouldSkip(entry.path)).map((entry) => entry.path);
  const files = new Array(accepted.length);
  let cursor = 0;
  let totalBytes = 0;
  const concurrency = Math.min(8, accepted.length || 1);

  async function workerTask() {
    while (true) {
      const index = cursor++;
      if (index >= accepted.length) return;
      const entry = accepted[index];
      const size = entry.file.size || 0;
      totalBytes += size;
      if (totalBytes > maxBytes) throw new ClientError(`Project exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB browser import limit`, { code: 'PROJECT_TOO_LARGE', stage: 'ingest' });
      const content = await entry.file.text();
      if (content.includes('\0')) {
        skipped.push(entry.path);
        continue;
      }
      files[index] = { path: entry.path, content, size };
    }
  }

  await Promise.all(Array.from({ length: concurrency }, workerTask));
  return { files: files.filter(Boolean), skipped, totalBytes };
}

export function analyzeProject(files) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    analysisWorker().postMessage({ id, type: 'analyze', files });
  });
}

export async function loadProject(entries, options = {}) {
  if (!entries?.length) throw new ClientError('Choose a C file or project folder', { code: 'EMPTY_PROJECT', stage: 'ingest' });
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const read = await readEntries(entries, maxBytes);
  if (!read.files.length) throw new ClientError('No text project files could be imported', { code: 'EMPTY_PROJECT', stage: 'ingest' });
  const analysis = await analyzeProject(read.files);
  return { ...read, analysis };
}

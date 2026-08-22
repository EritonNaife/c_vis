import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { CVisError } from './errors.js';

const execFileAsync = promisify(execFile);
const SOURCE_EXTENSIONS = new Set(['.c', '.h']);
const SKIP_NAMES = new Set(['.git', '.cvis', 'node_modules', 'dist']);
const MAKEFILE_NAMES = ['Makefile', 'makefile', 'GNUmakefile'];
const MAX_FILES = 1500;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_PROJECT_BYTES = 25 * 1024 * 1024;
const FUNCTION_DEFINITION_RE = /(^|\n)[ \t]*((?:(?:static|extern|inline|_Noreturn|const|volatile|signed|unsigned|short|long|struct[ \t]+[A-Za-z_]\w*|union[ \t]+[A-Za-z_]\w*|enum[ \t]+[A-Za-z_]\w*|[A-Za-z_]\w*)[ \t]+|\*[ \t]*)+)([A-Za-z_]\w*)[ \t]*\(([^;{}]*)\)[ \t\r\n]*\{/g;

export function assertInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new CVisError('PATH_ESCAPE', 'Path escapes project root', { stage: 'workspace', status: 400 });
  return resolved;
}

function normalizeUploadPath(input) {
  const value = String(input || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!value || value.startsWith('/') || value.includes('\0')) throw new CVisError('INVALID_FILE_PATH', 'Project contains an invalid file path', { stage: 'ingest', status: 400 });
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../')) throw new CVisError('INVALID_FILE_PATH', 'Project file path escapes the workspace', { stage: 'ingest', status: 400, details: { path: value } });
  const parts = normalized.split('/');
  if (parts.some((part) => SKIP_NAMES.has(part))) return null;
  return normalized;
}

export function workspacePaths(workspaceRoot, workspaceId) {
  if (!/^[a-z0-9_-]{6,80}$/i.test(workspaceId || '')) throw new CVisError('INVALID_WORKSPACE', 'Invalid workspace identifier', { stage: 'workspace', status: 400 });
  const root = assertInside(workspaceRoot, path.join(workspaceRoot, workspaceId));
  return {
    root,
    sourceDir: path.join(root, 'source'),
    runsDir: path.join(root, 'runs')
  };
}

export async function createWorkspace({ workspaceRoot, workspaceId, files }) {
  if (!Array.isArray(files) || !files.length) throw new CVisError('EMPTY_PROJECT', 'No project files were provided', { stage: 'ingest', status: 400 });
  if (files.length > MAX_FILES) throw new CVisError('PROJECT_TOO_LARGE', `Projects are limited to ${MAX_FILES} files`, { stage: 'ingest', status: 413 });

  const paths = workspacePaths(workspaceRoot, workspaceId);
  await rm(paths.root, { recursive: true, force: true });
  await mkdir(paths.sourceDir, { recursive: true });
  await mkdir(paths.runsDir, { recursive: true });

  let totalBytes = 0;
  const accepted = [];
  const skipped = [];

  for (const file of files) {
    const relativePath = normalizeUploadPath(file?.path);
    if (!relativePath) {
      skipped.push(String(file?.path || ''));
      continue;
    }
    if (typeof file?.content !== 'string') throw new CVisError('UNSUPPORTED_FILE', 'v0.4 accepts text project files only', { stage: 'ingest', status: 400, details: { path: relativePath } });
    const bytes = Buffer.byteLength(file.content, 'utf8');
    if (bytes > MAX_FILE_BYTES) throw new CVisError('FILE_TOO_LARGE', `File exceeds ${MAX_FILE_BYTES} bytes`, { stage: 'ingest', status: 413, details: { path: relativePath, bytes } });
    totalBytes += bytes;
    if (totalBytes > MAX_PROJECT_BYTES) throw new CVisError('PROJECT_TOO_LARGE', `Project exceeds ${MAX_PROJECT_BYTES} bytes`, { stage: 'ingest', status: 413 });

    const absolute = assertInside(paths.sourceDir, path.join(paths.sourceDir, relativePath));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, file.content, 'utf8');
    accepted.push(relativePath);
  }

  if (!accepted.length) throw new CVisError('EMPTY_PROJECT', 'No usable project files remained after validation', { stage: 'ingest', status: 400 });

  return { workspaceId, ...paths, files: accepted.sort(), skipped, totalBytes };
}

async function walkFiles(root) {
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_NAMES.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute));
    }
  }
  await walk(root);
  return files.sort();
}

export async function listSourceFiles(root) {
  return (await walkFiles(root)).filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)));
}

export async function readSource(root, relativePath) {
  const absolute = assertInside(root, path.join(root, relativePath));
  if (!SOURCE_EXTENSIONS.has(path.extname(absolute))) throw new CVisError('UNSUPPORTED_SOURCE', 'Only C source/header files can be read', { stage: 'workspace', status: 400 });
  return readFile(absolute, 'utf8');
}

function parseMakefile(text, file) {
  const nameMatch = text.match(/^\s*NAME\s*[:?+]?=\s*([^#\r\n]+)/m);
  const cflagsMatch = text.match(/^\s*CFLAGS\s*[:?+]?=\s*([^#\r\n]+)/m);
  return {
    type: 'make',
    file,
    name: nameMatch?.[1]?.trim().replace(/^['"]|['"]$/g, '') || null,
    cflags: cflagsMatch?.[1]?.trim() || '',
    hasRe: /^\s*re\s*:/m.test(text)
  };
}

async function detectBuildSystem(root, files) {
  for (const candidate of MAKEFILE_NAMES) {
    const file = files.find((item) => item === candidate || item.endsWith(`/${candidate}`));
    if (!file) continue;
    const text = await readFile(path.join(root, file), 'utf8');
    return parseMakefile(text, file);
  }
  return null;
}

function splitParameters(text) {
  const value = String(text || '').trim();
  if (!value || value === 'void') return [];
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function defaultExpressionForParameter(raw, type) {
  if (/\bchar\b[\s\S]*\*/.test(type) || /\bchar\b[\s\S]*\[/.test(raw)) return '""';
  if (/\b(struct|union)\s+[A-Za-z_]\w*/.test(type) && !/\*/.test(type)) return `(${type.trim()}){0}`;
  if (/\*/.test(type) || /\[[^\]]*\]/.test(raw)) return '0';
  if (/\b(float|double)\b/.test(type)) return '0.0';
  if (/\bchar\b/.test(type)) return "'a'";
  return '0';
}

function parseParameter(raw, index) {
  const text = raw.trim();
  if (text === '...') return { name: '...', type: '...', raw: text, variadic: true, defaultExpression: '' };
  const nameMatch = text.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/);
  const name = nameMatch?.[1] || `arg${index + 1}`;
  const nameIndex = nameMatch ? nameMatch.index : text.length;
  const arraySuffix = text.slice(nameIndex + (nameMatch?.[1]?.length || 0)).trim();
  const type = `${text.slice(0, nameIndex).trim()}${arraySuffix ? ` ${arraySuffix}` : ''}`.trim() || text;
  return { name, type, raw: text, variadic: false, defaultExpression: defaultExpressionForParameter(text, type) };
}

function functionsFromText(text, file) {
  const functions = [];
  const pattern = new RegExp(FUNCTION_DEFINITION_RE.source, FUNCTION_DEFINITION_RE.flags);
  let match;
  while ((match = pattern.exec(text))) {
    const name = match[3];
    if (['if', 'for', 'while', 'switch'].includes(name)) continue;
    const signatureStart = match.index + match[1].length;
    const line = text.slice(0, signatureStart).split('\n').length;
    const returnType = match[2].replace(/\s+/g, ' ').trim();
    const params = splitParameters(match[4]).map(parseParameter);
    functions.push({
      file,
      line,
      name,
      returnType,
      params: params.filter((param) => !param.variadic),
      variadic: params.some((param) => param.variadic),
      static: /(^|\s)static(\s|$)/.test(returnType)
    });
  }
  return functions;
}

async function detectFunctions(root, cFiles) {
  const functions = [];
  for (const file of cFiles) {
    const text = await readFile(path.join(root, file), 'utf8');
    functions.push(...functionsFromText(text, file));
  }
  return functions;
}

async function detectProfile(root, files) {
  const hasPushHeader = files.some((file) => /(^|\/)push_swap\.h$/.test(file));
  const dispatch = files.find((file) => /(^|\/)op_dispatch\.c$/.test(file));
  if (!hasPushHeader || !dispatch) return 'generic';
  try {
    const text = await readFile(path.join(root, dispatch), 'utf8');
    return /\bdo_op\s*\(/.test(text) ? 'push_swap' : 'generic';
  } catch {
    return 'generic';
  }
}

export async function inspectProject(root) {
  const files = await walkFiles(root);
  const cFiles = files.filter((file) => path.extname(file) === '.c');
  const headerFiles = files.filter((file) => path.extname(file) === '.h');
  const buildSystem = await detectBuildSystem(root, files);
  const functions = await detectFunctions(root, cFiles);
  const mainCandidates = [...new Set(functions.filter((fn) => fn.name === 'main').map((fn) => fn.file))];
  const profile = await detectProfile(root, files);
  const includeDirs = [...new Set(headerFiles.map((file) => path.dirname(file)).filter((dir) => dir !== '.'))].sort();

  return {
    files,
    cFiles,
    headerFiles,
    functions,
    mainCandidates,
    buildSystem,
    profile,
    buildPlan: buildSystem
      ? { type: 'make' }
      : { type: 'cc', sources: cFiles, includeDirs }
  };
}

function debugCFlags(existing) {
  const tokens = String(existing || '').split(/\s+/).filter(Boolean).filter((token) => token !== '-O0' && !/^-O[1-3sgz]$/.test(token) && token !== '-g');
  return [...tokens, '-g', '-O0'].join(' ');
}

async function runBuild(program, args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync(program, args, {
      cwd,
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' }
    });
    return { ok: true, stdout, stderr, command: [program, ...args] };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      error: error.message,
      command: [program, ...args]
    };
  }
}

async function isExecutable(file) {
  try {
    const info = await stat(file);
    return info.isFile() && (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

async function detectExecutable(runtimeDir, analysis, preferred = null) {
  const candidates = [];
  if (preferred) candidates.push(preferred);
  if (analysis.buildSystem?.name) candidates.push(analysis.buildSystem.name);
  if (analysis.buildPlan?.type === 'cc') candidates.push('cvis_program');

  for (const candidate of candidates) {
    const absolute = assertInside(runtimeDir, path.join(runtimeDir, candidate));
    if (await isExecutable(absolute)) return path.relative(runtimeDir, absolute);
  }

  const files = await walkFiles(runtimeDir);
  const executables = [];
  for (const file of files) {
    const absolute = path.join(runtimeDir, file);
    if (await isExecutable(absolute) && path.extname(file) !== '.o') executables.push(file);
  }
  executables.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
  if (!executables.length) throw new CVisError('EXECUTABLE_NOT_FOUND', 'Build completed but no executable could be identified', { stage: 'build', status: 422 });
  return executables[0];
}

function resolveEntryPoint(analysis, requestedEntry = null) {
  const functions = analysis.functions.filter((fn) => fn.name !== 'main');
  if (analysis.mainCandidates.length && (!requestedEntry || requestedEntry.kind !== 'function')) {
    return { kind: 'main', name: 'main', file: analysis.mainCandidates[0], breakpoint: 'main', args: [] };
  }

  let target = null;
  if (requestedEntry?.kind === 'function') {
    target = functions.find((fn) => fn.name === requestedEntry.name && fn.file === requestedEntry.file);
    if (!target) throw new CVisError('ENTRYPOINT_NOT_FOUND', 'The selected function could not be found in the uploaded source', {
      stage: 'build',
      status: 422,
      details: { name: requestedEntry.name ?? null, file: requestedEntry.file ?? null }
    });
  } else if (!analysis.mainCandidates.length && functions.length === 1) {
    target = functions[0];
  } else if (!analysis.mainCandidates.length && functions.length > 1) {
    throw new CVisError('ENTRYPOINT_REQUIRED', 'Choose which function c_vis should visualize', {
      stage: 'build',
      status: 409,
      retryable: true,
      details: { functions: functions.map(({ file, line, name, returnType, params, variadic }) => ({ file, line, name, returnType, params, variadic })) }
    });
  } else if (!analysis.mainCandidates.length) {
    throw new CVisError('NO_EXECUTABLE_CODE', 'No runnable function definition was detected in the uploaded C code', { stage: 'build', status: 422 });
  }

  const supplied = Array.isArray(requestedEntry?.args) ? requestedEntry.args.map((value) => String(value).trim()) : [];
  const args = target.params.map((param, index) => supplied[index] || param.defaultExpression || '0');
  if (target.variadic && supplied.length > target.params.length) args.push(...supplied.slice(target.params.length));
  return {
    kind: 'function',
    file: target.file,
    line: target.line,
    name: target.name,
    returnType: target.returnType,
    params: target.params,
    variadic: target.variadic,
    args,
    breakpoint: `${target.file}:${target.line}`
  };
}

function escapeIncludePath(value) {
  return String(value).replaceAll('\\', '/').replaceAll('"', '\\"');
}

async function writeHarness(runtimeDir, entry) {
  const harnessPath = '__cvis_harness.c';
  const callArguments = entry.args.map((value) => value || '0').join(', ');
  const content = [
    '/* Generated by c_vis in the disposable runtime workspace. */',
    `#include "${escapeIncludePath(entry.file)}"`,
    '',
    'int main(void)',
    '{',
    `    ${entry.name}(${callArguments});`,
    '    return 0;',
    '}',
    ''
  ].join('\n');
  await writeFile(path.join(runtimeDir, harnessPath), content, 'utf8');
  return harnessPath;
}

export async function prepareBuild({ sourceDir, runtimeDir, entry = null }) {
  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(runtimeDir, { recursive: true });
  await cp(sourceDir, runtimeDir, {
    recursive: true,
    filter(source) {
      const name = path.basename(source);
      if (SKIP_NAMES.has(name)) return false;
      if (name.endsWith('.o')) return false;
      return true;
    }
  });

  const analysis = await inspectProject(runtimeDir);
  if (!analysis.cFiles.length) throw new CVisError('NO_C_SOURCE', 'No C source files were found in the project', { stage: 'build', status: 422 });
  const resolvedEntry = resolveEntryPoint(analysis, entry);

  let result;
  if (resolvedEntry.kind === 'main' && analysis.buildSystem?.type === 'make') {
    const flags = debugCFlags(analysis.buildSystem.cflags);
    const args = ['-B'];
    if (analysis.buildSystem.hasRe) args.push('re');
    args.push(`CFLAGS=${flags}`);
    result = await runBuild('make', args, runtimeDir);
  } else {
    const args = ['-g', '-O0', '-Wall', '-Wextra'];
    for (const dir of analysis.buildPlan.includeDirs || []) args.push(`-I${dir}`);
    if (resolvedEntry.kind === 'function') {
      const harness = await writeHarness(runtimeDir, resolvedEntry);
      args.push(...analysis.cFiles.filter((file) => file !== resolvedEntry.file), harness, '-o', 'cvis_program');
    } else {
      args.push(...analysis.cFiles, '-o', 'cvis_program');
    }
    result = await runBuild('cc', args, runtimeDir);
  }

  if (!result.ok) return { ...result, analysis, entry: resolvedEntry, executable: null };
  const executable = await detectExecutable(runtimeDir, analysis, resolvedEntry.kind === 'function' ? 'cvis_program' : null);
  return { ...result, analysis, entry: resolvedEntry, executable };
}

export function toProjectRelative(runtimeDir, filePath) {
  if (!filePath) return null;
  try {
    return path.relative(runtimeDir, assertInside(runtimeDir, filePath));
  } catch {
    return filePath;
  }
}

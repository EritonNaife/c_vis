import { exec } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const SOURCE_EXTENSIONS = new Set(['.c', '.h']);
const SKIP_NAMES = new Set(['.git', '.cvis', 'node_modules']);

export function assertInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path escapes project root');
  return resolved;
}

export async function listSourceFiles(root) {
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_NAMES.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(path.relative(root, absolute));
    }
  }
  await walk(root);
  return files.sort();
}

export async function readSource(root, relativePath) {
  const absolute = assertInside(root, path.join(root, relativePath));
  if (!SOURCE_EXTENSIONS.has(path.extname(absolute))) throw new Error('Only C source/header files can be read');
  return readFile(absolute, 'utf8');
}

export async function prepareBuild({ sourceDir, runtimeDir, buildCommand }) {
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

  try {
    const { stdout, stderr } = await execAsync(buildCommand, {
      cwd: runtimeDir,
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' }
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? '', stderr: error.stderr ?? '', error: error.message };
  }
}

export function toProjectRelative(runtimeDir, filePath) {
  if (!filePath) return null;
  try {
    return path.relative(runtimeDir, assertInside(runtimeDir, filePath));
  } catch {
    return filePath;
  }
}

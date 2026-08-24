const SOURCE_EXTENSIONS = new Set(['.c', '.h']);
const PREFERRED_RESOURCE_EXTENSIONS = new Set(['.txt', '.text', '.input', '.data', '.fixture', '.log']);

function extension(path) {
  const name = String(path || '').slice(String(path || '').lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

function isBuildFile(path) {
  return /(^|\/)(Makefile|makefile|GNUmakefile)$/.test(String(path || ''));
}

export function isFileDescriptorParameter(param) {
  const name = String(param?.name || '').toLowerCase();
  const type = String(param?.type || '').replace(/\b(const|volatile|register)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const fdName = name === 'fd' || name.endsWith('_fd') || name === 'file_descriptor';
  return fdName && /^(?:(?:signed|unsigned)\s+)?int$/.test(type);
}

export function projectResourceFiles(paths = []) {
  return [...new Set(paths.map((value) => String(value || '').replaceAll('\\', '/')).filter(Boolean))]
    .filter((path) => !SOURCE_EXTENSIONS.has(extension(path)))
    .filter((path) => !isBuildFile(path))
    .filter((path) => !/(^|\/)\./.test(path))
    .sort();
}

export function preferredResourceFile(paths = []) {
  const files = projectResourceFiles(paths);
  if (!files.length) return '';
  const preferred = files.filter((file) => PREFERRED_RESOURCE_EXTENSIONS.has(extension(file)));
  if (preferred.length === 1) return preferred[0];
  if (preferred.length > 1) {
    const named = preferred.filter((file) => /(^|\/)(input|test|sample|fixture)([._-]|$)/i.test(file));
    if (named.length === 1) return named[0];
    return '';
  }
  return files.length === 1 ? files[0] : '';
}

function cStringLiteral(value) {
  const escaped = String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
  return `"${escaped}"`;
}

export function fileDescriptorExpression(path) {
  return `({ extern int open(const char *, int, ...); open(${cStringLiteral(path)}, 0); })`;
}

export function resourcePathForFileDescriptorExpression(value, paths = []) {
  const expression = String(value ?? '').trim();
  return projectResourceFiles(paths).find((path) => fileDescriptorExpression(path) === expression) || '';
}

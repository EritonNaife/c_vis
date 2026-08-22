function extension(path) {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index).toLowerCase();
}

function makefileAnalysis(file) {
  if (!file) return null;
  const name = file.content.match(/^\s*NAME\s*[:?+]?=\s*([^#\r\n]+)/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '') || null;
  const cflags = file.content.match(/^\s*CFLAGS\s*[:?+]?=\s*([^#\r\n]+)/m)?.[1]?.trim() || '';
  return { type: 'make', file: file.path, name, cflags, hasRe: /^\s*re\s*:/m.test(file.content) };
}

function mainCandidates(cFiles) {
  return cFiles.filter((file) => /\b(?:int|void)\s+main\s*\(/m.test(file.content)).map((file) => file.path);
}

function detectProfile(files) {
  const hasHeader = files.some((file) => /(^|\/)push_swap\.h$/.test(file.path));
  const dispatch = files.find((file) => /(^|\/)op_dispatch\.c$/.test(file.path));
  if (hasHeader && dispatch && /\bdo_op\s*\(/.test(dispatch.content)) return 'push_swap';
  return 'generic';
}

function extractStructs(files) {
  const structs = [];
  const seen = new Set();
  const pattern = /(?:typedef\s+)?struct\s+([A-Za-z_]\w*)?\s*\{([\s\S]*?)\}\s*([A-Za-z_]\w*)?\s*;/g;
  for (const file of files) {
    let match;
    while ((match = pattern.exec(file.content))) {
      const name = match[3] || match[1] || 'anonymous';
      const key = `${file.path}:${name}:${match.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const fields = match[2]
        .split(';')
        .map((line) => line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/g, '').trim())
        .filter(Boolean)
        .slice(0, 24);
      structs.push({ name, file: file.path, fields, recursivePointer: new RegExp(`(?:struct\\s+${match[1] || name}|${name})\\s*\\*`, 'm').test(match[2]) });
    }
  }
  return structs.slice(0, 80);
}

function analyze(files) {
  const started = performance.now();
  const cFiles = files.filter((file) => extension(file.path) === '.c');
  const headerFiles = files.filter((file) => extension(file.path) === '.h');
  const makefile = files.find((file) => /(^|\/)(Makefile|makefile|GNUmakefile)$/.test(file.path));
  const buildSystem = makefileAnalysis(makefile);
  const mains = mainCandidates(cFiles);
  const includeDirs = [...new Set(headerFiles.map((file) => file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.'))].sort();
  const profile = detectProfile(files);
  const structs = extractStructs([...cFiles, ...headerFiles]);
  const warnings = [];
  if (!cFiles.length) warnings.push('No .c files found.');
  if (!mains.length) warnings.push('No main() function detected.');
  if (mains.length > 1) warnings.push(`Multiple main() candidates detected (${mains.length}).`);

  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + (file.size || file.content.length), 0),
    cFiles: cFiles.map((file) => file.path),
    headerFiles: headerFiles.map((file) => file.path),
    mainCandidates: mains,
    buildSystem,
    buildPlan: buildSystem ? { type: 'make' } : { type: 'cc', sources: cFiles.map((file) => file.path), includeDirs },
    profile,
    structs,
    warnings,
    durationMs: Math.round(performance.now() - started)
  };
}

self.onmessage = (event) => {
  const { id, type, files } = event.data || {};
  if (type !== 'analyze') return;
  try {
    self.postMessage({ id, ok: true, analysis: analyze(files || []) });
  } catch (error) {
    self.postMessage({ id, ok: false, error: { message: error.message, stack: error.stack } });
  }
};

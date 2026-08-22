function extension(path) {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index).toLowerCase();
}

const FUNCTION_DEFINITION_RE = /(^|\n)[ \t]*((?:(?:static|extern|inline|_Noreturn|const|volatile|signed|unsigned|short|long|struct[ \t]+[A-Za-z_]\w*|union[ \t]+[A-Za-z_]\w*|enum[ \t]+[A-Za-z_]\w*|[A-Za-z_]\w*)[ \t]+|\*[ \t]*)+)([A-Za-z_]\w*)[ \t]*\(([^;{}]*)\)[ \t\r\n]*\{/g;

function makefileAnalysis(file) {
  if (!file) return null;
  const name = file.content.match(/^\s*NAME\s*[:?+]?=\s*([^#\r\n]+)/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '') || null;
  const cflags = file.content.match(/^\s*CFLAGS\s*[:?+]?=\s*([^#\r\n]+)/m)?.[1]?.trim() || '';
  return { type: 'make', file: file.path, name, cflags, hasRe: /^\s*re\s*:/m.test(file.content) };
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

function extractFunctions(cFiles) {
  const functions = [];
  for (const file of cFiles) {
    const pattern = new RegExp(FUNCTION_DEFINITION_RE.source, FUNCTION_DEFINITION_RE.flags);
    let match;
    while ((match = pattern.exec(file.content))) {
      const name = match[3];
      if (['if', 'for', 'while', 'switch'].includes(name)) continue;
      const signatureStart = match.index + match[1].length;
      const line = file.content.slice(0, signatureStart).split('\n').length;
      const returnType = match[2].replace(/\s+/g, ' ').trim();
      const parsed = splitParameters(match[4]).map(parseParameter);
      functions.push({
        file: file.path,
        line,
        name,
        returnType,
        params: parsed.filter((param) => !param.variadic),
        variadic: parsed.some((param) => param.variadic),
        static: /(^|\s)static(\s|$)/.test(returnType)
      });
    }
  }
  return functions;
}

function detectProfile(files) {
  const hasHeader = files.some((file) => /(^|\/)push_swap\.h$/.test(file.path));
  const dispatch = files.find((file) => /(^|\/)op_dispatch\.c$/.test(file.path));
  if (hasHeader && dispatch && /\bdo_op\s*\(/.test(dispatch.content)) return 'push_swap';
  return 'generic';
}

function cleanDeclaration(value) {
  return String(value || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStructs(files) {
  const structs = [];
  const seen = new Set();
  const pattern = /(?:typedef\s+)?struct\s+([A-Za-z_]\w*)?\s*\{([\s\S]*?)\}\s*([A-Za-z_]\w*)?\s*;/g;
  for (const file of files) {
    const localPattern = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = localPattern.exec(file.content))) {
      const name = match[3] || match[1] || 'anonymous';
      const key = `${file.path}:${name}:${match.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const line = file.content.slice(0, match.index).split('\n').length;
      const fields = match[2]
        .split(';')
        .map(cleanDeclaration)
        .filter(Boolean)
        .slice(0, 48);
      const declaredTag = match[1] || name;
      const recursivePointer = new RegExp(`(?:struct\\s+${declaredTag}|${name})\\s*\\*`, 'm').test(match[2]);
      structs.push({ name, tag: match[1] || null, file: file.path, line, fields, recursivePointer });
    }
  }
  return structs.slice(0, 100);
}

function extractEnums(files) {
  const enums = [];
  const pattern = /(?:typedef\s+)?enum\s+([A-Za-z_]\w*)?\s*\{([\s\S]*?)\}\s*([A-Za-z_]\w*)?\s*;/g;
  for (const file of files) {
    const localPattern = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = localPattern.exec(file.content))) {
      const name = match[3] || match[1] || 'anonymous enum';
      const line = file.content.slice(0, match.index).split('\n').length;
      const members = cleanDeclaration(match[2]).split(',').map((member) => member.trim()).filter(Boolean).slice(0, 64);
      enums.push({ name, tag: match[1] || null, file: file.path, line, members });
    }
  }
  return enums.slice(0, 100);
}

function extractTypedefs(files) {
  const aliases = [];
  const pattern = /(^|\n)\s*typedef\s+([^;{}]+?)\s+([A-Za-z_]\w*)\s*;/g;
  for (const file of files) {
    const localPattern = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = localPattern.exec(file.content))) {
      const target = cleanDeclaration(match[2]);
      const name = match[3];
      if (!target || /\([^)]*\*[^)]*\)/.test(target)) continue;
      const line = file.content.slice(0, match.index + match[1].length).split('\n').length;
      aliases.push({ name, target, file: file.path, line });
    }
  }
  return aliases.slice(0, 160);
}

function extractDefines(files) {
  const defines = [];
  const pattern = /^\s*#\s*define\s+([A-Za-z_]\w*)(?!\s*\()\s*(.*?)\s*$/gm;
  for (const file of files) {
    const localPattern = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = localPattern.exec(file.content))) {
      const line = file.content.slice(0, match.index).split('\n').length;
      defines.push({ name: match[1], value: cleanDeclaration(match[2]) || '1', file: file.path, line });
    }
  }
  return defines.slice(0, 200);
}

export function analyzeProjectFiles(files) {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const cFiles = files.filter((file) => extension(file.path) === '.c');
  const headerFiles = files.filter((file) => extension(file.path) === '.h');
  const sourceFiles = [...cFiles, ...headerFiles];
  const makefile = files.find((file) => /(^|\/)(Makefile|makefile|GNUmakefile)$/.test(file.path));
  const buildSystem = makefileAnalysis(makefile);
  const functions = extractFunctions(cFiles);
  const mains = [...new Set(functions.filter((fn) => fn.name === 'main').map((fn) => fn.file))];
  const callableFunctions = functions.filter((fn) => fn.name !== 'main');
  const includeDirs = [...new Set(headerFiles.map((file) => file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.'))].sort();
  const profile = detectProfile(files);
  const structs = extractStructs(sourceFiles);
  const enums = extractEnums(sourceFiles);
  const typedefs = extractTypedefs(sourceFiles);
  const defines = extractDefines(sourceFiles);
  const staticDeclarations = structs.length + enums.length + typedefs.length + defines.length;
  const warnings = [];
  if (!cFiles.length && staticDeclarations) warnings.push('No executable .c source found. c_vis is showing a static structural visualization in the browser.');
  else if (!cFiles.length) warnings.push('No .c files found.');
  if (!mains.length && callableFunctions.length) warnings.push('No main() detected. c_vis will generate a disposable runner for the selected function.');
  if (!mains.length && !callableFunctions.length && sourceFiles.length && staticDeclarations) warnings.push('No runnable function definition detected. Static source structure is available without execution.');
  if (!mains.length && !callableFunctions.length && cFiles.length && !staticDeclarations) warnings.push('No runnable function or structural declaration detected.');
  if (mains.length > 1) warnings.push(`Multiple main() candidates detected (${mains.length}).`);
  const finished = typeof performance !== 'undefined' ? performance.now() : Date.now();

  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + (file.size || file.content.length), 0),
    cFiles: cFiles.map((file) => file.path),
    headerFiles: headerFiles.map((file) => file.path),
    functions,
    mainCandidates: mains,
    buildSystem,
    buildPlan: buildSystem ? { type: 'make' } : { type: 'cc', sources: cFiles.map((file) => file.path), includeDirs },
    profile,
    structs,
    enums,
    typedefs,
    defines,
    staticDeclarations,
    visualizationMode: mains.length || callableFunctions.length ? 'runtime' : 'static',
    warnings,
    durationMs: Math.round(finished - started)
  };
}

if (typeof self !== 'undefined') {
  self.onmessage = (event) => {
    const { id, type, files } = event.data || {};
    if (type !== 'analyze') return;
    try {
      self.postMessage({ id, ok: true, analysis: analyzeProjectFiles(files || []) });
    } catch (error) {
      self.postMessage({ id, ok: false, error: { message: error.message, stack: error.stack } });
    }
  };
}

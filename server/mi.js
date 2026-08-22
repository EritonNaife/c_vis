function isDigit(char) {
  return char >= '0' && char <= '9';
}

function decodeCString(input) {
  if (!input.startsWith('"')) return input;
  let out = '';
  for (let i = 1; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') break;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = input[++i];
    if (next === undefined) break;
    const simple = { 'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'f': '\f', 'v': '\v', '\\': '\\', '"': '"' };
    if (Object.prototype.hasOwnProperty.call(simple, next)) {
      out += simple[next];
      continue;
    }
    if (next === 'x') {
      let hex = '';
      while (i + 1 < input.length && /[0-9a-fA-F]/.test(input[i + 1])) hex += input[++i];
      if (hex) out += String.fromCodePoint(Number.parseInt(hex, 16));
      continue;
    }
    if (/[0-7]/.test(next)) {
      let octal = next;
      for (let count = 0; count < 2 && i + 1 < input.length && /[0-7]/.test(input[i + 1]); count += 1) octal += input[++i];
      out += String.fromCodePoint(Number.parseInt(octal, 8));
      continue;
    }
    out += next;
  }
  return out;
}

class Parser {
  constructor(input) { this.input = input; this.pos = 0; }
  peek() { return this.input[this.pos]; }
  skipWhitespace() { while (/\s/.test(this.peek() ?? '')) this.pos += 1; }
  parseIdentifier() {
    const start = this.pos;
    while (this.pos < this.input.length && /[A-Za-z0-9_\-]/.test(this.input[this.pos])) this.pos += 1;
    return this.input.slice(start, this.pos);
  }
  parseString() {
    const start = this.pos;
    this.pos += 1;
    let escaped = false;
    while (this.pos < this.input.length) {
      const char = this.input[this.pos++];
      if (char === '"' && !escaped) break;
      if (char === '\\' && !escaped) escaped = true;
      else escaped = false;
    }
    return decodeCString(this.input.slice(start, this.pos));
  }
  parseBare() {
    const start = this.pos;
    while (this.pos < this.input.length && ![',', '}', ']'].includes(this.input[this.pos])) this.pos += 1;
    return this.input.slice(start, this.pos).trim();
  }
  parseValue() {
    this.skipWhitespace();
    if (this.peek() === '"') return this.parseString();
    if (this.peek() === '{') return this.parseTuple();
    if (this.peek() === '[') return this.parseList();
    return this.parseBare();
  }
  parseResult() {
    const key = this.parseIdentifier();
    if (!key || this.peek() !== '=') return null;
    this.pos += 1;
    return [key, this.parseValue()];
  }
  parseTuple() {
    this.pos += 1;
    const result = {};
    while (this.pos < this.input.length && this.peek() !== '}') {
      const pair = this.parseResult();
      if (!pair) break;
      const [key, value] = pair;
      result[key] = Object.prototype.hasOwnProperty.call(result, key)
        ? (Array.isArray(result[key]) ? [...result[key], value] : [result[key], value])
        : value;
      if (this.peek() === ',') this.pos += 1;
    }
    if (this.peek() === '}') this.pos += 1;
    return result;
  }
  parseList() {
    this.pos += 1;
    const values = [];
    while (this.pos < this.input.length && this.peek() !== ']') {
      const checkpoint = this.pos;
      const key = this.parseIdentifier();
      if (key && this.peek() === '=') {
        this.pos += 1;
        values.push({ [key]: this.parseValue() });
      } else {
        this.pos = checkpoint;
        values.push(this.parseValue());
      }
      if (this.peek() === ',') this.pos += 1;
      else if (this.peek() !== ']') break;
    }
    if (this.peek() === ']') this.pos += 1;
    return values;
  }
  parseResults() {
    const result = {};
    while (this.pos < this.input.length) {
      const pair = this.parseResult();
      if (!pair) break;
      const [key, value] = pair;
      result[key] = Object.prototype.hasOwnProperty.call(result, key)
        ? (Array.isArray(result[key]) ? [...result[key], value] : [result[key], value])
        : value;
      if (this.peek() === ',') this.pos += 1;
      else break;
    }
    return result;
  }
}

export function parseResults(input) { return new Parser(input).parseResults(); }

export function parseMiLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed === '(gdb)') return null;
  let pos = 0;
  while (isDigit(trimmed[pos])) pos += 1;
  const token = pos > 0 ? Number(trimmed.slice(0, pos)) : null;
  const type = trimmed[pos];
  const payload = trimmed.slice(pos + 1);
  if (!['^', '*', '+', '=', '~', '@', '&'].includes(type)) return { token, type: 'raw', text: line };
  if (['~', '@', '&'].includes(type)) return { token, type, text: decodeCString(payload) };
  const comma = payload.indexOf(',');
  const klass = comma === -1 ? payload : payload.slice(0, comma);
  const results = comma === -1 ? {} : parseResults(payload.slice(comma + 1));
  return { token, type, class: klass, results };
}

export function miQuote(value) { return JSON.stringify(String(value)); }

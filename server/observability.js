import { randomUUID } from 'node:crypto';

const startedAt = Date.now();
const counters = Object.create(null);
const durations = Object.create(null);
const recent = [];
const RECENT_LIMIT = 200;

export function createId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

export function increment(name, amount = 1) {
  counters[name] = (counters[name] || 0) + amount;
}

export function observe(name, durationMs) {
  const value = Number(durationMs) || 0;
  const current = durations[name] || { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += value;
  current.maxMs = Math.max(current.maxMs, value);
  durations[name] = current;
}

function safeValue(value) {
  if (value === undefined) return undefined;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(safeValue);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 30)) out[key] = safeValue(item);
    return out;
  }
  return String(value);
}

export function log(level, event, fields = {}) {
  const record = {
    ts: new Date().toISOString(),
    level,
    event,
    ...safeValue(fields)
  };
  recent.push(record);
  if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT);
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(JSON.stringify(record));
  return record;
}

export async function measure(name, fields, work) {
  const started = performance.now();
  try {
    return await work();
  } finally {
    observe(name, performance.now() - started);
    log('info', `${name}.duration`, { ...fields, durationMs: Math.round(performance.now() - started) });
  }
}

export function diagnostics() {
  const durationView = {};
  for (const [name, value] of Object.entries(durations)) {
    durationView[name] = {
      ...value,
      avgMs: value.count ? Math.round(value.totalMs / value.count) : 0,
      totalMs: Math.round(value.totalMs),
      maxMs: Math.round(value.maxMs)
    };
  }
  const memory = process.memoryUsage();
  return {
    uptimeMs: Date.now() - startedAt,
    process: {
      pid: process.pid,
      node: process.version,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal
    },
    counters: { ...counters },
    durations: durationView,
    recent: [...recent]
  };
}

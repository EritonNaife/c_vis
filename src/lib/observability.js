const recent = [];
const counters = Object.create(null);
const timings = Object.create(null);
const RECENT_LIMIT = 160;
let installed = false;

function safeFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields).slice(0, 24)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
    else if (Array.isArray(value)) out[key] = value.slice(0, 16).map((item) => ['string', 'number', 'boolean'].includes(typeof item) ? item : String(item));
    else if (value !== undefined) out[key] = String(value);
  }
  return out;
}

export function count(name, amount = 1) {
  counters[name] = (counters[name] || 0) + amount;
}

export function record(event, fields = {}, level = 'info', forward = false) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    fields: safeFields(fields)
  };
  recent.push(entry);
  if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT);
  count(`event.${event}`);
  if (forward) void forwardEvent(entry);
  return entry;
}

async function forwardEvent(entry) {
  try {
    await fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ event: entry.event, level: entry.level, fields: entry.fields })
    });
  } catch {
    count('telemetry.forward_failed');
  }
}

export function startSpan(name, fields = {}) {
  const started = performance.now();
  record(`${name}.started`, fields);
  return {
    end(extra = {}, level = 'info') {
      const durationMs = performance.now() - started;
      const current = timings[name] || { count: 0, totalMs: 0, maxMs: 0 };
      current.count += 1;
      current.totalMs += durationMs;
      current.maxMs = Math.max(current.maxMs, durationMs);
      timings[name] = current;
      record(`${name}.completed`, { ...fields, ...extra, durationMs: Math.round(durationMs) }, level);
      return durationMs;
    }
  };
}

export function captureError(error, fields = {}) {
  count('error');
  return record('client.error', {
    code: error?.code || error?.name || 'ERROR',
    stage: error?.stage || 'client',
    message: error?.message || String(error),
    requestId: error?.requestId || '',
    runId: error?.runId || '',
    ...fields
  }, 'error', true);
}

export function installGlobalObservers() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event) => captureError(event.error || new Error(event.message), { source: 'window.error' }));
  window.addEventListener('unhandledrejection', (event) => captureError(event.reason instanceof Error ? event.reason : new Error(String(event.reason)), { source: 'unhandledrejection' }));
}

export function diagnostics() {
  const timingView = {};
  for (const [name, value] of Object.entries(timings)) {
    timingView[name] = {
      count: value.count,
      totalMs: Math.round(value.totalMs),
      maxMs: Math.round(value.maxMs),
      avgMs: value.count ? Math.round(value.totalMs / value.count) : 0
    };
  }
  return {
    counters: { ...counters },
    timings: timingView,
    recent: [...recent],
    memory: performance?.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
    } : null
  };
}

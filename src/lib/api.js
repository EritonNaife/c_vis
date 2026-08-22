import { ClientError, normalizeError } from './errors.js';

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await parseResponse(response);
  if (!response.ok) {
    const error = normalizeError(payload, { code: `HTTP_${response.status}`, stage: 'server', message: `Request failed (${response.status})` });
    if (!error.requestId) error.requestId = response.headers.get('x-cvis-request-id');
    throw error;
  }
  return payload;
}

export function postJson(url, payload, options = {}) {
  return requestJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: JSON.stringify(payload),
    signal: options.signal
  });
}

export async function streamRun({ workspaceId, args = [], signal, onEvent }) {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId, args }),
    signal
  });

  if (!response.ok) {
    const payload = await parseResponse(response);
    throw normalizeError(payload, { code: `HTTP_${response.status}`, stage: 'server', message: `Run request failed (${response.status})` });
  }
  if (!response.body) throw new ClientError('Browser did not expose the execution response stream', { code: 'STREAM_UNAVAILABLE', stage: 'client' });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  async function handleLine(line) {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch (cause) {
      throw new ClientError('Execution stream contained invalid JSON', { code: 'INVALID_TRACE_EVENT', stage: 'trace', cause, details: { sample: line.slice(0, 160) } });
    }
    await onEvent?.(event);
    if (event.type === 'error') throw normalizeError({ error: event.error }, { stage: 'trace' });
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        await handleLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) await handleLine(buffer);
  } finally {
    reader.releaseLock();
  }
}

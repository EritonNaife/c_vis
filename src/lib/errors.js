export class ClientError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ClientError';
    this.code = options.code || 'CLIENT_ERROR';
    this.stage = options.stage || 'client';
    this.retryable = Boolean(options.retryable);
    this.requestId = options.requestId ?? null;
    this.runId = options.runId ?? null;
    this.details = options.details ?? null;
  }
}

export function normalizeError(error, defaults = {}) {
  if (error instanceof ClientError) return error;
  const payload = error?.error ?? error?.payload?.error ?? error;
  return new ClientError(
    payload?.message || defaults.message || error?.message || 'Unexpected c_vis error',
    {
      code: payload?.code || defaults.code || 'CLIENT_ERROR',
      stage: payload?.stage || defaults.stage || 'client',
      retryable: payload?.retryable ?? defaults.retryable ?? false,
      requestId: payload?.requestId ?? null,
      runId: payload?.runId ?? null,
      details: payload?.details ?? defaults.details ?? null,
      cause: error
    }
  );
}

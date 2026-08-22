export class CVisError extends Error {
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'CVisError';
    this.code = code || 'INTERNAL_ERROR';
    this.stage = options.stage || 'server';
    this.status = options.status || 500;
    this.retryable = Boolean(options.retryable);
    this.details = options.details ?? null;
  }

  toJSON(context = {}) {
    return {
      code: this.code,
      stage: this.stage,
      message: this.message,
      retryable: this.retryable,
      requestId: context.requestId ?? null,
      runId: context.runId ?? null,
      details: this.details
    };
  }
}

export function asCVisError(error, defaults = {}) {
  if (error instanceof CVisError) return error;
  return new CVisError(
    defaults.code || error?.code || 'INTERNAL_ERROR',
    defaults.message || error?.message || 'Unexpected c_vis error',
    {
      stage: defaults.stage || 'server',
      status: defaults.status || 500,
      retryable: defaults.retryable ?? false,
      details: defaults.details ?? null,
      cause: error
    }
  );
}

export function publicError(error, context = {}) {
  return asCVisError(error).toJSON(context);
}

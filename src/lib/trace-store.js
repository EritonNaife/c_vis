export class TraceStore {
  constructor() {
    this.reset();
  }

  reset() {
    this.snapshots = [];
    this.stdout = '';
    this.operations = [];
    this.complete = false;
    this.limitReached = false;
    this.runId = null;
    this.startedAt = null;
    this.durationMs = null;
  }

  start(event) {
    this.reset();
    this.runId = event.runId ?? null;
    this.startedAt = performance.now();
  }

  append(event) {
    if (event.stdoutDelta) this.stdout += event.stdoutDelta;
    if (event.operationsDelta?.length) this.operations.push(...event.operationsDelta);
    this.snapshots.push({
      snapshot: event.snapshot,
      stdoutEnd: this.stdout.length,
      operationEnd: this.operations.length
    });
    return this.snapshots.length - 1;
  }

  finish(event = {}) {
    this.complete = event.type === 'run.completed';
    this.limitReached = event.type === 'trace.limit';
    this.durationMs = event.durationMs ?? (this.startedAt === null ? null : Math.round(performance.now() - this.startedAt));
  }

  get total() {
    return this.snapshots.length;
  }

  materialize(index) {
    if (!this.snapshots.length) return null;
    const safeIndex = Math.max(0, Math.min(this.snapshots.length - 1, Number(index) || 0));
    const entry = this.snapshots[safeIndex];
    return {
      ...entry.snapshot,
      targetOutput: this.stdout.slice(0, entry.stdoutEnd),
      operations: this.operations.slice(0, entry.operationEnd)
    };
  }

  previous(index) {
    return index > 0 ? this.materialize(index - 1) : null;
  }

  summary() {
    return {
      runId: this.runId,
      total: this.total,
      stdoutBytes: this.stdout.length,
      operations: this.operations.length,
      complete: this.complete,
      limitReached: this.limitReached,
      durationMs: this.durationMs
    };
  }
}

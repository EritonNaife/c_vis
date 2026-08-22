import test from 'node:test';
import assert from 'node:assert/strict';
import { TraceStore } from '../src/lib/trace-store.js';

test('reconstructs cumulative output from deltas', () => {
  const store = new TraceStore();
  store.start({ runId: 'run_1' });
  store.append({ snapshot: { status: 'paused', frame: { line: 1 } }, stdoutDelta: 'pb\n', operationsDelta: ['pb'] });
  store.append({ snapshot: { status: 'paused', frame: { line: 2 } }, stdoutDelta: 'ra\n', operationsDelta: ['ra'] });

  assert.equal(store.total, 2);
  assert.equal(store.materialize(0).targetOutput, 'pb\n');
  assert.deepEqual(store.materialize(0).operations, ['pb']);
  assert.equal(store.materialize(1).targetOutput, 'pb\nra\n');
  assert.deepEqual(store.materialize(1).operations, ['pb', 'ra']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProjectFiles } from '../src/workers/project-analysis.worker.js';

test('maps header-only C declarations to static visualization mode', () => {
  const analysis = analyzeProjectFiles([
    {
      path: 'node.h',
      content: `
#define NODE_LIMIT 32

typedef enum e_state {
  STATE_IDLE,
  STATE_READY = 2
} t_state;

typedef struct s_node {
  int value;
  struct s_node *next;
} t_node;

typedef unsigned long t_size;
`
    }
  ]);

  assert.equal(analysis.visualizationMode, 'static');
  assert.deepEqual(analysis.cFiles, []);
  assert.deepEqual(analysis.headerFiles, ['node.h']);
  assert.equal(analysis.functions.length, 0);
  assert.equal(analysis.structs.length, 1);
  assert.equal(analysis.structs[0].name, 't_node');
  assert.equal(analysis.structs[0].recursivePointer, true);
  assert.equal(analysis.enums.length, 1);
  assert.equal(analysis.enums[0].name, 't_state');
  assert.ok(analysis.enums[0].members.includes('STATE_IDLE'));
  assert.ok(analysis.typedefs.some((alias) => alias.name === 't_size'));
  assert.ok(analysis.defines.some((define) => define.name === 'NODE_LIMIT' && define.value === '32'));
  assert.ok(analysis.staticDeclarations >= 4);
});

test('keeps executable C in runtime visualization mode', () => {
  const analysis = analyzeProjectFiles([
    { path: 'main.c', content: 'int main(void) { return 0; }\n' }
  ]);

  assert.equal(analysis.visualizationMode, 'runtime');
  assert.deepEqual(analysis.mainCandidates, ['main.c']);
});

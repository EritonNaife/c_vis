import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fileDescriptorExpression,
  isFileDescriptorParameter,
  preferredResourceFile,
  projectResourceFiles,
  resourcePathForFileDescriptorExpression
} from '../src/lib/function-inputs.js';

test('recognizes conventional file descriptor parameters', () => {
  assert.equal(isFileDescriptorParameter({ name: 'fd', type: 'int' }), true);
  assert.equal(isFileDescriptorParameter({ name: 'input_fd', type: 'const int' }), true);
  assert.equal(isFileDescriptorParameter({ name: 'file_descriptor', type: 'signed int' }), true);
  assert.equal(isFileDescriptorParameter({ name: 'index', type: 'int' }), false);
  assert.equal(isFileDescriptorParameter({ name: 'fd', type: 'int *' }), false);
});

test('keeps non-source text files as runtime resources', () => {
  assert.deepEqual(
    projectResourceFiles(['get_next_line.c', 'get_next_line.h', 'Makefile', 'input.txt', 'fixtures/sample.data']),
    ['fixtures/sample.data', 'input.txt']
  );
});

test('prefers a single conventional input fixture', () => {
  assert.equal(preferredResourceFile(['README.md', 'input.txt']), 'input.txt');
  assert.equal(preferredResourceFile(['a.txt', 'b.txt']), '');
});

test('generates and resolves a read-only project-file fd expression', () => {
  const expression = fileDescriptorExpression('fixtures/input.txt');
  assert.match(expression, /extern int open/);
  assert.match(expression, /open\("fixtures\/input\.txt", 0\)/);
  assert.equal(resourcePathForFileDescriptorExpression(expression, ['fixtures/input.txt']), 'fixtures/input.txt');
});

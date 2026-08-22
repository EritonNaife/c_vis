import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMiLine, parseResults, miQuote } from '../server/mi.js';

test('parses result records', () => {
  const parsed = parseMiLine('12^done,frame={level="0",func="main",file="src/main.c",line="6"}');
  assert.equal(parsed.token, 12);
  assert.equal(parsed.type, '^');
  assert.equal(parsed.class, 'done');
  assert.equal(parsed.results.frame.func, 'main');
  assert.equal(parsed.results.frame.line, '6');
});

test('parses lists of frames', () => {
  const parsed = parseResults('stack=[frame={level="0",func="main"},frame={level="1",func="start"}]');
  assert.deepEqual(parsed.stack, [
    { frame: { level: '0', func: 'main' } },
    { frame: { level: '1', func: 'start' } }
  ]);
});

test('decodes target output', () => {
  assert.equal(parseMiLine('@"pb\\n"').text, 'pb\n');
});

test('preserves raw inferior output', () => {
  const parsed = parseMiLine('  pb  ');
  assert.equal(parsed.type, 'raw');
  assert.equal(parsed.text, '  pb  ');
});

test('quotes debugger arguments', () => {
  assert.equal(miQuote('hello world'), '"hello world"');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRoot,
  diffRuntimeGraphs,
  linkedListModel,
  treeModel
} from '../src/lib/runtime-graph.js';

function pointer(type, target) {
  return { kind: 'pointer', type: `${type} *`, target, object: target, null: target === null, pointeeType: type };
}

function scalar(value) {
  return { kind: 'scalar', type: 'int', value };
}

test('classifies and walks recursive single-pointer structs as a linked list', () => {
  const runtime = {
    roots: [{ name: 'head', role: 'local', type: 'struct node *', value: pointer('struct node', '0x10') }],
    objects: [
      {
        id: '0x10', address: '0x10', type: 'struct node', kind: 'struct',
        fields: [
          { name: 'value', type: 'int', value: scalar(4) },
          { name: 'next', type: 'struct node *', value: pointer('struct node', '0x20') }
        ]
      },
      {
        id: '0x20', address: '0x20', type: 'struct node', kind: 'struct',
        fields: [
          { name: 'value', type: 'int', value: scalar(8) },
          { name: 'next', type: 'struct node *', value: pointer('struct node', null) }
        ]
      }
    ]
  };

  const classification = classifyRoot(runtime, runtime.roots[0]);
  assert.equal(classification.kind, 'linked-list');
  assert.equal(classification.linkField, 'next');
  assert.deepEqual(linkedListModel(runtime, classification).nodes.map((node) => node.id), ['0x10', '0x20']);
});

test('classifies two recursive pointer fields as a tree', () => {
  const runtime = {
    roots: [{ name: 'root', role: 'local', type: 'struct node *', value: pointer('struct node', '0x10') }],
    objects: [
      {
        id: '0x10', address: '0x10', type: 'struct node', kind: 'struct',
        fields: [
          { name: 'value', type: 'int', value: scalar(7) },
          { name: 'left', type: 'struct node *', value: pointer('struct node', '0x20') },
          { name: 'right', type: 'struct node *', value: pointer('struct node', '0x30') }
        ]
      },
      { id: '0x20', address: '0x20', type: 'struct node', kind: 'struct', fields: [] },
      { id: '0x30', address: '0x30', type: 'struct node', kind: 'struct', fields: [] }
    ]
  };

  const classification = classifyRoot(runtime, runtime.roots[0]);
  assert.equal(classification.kind, 'tree');
  assert.deepEqual(classification.childFields, ['left', 'right']);
  const model = treeModel(runtime, classification);
  assert.equal(model.nodes.length, 3);
  assert.equal(model.edges.length, 2);
});

test('classifies addressable arrays separately from object graphs', () => {
  const runtime = {
    roots: [{ name: 'values', role: 'local', type: 'int [3]', value: { kind: 'reference', type: 'int [3]', target: '0x40' } }],
    objects: [{
      id: '0x40', address: '0x40', type: 'int [3]', kind: 'array', length: 3,
      elements: [
        { index: 0, value: scalar(3) },
        { index: 1, value: scalar(1) },
        { index: 2, value: scalar(2) }
      ]
    }]
  };

  assert.equal(classifyRoot(runtime, runtime.roots[0]).kind, 'array');
});

test('diffs scalar, object and pointer transitions between snapshots', () => {
  const before = {
    roots: [
      { name: 'x', role: 'local', type: 'int', value: scalar(4) },
      { name: 'head', role: 'local', type: 'struct node *', value: pointer('struct node', '0x10') }
    ],
    objects: [{
      id: '0x10', address: '0x10', type: 'struct node', kind: 'struct',
      fields: [
        { name: 'value', type: 'int', value: scalar(4) },
        { name: 'next', type: 'struct node *', value: pointer('struct node', '0x20') }
      ]
    }, {
      id: '0x20', address: '0x20', type: 'struct node', kind: 'struct', fields: []
    }]
  };

  const after = {
    roots: [
      { name: 'x', role: 'local', type: 'int', value: scalar(9) },
      { name: 'head', role: 'local', type: 'struct node *', value: pointer('struct node', '0x20') }
    ],
    objects: [{
      id: '0x20', address: '0x20', type: 'struct node', kind: 'struct', fields: []
    }]
  };

  const diff = diffRuntimeGraphs(before, after);
  assert.deepEqual(diff.removed, ['0x10']);
  assert.deepEqual(diff.scalarChanges, [{ name: 'x', from: '4', to: '9' }]);
  assert.ok(diff.pointerChanges.some((change) => change.key === 'root:head' && change.from === '0x10' && change.to === '0x20'));
});

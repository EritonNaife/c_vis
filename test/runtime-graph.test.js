import test from 'node:test';
import assert from 'node:assert/strict';
import {
  charArrayText,
  classifyRoot,
  diffRuntimeGraphs,
  linkedListModel,
  memoryModel,
  presentationRoots,
  queueModel,
  stackModel,
  treeModel
} from '../src/lib/runtime-graph.js';

function pointer(type, target) {
  return { kind: 'pointer', type: `${type} *`, target, object: target, null: target === null, pointeeType: type };
}

function scalar(value, type = 'int') {
  return { kind: 'scalar', type, value };
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
  const model = linkedListModel(runtime, classification);
  assert.deepEqual(model.nodes.map((node) => node.id), ['0x10', '0x20']);
  assert.deepEqual(model.nodes.map((node) => node.value), ['4', '8']);
});

test('uses root vocabulary to project recursive chains as stacks and queues', () => {
  const objects = [
    { id: '0x10', address: '0x10', type: 'struct node', kind: 'struct', fields: [
      { name: 'data', type: 'int', value: scalar(3) },
      { name: 'next', type: 'struct node *', value: pointer('struct node', '0x20') }
    ] },
    { id: '0x20', address: '0x20', type: 'struct node', kind: 'struct', fields: [
      { name: 'data', type: 'int', value: scalar(2) },
      { name: 'next', type: 'struct node *', value: pointer('struct node', null) }
    ] }
  ];

  const stackRuntime = { roots: [{ name: 'top', role: 'local', type: 'struct node *', value: pointer('struct node', '0x10') }], objects };
  const stackClassification = classifyRoot(stackRuntime, stackRuntime.roots[0]);
  assert.equal(stackClassification.kind, 'stack');
  assert.deepEqual(stackModel(stackRuntime, stackClassification).nodes.map((node) => node.value), ['3', '2']);

  const queueRuntime = {
    roots: [
      { name: 'front', role: 'local', type: 'struct node *', value: pointer('struct node', '0x10') },
      { name: 'rear', role: 'local', type: 'struct node *', value: pointer('struct node', '0x20') }
    ],
    objects
  };
  const queueClassification = classifyRoot(queueRuntime, queueRuntime.roots[0]);
  assert.equal(queueClassification.kind, 'queue');
  assert.equal(queueModel(queueRuntime, queueClassification).rear, '0x20');
  assert.equal(presentationRoots(queueRuntime).filter((item) => item.kind === 'queue').length, 1);
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
  assert.equal(model.nodes[0].displayValue, '7');
});

test('classifies addressable arrays and char arrays into readable projections', () => {
  const values = {
    id: '0x40', address: '0x40', type: 'int [3]', kind: 'array', length: 3,
    elements: [
      { index: 0, value: scalar(3) },
      { index: 1, value: scalar(1) },
      { index: 2, value: scalar(2) }
    ]
  };
  const runtime = {
    roots: [{ name: 'values', role: 'local', type: 'int [3]', value: { kind: 'reference', type: 'int [3]', target: '0x40' } }],
    objects: [values]
  };
  assert.equal(classifyRoot(runtime, runtime.roots[0]).kind, 'array');

  const greeting = {
    id: '0x50', address: '0x50', type: 'char [3]', kind: 'array', length: 3,
    elements: [
      { index: 0, address: '0x50', value: { kind: 'scalar', type: 'char', value: 72, character: 'H' } },
      { index: 1, address: '0x51', value: { kind: 'scalar', type: 'char', value: 105, character: 'i' } },
      { index: 2, address: '0x52', value: { kind: 'scalar', type: 'char', value: 0, character: '\u0000' } }
    ]
  };
  const stringRuntime = {
    roots: [{ name: 'greeting', role: 'local', type: 'char [3]', value: { kind: 'reference', type: 'char [3]', target: '0x50' } }],
    objects: [greeting]
  };
  assert.equal(charArrayText(greeting), 'Hi');
  assert.equal(classifyRoot(stringRuntime, stringRuntime.roots[0]).kind, 'string-array');
});

test('memory model keeps local arrays in frames and resolves pointers into subobjects', () => {
  const runtime = {
    frames: [
      {
        id: 'frame:0', level: 0, function: 'reverse_string', roots: [
          { name: 'str', role: 'argument', type: 'char *', address: '0x900', value: { kind: 'pointer', type: 'char *', target: '0x501', null: false } }
        ]
      },
      {
        id: 'frame:1', level: 1, function: 'main', roots: [
          { name: 'greeting', role: 'local', type: 'char [3]', address: '0x500', value: { kind: 'reference', type: 'char [3]', target: '0x500' } }
        ]
      }
    ],
    roots: [{ name: 'str', role: 'argument', type: 'char *', address: '0x900', value: { kind: 'pointer', type: 'char *', target: '0x501', null: false } }],
    objects: [{
      id: '0x500', address: '0x500', type: 'char [3]', kind: 'array', storage: 'stack', ownerFrame: 'frame:1', length: 3,
      elements: [
        { index: 0, address: '0x500', value: { kind: 'scalar', type: 'char', value: 72, character: 'H' } },
        { index: 1, address: '0x501', value: { kind: 'scalar', type: 'char', value: 105, character: 'i' } },
        { index: 2, address: '0x502', value: { kind: 'scalar', type: 'char', value: 0, character: '\u0000' } }
      ]
    }]
  };

  const model = memoryModel(runtime);
  assert.equal(model.frames.length, 2);
  assert.equal(model.referencedObjects.length, 0);
  const strReference = model.references.find((reference) => reference.source === 'reverse_string.str');
  assert.equal(strReference.targetLocation.kind, 'element');
  assert.equal(strReference.targetLocation.label, 'char [3][1]');
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

function mapObjects(runtime) {
  return new Map((runtime?.objects ?? []).map((object) => [object.id, object]));
}

function descriptorTarget(value) {
  if (!value) return null;
  if (value.kind === 'reference') return value.target ?? null;
  if (value.kind === 'pointer') return value.object ?? value.target ?? null;
  return null;
}

function pointerFields(object) {
  return (object?.fields ?? []).filter((field) => field?.value?.kind === 'pointer');
}

function sameTypePointerFields(runtime, object) {
  const objects = mapObjects(runtime);
  return pointerFields(object).filter((field) => {
    const target = field.value?.object ?? field.value?.target;
    if (!target) return false;
    const targetObject = objects.get(target);
    return targetObject && targetObject.type === object.type;
  });
}

function rootObject(runtime, root) {
  const target = descriptorTarget(root?.value);
  if (!target) return null;
  return mapObjects(runtime).get(target) ?? null;
}

export function valueText(value) {
  if (!value) return '—';
  if (value.kind === 'pointer') {
    if (value.null) return 'NULL';
    if (value.string !== undefined) return `"${value.string}"`;
    return value.target ?? value.object ?? 'pointer';
  }
  if (value.kind === 'reference') return value.target ?? 'object';
  if (value.kind === 'enum') return value.label ?? String(value.value ?? '—');
  if (value.kind === 'scalar') {
    if (value.character && value.character !== '\u0000') return `${String(value.value)} '${value.character}'`;
    return String(value.value ?? '—');
  }
  if (value.kind === 'unavailable') return 'unavailable';
  return String(value.value ?? value.target ?? value.kind ?? '—');
}

export function classifyRoot(runtime, root) {
  const value = root?.value;
  if (!value) return { kind: 'unknown', root };

  if (value.kind === 'scalar' || value.kind === 'enum') return { kind: 'scalar', root };
  if (value.kind === 'pointer' && value.string !== undefined) return { kind: 'string', root };
  if (value.kind === 'pointer' && value.null) return { kind: 'pointer', root };

  const object = rootObject(runtime, root);
  if (!object) return { kind: value.kind === 'pointer' ? 'pointer' : 'unknown', root };
  if (object.kind === 'array') return { kind: 'array', root, object };
  if (object.kind === 'scalar') return { kind: 'scalar-reference', root, object };
  if (!['struct', 'union'].includes(object.kind)) return { kind: 'object', root, object };

  const recursiveFields = sameTypePointerFields(runtime, object);
  if (recursiveFields.length === 1) {
    return { kind: 'linked-list', root, object, linkField: recursiveFields[0].name };
  }
  if (recursiveFields.length >= 2) {
    const names = recursiveFields.map((field) => field.name.toLowerCase());
    const left = recursiveFields.find((field) => field.name.toLowerCase() === 'left');
    const right = recursiveFields.find((field) => field.name.toLowerCase() === 'right');
    if ((left && right) || recursiveFields.length === 2 || names.some((name) => name.includes('child'))) {
      return {
        kind: 'tree',
        root,
        object,
        childFields: left && right ? [left.name, right.name] : recursiveFields.slice(0, 2).map((field) => field.name)
      };
    }
  }

  return { kind: 'struct', root, object };
}

export function linkedListModel(runtime, classification, limit = 48) {
  const objects = mapObjects(runtime);
  const nodes = [];
  const seen = new Set();
  let current = classification?.object ?? null;
  const linkField = classification?.linkField;

  while (current && !seen.has(current.id) && nodes.length < limit) {
    seen.add(current.id);
    const fields = current.fields ?? [];
    const link = fields.find((field) => field.name === linkField);
    nodes.push({
      id: current.id,
      address: current.address,
      type: current.type,
      fields: fields.filter((field) => field.name !== linkField),
      link: link?.value ?? null
    });
    const nextId = link?.value?.object ?? link?.value?.target ?? null;
    current = nextId ? objects.get(nextId) ?? null : null;
  }

  return {
    nodes,
    cyclic: Boolean(current && seen.has(current.id)),
    truncated: Boolean(current && nodes.length >= limit),
    linkField
  };
}

export function treeModel(runtime, classification, limit = 63) {
  const objects = mapObjects(runtime);
  const childFields = classification?.childFields ?? [];
  const root = classification?.object ?? null;
  if (!root) return { nodes: [], edges: [], childFields };

  const nodes = [];
  const edges = [];
  const queue = [{ object: root, depth: 0, slot: 0 }];
  const seen = new Set();

  while (queue.length && nodes.length < limit) {
    const current = queue.shift();
    if (!current?.object || seen.has(current.object.id)) continue;
    seen.add(current.object.id);
    nodes.push({ ...current.object, depth: current.depth, slot: current.slot });

    childFields.forEach((fieldName, childIndex) => {
      const field = (current.object.fields ?? []).find((candidate) => candidate.name === fieldName);
      const target = field?.value?.object ?? field?.value?.target ?? null;
      if (!target) return;
      const child = objects.get(target);
      if (!child) return;
      edges.push({ from: current.object.id, to: child.id, field: fieldName });
      queue.push({ object: child, depth: current.depth + 1, slot: current.slot * 2 + childIndex });
    });
  }

  return { nodes, edges, childFields, truncated: queue.length > 0 };
}

export function objectGraph(runtime, root) {
  const objects = mapObjects(runtime);
  const start = descriptorTarget(root?.value);
  const reachable = [];
  const edges = [];
  const seen = new Set();
  const queue = start ? [start] : [];

  while (queue.length && reachable.length < 64) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    const object = objects.get(id);
    if (!object) continue;
    seen.add(id);
    reachable.push(object);

    for (const field of object.fields ?? []) {
      const target = descriptorTarget(field.value);
      if (!target || !objects.has(target)) continue;
      edges.push({ from: object.id, to: target, field: field.name });
      if (!seen.has(target)) queue.push(target);
    }
    for (const element of object.elements ?? []) {
      const target = descriptorTarget(element.value);
      if (!target || !objects.has(target)) continue;
      edges.push({ from: object.id, to: target, field: `[${element.index}]` });
      if (!seen.has(target)) queue.push(target);
    }
  }

  return { objects: reachable, edges };
}

function stableObjectSignature(object) {
  if (!object) return '';
  return JSON.stringify({
    kind: object.kind,
    type: object.type,
    value: object.value,
    fields: object.fields,
    elements: object.elements
  });
}

function pointerMap(runtime) {
  const pointers = new Map();
  for (const root of runtime?.roots ?? []) {
    if (root?.value?.kind === 'pointer' || root?.value?.kind === 'reference') {
      pointers.set(`root:${root.name}`, descriptorTarget(root.value));
    }
  }
  for (const object of runtime?.objects ?? []) {
    for (const field of object.fields ?? []) {
      if (field?.value?.kind === 'pointer' || field?.value?.kind === 'reference') {
        pointers.set(`${object.id}.${field.name}`, descriptorTarget(field.value));
      }
    }
    for (const element of object.elements ?? []) {
      if (element?.value?.kind === 'pointer' || element?.value?.kind === 'reference') {
        pointers.set(`${object.id}[${element.index}]`, descriptorTarget(element.value));
      }
    }
  }
  return pointers;
}

function scalarRootMap(runtime) {
  const values = new Map();
  for (const root of runtime?.roots ?? []) {
    if (['scalar', 'enum'].includes(root?.value?.kind)) values.set(root.name, valueText(root.value));
  }
  return values;
}

export function diffRuntimeGraphs(previous, current) {
  const before = mapObjects(previous);
  const after = mapObjects(current);
  const created = [];
  const removed = [];
  const changed = [];

  for (const [id, object] of after) {
    if (!before.has(id)) created.push(id);
    else if (stableObjectSignature(before.get(id)) !== stableObjectSignature(object)) changed.push(id);
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removed.push(id);
  }

  const beforePointers = pointerMap(previous);
  const afterPointers = pointerMap(current);
  const pointerChanges = [];
  const pointerKeys = new Set([...beforePointers.keys(), ...afterPointers.keys()]);
  for (const key of pointerKeys) {
    const from = beforePointers.get(key) ?? null;
    const to = afterPointers.get(key) ?? null;
    if (from !== to) pointerChanges.push({ key, from, to });
  }

  const beforeScalars = scalarRootMap(previous);
  const afterScalars = scalarRootMap(current);
  const scalarChanges = [];
  const scalarKeys = new Set([...beforeScalars.keys(), ...afterScalars.keys()]);
  for (const name of scalarKeys) {
    const from = beforeScalars.get(name);
    const to = afterScalars.get(name);
    if (from !== to) scalarChanges.push({ name, from, to });
  }

  return {
    created,
    removed,
    changed,
    pointerChanges,
    scalarChanges,
    total: created.length + removed.length + changed.length + pointerChanges.length + scalarChanges.length
  };
}

export function presentationRoots(runtime) {
  return (runtime?.roots ?? []).map((root) => classifyRoot(runtime, root));
}

export function changedPointerKeys(diff) {
  return new Set((diff?.pointerChanges ?? []).map((change) => change.key));
}

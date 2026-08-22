<script>
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';
  import {
    changedPointerKeys,
    diffRuntimeGraphs,
    linkedListModel,
    objectGraph,
    presentationRoots,
    treeModel,
    valueText
  } from './runtime-graph.js';

  let { runtime, previousRuntime = null } = $props();

  const presentations = $derived(presentationRoots(runtime));
  const diff = $derived(diffRuntimeGraphs(previousRuntime, runtime));
  const created = $derived(new Set(diff.created));
  const changed = $derived(new Set(diff.changed));
  const pointerChanges = $derived(changedPointerKeys(diff));

  function isChanged(id) {
    return changed.has(id);
  }

  function isCreated(id) {
    return created.has(id);
  }

  function pointerChanged(objectId, field) {
    return pointerChanges.has(`${objectId}.${field}`);
  }

  function visibleFields(fields = []) {
    return fields.slice(0, 8);
  }

  function treeLevels(model) {
    const levels = new Map();
    for (const node of model.nodes ?? []) {
      if (!levels.has(node.depth)) levels.set(node.depth, []);
      levels.get(node.depth).push(node);
    }
    return [...levels.entries()].sort(([a], [b]) => a - b).map(([depth, nodes]) => ({ depth, nodes }));
  }
</script>

<section class="runtime-visualizer" aria-label="Runtime C visualization">
  <header class="runtime-visualizer-header">
    <div>
      <span class="eyebrow">semantic runtime</span>
      <h3>Live program model</h3>
    </div>
    <div class="runtime-change-summary" aria-label="Changes in this step">
      {#if diff.total === 0}
        <span>no state change</span>
      {:else}
        {#if diff.created.length}<span class="created">+{diff.created.length} created</span>{/if}
        {#if diff.removed.length}<span class="removed">−{diff.removed.length} removed</span>{/if}
        {#if diff.changed.length}<span>{diff.changed.length} changed</span>{/if}
        {#if diff.pointerChanges.length}<span>{diff.pointerChanges.length} pointer {diff.pointerChanges.length === 1 ? 'move' : 'moves'}</span>{/if}
      {/if}
    </div>
  </header>

  {#if diff.scalarChanges.length || diff.pointerChanges.length}
    <div class="runtime-transition-strip" transition:fade={{ duration: 120 }}>
      {#each diff.scalarChanges.slice(0, 4) as change}
        <span><strong>{change.name}</strong> {change.from ?? '—'} → {change.to ?? '—'}</span>
      {/each}
      {#each diff.pointerChanges.slice(0, 4) as change}
        <span><strong>{change.key}</strong> {change.from ?? 'NULL'} → {change.to ?? 'NULL'}</span>
      {/each}
    </div>
  {/if}

  <div class="runtime-root-list">
    {#each presentations as presentation (presentation.root.name)}
      <article class="runtime-root-card">
        <header class="runtime-root-heading">
          <div>
            <span class="runtime-root-role">{presentation.root.role}</span>
            <strong>{presentation.root.name}</strong>
            <code>{presentation.root.type}</code>
          </div>
          <span class="runtime-kind-badge">{presentation.kind}</span>
        </header>

        {#if presentation.kind === 'scalar'}
          <div class="runtime-scalar" class:changed={diff.scalarChanges.some((change) => change.name === presentation.root.name)}>
            <span>{valueText(presentation.root.value)}</span>
          </div>
        {:else if presentation.kind === 'string'}
          <div class="runtime-string">
            <span class="quote">“</span><code>{presentation.root.value.string}</code><span class="quote">”</span>
            <small>{presentation.root.value.target}</small>
          </div>
        {:else if presentation.kind === 'pointer'}
          <div class="runtime-pointer" class:changed={pointerChanges.has(`root:${presentation.root.name}`)}>
            <span>{presentation.root.name}</span><b>→</b><code>{presentation.root.value.null ? 'NULL' : presentation.root.value.target}</code>
          </div>
        {:else if presentation.kind === 'array'}
          <div class="runtime-array" class:changed={isChanged(presentation.object.id)}>
            {#each presentation.object.elements ?? [] as element (element.index)}
              <div class="runtime-array-cell">
                <small>[{element.index}]</small>
                <strong>{valueText(element.value)}</strong>
              </div>
            {/each}
            {#if presentation.object.length > (presentation.object.elements?.length ?? 0)}
              <div class="runtime-array-cell more">+{presentation.object.length - presentation.object.elements.length}</div>
            {/if}
          </div>
        {:else if presentation.kind === 'linked-list'}
          {@const model = linkedListModel(runtime, presentation)}
          <div class="runtime-chain" aria-label={`${presentation.root.name} linked list`}>
            {#each model.nodes as node, index (node.id)}
              <div class="runtime-chain-item" animate:flip={{ duration: 180 }} transition:fly={{ y: -8, duration: 140 }}>
                <div class="runtime-object-card" class:created={isCreated(node.id)} class:changed={isChanged(node.id)}>
                  <div class="runtime-object-address"><code>{node.address}</code></div>
                  {#each visibleFields(node.fields) as field}
                    <div class="runtime-field">
                      <span>{field.name}</span>
                      <strong>{valueText(field.value)}</strong>
                    </div>
                  {/each}
                </div>
                {#if index < model.nodes.length - 1 || node.link?.target}
                  <div class:changed={pointerChanged(node.id, model.linkField)} class="runtime-edge">
                    <small>{model.linkField}</small><b>→</b>
                  </div>
                {:else}
                  <div class:changed={pointerChanged(node.id, model.linkField)} class="runtime-edge terminal">
                    <small>{model.linkField}</small><b>→ NULL</b>
                  </div>
                {/if}
              </div>
            {/each}
            {#if model.cyclic}<span class="runtime-cycle">↺ cycle</span>{/if}
            {#if model.truncated}<span class="runtime-cycle">… truncated</span>{/if}
          </div>
        {:else if presentation.kind === 'tree'}
          {@const model = treeModel(runtime, presentation)}
          <div class="runtime-tree" aria-label={`${presentation.root.name} tree`}>
            {#each treeLevels(model) as level (level.depth)}
              <div class="runtime-tree-level">
                {#each level.nodes as node (node.id)}
                  <div class="runtime-tree-node" class:created={isCreated(node.id)} class:changed={isChanged(node.id)}>
                    <code>{node.address}</code>
                    {#each visibleFields((node.fields ?? []).filter((field) => !model.childFields.includes(field.name))) as field}
                      <div><span>{field.name}</span><strong>{valueText(field.value)}</strong></div>
                    {/each}
                    <small>{model.childFields.join(' · ')}</small>
                  </div>
                {/each}
              </div>
            {/each}
            <div class="runtime-tree-edges">
              {#each model.edges as edge}
                <span class:changed={pointerChanged(edge.from, edge.field)}><code>{edge.from}</code>.{edge.field} → <code>{edge.to}</code></span>
              {/each}
            </div>
          </div>
        {:else if presentation.kind === 'struct' || presentation.kind === 'scalar-reference'}
          <div class="runtime-struct" class:created={isCreated(presentation.object.id)} class:changed={isChanged(presentation.object.id)}>
            <header><span>{presentation.object.kind}</span><code>{presentation.object.address}</code></header>
            {#each visibleFields(presentation.object.fields ?? []) as field}
              <div class:changed={pointerChanged(presentation.object.id, field.name)} class="runtime-field">
                <span>{field.name}</span>
                <code>{field.type}</code>
                <strong>{valueText(field.value)}</strong>
              </div>
            {/each}
            {#if presentation.object.kind === 'scalar'}<strong>{presentation.object.value}</strong>{/if}
          </div>
        {:else}
          {@const graph = objectGraph(runtime, presentation.root)}
          <div class="runtime-object-graph">
            <div class="runtime-object-grid">
              {#each graph.objects as object (object.id)}
                <div class="runtime-object-card" class:created={isCreated(object.id)} class:changed={isChanged(object.id)}>
                  <div class="runtime-object-address"><code>{object.address}</code><small>{object.type}</small></div>
                  {#each visibleFields(object.fields ?? []) as field}
                    <div class:changed={pointerChanged(object.id, field.name)} class="runtime-field">
                      <span>{field.name}</span><strong>{valueText(field.value)}</strong>
                    </div>
                  {/each}
                </div>
              {/each}
            </div>
            {#if graph.edges.length}
              <div class="runtime-graph-edges">
                {#each graph.edges as edge}
                  <span class:changed={pointerChanged(edge.from, edge.field)}><code>{edge.from}</code>.{edge.field} → <code>{edge.to}</code></span>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </article>
    {/each}
  </div>

  {#if runtime?.truncated}
    <div class="runtime-limit-note">Visualization was safely bounded by the runtime inspection limits. The program continues normally.</div>
  {/if}
</section>

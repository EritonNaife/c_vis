<script>
  import { fade } from 'svelte/transition';
  import ArrayStructure from './ArrayStructure.svelte';
  import LinearStructure from './LinearStructure.svelte';
  import ObjectGraphStructure from './ObjectGraphStructure.svelte';
  import TreeStructure from './TreeStructure.svelte';
  import {
    changedPointerKeys,
    diffRuntimeGraphs,
    linkedListModel,
    objectGraph,
    presentationRoots,
    queueModel,
    stackModel,
    treeModel,
    valueText
  } from './runtime-graph.js';

  let { runtime, previousRuntime = null } = $props();

  const presentations = $derived(presentationRoots(runtime));
  const diff = $derived(diffRuntimeGraphs(previousRuntime, runtime));
  const created = $derived(new Set(diff.created));
  const changed = $derived(new Set(diff.changed));
  const pointerChanges = $derived(changedPointerKeys(diff));
  const scalarPresentations = $derived(presentations.filter((item) => ['scalar', 'scalar-reference'].includes(item.kind)));
  const pointerPresentations = $derived(presentations.filter((item) => item.kind === 'pointer'));
  const visualPresentations = $derived(presentations.filter((item) => !['scalar', 'scalar-reference', 'pointer'].includes(item.kind)));

  function pointerChanged(objectId, field) {
    return pointerChanges.has(`${objectId}.${field}`);
  }

  function rootPointerChanged(name) {
    return pointerChanges.has(`root:${name}`);
  }

  function visibleFields(fields = []) {
    return fields.slice(0, 10);
  }
</script>

<section class="runtime-visualizer" aria-label="Runtime C visualization">
  <header class="runtime-visualizer-header">
    <div>
      <span class="eyebrow">program</span>
      <h3>What the data looks like</h3>
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
      {#each diff.scalarChanges.slice(0, 5) as change}
        <span><strong>{change.name}</strong> {change.from ?? '—'} → {change.to ?? '—'}</span>
      {/each}
      {#each diff.pointerChanges.slice(0, 5) as change}
        <span><strong>{change.key.replace('root:', '')}</strong> moved</span>
      {/each}
    </div>
  {/if}

  <div class="semantic-stage-list">
    {#each visualPresentations as presentation (presentation.root.name)}
      {#if presentation.kind === 'array' || presentation.kind === 'string-array'}
        <ArrayStructure
          name={presentation.root.name}
          object={presentation.object}
          text={presentation.kind === 'string-array' ? presentation.text : null}
          changed={changed.has(presentation.object.id)}
        />
      {:else if presentation.kind === 'string'}
        <section class="ds-stage ds-string">
          <header class="ds-stage-header">
            <div><span class="ds-type">String</span><strong>{presentation.root.name}</strong></div>
            <small>{presentation.root.type}</small>
          </header>
          <div class="string-hero">“{presentation.root.value.string}”</div>
        </section>
      {:else if ['linked-list', 'stack', 'queue'].includes(presentation.kind)}
        {@const model = presentation.kind === 'stack'
          ? stackModel(runtime, presentation)
          : presentation.kind === 'queue'
            ? queueModel(runtime, presentation)
            : linkedListModel(runtime, presentation)}
        <LinearStructure
          kind={presentation.kind}
          name={presentation.root.name}
          {model}
          changedIds={changed}
          createdIds={created}
          {pointerChanged}
        />
      {:else if presentation.kind === 'tree'}
        {@const model = treeModel(runtime, presentation)}
        <TreeStructure name={presentation.root.name} {model} changedIds={changed} createdIds={created} />
      {:else if presentation.kind === 'graph' || presentation.kind === 'object'}
        {@const graph = objectGraph(runtime, presentation.root)}
        <ObjectGraphStructure name={presentation.root.name} {graph} changedIds={changed} createdIds={created} />
      {:else if presentation.kind === 'struct'}
        <section class="ds-stage ds-struct">
          <header class="ds-stage-header">
            <div><span class="ds-type">{presentation.object.kind}</span><strong>{presentation.root.name}</strong></div>
            <small>{presentation.object.type}</small>
          </header>
          <div class="struct-card" class:changed={changed.has(presentation.object.id)}>
            {#each visibleFields(presentation.object.fields ?? []) as field}
              <div class="struct-field" class:changed={pointerChanged(presentation.object.id, field.name)}>
                <span>{field.name}</span>
                <small>{field.type}</small>
                <strong>{valueText(field.value)}</strong>
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {/each}

    {#if scalarPresentations.length}
      <section class="ds-stage ds-values">
        <header class="ds-stage-header">
          <div><span class="ds-type">Values</span><strong>Current scope</strong></div>
          <small>{scalarPresentations.length} values</small>
        </header>
        <div class="value-grid">
          {#each scalarPresentations as presentation (presentation.root.name)}
            <div class="value-tile" class:changed={diff.scalarChanges.some((change) => change.name === presentation.root.name)}>
              <span>{presentation.root.name}</span>
              <small>{presentation.root.type}</small>
              <strong>{presentation.kind === 'scalar-reference' ? presentation.object?.value ?? '—' : valueText(presentation.root.value)}</strong>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if pointerPresentations.length}
      <section class="ds-stage ds-pointers">
        <header class="ds-stage-header">
          <div><span class="ds-type">Pointers</span><strong>References</strong></div>
          <small>{pointerPresentations.length}</small>
        </header>
        <div class="pointer-grid">
          {#each pointerPresentations as presentation (presentation.root.name)}
            <div class="pointer-tile" class:changed={rootPointerChanged(presentation.root.name)}>
              <span>{presentation.root.name}</span>
              <b>→</b>
              <strong>{presentation.root.value.null ? 'NULL' : presentation.root.value.target ?? 'unresolved'}</strong>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </div>

  {#if runtime?.truncated}
    <div class="runtime-limit-note">The visual model was safely bounded. Execution itself is unaffected.</div>
  {/if}
</section>

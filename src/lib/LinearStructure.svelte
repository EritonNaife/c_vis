<script>
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';

  let { kind, name, model, changedIds = new Set(), createdIds = new Set(), pointerChanged = () => false } = $props();

  const label = $derived(kind === 'stack' ? 'Stack' : kind === 'queue' ? 'Queue' : 'Linked list');

  function changed(node) {
    return changedIds.has(node.id);
  }

  function created(node) {
    return createdIds.has(node.id);
  }
</script>

<section class={`ds-stage ds-${kind}`} aria-label={`${name} ${label}`}>
  <header class="ds-stage-header">
    <div>
      <span class="ds-type">{label}</span>
      <strong>{name}</strong>
    </div>
    <small>{model.nodes.length} {model.nodes.length === 1 ? 'item' : 'items'}</small>
  </header>

  {#if kind === 'stack'}
    <div class="stack-visual">
      <div class="stack-top-label">top ↓</div>
      <div class="stack-shell">
        {#if !model.nodes.length}
          <div class="ds-empty">empty</div>
        {/if}
        {#each model.nodes as node (node.id)}
          <div
            class="stack-slot"
            class:changed={changed(node)}
            class:created={created(node)}
            animate:flip={{ duration: 180 }}
            transition:fly={{ y: -12, duration: 150 }}
            title={`${node.type} · ${node.address}`}
          >
            <strong>{node.value}</strong>
          </div>
        {/each}
      </div>
      <div class="stack-base">base</div>
    </div>
  {:else if kind === 'queue'}
    <div class="queue-visual">
      <div class="queue-label-row"><span>→ Front</span><span>Rear →</span></div>
      <div class="queue-shell">
        {#if !model.nodes.length}
          <div class="ds-empty">empty</div>
        {/if}
        {#each model.nodes as node (node.id)}
          <div
            class="queue-slot"
            class:changed={changed(node)}
            class:created={created(node)}
            animate:flip={{ duration: 180 }}
            transition:fly={{ x: -12, duration: 150 }}
            title={`${node.type} · ${node.address}`}
          >
            <strong>{node.value}</strong>
          </div>
        {/each}
      </div>
      <div class="queue-size">Queue size: {model.nodes.length}</div>
    </div>
  {:else}
    <div class="list-visual">
      <div class="list-head">head</div>
      <div class="list-chain">
        {#if !model.nodes.length}
          <div class="ds-empty">NULL</div>
        {/if}
        {#each model.nodes as node, index (node.id)}
          <div class="list-segment" animate:flip={{ duration: 180 }} transition:fade={{ duration: 130 }}>
            <div
              class="list-node"
              class:changed={changed(node)}
              class:created={created(node)}
              title={`${node.type} · ${node.address}`}
            >
              <strong>{node.value}</strong>
            </div>
            {#if index < model.nodes.length - 1}
              <div class="list-arrow" class:changed={pointerChanged(node.id, model.linkField)}>→</div>
            {:else}
              <div class="list-arrow terminal" class:changed={pointerChanged(node.id, model.linkField)}>→ <span>NULL</span></div>
            {/if}
          </div>
        {/each}
        {#if model.cyclic}<div class="cycle-badge">↺ cycle</div>{/if}
        {#if model.truncated}<div class="cycle-badge">… more</div>{/if}
      </div>
    </div>
  {/if}
</section>

<script>
  let { label, nodes = [], previousNodes = [], compact = false } = $props();
  let selected = $state(null);

  const previousByAddress = $derived(new Map(previousNodes.map((node) => [node.address, node])));

  function changed(node) {
    const previous = previousByAddress.get(node.address);
    return !previous || previous.value !== node.value || previous.index !== node.index;
  }

  function toggle(node) {
    selected = selected === node.address ? null : node.address;
  }
</script>

<section class="stack-diagram" class:compact>
  <div class="stack-heading">
    <div>
      <span class="eyebrow">stack</span>
      <strong>{label}</strong>
    </div>
    <span class="count">{nodes.length}</span>
  </div>

  {#if nodes.length}
    <div class="stack-track" aria-label={`Stack ${label}`}>
      <span class="top-marker">TOP</span>
      {#each nodes as node, index (node.address)}
        <button
          type="button"
          class:changed={changed(node)}
          class:selected={selected === node.address}
          class="stack-node"
          onclick={() => toggle(node)}
          aria-label={`Stack ${label} node ${node.value}, index ${node.index}`}
        >
          <span class="node-position">{index}</span>
          <span class="node-value">{node.value}</span>
          <span class="node-index">idx {node.index}</span>
          {#if selected === node.address}
            <span class="node-detail"><code>{node.address}</code><span>next → {node.next === '0x0' ? 'NULL' : node.next}</span></span>
          {/if}
        </button>
      {/each}
    </div>
  {:else}
    <div class="empty-state">empty</div>
  {/if}
</section>

<script>
  let { name, model, changedIds = new Set(), createdIds = new Set() } = $props();

  const width = 760;
  const levelGap = 120;
  const margin = 64;
  const maxDepth = $derived(Math.max(0, ...(model.nodes ?? []).map((node) => node.depth ?? 0)));
  const height = $derived(Math.max(220, margin * 2 + (maxDepth + 1) * levelGap));
  const positions = $derived.by(() => {
    const result = new Map();
    for (const node of model.nodes ?? []) {
      const count = Math.max(1, 2 ** (node.depth ?? 0));
      const x = ((node.slot ?? 0) + 0.5) * (width - margin * 2) / count + margin;
      const y = margin + (node.depth ?? 0) * levelGap;
      result.set(node.id, { x, y });
    }
    return result;
  });

  function stateClass(node) {
    if (createdIds.has(node.id)) return 'created';
    if (changedIds.has(node.id)) return 'changed';
    return '';
  }
</script>

<section class="ds-stage ds-tree" aria-label={`${name} tree`}>
  <header class="ds-stage-header">
    <div>
      <span class="ds-type">Tree</span>
      <strong>{name}</strong>
    </div>
    <small>{model.nodes.length} nodes</small>
  </header>

  <div class="tree-canvas-wrap">
    <svg class="tree-canvas" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${name} tree graph`}>
      {#each model.edges ?? [] as edge}
        {@const from = positions.get(edge.from)}
        {@const to = positions.get(edge.to)}
        {#if from && to}
          <line class="tree-edge" x1={from.x} y1={from.y + 34} x2={to.x} y2={to.y - 34} />
        {/if}
      {/each}

      {#each model.nodes ?? [] as node (node.id)}
        {@const position = positions.get(node.id)}
        {#if position}
          <g class={`tree-node ${stateClass(node)}`} transform={`translate(${position.x} ${position.y})`}>
            <title>{node.type} · {node.address}</title>
            <circle r="35" />
            <text text-anchor="middle" dominant-baseline="middle">{node.displayValue}</text>
          </g>
        {/if}
      {/each}
    </svg>
  </div>
</section>

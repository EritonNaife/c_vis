<script>
  let { name, graph, changedIds = new Set(), createdIds = new Set() } = $props();

  const width = 760;
  const height = 430;
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = 255;
  const radiusY = 135;
  const positions = $derived.by(() => {
    const result = new Map();
    const count = Math.max(1, graph.objects?.length ?? 0);
    (graph.objects ?? []).forEach((object, index) => {
      if (count === 1) {
        result.set(object.id, { x: centerX, y: centerY });
        return;
      }
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
      result.set(object.id, {
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY
      });
    });
    return result;
  });

  function stateClass(object) {
    if (createdIds.has(object.id)) return 'created';
    if (changedIds.has(object.id)) return 'changed';
    return '';
  }
</script>

<section class="ds-stage ds-graph" aria-label={`${name} object graph`}>
  <header class="ds-stage-header">
    <div>
      <span class="ds-type">Object graph</span>
      <strong>{name}</strong>
    </div>
    <small>{graph.objects?.length ?? 0} nodes · {graph.edges?.length ?? 0} edges</small>
  </header>

  <div class="graph-canvas-wrap">
    <svg class="graph-canvas" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${name} object graph`}>
      <defs>
        <marker id="cvis-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
          <polygon points="0 0, 8 3.5, 0 7" />
        </marker>
      </defs>

      {#each graph.edges ?? [] as edge}
        {@const from = positions.get(edge.from)}
        {@const to = positions.get(edge.to)}
        {#if from && to}
          <line class="graph-edge" x1={from.x} y1={from.y} x2={to.x} y2={to.y} marker-end="url(#cvis-arrow)" />
        {/if}
      {/each}

      {#each graph.objects ?? [] as object (object.id)}
        {@const position = positions.get(object.id)}
        {#if position}
          <g class={`graph-node ${stateClass(object)}`} transform={`translate(${position.x} ${position.y})`}>
            <title>{object.type} · {object.address}</title>
            <circle r="37" />
            <text text-anchor="middle" dominant-baseline="middle">{object.displayValue}</text>
          </g>
        {/if}
      {/each}
    </svg>
  </div>
</section>

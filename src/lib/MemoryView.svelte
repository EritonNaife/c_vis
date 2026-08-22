<script>
  let { snapshot } = $props();
  const pushSwap = $derived(snapshot?.pushSwap?.available ? snapshot.pushSwap : null);
  const initialized = $derived(pushSwap ? pushSwap.initialized !== false : false);
  const completed = $derived(snapshot?.status === 'exited');
</script>

<div class="memory-view">
  <div class="state-title-row">
    <div>
      <span class="eyebrow">memory</span>
      <h2>{completed ? 'final captured state' : snapshot?.frame?.func ?? 'program'}</h2>
    </div>
    {#if completed}<span class="state-badge complete">process exited</span>{/if}
  </div>

  <section class="memory-section">
    <h3>Current frame</h3>
    {#if snapshot?.locals?.length}
      <div class="memory-table">
        {#each snapshot.locals as local}
          <div class="memory-row">
            <code>{local.name}</code>
            <code>{local.value ?? '—'}</code>
          </div>
        {/each}
      </div>
    {:else}
      <div class="memory-note">{completed ? 'The process has exited, so stack-frame locals are no longer live.' : 'No locals in the current frame.'}</div>
    {/if}
  </section>

  {#if pushSwap && initialized}
    <section class="memory-section">
      <h3>{completed ? 'Final linked nodes' : 'Linked nodes'}</h3>
      <div class="node-memory-grid">
        {#each [['A', pushSwap.a ?? []], ['B', pushSwap.b ?? []]] as [label, nodes]}
          <div>
            <span class="eyebrow">stack {label}</span>
            {#if nodes.length}
              {#each nodes as node}
                <div class="memory-node">
                  <code>{node.address}</code>
                  <span>value {node.value}</span>
                  <span>index {node.index}</span>
                </div>
              {/each}
            {:else}
              <div class="empty-state">empty</div>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {:else if pushSwap}
    <section class="memory-section">
      <h3>push_swap context</h3>
      <div class="memory-note">Not initialized yet. Raw context fields are intentionally not interpreted as valid runtime state.</div>
    </section>
  {/if}

  <section class="memory-section">
    <h3>Call stack</h3>
    {#if snapshot?.frames?.length}
      <div class="call-stack">
        {#each snapshot.frames as frame}
          <div><span>#{frame.level}</span><strong>{frame.func}</strong><code>{frame.projectPath ?? frame.file ?? ''}:{frame.line ?? ''}</code></div>
        {/each}
      </div>
    {:else}
      <div class="memory-note">{completed ? 'No live call stack after process exit.' : 'No call stack available.'}</div>
    {/if}
  </section>
</div>

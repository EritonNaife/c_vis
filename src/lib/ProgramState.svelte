<script>
  import StackDiagram from './StackDiagram.svelte';

  let { snapshot, previousSnapshot } = $props();

  const pushSwap = $derived(snapshot?.pushSwap?.available ? snapshot.pushSwap : null);
  const previousPushSwap = $derived(previousSnapshot?.pushSwap?.available ? previousSnapshot.pushSwap : null);
  const strategyNames = ['adaptive', 'simple', 'medium', 'complex'];

  function isPointer(value) {
    return typeof value === 'string' && /0x[0-9a-f]+/i.test(value);
  }
</script>

<div class="program-view">
  <div class="state-title-row">
    <div>
      <span class="eyebrow">program state</span>
      <h2>{snapshot?.frame?.func ?? 'program'}</h2>
    </div>
  </div>

  {#if snapshot?.locals?.length}
    <section class="locals-strip" aria-label="Local variables">
      {#each snapshot.locals as local (local.name)}
        <button class:pointer={isPointer(local.value)} class="local-card" type="button" title={local.type ?? local.name}>
          <span class="local-name">{local.name}</span>
          <strong>{local.value ?? '—'}</strong>
        </button>
      {/each}
    </section>
  {/if}

  {#if pushSwap}
    <section class="push-swap-visual">
      <div class="stacks-grid">
        <StackDiagram label="A" nodes={pushSwap.a} previousNodes={previousPushSwap?.a ?? []} />
        <StackDiagram label="B" nodes={pushSwap.b} previousNodes={previousPushSwap?.b ?? []} />
      </div>

      <div class="runtime-facts">
        <div><span>strategy</span><strong>{strategyNames[pushSwap.strategy] ?? pushSwap.strategy}</strong></div>
        <div><span>disorder</span><strong>{(pushSwap.disorder * 100).toFixed(1)}%</strong></div>
        <div><span>operations</span><strong>{pushSwap.ops?.total ?? 0}</strong></div>
      </div>
    </section>
  {:else}
    <section class="generic-state">
      <p>{snapshot?.pushSwap?.reason ?? 'Program-specific structures will appear when they enter scope.'}</p>
    </section>
  {/if}
</div>

<script>
  import StackDiagram from './StackDiagram.svelte';
  import RuntimeVisualizer from './RuntimeVisualizer.svelte';

  let { snapshot, previousSnapshot } = $props();

  const pushSwap = $derived(snapshot?.pushSwap?.available ? snapshot.pushSwap : null);
  const previousPushSwap = $derived(previousSnapshot?.pushSwap?.available && previousSnapshot.pushSwap.initialized !== false ? previousSnapshot.pushSwap : null);
  const runtime = $derived(snapshot?.runtime?.available ? snapshot.runtime : null);
  const previousRuntime = $derived(previousSnapshot?.runtime?.available ? previousSnapshot.runtime : null);
  const initialized = $derived(pushSwap ? pushSwap.initialized !== false : false);
  const completed = $derived(snapshot?.status === 'exited');
  const strategyNames = ['adaptive', 'simple', 'medium', 'complex'];

  function isPointer(value) {
    return typeof value === 'string' && /0x[0-9a-f]+/i.test(value);
  }

  function localValue(local) {
    if (local.name === 'ctx' && pushSwap && !initialized) return 'not initialized';
    return local.value ?? '—';
  }

  function strategyValue() {
    if (!initialized || pushSwap?.strategy === null || pushSwap?.strategy === undefined) return '—';
    return strategyNames[pushSwap.strategy] ?? pushSwap.strategy;
  }

  function disorderValue() {
    if (!initialized || typeof pushSwap?.disorder !== 'number' || !Number.isFinite(pushSwap.disorder)) return '—';
    return `${(pushSwap.disorder * 100).toFixed(1)}%`;
  }
</script>

<div class="program-view">
  <div class="state-title-row">
    <div>
      <span class="eyebrow">program state</span>
      <h2>{completed ? 'completed' : snapshot?.frame?.func ?? 'program'}</h2>
    </div>
    {#if completed}<span class="state-badge complete">final state</span>{/if}
  </div>

  {#if snapshot?.locals?.length}
    <section class="locals-strip" aria-label="Local variables">
      {#each snapshot.locals as local (local.name)}
        <button class:pointer={isPointer(local.value)} class="local-card" type="button" title={local.type ?? local.name}>
          <span class="local-name">{local.name}</span>
          <strong>{localValue(local)}</strong>
        </button>
      {/each}
    </section>
  {/if}

  {#if pushSwap && initialized}
    <section class="push-swap-visual">
      <div class="stacks-grid">
        <StackDiagram label="A" nodes={pushSwap.a ?? []} previousNodes={previousPushSwap?.a ?? []} />
        <StackDiagram label="B" nodes={pushSwap.b ?? []} previousNodes={previousPushSwap?.b ?? []} />
      </div>

      <div class="runtime-facts">
        <div><span>strategy</span><strong>{strategyValue()}</strong></div>
        <div><span>disorder</span><strong>{disorderValue()}</strong></div>
        <div><span>operations</span><strong>{pushSwap.ops?.total ?? '—'}</strong></div>
      </div>
    </section>
  {:else if pushSwap}
    <section class="context-uninitialized">
      <span class="eyebrow">push_swap context</span>
      <strong>Not initialized yet</strong>
      <p>{pushSwap.reason ?? 'The context exists in the current stack frame, but init_context has not established valid runtime state yet.'}</p>
      <div class="runtime-facts unavailable">
        <div><span>strategy</span><strong>—</strong></div>
        <div><span>disorder</span><strong>—</strong></div>
        <div><span>operations</span><strong>—</strong></div>
      </div>
    </section>
  {/if}

  {#if runtime?.roots?.length && !(pushSwap && initialized)}
    <RuntimeVisualizer {runtime} {previousRuntime} />
  {:else if !pushSwap}
    <section class="generic-state">
      <p>{runtime?.reason ?? 'Runtime data will appear as the program creates and uses it.'}</p>
    </section>
  {/if}
</div>

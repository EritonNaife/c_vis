<script>
  let {
    index = 0,
    total = 0,
    complete = false,
    busy = false,
    active = false,
    trace = null,
    onFirst,
    onPrevious,
    onNext,
    onLast,
    onCancel,
    onNavigate
  } = $props();

  const stepNumber = $derived(total ? index + 1 : 0);
  const traceStatus = $derived(trace?.status ?? (complete ? 'complete' : 'partial'));
  const tracing = $derived(traceStatus === 'running');
  const atEnd = $derived(total > 0 && complete && index >= total - 1);
  const limitReached = $derived(traceStatus === 'limit');
  const resumeLabel = $derived(['timed_out', 'cancelled', 'error'].includes(traceStatus));

  function traceMessage() {
    if (!active) return 'Build & start to observe execution';
    if (traceStatus === 'running') return `Preparing replay · ${total} observed of ${trace?.limit ?? '—'} state safety limit`;
    if (traceStatus === 'complete') return `Execution complete · ${total} observed states`;
    if (traceStatus === 'timed_out') return trace?.message ?? 'Trace timed out. Partial state is usable; Resume or use Next.';
    if (traceStatus === 'cancelled') return trace?.message ?? 'Trace cancelled. Partial state is usable.';
    if (traceStatus === 'limit') return trace?.message ?? `Trace limit reached at ${total} states. Use Next to continue manually.`;
    if (traceStatus === 'error') return trace?.message ?? 'Trace interrupted. Partial state is still available.';
    return `${total} observed state${total === 1 ? '' : 's'} · partial trace`;
  }
</script>

<footer class="timeline-panel">
  <div class="timeline-row">
    <div class="timeline-buttons">
      <button onclick={onFirst} disabled={busy || tracing || !active || index <= 0} aria-label="First execution step">|&lt; <span>First</span></button>
      <button onclick={onPrevious} disabled={busy || tracing || !active || index <= 0} aria-label="Previous execution step">&lt; <span>Previous</span></button>
    </div>

    <div class="timeline-track-wrap">
      <input aria-label="Execution timeline" type="range" min="0" max={Math.max(0, total - 1)} value={Math.max(0, index)} disabled={busy || tracing || !active || total <= 1} oninput={(event) => onNavigate?.(Number(event.currentTarget.value))} />
      <div class="step-label">
        {#if active}<strong>Step {stepNumber}</strong><span>of {total}{complete ? '' : ' observed'}</span>{:else}<span>Build & start to observe execution</span>{/if}
      </div>
      {#if active}<div class:warning={['timed_out', 'cancelled', 'limit', 'error'].includes(traceStatus)} class:success={traceStatus === 'complete'} class="trace-summary">{traceMessage()}</div>{/if}
    </div>

    <div class="timeline-buttons">
      <button onclick={onNext} disabled={busy || tracing || !active || atEnd} aria-label="Next execution step"><span>Next</span> &gt;</button>
      {#if tracing}
        <button class="cancel-trace" onclick={onCancel} disabled={busy} aria-label="Cancel trace">Cancel</button>
      {:else}
        <button onclick={onLast} disabled={busy || !active || atEnd || limitReached} aria-label={resumeLabel ? 'Resume trace' : 'Last execution step'}><span>{resumeLabel ? 'Resume' : 'Last'}</span> &gt;|</button>
      {/if}
    </div>
  </div>
</footer>

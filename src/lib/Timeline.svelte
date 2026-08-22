<script>
  let {
    index = 0,
    total = 0,
    complete = false,
    capturing = false,
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
  const atStart = $derived(!total || index <= 0);
  const atLatest = $derived(!total || index >= total - 1);
  const status = $derived(trace?.status ?? (complete ? 'complete' : capturing ? 'running' : 'idle'));

  function traceMessage() {
    if (!active) return 'Import a C project and visualize it';
    if (status === 'building') return 'Building native debug executable…';
    if (status === 'running') return `Capturing execution · ${total} states available now`;
    if (status === 'complete') return `Execution complete · ${total} states · browser replay`; 
    if (status === 'limit') return `Trace safety limit reached · ${total} states kept`;
    if (status === 'cancelled') return `Capture cancelled · ${total} states remain replayable`;
    if (status === 'error') return trace?.message || `Capture stopped · ${total} states remain replayable`;
    return `${total} captured state${total === 1 ? '' : 's'}`;
  }
</script>

<footer class="timeline-panel">
  <div class="timeline-row">
    <div class="timeline-buttons">
      <button onclick={onFirst} disabled={!active || atStart} aria-label="First execution step">|&lt; <span>First</span></button>
      <button onclick={onPrevious} disabled={!active || atStart} aria-label="Previous execution step">&lt; <span>Previous</span></button>
    </div>

    <div class="timeline-track-wrap">
      <input
        aria-label="Execution timeline"
        aria-valuetext={`Step ${stepNumber} of ${total}`}
        type="range"
        min="0"
        max={Math.max(0, total - 1)}
        value={Math.max(0, index)}
        disabled={!active || total <= 1}
        oninput={(event) => onNavigate?.(Number(event.currentTarget.value))}
      />
      <div class="step-label">
        {#if active}<strong>Step {stepNumber}</strong><span>of {total}</span>{:else}<span>Import a project to begin</span>{/if}
      </div>
      {#if active}<div class:warning={['limit', 'cancelled', 'error'].includes(status)} class:success={status === 'complete'} class="trace-summary">{traceMessage()}</div>{/if}
    </div>

    <div class="timeline-buttons">
      <button onclick={onNext} disabled={!active || atLatest} aria-label="Next execution step"><span>Next</span> &gt;</button>
      <button onclick={onLast} disabled={!active || atLatest} aria-label="Latest execution step"><span>Last</span> &gt;|</button>
      {#if capturing}<button class="cancel-trace" onclick={onCancel} aria-label="Cancel capture">Cancel</button>{/if}
    </div>
  </div>
</footer>

<script>
  let { index = 0, total = 1, complete = false, busy = false, onFirst, onPrevious, onNext, onLast, onNavigate } = $props();
  const stepNumber = $derived(total ? index + 1 : 0);
</script>

<footer class="timeline-panel">
  <div class="timeline-row">
    <button onclick={onFirst} disabled={busy || index <= 0} aria-label="First execution step">|&lt; <span>First</span></button>
    <button onclick={onPrevious} disabled={busy || index <= 0} aria-label="Previous execution step">&lt; <span>Previous</span></button>

    <div class="timeline-track-wrap">
      <input aria-label="Execution timeline" type="range" min="0" max={Math.max(0, total - 1)} value={index} disabled={busy || total <= 1} oninput={(event) => onNavigate?.(Number(event.currentTarget.value))} />
      <div class="step-label"><strong>Step {stepNumber}</strong><span>of {total}{complete ? '' : ' observed'}</span></div>
    </div>

    <button onclick={onNext} disabled={busy || complete && index >= total - 1} aria-label="Next execution step"><span>Next</span> &gt;</button>
    <button onclick={onLast} disabled={busy || complete && index >= total - 1} aria-label="Last execution step"><span>Last</span> &gt;|</button>
  </div>
  {#if busy}<div class="trace-status">Tracing program execution…</div>{/if}
</footer>

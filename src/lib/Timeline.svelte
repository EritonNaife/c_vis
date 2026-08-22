<script>
  let { index = 0, total = 0, complete = false, busy = false, active = false, onFirst, onPrevious, onNext, onLast, onNavigate } = $props();
  const stepNumber = $derived(total ? index + 1 : 0);
  const atEnd = $derived(total > 0 && complete && index >= total - 1);
</script>

<footer class="timeline-panel">
  <div class="timeline-row">
    <div class="timeline-buttons">
      <button onclick={onFirst} disabled={busy || !active || index <= 0} aria-label="First execution step">|&lt; <span>First</span></button>
      <button onclick={onPrevious} disabled={busy || !active || index <= 0} aria-label="Previous execution step">&lt; <span>Previous</span></button>
    </div>

    <div class="timeline-track-wrap">
      <input aria-label="Execution timeline" type="range" min="0" max={Math.max(0, total - 1)} value={Math.max(0, index)} disabled={busy || !active || total <= 1} oninput={(event) => onNavigate?.(Number(event.currentTarget.value))} />
      <div class="step-label">
        {#if active}<strong>Step {stepNumber}</strong><span>of {total}{complete ? '' : ' observed'}</span>{:else}<span>Build & start to observe execution</span>{/if}
      </div>
    </div>

    <div class="timeline-buttons">
      <button onclick={onNext} disabled={busy || !active || atEnd} aria-label="Next execution step"><span>Next</span> &gt;</button>
      <button onclick={onLast} disabled={busy || !active || atEnd} aria-label="Last execution step"><span>Last</span> &gt;|</button>
    </div>
  </div>
  {#if busy}<div class="trace-status">Tracing program execution…</div>{/if}
</footer>

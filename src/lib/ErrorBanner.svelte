<script>
  let { error, onDismiss } = $props();
  const details = $derived(error?.details ?? null);
</script>

{#if error}
  <section class="structured-error" role="alert">
    <div>
      <span class="error-stage">{error.stage || 'error'} · {error.code || 'ERROR'}</span>
      <strong>{error.message}</strong>
      <div class="error-meta">
        {#if error.requestId}<span>request {error.requestId}</span>{/if}
        {#if error.runId}<span>run {error.runId}</span>{/if}
        {#if error.retryable}<span>retryable</span>{/if}
      </div>
      {#if details?.stderr}<details><summary>Build diagnostics</summary><pre>{details.stderr}</pre></details>{/if}
    </div>
    {#if onDismiss}<button class="icon-button small" onclick={onDismiss} aria-label="Dismiss error">×</button>{/if}
  </section>
{/if}

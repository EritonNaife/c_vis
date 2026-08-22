<script>
  let { client, server, project, trace, onRefresh, onClose } = $props();

  function pretty(value) {
    return JSON.stringify(value ?? {}, null, 2);
  }
</script>

<aside class="diagnostics-drawer" aria-label="c_vis diagnostics">
  <header>
    <div>
      <span class="eyebrow">observability</span>
      <strong>Diagnostics</strong>
    </div>
    <div class="diagnostic-actions">
      <button onclick={onRefresh}>Refresh</button>
      <button class="icon-button small" onclick={onClose} aria-label="Close diagnostics">×</button>
    </div>
  </header>

  <div class="diagnostics-body">
    <section>
      <h3>Current project</h3>
      <pre>{pretty(project)}</pre>
    </section>
    <section>
      <h3>Trace</h3>
      <pre>{pretty(trace)}</pre>
    </section>
    <section>
      <h3>Browser</h3>
      <pre>{pretty(client)}</pre>
    </section>
    <section>
      <h3>Execution backend</h3>
      <pre>{pretty(server)}</pre>
    </section>
  </div>
</aside>

<script>
  let { snapshot, onClose } = $props();
</script>

<aside class="output-drawer" aria-label="Program output">
  <header>
    <div>
      <span class="eyebrow">terminal</span>
      <strong>Program output</strong>
    </div>
    <button class="icon-button small" onclick={onClose} aria-label="Close terminal">×</button>
  </header>
  <div class="output-body">
    <section>
      <h3>stdout</h3>
      <pre>{snapshot?.targetOutput || 'No stdout yet.'}</pre>
    </section>
    <section>
      <h3>operations</h3>
      <div class="operation-stream">
        {#if snapshot?.operations?.length}
          {#each snapshot.operations as operation, index}
            <span><small>{index + 1}</small>{operation}</span>
          {/each}
        {:else}
          <p>No operations yet.</p>
        {/if}
      </div>
    </section>
  </div>
</aside>

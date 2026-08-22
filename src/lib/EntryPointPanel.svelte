<script>
  let {
    functions = [],
    entry = null,
    onSelect,
    onArgument
  } = $props();

  const selectedKey = $derived(entry?.kind === 'function' ? `${entry.file}::${entry.name}::${entry.line}` : '');
  const selectedFunction = $derived(functions.find((fn) => `${fn.file}::${fn.name}::${fn.line}` === selectedKey) ?? null);

  function signature(fn) {
    if (!fn) return '';
    const params = fn.params?.map((param) => param.raw || `${param.type} ${param.name}`) ?? [];
    if (fn.variadic) params.push('...');
    return `${fn.returnType} ${fn.name}(${params.join(', ') || 'void'})`;
  }
</script>

<section class="entry-point-panel" aria-label="Visualization entry point">
  <span class="eyebrow">automatic entry point</span>

  {#if functions.length}
    <div class="entry-point-heading">
      <div>
        <h3>No main() required</h3>
        <p>c_vis generates a temporary runner in the disposable workspace. Your source is not changed.</p>
      </div>

      {#if functions.length > 1}
        <label>
          <span>Function to visualize</span>
          <select value={selectedKey} onchange={(event) => onSelect?.(event.currentTarget.value)}>
            {#each functions as fn}
              <option value={`${fn.file}::${fn.name}::${fn.line}`}>{fn.name} · {fn.file}:{fn.line}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>

    {#if selectedFunction}
      <code class="entry-signature">{signature(selectedFunction)}</code>

      {#if selectedFunction.params?.length}
        <div class="entry-arguments">
          {#each selectedFunction.params as param, index}
            <label>
              <span><strong>{param.name}</strong><small>{param.type}</small></span>
              <input
                value={entry?.args?.[index] ?? param.defaultExpression ?? '0'}
                aria-label={`Value for ${param.name}`}
                oninput={(event) => onArgument?.(index, event.currentTarget.value)}
                placeholder={param.defaultExpression || '0'}
              />
            </label>
          {/each}
        </div>
        <small class="entry-help">Values are C expressions used only in the generated runner. c_vis pre-fills safe defaults; change only the inputs that matter to the behavior you want to inspect.</small>
      {:else}
        <div class="entry-zero-args">No inputs required. c_vis can visualize this function immediately.</div>
      {/if}
    {/if}
  {:else}
    <div class="entry-unavailable">
      <h3>No runnable function found</h3>
      <p>c_vis can still inspect the source, but runtime visualization needs at least one C function definition.</p>
    </div>
  {/if}
</section>

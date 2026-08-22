<script>
  let { analysis = {}, onSelectSource } = $props();

  const structs = $derived(analysis?.structs ?? []);
  const enums = $derived(analysis?.enums ?? []);
  const typedefs = $derived(analysis?.typedefs ?? []);
  const defines = $derived(analysis?.defines ?? []);
  const total = $derived(structs.length + enums.length + typedefs.length + defines.length);

  function fieldParts(field) {
    const text = String(field || '').trim();
    const match = text.match(/^(.*?)([A-Za-z_]\w*)(\s*(?:\[[^\]]*\])?)$/);
    if (!match) return { type: text, name: '' };
    const type = `${match[1]}${match[3] || ''}`.trim();
    return { type: type || text, name: match[2] };
  }

  function sourceLabel(item) {
    return item?.line ? `${item.file}:${item.line}` : item?.file;
  }
</script>

<section class="static-program" aria-label="Static C structure visualization">
  <header class="static-summary">
    <div>
      <span class="eyebrow">static visualization</span>
      <h2>Source structure</h2>
      <p>No executable behavior is required for this view. c_vis mapped declarations directly from the uploaded C source in the browser.</p>
    </div>
    <div class="static-counts" aria-label="Detected declarations">
      <span><strong>{structs.length}</strong> structs</span>
      <span><strong>{enums.length}</strong> enums</span>
      <span><strong>{typedefs.length}</strong> aliases</span>
      <span><strong>{defines.length}</strong> constants</span>
    </div>
  </header>

  {#if total === 0}
    <div class="static-empty">
      <h3>No executable or structural declaration detected</h3>
      <p>The source is loaded and browsable, but there is no runtime behavior or supported declaration model for c_vis to render yet.</p>
    </div>
  {/if}

  {#if structs.length}
    <section class="static-section">
      <header><span>Structs</span><small>field layout + relationships</small></header>
      <div class="struct-grid">
        {#each structs as struct}
          <article class:recursive={struct.recursivePointer} class="struct-card">
            <header>
              <div>
                <span class="type-kind">struct</span>
                <h3>{struct.name}</h3>
              </div>
              <button type="button" onclick={() => onSelectSource?.(struct.file)}>{sourceLabel(struct)}</button>
            </header>

            <div class="struct-fields">
              {#each struct.fields as field}
                {@const parsed = fieldParts(field)}
                <div class="struct-field">
                  <code>{parsed.type}</code>
                  <strong>{parsed.name}</strong>
                </div>
              {/each}
            </div>

            {#if struct.recursivePointer}
              <div class="recursive-model" aria-label={`${struct.name} recursive relationship`}>
                <span>{struct.name}</span><b>→</b><span>{struct.name}</span><b>→</b><span>{struct.name}</span><b>→</b><em>NULL</em>
              </div>
              <small class="relationship-note">self-referential pointer detected · linked structure candidate</small>
            {/if}
          </article>
        {/each}
      </div>
    </section>
  {/if}

  {#if enums.length}
    <section class="static-section">
      <header><span>Enums</span><small>named value sets</small></header>
      <div class="declaration-grid">
        {#each enums as enumType}
          <article class="declaration-card">
            <header>
              <div><span class="type-kind">enum</span><h3>{enumType.name}</h3></div>
              <button type="button" onclick={() => onSelectSource?.(enumType.file)}>{sourceLabel(enumType)}</button>
            </header>
            <div class="enum-members">
              {#each enumType.members as member}<code>{member}</code>{/each}
            </div>
          </article>
        {/each}
      </div>
    </section>
  {/if}

  {#if typedefs.length}
    <section class="static-section">
      <header><span>Type aliases</span><small>typedef relationships</small></header>
      <div class="alias-list">
        {#each typedefs as alias}
          <button type="button" class="alias-row" onclick={() => onSelectSource?.(alias.file)}>
            <strong>{alias.name}</strong><span>→</span><code>{alias.target}</code><small>{sourceLabel(alias)}</small>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if defines.length}
    <section class="static-section">
      <header><span>Compile-time constants</span><small>object-like #define values</small></header>
      <div class="define-list">
        {#each defines as define}
          <button type="button" class="define-row" onclick={() => onSelectSource?.(define.file)}>
            <strong>{define.name}</strong><code>{define.value}</code><small>{sourceLabel(define)}</small>
          </button>
        {/each}
      </div>
    </section>
  {/if}
</section>

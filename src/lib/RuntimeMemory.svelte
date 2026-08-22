<script>
  import { valueText } from './runtime-graph.js';

  let { runtime } = $props();

  function pointerClass(value) {
    return value?.kind === 'pointer' || value?.kind === 'reference';
  }

  function visibleElements(object) {
    return (object?.elements ?? []).slice(0, 24);
  }
</script>

<section class="runtime-memory" aria-label="Runtime memory graph">
  <header class="runtime-memory-header">
    <div>
      <span class="eyebrow">value graph</span>
      <h3>Reachable runtime memory</h3>
    </div>
    <span>{runtime?.objects?.length ?? 0} objects</span>
  </header>

  <div class="runtime-memory-roots">
    {#each runtime?.roots ?? [] as root (root.name)}
      <div class="runtime-memory-root">
        <div><strong>{root.name}</strong><span>{root.role}</span></div>
        <code>{root.type}</code>
        <code class:pointer={pointerClass(root.value)}>{valueText(root.value)}</code>
      </div>
    {/each}
  </div>

  {#if runtime?.objects?.length}
    <div class="runtime-memory-objects">
      {#each runtime.objects as object (object.id)}
        <article class="runtime-memory-object">
          <header>
            <div><span>{object.kind}</span><strong>{object.type}</strong></div>
            <code>{object.address}</code>
          </header>

          {#if object.fields?.length}
            <div class="runtime-memory-fields">
              {#each object.fields as field}
                <div class="runtime-memory-field">
                  <span>{field.name}</span>
                  <code>{field.type}</code>
                  <strong class:pointer={pointerClass(field.value)}>{valueText(field.value)}</strong>
                </div>
              {/each}
            </div>
          {:else if object.elements?.length}
            <div class="runtime-memory-array">
              {#each visibleElements(object) as element}
                <div><span>[{element.index}]</span><strong>{valueText(element.value)}</strong></div>
              {/each}
              {#if object.length > visibleElements(object).length}
                <small>+{object.length - visibleElements(object).length} more elements</small>
              {/if}
            </div>
          {:else if object.value !== undefined}
            <div class="runtime-memory-scalar"><strong>{object.value}</strong></div>
          {/if}
        </article>
      {/each}
    </div>
  {:else}
    <div class="memory-note">No addressable runtime objects are reachable from the current frame.</div>
  {/if}

  {#if runtime?.truncated}
    <div class="runtime-limit-note">Inspection limit reached: memory traversal stopped safely rather than following unbounded or cyclic pointers.</div>
  {/if}
  {#if runtime?.errors?.length}
    <details class="runtime-memory-errors">
      <summary>{runtime.errors.length} unreadable value {runtime.errors.length === 1 ? 'detail' : 'details'}</summary>
      {#each runtime.errors as item}<code>{item}</code>{/each}
    </details>
  {/if}
</section>

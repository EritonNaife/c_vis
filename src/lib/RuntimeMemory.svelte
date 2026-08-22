<script>
  import { charArrayText, memoryModel, valueText } from './runtime-graph.js';

  let { runtime } = $props();

  const model = $derived(memoryModel(runtime));
  const objects = $derived(new Map((runtime?.objects ?? []).map((object) => [object.id, object])));

  function rootObject(root) {
    const target = root?.value?.kind === 'reference' ? root.value.target : root?.value?.object;
    return target ? objects.get(target) ?? null : null;
  }

  function targetLabel(reference) {
    if (reference.null) return 'NULL';
    if (reference.targetLocation?.kind === 'element') return reference.targetLocation.label;
    if (reference.targetLocation?.kind === 'field') return reference.targetLocation.label;
    if (reference.targetLocation?.kind === 'root') return reference.targetLocation.label;
    if (reference.targetObject) return `${reference.targetObject.type} @ ${reference.targetObject.address}`;
    return reference.target ?? 'unresolved';
  }

  function visibleElements(object) {
    return (object?.elements ?? []).slice(0, 20);
  }
</script>

<section class="runtime-memory" aria-label="Canonical C memory model">
  <header class="runtime-memory-header">
    <div>
      <span class="eyebrow">memory</span>
      <h3>Stack + referenced memory</h3>
    </div>
    <span>{model.frames.length} {model.frames.length === 1 ? 'frame' : 'frames'}</span>
  </header>

  <div class="c-memory-stage">
    <section class="memory-zone stack-zone">
      <header><strong>Stack</strong><small>call frames and local storage</small></header>
      <div class="frame-stack">
        {#each model.frames as frame (frame.id)}
          <article class="frame-card" class:active-frame={frame.level === 0}>
            <header class="frame-card-header">
              <strong>{frame.function}</strong>
              <span>#{frame.level}</span>
            </header>
            <div class="frame-vars">
              {#each frame.roots ?? [] as root (`${frame.id}:${root.name}`)}
                {@const object = rootObject(root)}
                <div class="frame-var">
                  <div class="frame-var-name">
                    <strong>{root.name}</strong>
                    <small>{root.type}</small>
                  </div>

                  {#if object?.kind === 'array'}
                    {@const stringValue = charArrayText(object)}
                    <div class={stringValue !== null ? 'frame-inline-array string-array' : 'frame-inline-array'}>
                      {#each visibleElements(object) as element (element.index)}
                        <div title={element.address ?? ''}>
                          <span>{element.index}</span>
                          <strong>{element.value?.character === '\u0000' ? '\\0' : element.value?.character ?? element.value?.value ?? '—'}</strong>
                        </div>
                      {/each}
                    </div>
                    {#if stringValue !== null}<div class="inline-string-label">“{stringValue}”</div>{/if}
                  {:else if object?.kind === 'struct' || object?.kind === 'union'}
                    <div class="frame-inline-struct">
                      {#each (object.fields ?? []).slice(0, 8) as field}
                        <div><span>{field.name}</span><strong>{valueText(field.value)}</strong></div>
                      {/each}
                    </div>
                  {:else if root.value?.kind === 'pointer'}
                    <div class="frame-pointer-value">
                      <span class="pointer-dot">●</span><span>→</span><strong>{root.value.null ? 'NULL' : root.value.target ?? 'unresolved'}</strong>
                    </div>
                  {:else}
                    <div class="frame-scalar-value">{valueText(root.value)}</div>
                  {/if}
                </div>
              {/each}
              {#if !(frame.roots?.length)}<div class="memory-zone-empty">no visible locals</div>{/if}
            </div>
          </article>
        {/each}
      </div>
    </section>

    <section class="memory-zone heap-zone">
      <header><strong>Heap / referenced</strong><small>objects reached through pointers</small></header>
      {#if model.referencedObjects.length}
        <div class="referenced-object-list">
          {#each model.referencedObjects as object (object.id)}
            <article class="heap-object-card">
              <header><strong>{object.type}</strong><code>{object.address}</code></header>
              {#if object.fields?.length}
                <div class="heap-object-fields">
                  {#each object.fields.slice(0, 10) as field}
                    <div>
                      <span>{field.name}</span>
                      <small>{field.type}</small>
                      <strong>{valueText(field.value)}</strong>
                    </div>
                  {/each}
                </div>
              {:else if object.elements?.length}
                <div class="heap-array">
                  {#each visibleElements(object) as element}
                    <div><span>{element.index}</span><strong>{valueText(element.value)}</strong></div>
                  {/each}
                </div>
              {:else}
                <div class="frame-scalar-value">{object.value ?? '—'}</div>
              {/if}
            </article>
          {/each}
        </div>
      {:else}
        <div class="memory-zone-empty large">No separate referenced objects at this step.</div>
      {/if}
    </section>
  </div>

  {#if model.references.length}
    <section class="reference-map">
      <header><strong>References</strong><small>where pointers lead</small></header>
      <div class="reference-list">
        {#each model.references.slice(0, 24) as reference, index (`${reference.source}:${index}`)}
          <div class="reference-row">
            <code>{reference.source}</code>
            <span>→</span>
            <strong class:null-target={reference.null}>{targetLabel(reference)}</strong>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if runtime?.truncated}
    <div class="runtime-limit-note">Memory traversal stopped at the configured safety bound rather than following an unbounded graph.</div>
  {/if}
  {#if runtime?.errors?.length}
    <details class="runtime-memory-errors">
      <summary>{runtime.errors.length} unreadable value {runtime.errors.length === 1 ? 'detail' : 'details'}</summary>
      {#each runtime.errors as item}<code>{item}</code>{/each}
    </details>
  {/if}
</section>

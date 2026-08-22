<script>
  import { flip } from 'svelte/animate';

  let { name, object, text = null, changed = false } = $props();
</script>

<section class="ds-stage ds-array" aria-label={`${name} array`}>
  <header class="ds-stage-header">
    <div>
      <span class="ds-type">{text === null ? 'Array' : 'String / char array'}</span>
      <strong>{name}</strong>
    </div>
    <small>{object.length ?? object.elements?.length ?? 0} elements</small>
  </header>

  {#if text !== null}
    <div class="string-preview">“{text}”</div>
  {/if}

  <div class="array-strip" class:changed>
    {#each object.elements ?? [] as element (element.index)}
      <div class="array-cell" animate:flip={{ duration: 160 }} title={element.address ?? ''}>
        <span class="array-index">{element.index}</span>
        <small>{element.value?.type ?? ''}</small>
        <strong>{element.value?.character === '\u0000' ? '\\0' : element.value?.character ?? element.value?.label ?? element.value?.value ?? '—'}</strong>
      </div>
    {/each}
    {#if object.length > (object.elements?.length ?? 0)}
      <div class="array-cell array-more">+{object.length - object.elements.length}</div>
    {/if}
  </div>
</section>

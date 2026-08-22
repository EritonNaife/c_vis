<script>
  let { file = '', source = '', line = null, previousLine = null, functionName = '' } = $props();
  const lines = $derived(source.split('\n'));
</script>

<section class="code-pane">
  <header class="code-header">
    <div class="breadcrumb">
      <span>{file || 'source'}</span>
      {#if functionName}<span class="crumb-separator">/</span><strong>{functionName}()</strong>{/if}
    </div>
    {#if line}<code>line {line}</code>{/if}
  </header>

  <div class="code-scroll">
    <pre>{#each lines as text, index}<div class:current={index + 1 === line} class:previous={index + 1 === previousLine} class="code-line"><span class="line-marker">{index + 1 === line ? '→' : index + 1 === previousLine ? '✓' : ''}</span><span class="line-number">{index + 1}</span><code>{text || ' '}</code></div>{/each}</pre>
  </div>
</section>

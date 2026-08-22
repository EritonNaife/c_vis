<script>
  let { file = '', source = '', line = null, previousLine = null, functionName = '' } = $props();
  const lines = $derived(source ? source.split('\n') : []);

  const keywords = new Set(['if', 'else', 'for', 'while', 'return', 'sizeof', 'switch', 'case', 'break', 'continue', 'do', 'goto']);
  const types = new Set(['int', 'char', 'void', 'long', 'short', 'double', 'float', 'unsigned', 'signed', 'struct', 'typedef', 'enum', 'const', 'static']);

  function tokenType(token, text, endIndex) {
    if (token.startsWith('//') || token.startsWith('/*')) return 'comment';
    if (token.startsWith('#')) return 'preprocessor';
    if (token.startsWith('"') || token.startsWith("'")) return 'string';
    if (/^(0x[0-9a-f]+|\d+(\.\d+)?)$/i.test(token)) return 'number';
    if (keywords.has(token)) return 'keyword';
    if (types.has(token) || /^t_[a-z0-9_]+$/i.test(token)) return 'type';
    if (text.slice(endIndex).trimStart().startsWith('(')) return 'function';
    return 'plain';
  }

  function tokenize(text) {
    const pattern = /(\/\/.*$|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[A-Za-z_]\w*|\b0x[0-9A-Fa-f]+\b|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;
    const tokens = [];
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) tokens.push({ text: text.slice(cursor, match.index), type: 'plain' });
      const value = match[0];
      tokens.push({ text: value, type: tokenType(value, text, match.index + value.length) });
      cursor = match.index + value.length;
      if (value.startsWith('//')) break;
    }
    if (cursor < text.length) tokens.push({ text: text.slice(cursor), type: 'plain' });
    return tokens.length ? tokens : [{ text: text || ' ', type: 'plain' }];
  }
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
    {#if lines.length}
      <pre>{#each lines as text, index}<div class:current={index + 1 === line} class:previous={index + 1 === previousLine} class="code-line"><span class="line-marker">{index + 1 === line ? '→' : index + 1 === previousLine ? '·' : ''}</span><span class="line-number">{index + 1}</span><code>{#each tokenize(text) as token}<span class={`tok-${token.type}`}>{token.text}</span>{/each}</code></div>{/each}</pre>
    {:else}
      <div class="source-empty">Select a source file to inspect it.</div>
    {/if}
  </div>
</section>

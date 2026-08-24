<script>
  import {
    fileDescriptorExpression,
    isFileDescriptorParameter,
    preferredResourceFile,
    resourcePathForFileDescriptorExpression
  } from './function-inputs.js';
  import { projectSessionResourceFiles } from './project-session.js';

  let {
    functions = [],
    entry = null,
    onSelect,
    onArgument
  } = $props();

  const resourceFiles = projectSessionResourceFiles();
  const selectedKey = $derived(entry?.kind === 'function' ? `${entry.file}::${entry.name}::${entry.line}` : '');
  const selectedFunction = $derived(functions.find((fn) => `${fn.file}::${fn.name}::${fn.line}` === selectedKey) ?? null);
  let autoFunctionDone = $state(false);
  let autoResourceKey = $state('');

  function functionKey(fn) {
    return `${fn.file}::${fn.name}::${fn.line}`;
  }

  function signature(fn) {
    if (!fn) return '';
    const params = fn.params?.map((param) => param.raw || `${param.type} ${param.name}`) ?? [];
    if (fn.variadic) params.push('...');
    return `${fn.returnType} ${fn.name}(${params.join(', ') || 'void'})`;
  }

  function selectedResource(index) {
    return resourcePathForFileDescriptorExpression(entry?.args?.[index], resourceFiles);
  }

  function setFileDescriptor(index, path) {
    onArgument?.(index, path ? fileDescriptorExpression(path) : '0');
  }

  $effect(() => {
    if (autoFunctionDone || !functions.length) return;
    const getNextLine = functions.find((fn) => fn.name === 'get_next_line');
    autoFunctionDone = true;
    if (getNextLine && entry?.name !== getNextLine.name) onSelect?.(functionKey(getNextLine));
  });

  $effect(() => {
    const fn = selectedFunction;
    if (!fn) return;
    const key = functionKey(fn);
    if (autoResourceKey === key) return;
    autoResourceKey = key;

    const index = (fn.params ?? []).findIndex(isFileDescriptorParameter);
    const resource = preferredResourceFile(resourceFiles);
    if (index < 0 || !resource) return;

    const current = String(entry?.args?.[index] ?? fn.params?.[index]?.defaultExpression ?? '0').trim();
    if (!current || current === '0') onArgument?.(index, fileDescriptorExpression(resource));
  });
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
              <option value={functionKey(fn)}>{fn.name} · {fn.file}:{fn.line}</option>
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
              {#if isFileDescriptorParameter(param) && resourceFiles.length}
                <select
                  value={selectedResource(index)}
                  aria-label={`Project file for ${param.name}`}
                  onchange={(event) => setFileDescriptor(index, event.currentTarget.value)}
                >
                  <option value="">fd 0 · stdin</option>
                  {#each resourceFiles as file}
                    <option value={file}>{file}</option>
                  {/each}
                </select>
              {:else}
                <input
                  value={entry?.args?.[index] ?? param.defaultExpression ?? '0'}
                  aria-label={`Value for ${param.name}`}
                  oninput={(event) => onArgument?.(index, event.currentTarget.value)}
                  placeholder={param.defaultExpression || '0'}
                />
              {/if}
            </label>
          {/each}
        </div>

        {#if selectedFunction.params.some(isFileDescriptorParameter)}
          {#if resourceFiles.length}
            <small class="entry-help">File-descriptor inputs can use a project file. c_vis opens the selected file read-only in the generated runner and starts the trace inside your function.</small>
          {:else if selectedFunction.name === 'get_next_line'}
            <small class="entry-help">Add a text fixture such as input.txt to the project folder for a useful get_next_line trace. The generated runner has no interactive stdin.</small>
          {:else}
            <small class="entry-help">This function accepts a file descriptor. Add a text fixture to the project folder or provide the fd value manually.</small>
          {/if}
        {:else}
          <small class="entry-help">Values are C expressions used only in the generated runner. c_vis pre-fills safe defaults; change only the inputs that matter to the behavior you want to inspect.</small>
        {/if}
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

<script>
  import { entriesFromDrop, entriesFromFileList } from './project-loader.js';

  let { busy = false, status = '', onEntries } = $props();
  let fileInput;
  let folderInput;
  let dragging = $state(false);

  async function choose(event) {
    const entries = entriesFromFileList(event.currentTarget.files || []);
    event.currentTarget.value = '';
    if (entries.length) await onEntries?.(entries);
  }

  async function drop(event) {
    event.preventDefault();
    dragging = false;
    const entries = await entriesFromDrop(event.dataTransfer);
    if (entries.length) await onEntries?.(entries);
  }
</script>

<section
  role="region"
  aria-label="Import C project"
  class:dragging
  class="project-import"
  ondragover={(event) => { event.preventDefault(); dragging = true; }}
  ondragleave={() => dragging = false}
  ondrop={drop}
>
  <div class="import-card">
    <span class="eyebrow">c_vis v0.4</span>
    <h1>Visualize how your C runs.</h1>
    <p>Drop a C file or project folder. c_vis analyzes the project in your browser, builds a native debug copy, runs it under GDB, and prepares the execution replay.</p>

    <div class="drop-zone">
      <strong>{dragging ? 'Drop project' : 'Drop C project here'}</strong>
      <span>file or folder</span>
    </div>

    <div class="import-actions">
      <button class="primary" onclick={() => fileInput?.click()} disabled={busy}>Open file</button>
      <button onclick={() => folderInput?.click()} disabled={busy}>Open folder</button>
    </div>

    {#if busy || status}<div class="import-status">{status || 'Preparing project…'}</div>{/if}
    <small>Source stays in the browser for browsing. Only a validated project copy is sent to the local execution container.</small>
  </div>

  <input class="hidden-input" bind:this={fileInput} type="file" accept=".c,.h,text/plain" multiple onchange={choose} />
  <input class="hidden-input" bind:this={folderInput} type="file" webkitdirectory multiple onchange={choose} />
</section>

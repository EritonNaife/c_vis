<script>
  let { files = [], activeFile = '', onSelect } = $props();
  let openFolders = $state(new Set());
  let collapsed = $state(false);

  const grouped = $derived.by(() => {
    const rootFiles = [];
    const folders = new Map();

    for (const file of files) {
      const slash = file.lastIndexOf('/');
      if (slash === -1) {
        rootFiles.push({ path: file, name: file });
        continue;
      }
      const folder = file.slice(0, slash);
      const name = file.slice(slash + 1);
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder).push({ path: file, name });
    }

    const folderRows = [...folders.entries()]
      .map(([path, children]) => ({ path, name: `${path}/`, children: children.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.path.localeCompare(b.path));

    return { rootFiles: rootFiles.sort((a, b) => a.name.localeCompare(b.name)), folders: folderRows };
  });

  $effect(() => {
    if (!activeFile) return;
    const slash = activeFile.lastIndexOf('/');
    if (slash === -1) return;
    const folder = activeFile.slice(0, slash);
    if (!openFolders.has(folder)) openFolders = new Set([...openFolders, folder]);
  });

  function isOpen(folder) {
    return openFolders.has(folder);
  }

  function toggle(folder) {
    const next = new Set(openFolders);
    if (next.has(folder)) next.delete(folder);
    else next.add(folder);
    openFolders = next;
  }
</script>

<nav class="project-tree" class:collapsed aria-label="Project files">
  <div class="project-heading">
    {#if !collapsed}<span>Project</span>{/if}
    <button
      class="project-collapse-button"
      onclick={() => collapsed = !collapsed}
      aria-label={collapsed ? 'Expand project files' : 'Collapse project files'}
      aria-expanded={!collapsed}
      title={collapsed ? 'Expand project files' : 'Collapse project files'}
    >
      {collapsed ? '›' : '‹'}
    </button>
  </div>

  {#if !collapsed}
    <div class="project-scroll">
      {#each grouped.rootFiles as file (file.path)}
        <button class:active={activeFile === file.path} class="tree-file root-file" onclick={() => onSelect?.(file.path)}>
          <span class="file-mark">C</span><span>{file.name}</span>
        </button>
      {/each}

      {#each grouped.folders as folder (folder.path)}
        <section class="tree-group">
          <button class="tree-folder" onclick={() => toggle(folder.path)} aria-expanded={isOpen(folder.path)}>
            <span class="folder-caret">{isOpen(folder.path) ? '▾' : '▸'}</span>
            <span class="folder-icon">{isOpen(folder.path) ? '▱' : '□'}</span>
            <span>{folder.name}</span>
          </button>
          {#if isOpen(folder.path)}
            <div class="tree-children">
              {#each folder.children as file (file.path)}
                <button class:active={activeFile === file.path} class="tree-file" onclick={() => onSelect?.(file.path)}>
                  <span>{file.name}</span>
                </button>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</nav>

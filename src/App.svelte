<script>
  import ProjectTree from './lib/ProjectTree.svelte';
  import CodePane from './lib/CodePane.svelte';
  import ProgramState from './lib/ProgramState.svelte';
  import MemoryView from './lib/MemoryView.svelte';
  import StaticProgramView from './lib/StaticProgramView.svelte';
  import Timeline from './lib/Timeline.svelte';
  import OutputDrawer from './lib/OutputDrawer.svelte';
  import ProjectImport from './lib/ProjectImport.svelte';
  import EntryPointPanel from './lib/EntryPointPanel.svelte';
  import ErrorBanner from './lib/ErrorBanner.svelte';
  import DiagnosticsDrawer from './lib/DiagnosticsDrawer.svelte';
  import { loadProject } from './lib/project-loader.js';
  import { postJson, requestJson, streamRun } from './lib/api.js';
  import { normalizeError } from './lib/errors.js';
  import { TraceStore } from './lib/trace-store.js';
  import { captureError, diagnostics as browserDiagnostics, installGlobalObservers, record, startSpan } from './lib/observability.js';

  installGlobalObservers();

  const traceStore = new TraceStore();
  let sourceMap = new Map();
  let config = $state(null);
  let project = $state(null);
  let entry = $state(null);
  let build = $state(null);
  let traceVersion = $state(0);
  let currentIndex = $state(0);
  let sourcePath = $state('');
  let mode = $state('program');
  let argsText = $state('');
  let phase = $state('idle');
  let phaseMessage = $state('');
  let traceState = $state({ status: 'idle', message: '' });
  let error = $state(null);
  let showSettings = $state(false);
  let showTerminal = $state(false);
  let showDiagnostics = $state(false);
  let serverDiagnostics = $state(null);
  let clientDiagnostics = $state(null);
  let runController = null;
  let followTail = true;

  const total = $derived.by(() => { traceVersion; return traceStore.total; });
  const snapshot = $derived.by(() => { traceVersion; currentIndex; return traceStore.materialize(currentIndex); });
  const previousSnapshot = $derived.by(() => { traceVersion; currentIndex; return traceStore.previous(currentIndex); });
  const source = $derived.by(() => { sourcePath; traceVersion; return sourceMap.get(sourcePath) ?? ''; });
  const executionPath = $derived(snapshot?.frame?.projectPath ?? '');
  const displayLine = $derived(sourcePath === executionPath ? snapshot?.frame?.line : null);
  const previousLine = $derived(previousSnapshot?.frame?.projectPath === sourcePath ? previousSnapshot?.frame?.line : null);
  const displayFunction = $derived(sourcePath === executionPath ? snapshot?.frame?.func : '');
  const capturing = $derived(phase === 'building' || phase === 'capturing');
  const staticMode = $derived(Boolean(project && !entry));
  const status = $derived(
    phase === 'importing' ? 'analyzing'
      : phase === 'uploading' ? 'preparing'
      : phase === 'building' ? 'building'
      : phase === 'capturing' ? 'capturing'
      : phase === 'error' ? 'error'
      : staticMode ? 'static'
      : project ? 'ready' : 'idle'
  );
  const projectFiles = $derived(project ? [...(project.analysis?.cFiles ?? []), ...(project.analysis?.headerFiles ?? [])].sort() : []);
  const callableFunctions = $derived((project?.serverAnalysis?.functions ?? project?.analysis?.functions ?? []).filter((fn) => fn.name !== 'main'));
  const hasMain = $derived(Boolean((project?.serverAnalysis?.mainCandidates ?? project?.analysis?.mainCandidates ?? []).length));
  const projectDiagnostics = $derived(project ? {
    workspaceId: project.workspaceId,
    mode: staticMode ? 'static' : 'runtime',
    fileCount: project.analysis?.fileCount,
    totalBytes: project.totalBytes,
    cFiles: project.analysis?.cFiles?.length ?? 0,
    headerFiles: project.analysis?.headerFiles?.length ?? 0,
    functions: project.serverAnalysis?.functions?.length ?? project.analysis?.functions?.length ?? 0,
    staticDeclarations: project.analysis?.staticDeclarations ?? 0,
    mainCandidates: project.analysis?.mainCandidates ?? [],
    entry: staticMode ? 'static source model' : entry?.kind === 'function' ? `${entry.name} · ${entry.file}:${entry.line}` : entry?.kind ?? null,
    profile: project.serverAnalysis?.profile ?? project.analysis?.profile,
    buildSystem: staticMode ? 'not required' : project.serverAnalysis?.buildSystem?.type ?? project.analysis?.buildSystem?.type ?? 'cc',
    skipped: project.skipped?.length ?? 0
  } : null);
  const traceDiagnostics = $derived.by(() => { traceVersion; return staticMode ? { mode: 'static', states: 0 } : traceStore.summary(); });

  function parseArgs(text) {
    const values = [];
    let current = '';
    let quote = null;
    for (const character of text) {
      if (quote) {
        if (character === quote) quote = null;
        else current += character;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (/\s/.test(character)) {
        if (current) {
          values.push(current);
          current = '';
        }
        continue;
      }
      current += character;
    }
    if (quote) throw normalizeError(new Error('Unclosed quote in program arguments'), { code: 'INVALID_ARGUMENTS', stage: 'client' });
    if (current) values.push(current);
    return values;
  }

  function functionKey(fn) {
    return `${fn.file}::${fn.name}::${fn.line}`;
  }

  function makeFunctionEntry(fn, existingArgs = []) {
    return {
      kind: 'function',
      file: fn.file,
      line: fn.line,
      name: fn.name,
      args: (fn.params ?? []).map((param, index) => existingArgs[index] ?? param.defaultExpression ?? '0')
    };
  }

  function chooseInitialEntry(analysis) {
    if (analysis?.mainCandidates?.length) return { kind: 'main' };
    const functions = (analysis?.functions ?? []).filter((fn) => fn.name !== 'main');
    return functions.length ? makeFunctionEntry(functions[0]) : null;
  }

  function selectFunction(key) {
    const fn = callableFunctions.find((candidate) => functionKey(candidate) === key);
    if (!fn) return;
    entry = makeFunctionEntry(fn);
    sourcePath = fn.file;
    record('entry.selected', { kind: 'function', name: fn.name, file: fn.file, params: fn.params?.length ?? 0 });
  }

  function setFunctionArgument(index, value) {
    if (entry?.kind !== 'function') return;
    const args = [...(entry.args ?? [])];
    args[index] = value;
    entry = { ...entry, args };
  }

  function clearTrace() {
    traceStore.reset();
    traceVersion += 1;
    currentIndex = 0;
    followTail = true;
    build = null;
    traceState = { status: 'idle', message: '' };
  }

  function showExecutionSource(targetSnapshot = snapshot) {
    const path = targetSnapshot?.frame?.projectPath;
    if (path && sourceMap.has(path)) sourcePath = path;
  }

  function navigate(index, userInitiated = true) {
    if (!traceStore.total) return;
    const next = Math.max(0, Math.min(traceStore.total - 1, Number(index) || 0));
    currentIndex = next;
    if (userInitiated) followTail = next === traceStore.total - 1;
    showExecutionSource(traceStore.materialize(next));
  }

  function stopRun() {
    if (runController) {
      runController.abort();
      runController = null;
    }
  }

  async function importEntries(entries) {
    stopRun();
    clearTrace();
    error = null;
    project = null;
    entry = null;
    sourceMap = new Map();
    mode = 'program';
    showTerminal = false;
    phase = 'importing';
    phaseMessage = 'Reading and analyzing project in browser…';
    const span = startSpan('project.import', { entries: entries.length });

    try {
      const loaded = await loadProject(entries, { maxBytes: config?.maxUploadBytes });
      sourceMap = new Map(loaded.files.map((file) => [file.path, file.content]));
      const firstSource = loaded.analysis.mainCandidates?.[0] || loaded.analysis.functions?.[0]?.file || loaded.analysis.structs?.[0]?.file || loaded.analysis.headerFiles?.[0] || loaded.analysis.cFiles?.[0] || '';
      sourcePath = firstSource;

      const browserEntry = chooseInitialEntry(loaded.analysis);
      if (!browserEntry && loaded.analysis.visualizationMode === 'static') {
        project = {
          workspaceId: null,
          analysis: loaded.analysis,
          serverAnalysis: null,
          totalBytes: loaded.totalBytes,
          skipped: loaded.skipped || []
        };
        entry = null;
        argsText = '';
        phase = 'ready';
        phaseMessage = '';
        span.end({
          files: loaded.files.length,
          profile: loaded.analysis.profile,
          analysisMs: loaded.analysis.durationMs,
          entryKind: 'none',
          mode: 'static',
          backend: false
        });
        record('project.ready', {
          files: loaded.files.length,
          functions: loaded.analysis.functions?.length ?? 0,
          staticDeclarations: loaded.analysis.staticDeclarations ?? 0,
          profile: loaded.analysis.profile,
          entryKind: 'none',
          mode: 'static',
          backend: false
        });
        return;
      }

      phase = 'uploading';
      phaseMessage = 'Creating isolated execution workspace…';
      const uploadSpan = startSpan('project.upload', { files: loaded.files.length, bytes: loaded.totalBytes });
      const workspace = await postJson('/api/workspaces', {
        files: loaded.files.map(({ path, content }) => ({ path, content })),
        analysis: loaded.analysis
      });
      uploadSpan.end({ workspaceId: workspace.workspaceId, skipped: workspace.skipped?.length ?? 0 });

      project = {
        workspaceId: workspace.workspaceId,
        analysis: loaded.analysis,
        serverAnalysis: workspace.analysis,
        totalBytes: loaded.totalBytes,
        skipped: [...new Set([...(loaded.skipped || []), ...(workspace.skipped || [])])]
      };
      entry = chooseInitialEntry(workspace.analysis || loaded.analysis);
      if (entry?.kind === 'function') sourcePath = entry.file;
      argsText = entry?.kind === 'main' && (workspace.analysis?.profile || loaded.analysis.profile) === 'push_swap' ? '4 67 3 87 23' : '';
      phase = 'ready';
      phaseMessage = '';
      const resolvedMode = entry ? 'runtime' : 'static';
      span.end({
        files: loaded.files.length,
        profile: workspace.analysis?.profile || loaded.analysis.profile,
        analysisMs: loaded.analysis.durationMs,
        entryKind: entry?.kind ?? 'none',
        mode: resolvedMode,
        backend: true
      });
      record('project.ready', {
        files: loaded.files.length,
        functions: workspace.analysis?.functions?.length ?? loaded.analysis.functions?.length ?? 0,
        staticDeclarations: loaded.analysis.staticDeclarations ?? 0,
        profile: workspace.analysis?.profile || loaded.analysis.profile,
        entryKind: entry?.kind ?? 'none',
        mode: resolvedMode,
        backend: true
      });
    } catch (cause) {
      const failure = normalizeError(cause, { stage: phase === 'uploading' ? 'workspace' : 'ingest' });
      error = failure;
      phase = 'error';
      phaseMessage = '';
      span.end({ code: failure.code }, 'error');
      captureError(failure, { operation: 'project.import' });
    }
  }

  async function handleTraceEvent(event) {
    if (event.type === 'run.started') {
      traceStore.start(event);
      traceVersion += 1;
      traceState = { status: 'building', message: 'Building native debug executable…', runId: event.runId, limit: event.traceLimit };
      phase = 'building';
      return;
    }
    if (event.type === 'build.started') {
      phase = 'building';
      traceState = { ...traceState, status: 'building' };
      return;
    }
    if (event.type === 'build.completed') {
      build = event.build;
      record('build.completed', {
        profile: event.analysis?.profile,
        cFiles: event.analysis?.cFiles,
        buildSystem: event.analysis?.buildSystem,
        entryKind: event.entry?.kind,
        entryName: event.entry?.name
      });
      return;
    }
    if (event.type === 'debugger.started') {
      phase = 'capturing';
      traceState = { ...traceState, status: 'running', profile: event.profile };
      return;
    }
    if (event.type === 'snapshot') {
      const wasAtTail = followTail || currentIndex >= Math.max(0, traceStore.total - 1);
      const index = traceStore.append(event);
      traceVersion += 1;
      if (wasAtTail) {
        currentIndex = index;
        followTail = true;
        showExecutionSource(traceStore.materialize(index));
      }
      if (traceStore.total % 100 === 0) record('trace.progress', { states: traceStore.total });
      return;
    }
    if (event.type === 'trace.limit') {
      traceStore.finish(event);
      traceVersion += 1;
      traceState = { ...traceState, status: 'limit', message: `Trace limit reached at ${event.total} states.` };
      phase = 'ready';
      return;
    }
    if (event.type === 'run.completed') {
      traceStore.finish(event);
      traceVersion += 1;
      traceState = { ...traceState, status: 'complete', message: 'Execution captured. Replay is local to the browser.' };
      phase = 'ready';
      record('run.completed', { states: event.total, durationMs: event.durationMs });
      return;
    }
    if (event.type === 'run.cancelled') {
      traceStore.finish(event);
      traceVersion += 1;
      traceState = { ...traceState, status: 'cancelled', message: 'Capture cancelled. Captured states remain replayable.' };
      phase = 'ready';
    }
  }

  async function visualize() {
    if (!project?.workspaceId || capturing || !entry) return;
    stopRun();
    clearTrace();
    error = null;
    phase = 'building';
    phaseMessage = entry.kind === 'function' ? `Generating runner for ${entry.name}()…` : 'Starting native execution…';
    runController = new AbortController();
    const span = startSpan('run.capture', {
      profile: project.serverAnalysis?.profile || project.analysis?.profile,
      entryKind: entry.kind,
      entryName: entry.name ?? 'main'
    });

    try {
      await streamRun({
        workspaceId: project.workspaceId,
        args: entry.kind === 'main' ? parseArgs(argsText) : [],
        entry,
        signal: runController.signal,
        onEvent: handleTraceEvent
      });
      span.end({ states: traceStore.total, status: traceState.status });
    } catch (cause) {
      if (cause?.name === 'AbortError') {
        traceStore.finish({ type: 'run.cancelled' });
        traceVersion += 1;
        traceState = { ...traceState, status: 'cancelled', message: 'Capture cancelled. Captured states remain replayable.' };
        phase = 'ready';
        span.end({ states: traceStore.total, status: 'cancelled' });
      } else {
        const failure = normalizeError(cause, { stage: 'trace' });
        error = failure;
        traceState = { ...traceState, status: 'error', message: failure.message };
        phase = traceStore.total ? 'ready' : 'error';
        span.end({ states: traceStore.total, code: failure.code }, 'error');
        captureError(failure, { operation: 'run.capture' });
      }
    } finally {
      runController = null;
      phaseMessage = '';
    }
  }

  function cancelCapture() {
    if (!runController) return;
    runController.abort();
  }

  function resetProject() {
    stopRun();
    clearTrace();
    project = null;
    entry = null;
    sourceMap = new Map();
    sourcePath = '';
    mode = 'program';
    argsText = '';
    error = null;
    showTerminal = false;
    phase = 'idle';
    phaseMessage = '';
  }

  async function refreshDiagnostics() {
    clientDiagnostics = browserDiagnostics();
    try {
      serverDiagnostics = await requestJson('/api/diagnostics');
    } catch (cause) {
      captureError(normalizeError(cause), { operation: 'diagnostics.refresh' });
    }
  }

  async function openDiagnostics() {
    showDiagnostics = !showDiagnostics;
    if (showDiagnostics) await refreshDiagnostics();
  }

  requestJson('/api/config')
    .then((value) => { config = value; record('config.loaded', { version: value.version, traceLimit: value.traceLimit }); })
    .catch((cause) => { error = normalizeError(cause, { stage: 'server' }); captureError(error, { operation: 'config.load' }); });
</script>

<svelte:head><title>c_vis — C Visualizer</title></svelte:head>

<div class="app-shell">
  <header class="topbar">
    <div class="brand-block">
      <strong>c_vis</strong>
      <span>C Visualizer</span>
    </div>

    <div class="run-controls">
      {#if project}
        {#if staticMode}
          <span class="entry-chip static-entry-chip"><strong>Static structure</strong><span>browser visualization</span></span>
        {:else}
          {#if entry?.kind === 'main'}
            <input bind:value={argsText} aria-label="Program arguments" placeholder="program arguments (optional)" disabled={capturing} />
          {:else if entry?.kind === 'function'}
            <span class="entry-chip"><strong>{entry.name}()</strong><span>generated runner</span></span>
          {/if}
          <button class="primary rebuild-button" onclick={visualize} disabled={capturing || !entry}>Visualize</button>
        {/if}
      {:else}
        <span class="topbar-hint">Open a C file or project folder</span>
      {/if}
    </div>

    <div class="header-actions">
      <div class="status-pill" class:running={capturing}><span></span>{status}</div>
      <div class="utility-cluster">
        {#if project}<button class="icon-button" onclick={resetProject} aria-label="Open another project" title="Open another project">＋</button>{/if}
        <button class:active={showSettings} class="icon-button" onclick={() => showSettings = !showSettings} aria-label="Settings" title="Settings">⚙</button>
        <button class:active={showTerminal} class="icon-button terminal-icon" onclick={() => showTerminal = !showTerminal} aria-label="Program output" title={staticMode ? 'No runtime output in static visualization' : 'Program output'} disabled={!snapshot || staticMode}>&gt;_</button>
        <button class:active={showDiagnostics} class="icon-button" onclick={openDiagnostics} aria-label="Diagnostics" title="Diagnostics">◎</button>

        {#if showSettings}
          <aside class="settings-popover">
            <span class="eyebrow">settings</span>
            <div class="setting-row"><span>Version</span><strong>{config?.version ?? '0.4'}</strong></div>
            <div class="setting-row"><span>Mode</span><strong>{staticMode ? 'static source model' : 'runtime execution'}</strong></div>
            <div class="setting-row"><span>Execution</span><strong>{staticMode ? 'browser analysis only' : 'native GDB → browser replay'}</strong></div>
            <div class="setting-row"><span>Entry</span><strong>{staticMode ? 'not required' : entry?.kind === 'function' ? `${entry.name}()` : entry?.kind ?? 'none'}</strong></div>
            <div class="setting-row"><span>Trace limit</span><strong>{staticMode ? 'not applicable' : config?.traceLimit ?? '—'}</strong></div>
            <div class="setting-row"><span>Profile</span><strong>{project?.serverAnalysis?.profile ?? project?.analysis?.profile ?? 'generic'}</strong></div>
            <div class="setting-row"><span>Build</span><strong>{staticMode ? 'not required' : project?.serverAnalysis?.buildSystem?.type ?? project?.analysis?.buildSystem?.type ?? 'cc'}</strong></div>
          </aside>
        {/if}
      </div>
    </div>
  </header>

  <ErrorBanner {error} onDismiss={() => error = null} />

  {#if project}
    <main class="workspace" class:static-workspace={staticMode}>
      <ProjectTree files={projectFiles} activeFile={sourcePath} onSelect={(path) => sourcePath = path} />
      <CodePane file={sourcePath} {source} line={displayLine} {previousLine} functionName={displayFunction} />

      <aside class="visual-pane">
        <header class="visual-header">
          <div class="view-switcher" role="tablist" aria-label="Visualization depth">
            <button class:active={mode === 'program'} onclick={() => mode = 'program'}>{staticMode ? 'Structure' : 'Program'}</button>
            <button class:active={mode === 'memory'} onclick={() => !staticMode && (mode = 'memory')} disabled={staticMode} title={staticMode ? 'Runtime memory requires executable behavior' : 'Memory'}>Memory</button>
          </div>
          {#if phaseMessage}<span class="phase-message">{phaseMessage}</span>{/if}
        </header>

        <div class="visual-scroll">
          {#if staticMode}
            <StaticProgramView analysis={project.analysis} onSelectSource={(path) => sourcePath = path} />
          {:else if snapshot}
            {#if mode === 'program'}<ProgramState {snapshot} {previousSnapshot} />{:else}<MemoryView {snapshot} />{/if}
          {:else}
            <div class="visual-empty">
              <span class="eyebrow">project ready</span>
              {#if hasMain}
                <h2>{project.analysis?.mainCandidates?.[0] ?? 'C program'}</h2>
                <p>{project.analysis?.fileCount} files analyzed. c_vis found main() and can run the program directly.</p>
              {:else}
                <EntryPointPanel functions={callableFunctions} {entry} onSelect={selectFunction} onArgument={setFunctionArgument} />
              {/if}
              {#if project.analysis?.warnings?.length}<div class="project-warnings">{project.analysis.warnings.join(' ')}</div>{/if}
            </div>
          {/if}
        </div>
      </aside>
    </main>
  {:else}
    <ProjectImport busy={phase === 'importing' || phase === 'uploading'} status={phaseMessage} onEntries={importEntries} />
  {/if}

  {#if showTerminal && !staticMode}<OutputDrawer {snapshot} onClose={() => showTerminal = false} />{/if}
  {#if showDiagnostics}<DiagnosticsDrawer client={clientDiagnostics} server={serverDiagnostics} project={projectDiagnostics} trace={traceDiagnostics} onRefresh={refreshDiagnostics} onClose={() => showDiagnostics = false} />{/if}

  {#if staticMode}
    <footer class="static-mode-footer">
      <span>Static source model</span>
      <strong>No runtime trace required</strong>
      <small>{project.analysis?.staticDeclarations ?? 0} declarations mapped in browser</small>
    </footer>
  {:else}
    <Timeline
      index={currentIndex}
      {total}
      complete={traceState.status === 'complete'}
      {capturing}
      trace={traceState}
      active={total > 0}
      onFirst={() => navigate(0)}
      onPrevious={() => navigate(currentIndex - 1)}
      onNext={() => navigate(currentIndex + 1)}
      onLast={() => navigate(total - 1)}
      onCancel={cancelCapture}
      onNavigate={navigate}
    />
  {/if}
</div>

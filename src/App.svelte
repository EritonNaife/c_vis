<script>
  import ProjectTree from './lib/ProjectTree.svelte';
  import CodePane from './lib/CodePane.svelte';
  import ProgramState from './lib/ProgramState.svelte';
  import MemoryView from './lib/MemoryView.svelte';
  import Timeline from './lib/Timeline.svelte';
  import OutputDrawer from './lib/OutputDrawer.svelte';

  let project = $state(null);
  let session = $state(null);
  let build = $state(null);
  let argsText = $state('4 67 3 87 23');
  let source = $state('');
  let sourcePath = $state('');
  let mode = $state('program');
  let busy = $state(false);
  let tracePolling = $state(false);
  let error = $state('');
  let showSettings = $state(false);
  let showTerminal = $state(false);
  let showPowerControls = $state(true);

  const snapshot = $derived(session?.snapshot ?? null);
  const previousSnapshot = $derived(session?.previousSnapshot ?? null);
  const trace = $derived(session?.trace ?? null);
  const tracing = $derived(trace?.status === 'running');
  const executionPath = $derived(snapshot?.frame?.projectPath ?? '');
  const displayLine = $derived(sourcePath === executionPath ? snapshot?.frame?.line : null);
  const previousLine = $derived(previousSnapshot?.frame?.projectPath === sourcePath ? previousSnapshot?.frame?.line : null);
  const displayFunction = $derived(sourcePath === executionPath ? snapshot?.frame?.func : '');
  const status = $derived(tracing ? 'tracing' : busy ? 'running' : snapshot?.status ?? 'ready');
  const interactionLocked = $derived(busy || tracing);
  const canDebug = $derived(Boolean(snapshot && snapshot.status !== 'exited' && !interactionLocked));

  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!response.ok) {
      const failure = new Error(payload.error || 'Request failed');
      failure.payload = payload;
      throw failure;
    }
    return payload;
  }

  function post(url, payload = {}) {
    return request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

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
    if (quote) throw new Error('Unclosed quote in program arguments');
    if (current) values.push(current);
    return values;
  }

  async function loadProject() {
    project = await request('/api/project');
    if (project.defaults?.args) argsText = project.defaults.args.join(' ');
    const initial = project.files?.find((file) => file === 'src/main.c' || file.endsWith('/main.c') || file === 'main.c') ?? project.files?.[0];
    if (initial) await loadSource(initial);
  }

  async function loadSource(path) {
    if (!path) return;
    if (path.startsWith('/')) {
      source = '';
      sourcePath = path;
      return;
    }
    if (path === sourcePath && source) return;
    try {
      const payload = await request(`/api/source?path=${encodeURIComponent(path)}`);
      source = payload.source;
      sourcePath = path;
    } catch (cause) {
      source = '';
      sourcePath = path;
      error = cause.message;
    }
  }

  async function syncSession(payload, followExecution = true) {
    session = payload.session ?? payload;
    if (payload.build) build = payload.build;
    if (followExecution) await loadSource(session?.snapshot?.frame?.projectPath);
  }

  async function withBusy(work) {
    busy = true;
    error = '';
    try {
      await work();
    } catch (cause) {
      error = cause.message;
      if (cause.payload?.session) await syncSession(cause.payload.session);
    } finally {
      busy = false;
    }
  }

  async function pollTrace() {
    if (tracePolling) return;
    tracePolling = true;
    try {
      while (session?.trace?.status === 'running') {
        await delay(220);
        const payload = await request('/api/session');
        await syncSession(payload);
      }
    } catch (cause) {
      error = cause.message;
    } finally {
      tracePolling = false;
    }
  }

  async function start() {
    await withBusy(async () => {
      await syncSession(await post('/api/session/start', { args: parseArgs(argsText) }));
    });
    if (session?.trace?.status === 'running') void pollTrace();
  }

  async function restart() {
    await withBusy(async () => {
      await syncSession(await post('/api/session/restart'));
    });
    if (session?.trace?.status === 'running') void pollTrace();
  }

  async function action(name) {
    await withBusy(async () => {
      await syncSession(await post('/api/session/action', { action: name }));
    });
  }

  async function last() {
    await withBusy(async () => {
      await syncSession(await post('/api/session/action', { action: 'last' }));
    });
    if (session?.trace?.status === 'running') void pollTrace();
  }

  async function cancelTrace() {
    try {
      await syncSession(await post('/api/session/trace/cancel'));
      if (session?.trace?.status === 'running') void pollTrace();
    } catch (cause) {
      error = cause.message;
      if (cause.payload?.session) await syncSession(cause.payload.session);
    }
  }

  async function debugAction(name) {
    await withBusy(async () => {
      await syncSession(await post('/api/session/debug', { action: name }));
    });
  }

  async function navigate(index) {
    if (!session || index === session.index) return;
    await withBusy(async () => {
      await syncSession(await post('/api/session/navigate', { index }));
    });
  }

  loadProject().catch((cause) => { error = cause.message; });
</script>

<svelte:head><title>c_vis — visual C execution</title></svelte:head>

<div class="app-shell">
  <header class="topbar">
    <div class="brand-block">
      <strong>c_vis</strong>
      <span>visual C execution</span>
    </div>

    <div class="run-controls">
      <input bind:value={argsText} aria-label="Program arguments" placeholder="program arguments" disabled={tracing} />
      <button class="primary rebuild-button" onclick={start} disabled={interactionLocked}>Rebuild &amp; start</button>
    </div>

    <div class="header-actions">
      <div class="status-pill" class:running={busy || tracing}><span></span>{status}</div>

      {#if showPowerControls}
        <div class="power-controls" aria-label="Advanced debugger controls">
          <button onclick={restart} disabled={!session || interactionLocked}>Restart</button>
          <button onclick={() => debugAction('step')} disabled={!canDebug}>Step in</button>
          <button onclick={() => debugAction('next')} disabled={!canDebug}>Step over</button>
          <button onclick={() => debugAction('finish')} disabled={!canDebug}>Finish</button>
          <button onclick={() => debugAction('continue')} disabled={!canDebug}>Continue</button>
        </div>
      {/if}

      <div class="utility-cluster">
        <button class:active={showSettings} class="icon-button" onclick={() => showSettings = !showSettings} aria-label="Settings" title="Settings">⚙</button>
        <button class:active={showTerminal} class="icon-button terminal-icon" onclick={() => showTerminal = !showTerminal} aria-label="Program output" title="Program output">&gt;_</button>

        {#if showSettings}
          <aside class="settings-popover">
            <span class="eyebrow">settings</span>
            <label class="setting-toggle"><input type="checkbox" bind:checked={showPowerControls} /><span>Show debugger controls</span></label>
            <div class="setting-row"><span>Execution</span><strong>source-level timeline</strong></div>
            <div class="setting-row"><span>Trace limit</span><strong>{session?.traceLimit ?? project?.traceLimit ?? '—'}</strong></div>
            <div class="setting-row"><span>GDB stop timeout</span><strong>{project?.gdbStopTimeoutMs ? `${project.gdbStopTimeoutMs} ms` : '—'}</strong></div>
            <div class="setting-row"><span>Adapter</span><strong>{project?.adapter ?? 'generic C'}</strong></div>
          </aside>
        {/if}
      </div>
    </div>
  </header>

  {#if error}<div class="error-banner">{error}</div>{/if}

  <main class="workspace">
    <ProjectTree files={project?.files ?? []} activeFile={sourcePath} onSelect={loadSource} />

    <CodePane file={sourcePath} source={source} line={displayLine} {previousLine} functionName={displayFunction} />

    <aside class="visual-pane">
      <header class="visual-header">
        <div class="view-switcher" role="tablist" aria-label="Visualization depth">
          <button class:active={mode === 'program'} onclick={() => mode = 'program'}>Program</button>
          <button class:active={mode === 'memory'} onclick={() => mode = 'memory'}>Memory</button>
        </div>
      </header>

      <div class="visual-scroll">
        {#if snapshot}
          {#if mode === 'program'}<ProgramState {snapshot} {previousSnapshot} />{:else}<MemoryView {snapshot} />{/if}
        {:else}
          <div class="visual-empty">
            <span class="eyebrow">program state</span>
            <h2>Ready to run</h2>
            <p>Rebuild &amp; start to capture the run, then move freely through the recorded states.</p>
          </div>
        {/if}
      </div>
    </aside>
  </main>

  {#if showTerminal}<OutputDrawer {snapshot} onClose={() => showTerminal = false} />{/if}

  <Timeline
    index={session?.index ?? 0}
    total={session?.total ?? 0}
    complete={session?.complete ?? false}
    trace={session?.trace ?? null}
    active={Boolean(session)}
    {busy}
    onFirst={() => action('first')}
    onPrevious={() => action('previous')}
    onNext={() => action('next')}
    onLast={last}
    onCancel={cancelTrace}
    onNavigate={navigate}
  />
</div>

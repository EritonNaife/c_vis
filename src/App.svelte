<script>
  import CodePane from './lib/CodePane.svelte';
  import ProgramState from './lib/ProgramState.svelte';
  import MemoryView from './lib/MemoryView.svelte';
  import Timeline from './lib/Timeline.svelte';

  let project = $state(null);
  let session = $state(null);
  let argsText = $state('4 67 3 87 23');
  let source = $state('');
  let sourcePath = $state('');
  let mode = $state('program');
  let busy = $state(false);
  let error = $state('');

  const snapshot = $derived(session?.snapshot ?? null);
  const previousSnapshot = $derived(session?.previousSnapshot ?? null);
  const currentPath = $derived(snapshot?.frame?.projectPath ?? '');
  const previousLine = $derived(previousSnapshot?.frame?.projectPath === currentPath ? previousSnapshot?.frame?.line : null);

  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
  }

  function post(url, payload = {}) {
    return request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async function loadProject() {
    project = await request('/api/project');
    if (project.defaults?.args) argsText = project.defaults.args.join(' ');
  }

  async function loadSource(path) {
    if (!path || path === sourcePath || path.startsWith('/')) return;
    try {
      const payload = await request(`/api/source?path=${encodeURIComponent(path)}`);
      source = payload.source;
      sourcePath = path;
    } catch {
      source = '';
      sourcePath = path;
    }
  }

  async function syncSession(payload) {
    session = payload.session ?? payload;
    await loadSource(session?.snapshot?.frame?.projectPath);
  }

  async function start() {
    busy = true;
    error = '';
    try {
      const args = argsText.trim() ? argsText.trim().split(/\s+/) : [];
      await syncSession(await post('/api/session/start', { args }));
    } catch (cause) {
      error = cause.message;
    } finally {
      busy = false;
    }
  }

  async function action(name) {
    busy = true;
    error = '';
    try {
      await syncSession(await post('/api/session/action', { action: name }));
    } catch (cause) {
      error = cause.message;
    } finally {
      busy = false;
    }
  }

  async function navigate(index) {
    if (!session || index === session.index) return;
    busy = true;
    try {
      await syncSession(await post('/api/session/navigate', { index }));
    } catch (cause) {
      error = cause.message;
    } finally {
      busy = false;
    }
  }

  loadProject().catch((cause) => { error = cause.message; });
</script>

<svelte:head><title>c_vis — visual C execution</title></svelte:head>

<div class="app-shell">
  <header class="topbar">
    <div class="brand-block"><strong>c_vis</strong><span>visual C execution</span></div>
    <div class="run-controls">
      <input bind:value={argsText} aria-label="Program arguments" placeholder="program arguments" />
      <button class="primary" onclick={start} disabled={busy}>{session ? 'Rebuild & start' : 'Build & start'}</button>
    </div>
    <div class="status-pill" class:running={busy}><span></span>{busy ? 'running' : snapshot?.status ?? 'ready'}</div>
  </header>

  {#if error}<div class="error-banner">{error}</div>{/if}

  {#if snapshot}
    <main class="workspace">
      <CodePane file={sourcePath} source={source} line={snapshot.frame?.line} previousLine={previousLine} functionName={snapshot.frame?.func} />

      <section class="visual-pane">
        <header class="visual-header">
          <div class="view-switcher" role="tablist" aria-label="Visualization depth">
            <button class:active={mode === 'program'} onclick={() => mode = 'program'}>Program</button>
            <button class:active={mode === 'memory'} onclick={() => mode = 'memory'}>Memory</button>
          </div>
          {#if snapshot.operations?.length}<div class="latest-op"><span>latest</span><strong>{snapshot.operations.at(-1)}</strong></div>{/if}
        </header>

        <div class="visual-scroll">
          {#if mode === 'program'}<ProgramState {snapshot} {previousSnapshot} />{:else}<MemoryView {snapshot} />{/if}
        </div>
      </section>
    </main>

    <Timeline index={session.index} total={session.total} complete={session.complete} {busy} onFirst={() => action('first')} onPrevious={() => action('previous')} onNext={() => action('next')} onLast={() => action('last')} onNavigate={navigate} />
  {:else}
    <main class="welcome-state">
      <div>
        <span class="eyebrow">ready</span>
        <h1>See how your C code runs.</h1>
        <p>Build the program, then move through its execution one state at a time.</p>
        <button class="primary large" onclick={start} disabled={busy}>Build & start</button>
      </div>
    </main>
  {/if}
</div>

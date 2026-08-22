import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace, inspectProject, prepareBuild } from '../server/project.js';

test('creates and inspects a simple uploaded C workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cvis-project-'));
  try {
    const workspace = await createWorkspace({
      workspaceRoot: root,
      workspaceId: 'ws_test123',
      files: [
        { path: 'main.c', content: '#include "node.h"\nint main(void) { return 0; }\n' },
        { path: 'node.h', content: 'typedef struct s_node { int value; struct s_node *next; } t_node;\n' }
      ]
    });
    const analysis = await inspectProject(workspace.sourceDir);
    assert.deepEqual(analysis.cFiles, ['main.c']);
    assert.deepEqual(analysis.headerFiles, ['node.h']);
    assert.deepEqual(analysis.mainCandidates, ['main.c']);
    assert.equal(analysis.profile, 'generic');
    assert.equal(analysis.buildPlan.type, 'cc');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('builds a simple uploaded C project with debug flags', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cvis-build-'));
  try {
    const workspace = await createWorkspace({
      workspaceRoot: root,
      workspaceId: 'ws_build123',
      files: [{ path: 'main.c', content: 'int main(void) { return 0; }\n' }]
    });
    const result = await prepareBuild({ sourceDir: workspace.sourceDir, runtimeDir: path.join(workspace.runsDir, 'run_test') });
    assert.equal(result.ok, true, result.stderr || result.error);
    assert.equal(result.executable, 'cvis_program');
    assert.ok(result.command.includes('-g'));
    assert.ok(result.command.includes('-O0'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects upload paths that escape the workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cvis-project-'));
  try {
    await assert.rejects(
      createWorkspace({ workspaceRoot: root, workspaceId: 'ws_test456', files: [{ path: '../escape.c', content: 'int main(void){return 0;}' }] }),
      (error) => error.code === 'INVALID_FILE_PATH'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

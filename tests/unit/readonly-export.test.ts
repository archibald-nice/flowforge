import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoProject, addReference } from '../../src/domain/project.ts';
import { renderReadonly } from '../../src/persistence/readonly-export.ts';

const blob = (bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

test('M23: the read-only view has no script, no form control and no run entry', async () => {
  let project = addReference(demoProject(), 'draft', 'brief');
  project = { ...project, snapshots: project.snapshots };
  const media = new Map([['/fixtures/study-01.png', { path: '/fixtures/study-01.png', sha256: '', blob: blob([1, 2, 3]) }]]);
  const html = await renderReadonly(project, media);
  assert.ok(!/<script/i.test(html));
  assert.ok(!/<input/i.test(html));
  assert.ok(!/<textarea/i.test(html));
  assert.ok(!/<button/i.test(html));
  assert.ok(!/Generate/i.test(html));
  assert.ok(!/Run simulated/i.test(html));
  assert.ok(!/Approve/i.test(html));
  assert.ok(!/https?:\/\//i.test(html));
  assert.match(html, /READ-ONLY · NO EDIT · NO RUN · NO AGENT/);
});

test('M23: nodes, edges, references and the simulated marker all survive the export', async () => {
  const project = addReference(demoProject(), 'draft', 'brief');
  const media = new Map([['/fixtures/study-01.png', { path: '/fixtures/study-01.png', sha256: '', blob: blob([9, 9]) }]]);
  const html = await renderReadonly(project, media);
  for (const node of project.nodes) assert.ok(html.includes(node.title), node.title);
  assert.equal((html.match(/<line /g) ?? []).length, project.edges.length);
  assert.ok(html.includes('01 / Creative brief'));
  assert.ok(html.includes('data:image/png;base64,'));
  assert.ok(html.includes('simulated marker'));
  assert.ok(html.includes('read-only'));
});

test('M23: an empty project still renders a static page without controls', async () => {
  const empty = { ...demoProject(), nodes: [], edges: [], snapshots: [] };
  const html = await renderReadonly(empty, new Map());
  assert.ok(html.includes('READ-ONLY'));
  assert.ok(!/<button/i.test(html));
  assert.ok(!/<card/i.test(html));
});

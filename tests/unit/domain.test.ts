import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMediaNode, addReferenceEdge, freezeInputs, demoProject, validateProject, benchmarkProject } from '../../src/domain/project.ts';
import { zoomAt } from '../../src/domain/viewport.ts';

test('G2: edges alone are not explicit inputs; drafting never starts a provider', () => {
  const project = demoProject();
  assert.equal(project.snapshots.length, 0);
  assert.throws(() => freezeInputs(project, 'draft'), /显式输入/);
  assert.equal(project.snapshots.length, 0);
});

test('G1: only explicitly selected input revisions enter a frozen snapshot', () => {
  const project = demoProject();
  const draft = project.nodes.find(node => node.id === 'draft')!;
  assert.ok(isMediaNode(draft));
  if (!isMediaNode(draft)) throw new Error('fixture');
  draft.references = [{ nodeId: 'brief', role: 'reference' }];
  const snapshot = freezeInputs(project, 'draft');
  assert.deepEqual(snapshot.inputs.map(input => input.nodeId), ['brief']);
  draft.references.push({ nodeId: 'product', role: 'first-frame' });
  const twoInputs = freezeInputs(project, 'draft');
  assert.deepEqual(twoInputs.inputs.map(input => [input.nodeId, input.revision, input.role]), [['brief', 1, 'reference'], ['product', 1, 'first-frame']]);
  assert.equal(twoInputs.inputs[1].assetPath, '/fixtures/study-01.png');
  const brief = project.nodes.find(node => node.id === 'brief')!;
  if (brief.kind !== 'text') throw new Error('fixture');
  brief.text = 'Changed after freezing';
  brief.revision += 1;
  draft.prompt = 'Changed prompt';
  assert.equal(snapshot.inputs[0].revision, 1);
  assert.notEqual(snapshot.inputs[0].text, brief.text);
  assert.equal(snapshot.prompt, 'A quieter direction, with clear product focus.');
  assert.ok(Object.isFrozen(snapshot.inputs[0]));
  assert.ok(Object.isFrozen(snapshot.inputs));
});

test('references must be connected candidates; duplicates and unsupported edges fail', () => {
  const project = demoProject();
  assert.throws(() => addReferenceEdge(project, 'brief', 'draft'), /duplicate/);
  assert.throws(() => addReferenceEdge(project, 'brief', 'brief'), /self/);
  assert.throws(() => addReferenceEdge(project, 'draft', 'brief'), /compatible/);
  const draft = project.nodes.find(node => node.id === 'draft')!;
  if (!isMediaNode(draft)) throw new Error('fixture');
  draft.references = [{ nodeId: 'other', role: 'style' }];
  assert.throws(() => freezeInputs(project, 'draft'), /candidate/);
  draft.references = [{ nodeId: 'brief', role: 'reference' }, { nodeId: 'brief', role: 'style' }];
  assert.throws(() => freezeInputs(project, 'draft'), /duplicate/);
});

test('persistence validation rejects unknown schema, bad IDs, references and nonfinite coordinates', () => {
  const project = demoProject();
  assert.deepEqual(validateProject(structuredClone(project)), project);
  assert.throws(() => validateProject({ ...project, schemaVersion: 9 }), /schema/);
  assert.throws(() => validateProject({ ...project, nodes: [...project.nodes, project.nodes[0]] }), /duplicate/);
  project.nodes[0].position.x = Infinity;
  assert.throws(() => validateProject(project), /position/);
});

test('corrupt snapshots and asset sources do not become trusted persisted data', () => {
  const project = demoProject();
  const image = project.nodes.find(node => node.kind === 'image')!;
  if (image.kind !== 'image') throw new Error('fixture');
  image.assetPath = 'https://untrusted.invalid/tracker.png';
  assert.throws(() => validateProject(project), /asset/);
  const clean = demoProject();
  clean.snapshots = [{} as never];
  assert.throws(() => validateProject(clean), /snapshot/);
});

test('pointer anchored zoom preserves world point and clamps at 0.1..4', () => {
  const view = { x: 34, y: -80, zoom: 1.2 };
  const pointer = { x: 420, y: 240 };
  const result = zoomAt(view, pointer, 1.4);
  assert.ok(Math.abs((pointer.x - view.x) / view.zoom - (pointer.x - result.x) / result.zoom) < 1e-9);
  assert.ok(Math.abs((pointer.y - view.y) / view.zoom - (pointer.y - result.y) / result.zoom) < 1e-9);
  assert.equal(zoomAt(view, pointer, 100).zoom, 4);
  assert.equal(zoomAt(view, pointer, 0.001).zoom, 0.1);
});

test('restored snapshots remain frozen and invalid identities are rejected', () => {
  const project = demoProject();
  const draft = project.nodes.find(node => node.id === 'draft')!;
  if (!isMediaNode(draft)) throw new Error('fixture');
  draft.references = [{ nodeId: 'brief', role: 'reference' }];
  project.snapshots = [freezeInputs(project, draft.id)];
  const restored = validateProject(structuredClone(project));
  assert.ok(Object.isFrozen(restored.snapshots[0]));
  assert.ok(Object.isFrozen(restored.snapshots[0].inputs[0]));
  assert.throws(() => validateProject({ ...project, snapshots: [...project.snapshots, project.snapshots[0]] }), /snapshot ID/);
  assert.throws(() => validateProject({ ...project, snapshots: [{ ...project.snapshots[0], targetNodeId: 'brief' }] }), /snapshot target/);
});

test('indexed validation preserves graph guards and full benchmark cardinality', () => {
  for (const count of [300, 1000]) {
    const restored = validateProject(benchmarkProject(count));
    assert.equal(restored.nodes.length, count);
    assert.equal(restored.edges.length, count === 300 ? 500 : 1600);
    assert.equal(restored.nodes.filter(node => node.kind === 'image').length, 30 + Math.floor(count / 2));
    assert.equal(restored.credits, 200);
  }
  const project = demoProject();
  assert.throws(() => validateProject({ ...project, edges: [...project.edges, { ...project.edges[0], id: 'different-id' }] }), /duplicate edge/);
  assert.throws(() => validateProject({ ...project, edges: [{ id: 'bad', source: 'brief', target: 'brief' }] }), /self/);
  assert.throws(() => validateProject({ ...project, edges: [{ id: 'bad', source: 'draft', target: 'brief' }] }), /compatible/);
  assert.throws(() => validateProject({ ...project, mediaVersion: 2 }), /media version/);
});

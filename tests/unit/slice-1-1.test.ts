import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NODE_KINDS, addNode, addReference, applySimulatedResult, demoProject, freezeInputs, isMediaNode,
  isSimulatedPath, removeNode, validateProject, type Project,
} from '../../src/domain/project.ts';
import { providerCallCount, resetProviderCalls } from '../../src/providers/mock-provider.ts';

const kinds = (project: Project) => project.nodes.map(node => node.kind);

test('1.1: the canvas offers exactly five node kinds', () => {
  assert.deepEqual([...NODE_KINDS], ['text', 'image', 'video', 'audio', 'scene']);
  let project = demoProject();
  for (const kind of NODE_KINDS) project = addNode(project, kind, { id: `new-${kind}` });
  assert.deepEqual(kinds(project).slice(-5), ['text', 'image', 'video', 'audio', 'scene']);
  // Creating is a draft, never a result: nothing carries an asset yet.
  for (const kind of ['image', 'video', 'audio'] as const) {
    const node = project.nodes.find(item => item.id === `new-${kind}`)!;
    assert.ok(isMediaNode(node));
    if (!isMediaNode(node)) throw new Error('fixture');
    assert.equal(node.assetPath, undefined);
    assert.equal(node.prompt, '');
    assert.deepEqual(node.references, []);
  }
  // Scene is a placeholder and cannot take part in references.
  assert.throws(() => addNode(project, 'new-kind' as never), /Unsupported node kind/);
});

test('1.1: an empty image node saves, reloads and can be referenced', () => {
  const project = addNode(demoProject(), 'image', { id: 'empty-image', position: { x: 0, y: 600 } });
  const empty = project.nodes.find(node => node.id === 'empty-image')!;
  assert.ok(isMediaNode(empty));
  if (!isMediaNode(empty)) throw new Error('fixture');
  assert.equal(empty.assetPath, undefined);
  const restored = validateProject(structuredClone(project));
  const reloaded = restored.nodes.find(node => node.id === 'empty-image')!;
  assert.ok(isMediaNode(reloaded));
  if (!isMediaNode(reloaded)) throw new Error('fixture');
  assert.equal(reloaded.assetPath, undefined);
  // An empty draft is still a valid snapshot input source.
  const wired = addReference({ ...restored, edges: [...restored.edges, { id: 'empty-image-draft', source: 'empty-image', target: 'draft' }] },
    'draft', 'empty-image');
  const snapshot = freezeInputs(wired, 'draft');
  const input = snapshot.inputs.find(item => item.nodeId === 'empty-image')!;
  assert.equal(input.kind, 'image');
  assert.equal(input.assetPath, '');
});

test('1.1: a simulated result lands inside the node and stays marked simulated', () => {
  resetProviderCalls();
  const project = demoProject();
  const before = project.nodes.length;
  const next = applySimulatedResult(project, 'draft', 'run-1');
  const node = next.nodes.find(item => item.id === 'draft')!;
  assert.ok(isMediaNode(node));
  if (!isMediaNode(node)) throw new Error('fixture');
  assert.equal(next.nodes.length, before, 'the result must not add a node');
  assert.ok(node.assetPath && isSimulatedPath(node.assetPath));
  assert.equal(node.assetSource, 'simulated');
  assert.equal(node.revision, 2);
  // The asset never becomes uploadable input and never calls a provider.
  assert.equal(providerCallCount(), 0);
  assert.equal(validateProject(structuredClone(next)).nodes.length, before);
});

test('1.1: a legacy generation project migrates to an image draft', () => {
  const legacy = structuredClone(demoProject()) as unknown as Record<string, unknown>;
  const nodes = legacy.nodes as Record<string, unknown>[];
  const draft = nodes.find(node => node.id === 'draft')!;
  draft.kind = 'generation';
  draft.prompt = 'Legacy prompt';
  draft.references = [{ nodeId: 'brief', role: 'brief' }];
  legacy.schemaVersion = 1;
  const migrated = validateProject(legacy);
  assert.equal(migrated.schemaVersion, 4);
  const node = migrated.nodes.find(item => item.id === 'draft')!;
  assert.equal(node.kind, 'image');
  assert.ok(isMediaNode(node));
  if (!isMediaNode(node)) throw new Error('fixture');
  assert.equal(node.prompt, 'Legacy prompt');
  assert.deepEqual(node.references, [{ nodeId: 'brief', role: 'reference' }]);
});

test('1.1: deleting a media node drops its candidates and references', () => {
  let project = demoProject();
  project = applySimulatedResult(project, 'draft', 'run-2');
  project = removeNode(project, 'draft');
  assert.equal(project.nodes.some(node => node.id === 'draft'), false);
  assert.deepEqual(project.edges, []);
});

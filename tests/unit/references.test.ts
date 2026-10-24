import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMediaNode, addReference, addReferenceEdge, demoProject, freezeInputs, removeReference, removeReferenceEdge,
  setReferenceRole, validateProject, type Project } from '../../src/domain/project.ts';
import { providerCallCount, resetProviderCalls, withoutProviderCalls } from '../../src/providers/mock-provider.ts';

const draftOf = (project: Project) => {
  const draft = project.nodes.find(node => node.id === 'draft');
  if (!draft || !isMediaNode(draft)) throw new Error('fixture');
  return draft;
};

test('M09: a reference is prompt-level and must already be a candidate edge', () => {
  resetProviderCalls();
  const project = withoutProviderCalls('adding a reference', () => addReference(demoProject(), 'draft', 'brief'));
  const draft = draftOf(project);
  assert.deepEqual(draft.references, [{ nodeId: 'brief', role: 'reference' }]);
  assert.equal(draft.revision, 2);
  assert.equal(providerCallCount(), 0);

  assert.throws(() => addReference(demoProject(), 'draft', 'other'), /connected candidate/);
  assert.throws(() => addReference(project, 'draft', 'brief'), /duplicate reference/);
  const second = addReference(project, 'draft', 'product');
  assert.deepEqual(draftOf(second).references.map(ref => ref.role), ['reference', 'first-frame']);
  assert.throws(() => addReference(project, 'brief', 'product'), /media node/);
  assert.throws(() => addReference(demoProject(), 'draft', 'brief', 'brief' as never), /Invalid reference role/);
});

test('M09: only referenced inputs enter the snapshot; an edge-only neighbour stays out', () => {
  // other-draft is a candidate line with no reference.
  let project = addReferenceEdge(demoProject(), 'other', 'draft');
  project = addReference(project, 'draft', 'brief');
  const snapshot = freezeInputs(project, 'draft');
  assert.deepEqual(snapshot.inputs.map(input => [input.nodeId, input.revision, input.role]), [['brief', 1, 'reference']]);
  assert.ok(!snapshot.inputs.some(input => input.nodeId === 'other'));
  assert.ok(!snapshot.inputs.some(input => input.nodeId === 'product'));
  // The revision travels with the input, so later edits cannot rewrite history.
  const edited = { ...project, nodes: project.nodes.map(node => node.id === 'brief' ? { ...node, text: 'Rewritten after freeze.', revision: 9 } : node) };
  assert.equal(snapshot.inputs[0].revision, 1);
  assert.equal(edited.nodes.find(node => node.id === 'brief')!.revision, 9);
});

test('M10: removing a reference keeps the line and the source node', () => {
  resetProviderCalls();
  let project = addReference(demoProject(), 'draft', 'brief');
  project = addReference(project, 'draft', 'product');
  const revisionBefore = draftOf(project).revision;
  project = withoutProviderCalls('removing a reference', () => removeReference(project, 'draft', 'brief'));
  const draft = draftOf(project);
  assert.deepEqual(draft.references, [{ nodeId: 'product', role: 'first-frame' }]);
  assert.equal(draft.revision, revisionBefore + 1);
  assert.deepEqual(project.edges.map(edge => edge.id), ['brief-draft', 'product-draft']);
  assert.equal(project.nodes.find(node => node.id === 'brief')!.revision, 1);
  assert.equal(providerCallCount(), 0);
  assert.throws(() => removeReference(project, 'draft', 'brief'), /Unknown reference/);

  const snapshot = freezeInputs(project, 'draft');
  assert.deepEqual(snapshot.inputs.map(input => input.nodeId), ['product']);
  // Removing the candidate line afterwards still clears the matching reference.
  const pruned = removeReferenceEdge(project, 'product-draft');
  assert.deepEqual(draftOf(pruned).references, []);
});

test('M10: purposes are the designed three values and reach the snapshot', () => {
  let project = addReference(demoProject(), 'draft', 'brief');
  project = addReference(project, 'draft', 'product');
  for (const role of ['first-frame', 'style', 'reference'] as const) {
    project = setReferenceRole(project, 'draft', 'brief', role);
    assert.equal(draftOf(project).references.find(ref => ref.nodeId === 'brief')!.role, role);
  }
  project = setReferenceRole(project, 'draft', 'product', 'style');
  const snapshot = freezeInputs(project, 'draft');
  assert.deepEqual(snapshot.inputs.map(input => [input.nodeId, input.role]), [['brief', 'reference'], ['product', 'style']]);
  assert.throws(() => setReferenceRole(project, 'draft', 'other', 'style'), /Unknown reference/);
  assert.throws(() => setReferenceRole(project, 'draft', 'brief', 'brief' as never), /Invalid reference role/);
});

test('M09/M10: legacy brief / product / other roles load as the designed three', () => {
  const legacy = demoProject();
  const draft = legacy.nodes.find(node => node.id === 'draft');
  if (!draft || !isMediaNode(draft)) throw new Error('fixture');
  (draft.references as { nodeId: string; role: string }[]) = [{ nodeId: 'brief', role: 'brief' }, { nodeId: 'product', role: 'product' }];
  legacy.snapshots = [Object.freeze({ id: 'legacy-snap', targetNodeId: 'draft', prompt: 'Old prompt.', createdAt: '2026-10-13T00:00:00.000Z',
    mode: 'inspection-only' as const,
    inputs: Object.freeze([Object.freeze({ nodeId: 'brief', revision: 1, role: 'other' as never, kind: 'text' as const, text: 'Old.' })]) })];
  const normalized = validateProject(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual([...draftOf(normalized).references], [{ nodeId: 'brief', role: 'reference' }, { nodeId: 'product', role: 'first-frame' }]);
  assert.equal(normalized.snapshots[0].inputs[0].role, 'style');
});

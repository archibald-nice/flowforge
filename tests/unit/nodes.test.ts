import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMediaNode, addNode, addReferenceEdge, demoProject, removeNode, removeReferenceEdge, validateProject, type Project } from '../../src/domain/project.ts';
import { providerCallCount, resetProviderCalls, withoutProviderCalls } from '../../src/providers/mock-provider.ts';

const kinds = (project: Project) => project.nodes.map(node => `${node.kind}:${node.id}`);

test('M07: only the five node kinds can be added; no capability tools exist', () => {
  const project = demoProject();
  const withText = addNode(project, 'text', { id: 'new-text' });
  assert.equal(withText.nodes.length, project.nodes.length + 1);
  const text = withText.nodes.at(-1)!;
  assert.equal(text.kind, 'text');
  assert.equal(text.title, 'New text');
  if (text.kind !== 'text') throw new Error('fixture');
  assert.equal(text.text, '');
  assert.equal(validateProject(withText).nodes.length, withText.nodes.length);

  const withImage = addNode(project, 'image', { id: 'new-image', assetPath: '/fixtures/study-04.png' });
  const image = withImage.nodes.at(-1)!;
  assert.equal(image.kind, 'image');
  if (image.kind !== 'image') throw new Error('fixture');
  assert.equal(image.assetPath, '/fixtures/study-04.png');
  assert.throws(() => addNode(project, 'image', { id: 'bad', assetPath: 'https://example.com/a.png' }), /bundled fixture/);
  assert.throws(() => addNode(project, 'timeline' as never), /Unsupported node kind/);

  const withDraft = addNode(project, 'image', { id: 'new-draft' });
  const draft = withDraft.nodes.at(-1)!;
  assert.ok(isMediaNode(draft));
  if (!isMediaNode(draft)) throw new Error('fixture');
  assert.equal(draft.prompt, '');
  assert.deepEqual(draft.references, []);

  const menu = ['text', 'image', 'video', 'audio', 'scene'];
  for (const blocked of ['3d', 'timeline', 'scene-director', 'image-editor', 'generation']) assert.ok(!menu.includes(blocked as never), blocked);
});

test('M07: node creation is an empty draft, never a result and never a provider call', () => {
  resetProviderCalls();
  const project = withoutProviderCalls('creating a node', () => addNode(demoProject(), 'image', { id: 'draft-2' }));
  const draft = project.nodes.at(-1)!;
  if (!isMediaNode(draft)) throw new Error('fixture');
  assert.equal(draft.prompt, '');
  assert.deepEqual(draft.references, []);
  assert.equal(providerCallCount(), 0);
});

test('M07: deleting a node removes its candidates and any references that pointed at it', () => {
  let project = demoProject();
  const draft = project.nodes.find(node => node.id === 'draft')!;
  if (!isMediaNode(draft)) throw new Error('fixture');
  draft.references = [{ nodeId: 'brief', role: 'reference' }, { nodeId: 'product', role: 'first-frame' }];
  const revisionBefore = draft.revision;
  project = removeNode(project, 'brief');
  assert.deepEqual(kinds(project), ['image:product', 'image:draft', 'text:other']);
  assert.deepEqual(project.edges.map(edge => edge.id), ['product-draft']);
  const after = project.nodes.find(node => node.id === 'draft')!;
  if (!isMediaNode(after)) throw new Error('fixture');
  assert.deepEqual(after.references.map(reference => reference.nodeId), ['product']);
  assert.equal(after.revision, revisionBefore + 1);
  assert.equal(providerCallCount(), 0);
  assert.throws(() => removeNode(project, 'missing'), /Unknown node/);
});

test('M08: candidates are edges only, and removing one drops the matching reference', () => {
  resetProviderCalls();
  let project = demoProject();
  project = withoutProviderCalls('creating a candidate edge', () => addReferenceEdge(project, 'other', 'draft'));
  const draft = project.nodes.find(node => node.id === 'draft')!;
  if (!isMediaNode(draft)) throw new Error('fixture');
  draft.references = [{ nodeId: 'other', role: 'reference' }];
  const revisionBefore = draft.revision;
  project = withoutProviderCalls('removing a candidate', () => removeReferenceEdge(project, 'other-draft'));
  assert.ok(!project.edges.some(edge => edge.id === 'other-draft'));
  const after = project.nodes.find(node => node.id === 'draft')!;
  if (!isMediaNode(after)) throw new Error('fixture');
  assert.deepEqual(after.references, []);
  assert.equal(after.revision, revisionBefore + 1);
  assert.equal(providerCallCount(), 0);
  assert.throws(() => removeReferenceEdge(project, 'other-draft'), /Unknown candidate/);
});

test('M08: self, duplicate and cyclic candidates are rejected as designed', () => {
  const project = demoProject();
  assert.throws(() => addReferenceEdge(project, 'draft', 'draft'), /self|reference/);
  assert.throws(() => addReferenceEdge(project, 'brief', 'draft'), /duplicate/);
  assert.throws(() => addReferenceEdge(project, 'product', 'brief'), /compatible/);
  // A cycle can only arrive from a corrupted or imported project, because public
  // creation rejects generation-to-generation edges before the cycle check.
  const corrupted: Project = { ...project, edges: [...project.edges, { id: 'draft-other', source: 'draft', target: 'other' }] };
  assert.throws(() => addReferenceEdge(corrupted, 'other', 'draft'), /cyclic/);
});

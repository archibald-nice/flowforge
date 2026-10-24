import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMediaNode, demoProject, addReference, setDraftSettings } from '../../src/domain/project.ts';
import { adviceFor } from '../../src/domain/agent-advice.ts';

test('M01: advice is bound to the selected node and empty without one', () => {
  const project = demoProject();
  assert.deepEqual(adviceFor(project, 'missing'), []);
  assert.equal(adviceFor(project, 'brief').length, 1);
  const draftAdvice = adviceFor(project, 'draft');
  assert.deepEqual(draftAdvice.map(item => item.id), ['reference-first']);
});

test('M21: advice only suggests; it never mutates the project', () => {
  const project = demoProject();
  const before = JSON.stringify(project);
  adviceFor(project, 'draft');
  adviceFor(project, 'brief');
  assert.equal(JSON.stringify(project), before);
});

test('M21: approval targets the existing explicit reference path, not a run', () => {
  let project = demoProject();
  const advice = adviceFor(project, 'brief');
  assert.equal(advice[0].action, 'reference');
  project = addReference(project, 'draft', 'brief');
  const draft = project.nodes.find(node => node.id === 'draft');
  assert.ok(draft && isMediaNode(draft));
  assert.deepEqual(draft && isMediaNode(draft) ? draft.references.map(reference => reference.nodeId) : [], ['brief']);
  assert.equal(project.snapshots.length, 0);
  assert.equal(adviceFor(project, 'brief')[0].action, 'focus-run');
});

test('M21: a ready draft offers the simulated-run step and still needs a manual submit', () => {
  let project = addReference(demoProject(), 'draft', 'brief');
  const ready = adviceFor(project, 'draft');
  assert.equal(ready[0].id, 'run-ready');
  assert.equal(ready[0].action, 'focus-run');
  project = setDraftSettings(project, 'draft', { model: 'mock-still-a', size: '1024', variants: 1 });
  assert.equal(project.snapshots.length, 0);
});

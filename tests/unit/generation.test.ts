import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, addReference, demoProject, freezeInputs, setDraftSettings, settingsOf,
  type MediaNode } from '../../src/domain/project.ts';
import { cancelRun, providerCallCount, resetProviderCalls, runControls, runSeed, startRun, tickRun }
  from '../../src/providers/mock-provider.ts';

const draftOf = (nodes: readonly { id: string; kind: string }[], id = 'draft') =>
  nodes.find(node => node.id === id) as MediaNode;

test('M11: the form defaults to a designed mock model and size', () => {
  assert.deepEqual(settingsOf(draftOf(demoProject().nodes)), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.model, 'mock-still-a');
});

test('M11: changing the form bumps the draft revision and leaves snapshots alone', () => {
  const project = addReference(demoProject(), 'draft', 'brief');
  const frozen = freezeInputs(project, 'draft');
  const withSnapshot = { ...project, snapshots: [frozen] };
  const changed = setDraftSettings(withSnapshot, 'draft', { model: 'mock-still-b', size: '1024' });
  const node = draftOf(changed.nodes);
  assert.deepEqual(node.settings, { model: 'mock-still-b', size: '1024', variants: 1 });
  assert.equal(node.revision, draftOf(project.nodes).revision + 1);
  assert.deepEqual(changed.snapshots, withSnapshot.snapshots);
  assert.deepEqual(withSnapshot.snapshots[0].settings, DEFAULT_SETTINGS);
});

test('M11: the chosen model constrains the sizes and the snapshot carries the form', () => {
  assert.throws(() => setDraftSettings(demoProject(), 'draft', { model: 'mock-still-b', size: '512' }),
    /Unsupported mock size/);
  const project = setDraftSettings(addReference(demoProject(), 'draft', 'brief'), 'draft', { size: '1024' });
  assert.deepEqual(freezeInputs(project, 'draft').settings, { model: 'mock-still-a', size: '1024', variants: 1 });
});

const request = { prompt: 'brief', inputs: [{ nodeId: 'brief', revision: 1, role: 'reference' }],
  settings: { model: 'mock-still-a', size: '512', variants: 1 as const } };

test('M12: queued → running → succeeded counts exactly one provider call and costs 0', () => {
  resetProviderCalls();
  runControls.failNext = false;
  const queued = startRun(request);
  assert.equal(queued.state, 'queued');
  assert.equal(providerCallCount(), 1);
  const running = tickRun(queued);
  assert.equal(running.state, 'running');
  const done = tickRun(running);
  assert.equal(done.state, 'succeeded');
  assert.equal(done.result?.mode, 'simulated');
  assert.equal(done.result?.status, 'simulated-only');
  assert.equal(done.result?.cost, 0);
  assert.equal(providerCallCount(), 1);
});

test('M12: same input yields the same seed, a changed prompt does not', () => {
  assert.equal(runSeed(request), runSeed({ ...request }));
  assert.notEqual(runSeed(request), runSeed({ ...request, prompt: 'other brief' }));
});

test('M12: a controlled failure touches only the run slot', () => {
  runControls.failNext = true;
  const failed = tickRun(tickRun(startRun(request)));
  assert.equal(failed.state, 'failed');
  assert.equal(failed.result, null);
  assert.match(failed.error ?? '', /画布内容未变/);
  assert.deepEqual(failed.request, request);
  assert.equal(runControls.failNext, false);
  assert.equal(tickRun(startRun(request)).state, 'running');
});

test('M12: cancel blocks the result and is idempotent', () => {
  const canceled = cancelRun(tickRun(startRun(request)));
  assert.equal(canceled.state, 'canceled');
  assert.equal(tickRun(canceled), canceled);
  assert.equal(tickRun(canceled).result, null);
  assert.equal(cancelRun(canceled), canceled);
});

test('M12: canceling a finished run changes nothing', () => {
  const done = tickRun(tickRun(startRun(request)));
  assert.equal(cancelRun(done), done);
  assert.notEqual(done.result, null);
});

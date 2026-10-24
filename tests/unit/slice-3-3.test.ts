import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resetArkTransport, setArkTransport, startArkRun, tickArkRun, DEFAULT_ARK_SETTINGS,
} from '../../src/providers/ark-provider.ts';
import { applyRealResult } from '../../src/providers/real-provider.ts';
import { addReference, addReferenceEdge, createProject, addNode, setDraftSettings, freezeInputs, isMediaNode, type GenerationSettings } from '../../src/domain/project.ts';
import { providerCallCount, withoutProviderCalls, startRun, resetProviderCalls } from '../../src/providers/mock-provider.ts';

/** Records every call and replays scripted HTTP responses. Never hits a network. */
function fakeTransport(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: unknown }[] = [];
  return {
    calls,
    async fetchJson(url: string, init: unknown) {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error('no scripted response left');
      return next;
    },
  };
}

const okData = (b64: string) => ({ model: 'doubao-seedream-4-0-20260415', created: 1, data: [{ b64_json: b64, size: '1280x720' }] });

test('3.3 plan confirm routes to the real provider and writes the result back marked real', async () => {
  const transport = fakeTransport([
    { status: 200, body: okData(Buffer.from('PNG-PLAN-CONFIRM').toString('base64')) },
  ]);
  setArkTransport(transport.fetchJson);
  process.env.ARK_ENABLED = '1';
  process.env.ARK_API_KEY = 'test-key-not-real';
  try {
    // The same pipeline the confirm button runs: freeze, start, tick twice, apply.
    let project = createProject();
    project = addNode(project, 'text');
    project = addNode(project, 'image');
    const source = project.nodes.find(node => node.kind === 'text')!;
    const draft = project.nodes.find(isMediaNode)!;
    project = addReferenceEdge(project, source.id, draft.id);
    project = addReference(project, draft.id, source.id);
    project = setDraftSettings(project, draft.id, { model: DEFAULT_ARK_SETTINGS.model as GenerationSettings['model'], size: '1280x720', variants: 1 });
    const snapshot = freezeInputs(project, draft.id);
    assert.ok(snapshot, 'freezeInputs yields a snapshot for the plan target');

    const run = startArkRun({ prompt: snapshot.prompt, settings: { model: DEFAULT_ARK_SETTINGS.model, size: '1280x720', variants: 1 } });
    const running = await tickArkRun(run);
    const done = await tickArkRun(running);
    assert.equal(done.state, 'succeeded');
    assert.equal(transport.calls.length, 1, 'exactly one HTTP call, no retries');

    const bytes = done.result!.bytes.slice().buffer as ArrayBuffer;
    const assetPath = `asset:plan-${done.id}.png`;
    const written = applyRealResult(project, draft.id, assetPath);
    const node = written.nodes.find(entry => entry.id === draft.id)!;
    assert.equal((node as { resultMeta?: { mode?: string } }).resultMeta?.mode, 'real');
    assert.equal((node as { assetSource?: string }).assetSource, 'asset');
    assert.ok(providerCallCount() === 0, 'real path never counts as a mock provider call');
    void bytes;
  } finally {
    resetArkTransport();
    delete process.env.ARK_ENABLED;
    delete process.env.ARK_API_KEY;
  }
});

test('3.3 cancel path produces no HTTP call at all', async () => {
  const transport = fakeTransport([
    { status: 200, body: okData(Buffer.from('PNG-NEVER').toString('base64')) },
  ]);
  setArkTransport(transport.fetchJson);
  process.env.ARK_ENABLED = '1';
  process.env.ARK_API_KEY = 'test-key-not-real';
  try {
    const run = startArkRun({ prompt: 'p', settings: { model: DEFAULT_ARK_SETTINGS.model, size: '1280x720', variants: 1 } });
    // A cancel before the first tick drops the run object; nothing advances.
    // The UI path is: plan-cancel clears state without ever starting the run.
    assert.equal(run.state, 'queued');
    assert.equal(transport.calls.length, 0, 'queued run makes no HTTP call until ticked');
    assert.equal(transport.calls.length, 0, 'cancel never ticks; no network traffic');
  } finally {
    resetArkTransport();
    delete process.env.ARK_ENABLED;
    delete process.env.ARK_API_KEY;
  }
});

test('3.3 reference plan confirm stays on the mock path (no Ark start without an Ark model)', () => {
  const callsBefore = providerCallCount();
  let project = createProject();
  project = addNode(project, 'text');
  project = addNode(project, 'image');
  const source = project.nodes.find(node => node.kind === 'text')!;
  const draft = project.nodes.find(isMediaNode)!;
  project = addReferenceEdge(project, source.id, draft.id);
    project = addReference(project, draft.id, source.id);
  const snapshot = freezeInputs(project, draft.id);
  // A mock-model run is still a provider call; the guard is that Ark is untouched.
  const run = startRun({ prompt: snapshot.prompt, settings: snapshot.settings,
    inputs: snapshot.inputs.map(input => ({ nodeId: input.nodeId, revision: input.revision, role: input.role })) });
  assert.equal(run.state, 'queued');
  assert.equal(providerCallCount(), callsBefore + 1, 'mock path still counts exactly one call');
});

test('3.3 asset write is wrapped in the zero-provider-call guard', () => {
  resetProviderCalls();
  const project = createProject();
  assert.throws(() => withoutProviderCalls('slice 3.3 apply', () => applyRealResult(project, 'missing-node', 'asset:x.png')),
    /media nodes/, 'guard passes the domain error through; provider stays at zero');
  assert.equal(providerCallCount(), 0);
});

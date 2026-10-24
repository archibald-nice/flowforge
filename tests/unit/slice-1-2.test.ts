import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  arkEnabled, resetArkTransport, setArkTransport,
  startArkRun, tickArkRun, ARK_IMAGE_MODELS, ARK_SIZES, DEFAULT_ARK_SETTINGS,
} from '../../src/providers/ark-provider.ts';

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

const okData = (b64: string) => ({ model: DEFAULT_ARK_SETTINGS.model, created: 1, data: [{ b64_json: b64, size: '1024x1024' }] });

test('1.2 ark is disabled unless ARK_ENABLED=1', () => {
  delete process.env.ARK_ENABLED;
  assert.equal(arkEnabled(), false);
  process.env.ARK_ENABLED = '1';
  assert.equal(arkEnabled(), true);
  process.env.ARK_ENABLED = '0';
  assert.equal(arkEnabled(), false);
  delete process.env.ARK_ENABLED;
});

test('1.2 model table is local and documented', () => {
  assert.ok(ARK_IMAGE_MODELS.length >= 1);
  for (const model of ARK_IMAGE_MODELS) assert.ok(model.sizes.length >= 1);
  assert.ok(ARK_IMAGE_MODELS.some((model) => model.id === DEFAULT_ARK_SETTINGS.model));
});

test('1.2 fake transport run succeeds without any network call and yields a real result', async () => {
  const transport = fakeTransport([
    { status: 200, body: okData(Buffer.from('PNGDATA').toString('base64')) },
  ]);
  setArkTransport(transport.fetchJson);
  process.env.ARK_ENABLED = '1';
  process.env.ARK_API_KEY = 'test-key-not-real';
  try {
    const run = startArkRun({ prompt: 'a red bottle', settings: { model: DEFAULT_ARK_SETTINGS.model, size: DEFAULT_ARK_SETTINGS.size, variants: 1 } });
    assert.equal(run.state, 'queued');
    const step1 = await tickArkRun(run);
    assert.equal(step1.state, 'running');
    const step2 = await tickArkRun(step1);
    assert.equal(step2.state, 'succeeded');
    assert.equal(step2.result?.mode, 'real');
    assert.ok((step2.result?.bytes.byteLength ?? 0) > 0);
    assert.equal(transport.calls.length, 1);
    assert.match(transport.calls[0].url, /images\/generations/);
  } finally {
    resetArkTransport();
    delete process.env.ARK_ENABLED;
    delete process.env.ARK_API_KEY;
  }
});

test('1.2 a failed HTTP response fails the run once and never retries', async () => {
  const transport = fakeTransport([{ status: 429, body: { error: { message: 'rate limited' } } }]);
  setArkTransport(transport.fetchJson);
  process.env.ARK_ENABLED = '1';
  process.env.ARK_API_KEY = 'test-key-not-real';
  try {
    const run = startArkRun({ prompt: 'p', settings: { model: DEFAULT_ARK_SETTINGS.model, size: DEFAULT_ARK_SETTINGS.size, variants: 1 } });
    const running = await tickArkRun(run);
    const failed = await tickArkRun(running);
    assert.equal(failed.state, 'failed');
    assert.match(failed.error ?? '', /rate limited/);
    const again = await tickArkRun(failed);
    assert.equal(again, failed);
    assert.equal(transport.calls.length, 1, 'no second HTTP call after failure');
  } finally {
    resetArkTransport();
    delete process.env.ARK_ENABLED;
    delete process.env.ARK_API_KEY;
  }
});

test('1.2 a disabled provider refuses to start instead of silently mocking', () => {
  delete process.env.ARK_ENABLED;
  assert.throws(() => startArkRun({ prompt: 'p', settings: { model: DEFAULT_ARK_SETTINGS.model, size: DEFAULT_ARK_SETTINGS.size, variants: 1 } }), /ARK_ENABLED=1/);
});

test('1.2 real bytes are rejected as canvas fixtures', async () => {
  const { isCanvasAssetSource } = await import('../../src/domain/project.ts');
  assert.equal(isCanvasAssetSource('ark:whatever'), false);
});

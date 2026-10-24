/**
 * Slice 1.6 — local generation proxy.
 *
 * Two things are proven here, with no network:
 * 1. The server side: loopback-only, one-at-a-time, JSON-only, and it reaches
 *    real models by reusing the provider modules (never a separate call path).
 * 2. The client side: the four proxy transports map provider-native shapes onto
 *    the `/api/*` JSON contract, and `installProxyTransports()` is a no-op when
 *    the proxy is unavailable (no silent downgrade).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { handleProxyRequest, isLoopback, proxyConfigured, resetProxyState } from '../../src/server/proxy.ts';
import { ARK_IMAGE_MODELS, DEFAULT_ARK_SETTINGS, resetArkTransport, setArkTransport } from '../../src/providers/ark-provider.ts';
import { resetVideoTransport, setVideoTransport } from '../../src/providers/video-provider.ts';
import { resetTextTransport, setTextTransport } from '../../src/providers/text-provider.ts';
import { resetSpeechTransport, setSpeechTransport } from '../../src/providers/speech-provider.ts';
import { installProxyTransports, proxyAvailable, resetProxyTransports } from '../../src/providers/proxy-transport.ts';

const LOOPBACK = '127.0.0.1';
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

async function withEnv<T>(vars: Record<string, string | undefined>, run: () => T | Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('1.6 server: only loopback callers are served', async () => {
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('::1'), true);
  assert.equal(isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(isLoopback('localhost'), true);
  assert.equal(isLoopback('10.0.0.7'), false);
  assert.equal(isLoopback(undefined), false);

  const blocked = await handleProxyRequest({ method: 'POST', path: '/api/ark/generate', remoteAddress: '10.0.0.7', body: '{}' });
  assert.equal(blocked.status, 403);
  assert.match(JSON.stringify(blocked.body), /only serves this machine/u);
});

test('1.6 server: registration is dev-only, disable-able and needs a key', () => {
  const key = { ARK_API_KEY: 'test-key-not-real' };
  assert.equal(proxyConfigured({ ...key }, 'serve'), true);
  assert.equal(proxyConfigured({ ...key, ARK_PROXY_ENABLED: '0' }, 'serve'), false);
  assert.equal(proxyConfigured({ ...key }, 'build'), false);
  assert.equal(proxyConfigured({}, 'serve'), false);
  assert.equal(proxyConfigured({ SPEECH_API_KEY: 'test-key-not-real' }, 'serve'), true);
});

test('1.6 server: rejects non-POST, bad JSON and unknown paths', async () => {
  resetProxyState();
  const get = await handleProxyRequest({ method: 'GET', path: '/api/ark/generate', remoteAddress: LOOPBACK, body: '' });
  assert.equal(get.status, 405);

  const bad = await handleProxyRequest({ method: 'POST', path: '/api/ark/generate', remoteAddress: LOOPBACK, body: '{oops' });
  assert.equal(bad.status, 400);

  const missing = await handleProxyRequest({ method: 'POST', path: '/api/nope', remoteAddress: LOOPBACK, body: '{}' });
  assert.equal(missing.status, 404);
});

test('1.6 server: image generation reuses the ark provider and never echoes the key', async () => {
  resetProxyState();
  const secret = 'test-key-not-real';
  setArkTransport(async () => ({
    status: 200,
    body: { data: [{ b64_json: Buffer.from(PNG_BYTES).toString('base64'), size: '1024x1024' }], usage: { output_tokens: 77 } },
  }));
  try {
    const reply = await withEnv({ ARK_ENABLED: '1', ARK_API_KEY: secret, ARK_IMAGE_ENDPOINT: 'ep-test-image', ARK_PROXY_AVAILABLE: undefined }, () =>
      handleProxyRequest({
        method: 'POST',
        path: '/api/ark/generate',
        remoteAddress: LOOPBACK,
        body: JSON.stringify({ model: ARK_IMAGE_MODELS[0].id, size: DEFAULT_ARK_SETTINGS.size, prompt: 'a blue bottle' }),
      }));
    const text = JSON.stringify(reply.body);
    assert.equal(reply.status, 200, text);
    assert.match(text, /"ok":true/u);
    assert.match(text, /"mode":"real"/u);
    assert.match(text, /"outputTokens":77/u);
    assert.equal(Buffer.from(PNG_BYTES).toString('base64'), (reply.body as { bytes: string }).bytes);
    assert.equal(text.includes(secret), false);
  } finally {
    resetArkTransport();
  }
});

test('1.6 server: one real request at a time (429 while busy)', async () => {
  resetProxyState();
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  setArkTransport(async () => {
    await gate;
    return { status: 200, body: { data: [{ b64_json: Buffer.from(PNG_BYTES).toString('base64') }], usage: {} } };
  });
  try {
    await withEnv({ ARK_ENABLED: '1', ARK_API_KEY: 'test-key-not-real', ARK_IMAGE_ENDPOINT: 'ep-test-image' }, async () => {
      const body = JSON.stringify({ model: ARK_IMAGE_MODELS[0].id, size: DEFAULT_ARK_SETTINGS.size, prompt: 'first' });
      const first = handleProxyRequest({ method: 'POST', path: '/api/ark/generate', remoteAddress: LOOPBACK, body });
      const second = await handleProxyRequest({ method: 'POST', path: '/api/ark/generate', remoteAddress: LOOPBACK, body });
      assert.equal(second.status, 429);
      release();
      assert.equal((await first).status, 200);
      const third = await handleProxyRequest({ method: 'POST', path: '/api/ark/generate', remoteAddress: LOOPBACK, body });
      assert.equal(third.status, 200, 'the slot is released after the first request finishes');
    });
  } finally {
    resetArkTransport();
  }
});

test('1.6 server: video submits a task, then polling returns the bytes', async () => {
  resetProxyState();
  let polls = 0;
  setVideoTransport(async (request) => {
    if (request.kind === 'submit') return { status: 200, body: { id: 'task-1' } };
    if (request.kind === 'poll') {
      polls += 1;
      return { status: 200, body: { status: 'succeeded', content: { video_url: 'https://example.test/v.mp4' } } };
    }
    return { status: 200, bytes: new Uint8Array([1, 2, 3, 4]) };
  });
  try {
    await withEnv({ ARK_VIDEO_ENABLED: '1', ARK_VIDEO_ENDPOINT: 'ep-test-video', ARK_API_KEY: 'test-key-not-real' }, async () => {
      const submit = await handleProxyRequest({
        method: 'POST', path: '/api/ark/video/tasks', remoteAddress: LOOPBACK, body: JSON.stringify({ prompt: 'a wave' }),
      });
      assert.equal(submit.status, 200);
      const taskId = (submit.body as { taskId: string }).taskId;
      const poll = await handleProxyRequest({
        method: 'POST', path: `/api/ark/video/tasks/${taskId}`, remoteAddress: LOOPBACK, body: '{}',
      });
      assert.equal(poll.status, 200);
      assert.match(JSON.stringify(poll.body), /"state":"succeeded"/u);
      assert.equal((poll.body as { bytes: string }).bytes, Buffer.from([1, 2, 3, 4]).toString('base64'));
      assert.equal(polls, 1);
      const gone = await handleProxyRequest({
        method: 'POST', path: `/api/ark/video/tasks/${taskId}`, remoteAddress: LOOPBACK, body: '{}',
      });
      assert.equal(gone.status, 404, 'a finished task is dropped from memory');
    });
  } finally {
    resetVideoTransport();
  }
});

test('1.6 server: chat and speech endpoints reuse the provider modules', async () => {
  resetProxyState();
  setTextTransport(async () => new Response(JSON.stringify({
    model: 'deepseek-test',
    choices: [{ message: { content: 'ok' } }],
    usage: { prompt_tokens: 5, completion_tokens: 7 },
  }), { status: 200 }));
  setSpeechTransport(async () => ({
    status: 200,
    body: { audio: Buffer.from([9, 9]).toString('base64'), duration: 8.8, original_duration: 10.18 },
  }));
  try {
    await withEnv({ ARK_TEXT_ENABLED: '1', ARK_TEXT_ENDPOINT: 'ep-test-text', SPEECH_ENABLED: '1', ARK_API_KEY: 'k', SPEECH_API_KEY: 'k' }, async () => {
      const chat = await handleProxyRequest({
        method: 'POST', path: '/api/ark/chat', remoteAddress: LOOPBACK,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      });
      assert.equal(chat.status, 200);
      assert.equal((chat.body as { content: string }).content, 'ok');
      assert.deepEqual((chat.body as { usage: unknown }).usage, { promptTokens: 5, completionTokens: 7 });

      const speech = await handleProxyRequest({
        method: 'POST', path: '/api/speech/tts', remoteAddress: LOOPBACK, body: JSON.stringify({ text: '读这一句' }),
      });
      assert.equal(speech.status, 200);
      assert.equal((speech.body as { durationSeconds: number }).durationSeconds, 8.8);
      assert.equal((speech.body as { originalDurationSeconds: number }).originalDurationSeconds, 10.18);
    });
  } finally {
    resetTextTransport();
    resetSpeechTransport();
  }
});

test('1.6-fix server: a placeholder text model is resolved to the server endpoint', async () => {
  resetProxyState();
  const sent: string[] = [];
  setTextTransport(async (_url, init) => {
    sent.push(String((JSON.parse(String(init.body)) as { model?: string }).model));
    return new Response(JSON.stringify({
      model: 'deepseek-test',
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    }), { status: 200 });
  });
  try {
    await withEnv({ ARK_TEXT_ENABLED: '1', ARK_TEXT_ENDPOINT: 'ep-test-text', ARK_API_KEY: 'k' }, async () => {
      // The browser only has the shape id (1.6 §3), so this is what it sends.
      const chat = await handleProxyRequest({
        method: 'POST', path: '/api/ark/chat', remoteAddress: LOOPBACK,
        body: JSON.stringify({ model: 'ark-text-endpoint', messages: [{ role: 'user', content: 'hi' }] }),
      });
      assert.equal(chat.status, 200);
    });
    // Upstream never saw the placeholder: the dev server substituted its endpoint.
    assert.deepEqual(sent, ['ep-test-text']);
  } finally {
    resetTextTransport();
  }
});

test('1.6-fix server: an unknown model id is never sent upstream as the model', async () => {
  resetProxyState();
  const sent: string[] = [];
  const transport = async (_url: string, init: RequestInit) => {
    sent.push(String((JSON.parse(String(init.body)) as { model?: string }).model));
    return new Response(JSON.stringify({
      model: 'deepseek-test',
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), { status: 200 });
  };
  setTextTransport(transport);
  try {
    // A client-invented id (or an injection attempt) is ignored, not forwarded.
    await withEnv({ ARK_TEXT_ENABLED: '1', ARK_TEXT_ENDPOINT: 'ep-test-text', ARK_API_KEY: 'k' }, async () => {
      const chat = await handleProxyRequest({
        method: 'POST', path: '/api/ark/chat', remoteAddress: LOOPBACK,
        body: JSON.stringify({ model: 'ep-forged-by-client', messages: [{ role: 'user', content: 'hi' }] }),
      });
      assert.equal(chat.status, 200);
    });
    assert.deepEqual(sent, ['ep-test-text']);

    // With no server endpoint there is nothing safe to send: refuse instead of
    // forwarding the client string (or the placeholder) upstream.
    sent.length = 0;
    await withEnv({ ARK_TEXT_ENABLED: '1', ARK_TEXT_ENDPOINT: undefined, ARK_API_KEY: 'k' }, async () => {
      const chat = await handleProxyRequest({
        method: 'POST', path: '/api/ark/chat', remoteAddress: LOOPBACK,
        body: JSON.stringify({ model: 'ark-text-endpoint', messages: [{ role: 'user', content: 'hi' }] }),
      });
      assert.equal(chat.status, 503);
      assert.match(String((chat.body as { error: string }).error), /ARK_TEXT_ENDPOINT/u);
    });
    assert.deepEqual(sent, []);
  } finally {
    resetTextTransport();
  }
});

test('1.6 store rule: provider media bypasses the image whitelist but keeps a ceiling', async () => {
  const { validateGeneratedBlob, validateAsset, MAX_GENERATED_BYTES } = await import('../../src/domain/assets.ts');
  // 6.5-fix: MP4 is now an accepted local upload, so pick something the
  // whitelist still rejects; generated media only has to be non-empty and under
  // the local ceiling.
  assert.doesNotThrow(() => validateAsset({ name: 'clip.mp4', type: 'video/mp4', size: 1024 }));
  assert.throws(() => validateAsset({ name: 'clip.mov', type: 'video/quicktime', size: 1024 }), /只能添加 PNG/u);
  assert.doesNotThrow(() => validateGeneratedBlob(1024));
  assert.doesNotThrow(() => validateGeneratedBlob(MAX_GENERATED_BYTES));
  assert.throws(() => validateGeneratedBlob(0), /empty/u);
  assert.throws(() => validateGeneratedBlob(MAX_GENERATED_BYTES + 1), /local ceiling is 50 MB/u);
});

test('1.6 client: the browser carries no endpoint id, the proxy resolves it', async () => {
  const { videoEndpoint } = await import('../../src/providers/video-provider.ts');
  const { textEndpoint } = await import('../../src/providers/text-provider.ts');
  await withEnv({ ARK_PROXY_AVAILABLE: undefined, ARK_VIDEO_ENDPOINT: undefined, ARK_TEXT_ENDPOINT: undefined }, () => {
    assert.throws(() => videoEndpoint(), /ARK_VIDEO_ENDPOINT is not set/u);
    assert.throws(() => textEndpoint(), /文本接入点未配置/u);
  });
  await withEnv({ ARK_PROXY_AVAILABLE: '1', ARK_VIDEO_ENDPOINT: undefined, ARK_TEXT_ENDPOINT: undefined }, () => {
    // Placeholders only: the browser must not learn the real ids.
    assert.equal(videoEndpoint(), 'ark-video-endpoint');
    assert.equal(textEndpoint(), 'ark-text-endpoint');
  });
});

test('1.6 client: transports are installed only when the proxy flag is inlined', async () => {
  resetProxyTransports();
  await withEnv({ ARK_PROXY_AVAILABLE: undefined }, () => {
    assert.equal(proxyAvailable(), false);
    installProxyTransports();
    assert.equal(proxyAvailable(), false, 'still off: nothing was installed');
  });

  // With the flag on, the ark transport must POST to /api/ark/generate and map
  // the proxy reply back onto the native shape the provider parses.
  const calls: string[] = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push(String(url));
    assert.match(String(init.body), /"prompt":"a bottle"/u);
    return new Response(JSON.stringify({
      ok: true, mode: 'real', bytes: Buffer.from(PNG_BYTES).toString('base64'), mime: 'image/png', size: '1024x1024',
      model: 'doubao-test', outputTokens: 12,
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const { startArkRun, tickArkRun } = await import('../../src/providers/ark-provider.ts');
    const run = await withEnv({ ARK_PROXY_AVAILABLE: '1' }, async () => {
      assert.equal(proxyAvailable(), true);
      installProxyTransports();
      let held = startArkRun({ prompt: 'a bottle', settings: { model: ARK_IMAGE_MODELS[0].id, size: DEFAULT_ARK_SETTINGS.size, variants: 1 } });
      held = await tickArkRun(held);
      return tickArkRun(held);
    });
    assert.deepEqual([...calls], ['/api/ark/generate']);
    assert.equal(run.state, 'succeeded');
    assert.equal(run.result?.outputTokens, 12);
    assert.deepEqual([...(run.result?.bytes ?? [])], [...PNG_BYTES]);
  } finally {
    globalThis.fetch = savedFetch;
    resetProxyTransports();
    resetArkTransport();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, addNode, applyTextResult, isMediaNode } from '../../src/domain/project.ts';
import { spendAmount, walletOf } from '../../src/domain/pricing.ts';
import { TEXT_CREDITS_PER_CALL } from '../../src/domain/money.ts';
import {
  ARK_TEXT_MODELS, cancelTextRun, rawTextFetch, resetTextTransport, setTextTransport,
  startTextRun, textAvailable, textEnabled, tickTextRun, type TextTransport,
} from '../../src/providers/text-provider.ts';

type Call = { url: string; init: RequestInit };

function fakeTransport(reply: (call: Call, index: number) => Response): Call[] {
  const calls: Call[] = [];
  const transport: TextTransport = async (url, init) => {
    calls.push({ url, init });
    return reply({ url, init }, calls.length - 1);
  };
  setTextTransport(transport);
  return calls;
}

const ok = (content: string, promptTokens = 11, completionTokens = 22): Response => new Response(JSON.stringify({
  model: 'deepseek-v4-1-flash-economy-261017',
  choices: [{ index: 0, message: { role: 'assistant', content } }],
  usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
}), { status: 200, headers: { 'content-type': 'application/json' } });

test('text generation is gated: off by default, on only with the env flag and endpoint', () => {
  const before = { flag: process.env.ARK_TEXT_ENABLED, endpoint: process.env.ARK_TEXT_ENDPOINT };
  delete process.env.ARK_TEXT_ENABLED;
  delete process.env.ARK_TEXT_ENDPOINT;
  assert.equal(textEnabled(), false);
  process.env.ARK_TEXT_ENABLED = '1';
  assert.equal(textEnabled(), false, 'a flag without an endpoint stays off');
  process.env.ARK_TEXT_ENDPOINT = 'ep-test-not-real';
  assert.equal(textEnabled(), true);
  if (before.flag === undefined) delete process.env.ARK_TEXT_ENABLED; else process.env.ARK_TEXT_ENABLED = before.flag;
  if (before.endpoint === undefined) delete process.env.ARK_TEXT_ENDPOINT; else process.env.ARK_TEXT_ENDPOINT = before.endpoint;
  assert.equal(ARK_TEXT_MODELS.length, 1);
  assert.equal(ARK_TEXT_MODELS[0].sizes.length > 0, true);
  assert.equal(TEXT_CREDITS_PER_CALL, 1);
  assert.equal(rawTextFetch.length > 0, true);
  // The client only ever learns a boolean; the endpoint id never reaches the bundle.
  assert.equal(typeof textAvailable(), 'boolean');
});

test('a text run submits once, returns the message content and records token usage', async () => {
  const before = { flag: process.env.ARK_TEXT_ENABLED, endpoint: process.env.ARK_TEXT_ENDPOINT, key: process.env.ARK_API_KEY };
  process.env.ARK_TEXT_ENABLED = '1';
  process.env.ARK_TEXT_ENDPOINT = 'ep-test-not-real';
  process.env.ARK_API_KEY = 'test-key-not-real';
  const calls = fakeTransport(() => ok('A short product sentence.'));
  try {
    let run = startTextRun({ prompt: '写一句产品介绍', nodeId: 'text-1' });
    assert.equal(run.state, 'queued');
    run = await tickTextRun(run);
    assert.equal(run.state, 'running');
    assert.equal(calls.length, 0, 'the queued tick never touches the network');
    run = await tickTextRun(run);
    assert.equal(run.state, 'succeeded');
    assert.equal(run.result?.text, 'A short product sentence.');
    assert.equal(run.result?.promptTokens, 11);
    assert.equal(run.result?.completionTokens, 22);
    assert.equal(run.result?.mode, 'real');
    assert.equal(run.result?.model, 'deepseek-v4-1-flash-economy-261017');
    assert.equal(calls.length, 1);
    const body = JSON.parse(String(calls[0].init.body)) as { model: string; messages: { role: string; content: string }[] };
    assert.equal(body.model, 'ep-test-not-real');
    assert.deepEqual(body.messages, [{ role: 'user', content: '写一句产品介绍' }]);
    assert.match(String((calls[0].init.headers as Record<string, string>).authorization), /^Bearer test-key-not-real$/u);
  } finally {
    resetTextTransport();
    if (before.flag === undefined) delete process.env.ARK_TEXT_ENABLED; else process.env.ARK_TEXT_ENABLED = before.flag;
    if (before.endpoint === undefined) delete process.env.ARK_TEXT_ENDPOINT; else process.env.ARK_TEXT_ENDPOINT = before.endpoint;
    if (before.key === undefined) delete process.env.ARK_API_KEY; else process.env.ARK_API_KEY = before.key;
  }
});

test('a failed text call is a terminal state: no retry, the error surfaces verbatim', async () => {
  const before = { flag: process.env.ARK_TEXT_ENABLED, endpoint: process.env.ARK_TEXT_ENDPOINT, key: process.env.ARK_API_KEY };
  process.env.ARK_TEXT_ENABLED = '1';
  process.env.ARK_TEXT_ENDPOINT = 'ep-test-not-real';
  process.env.ARK_API_KEY = 'test-key-not-real';
  const calls = fakeTransport(() => new Response(JSON.stringify({ error: { message: 'rate limited', code: 'RateLimit' } }), { status: 429 }));
  try {
    let run = await tickTextRun(startTextRun({ prompt: 'hi', nodeId: 'text-2' }));
    run = await tickTextRun(run);
    assert.equal(run.state, 'failed');
    assert.match(String(run.error), /rate limited/u);
    assert.equal(calls.length, 1);
    run = await tickTextRun(run);
    assert.equal(run.state, 'failed', 'a failed run stays failed');
    assert.equal(calls.length, 1, 'no automatic retry');
  } finally {
    resetTextTransport();
    if (before.flag === undefined) delete process.env.ARK_TEXT_ENABLED; else process.env.ARK_TEXT_ENABLED = before.flag;
    if (before.endpoint === undefined) delete process.env.ARK_TEXT_ENDPOINT; else process.env.ARK_TEXT_ENDPOINT = before.endpoint;
    if (before.key === undefined) delete process.env.ARK_API_KEY; else process.env.ARK_API_KEY = before.key;
  }
});

test('an empty answer is a failure, not an empty node write', async () => {
  const before = { flag: process.env.ARK_TEXT_ENABLED, endpoint: process.env.ARK_TEXT_ENDPOINT, key: process.env.ARK_API_KEY };
  process.env.ARK_TEXT_ENABLED = '1';
  process.env.ARK_TEXT_ENDPOINT = 'ep-test-not-real';
  process.env.ARK_API_KEY = 'test-key-not-real';
  fakeTransport(() => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
  try {
    let run = await tickTextRun(startTextRun({ prompt: 'hi', nodeId: 'text-3' }));
    run = await tickTextRun(run);
    assert.equal(run.state, 'failed');
    assert.match(String(run.error), /no message content/u);
  } finally {
    resetTextTransport();
    if (before.flag === undefined) delete process.env.ARK_TEXT_ENABLED; else process.env.ARK_TEXT_ENABLED = before.flag;
    if (before.endpoint === undefined) delete process.env.ARK_TEXT_ENDPOINT; else process.env.ARK_TEXT_ENDPOINT = before.endpoint;
    if (before.key === undefined) delete process.env.ARK_API_KEY; else process.env.ARK_API_KEY = before.key;
  }
});

test('a canceled text run stops before the request and never retries', async () => {
  const before = { flag: process.env.ARK_TEXT_ENABLED, endpoint: process.env.ARK_TEXT_ENDPOINT, key: process.env.ARK_API_KEY };
  process.env.ARK_TEXT_ENABLED = '1';
  process.env.ARK_TEXT_ENDPOINT = 'ep-test-not-real';
  process.env.ARK_API_KEY = 'test-key-not-real';
  const calls = fakeTransport(() => ok('never used'));
  try {
    let run = await tickTextRun(startTextRun({ prompt: 'hi', nodeId: 'text-4' }));
    run = cancelTextRun(run);
    assert.equal(run.state, 'canceled');
    run = await tickTextRun(run);
    assert.equal(run.state, 'canceled');
    assert.equal(calls.length, 0);
  } finally {
    resetTextTransport();
    if (before.flag === undefined) delete process.env.ARK_TEXT_ENABLED; else process.env.ARK_TEXT_ENABLED = before.flag;
    if (before.endpoint === undefined) delete process.env.ARK_TEXT_ENDPOINT; else process.env.ARK_TEXT_ENDPOINT = before.endpoint;
    if (before.key === undefined) delete process.env.ARK_API_KEY; else process.env.ARK_API_KEY = before.key;
  }
});

test('a real text result lands in the node content, keeps the prompt, and costs one Tapie', () => {
  const base = addNode(createProject(), 'text');
  const textId = base.nodes[base.nodes.length - 1].id;
  const withPrompt = { ...base, nodes: base.nodes.map(node => node.id === textId ? { ...node, text: '写一句产品介绍' } : node) };
  const next = applyTextResult(withPrompt, textId, 'A short product sentence.', { model: 'deepseek-v4-1-flash-economy-261017', promptTokens: 11, completionTokens: 22 });
  const beforeRevision = withPrompt.nodes.find(entry => entry.id === textId)!.revision;
  const node = next.nodes.find(entry => entry.id === textId)!;
  assert.equal(node.kind, 'text');
  assert.equal(isMediaNode(node), false);
  assert.equal((node as { text: string }).text, 'A short product sentence.');
  const meta = (node as { textMeta?: { mode: string; prompt: string; promptTokens: number; completionTokens: number } }).textMeta;
  assert.equal(meta?.mode, 'real');
  assert.equal(meta?.prompt, '写一句产品介绍');
  assert.equal(meta?.promptTokens, 11);
  assert.equal(meta?.completionTokens, 22);
  assert.equal(node.revision, beforeRevision + 1, 'applying a result bumps the revision');
  const paid = spendAmount(next, TEXT_CREDITS_PER_CALL);
  assert.equal(walletOf(paid), walletOf(next) - 1);
});

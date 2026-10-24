import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ARK_VIDEO_MODELS, DEFAULT_VIDEO_SETTINGS, VIDEO_POLL_INTERVAL_MS, VIDEO_TOTAL_TIMEOUT_MS, VIDEO_CREDITS_PER_SECOND,
  cancelVideoRun, resetVideoTransport, setVideoTransport, startVideoRun, tickVideoRun, videoCost, videoEnabled, videoModels,
  type VideoTransportRequest,
} from '../../src/providers/video-provider.ts';

const ENDPOINT = 'ep-test-video-endpoint';
const KEY = 'test-ark-key-not-real';
const MP4 = Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

function enable(extra: Record<string, string> = {}) {
  process.env.ARK_VIDEO_ENABLED = '1';
  process.env.ARK_VIDEO_ENDPOINT = ENDPOINT;
  process.env.ARK_API_KEY = KEY;
  for (const [key, value] of Object.entries(extra)) process.env[key] = value;
}

const fakeTransport = (script: { kind: VideoTransportRequest['kind']; response: Parameters<typeof setVideoTransport>[0] extends (request: VideoTransportRequest) => Promise<infer R> ? R : never }[]) => {
  const calls: VideoTransportRequest[] = [];
  const queue = [...script];
  setVideoTransport(async (request) => {
    calls.push(request);
    const next = queue.shift();
    if (!next) throw new Error(`unexpected ${request.kind} call`);
    assert.equal(request.kind, next.kind);
    return next.response;
  });
  return calls;
};

test('1.3 gate: no endpoint means no real video model and no run', () => {
  process.env.ARK_VIDEO_ENABLED = '1';
  delete process.env.ARK_VIDEO_ENDPOINT;
  assert.equal(videoEnabled(), false);
  assert.deepEqual(videoModels(), []);
  assert.throws(() => startVideoRun({ prompt: 'a wave', settings: DEFAULT_VIDEO_SETTINGS }), /configured endpoint/);

  process.env.ARK_VIDEO_ENABLED = '0';
  process.env.ARK_VIDEO_ENDPOINT = ENDPOINT;
  assert.equal(videoEnabled(), false);
  assert.deepEqual(videoModels(), []);
});

test('1.3 success: submit → poll twice while running → succeeded → download bytes', async () => {
  enable();
  const calls = fakeTransport([
    { kind: 'submit', response: { status: 200, body: { id: 'task-1' } } },
    { kind: 'poll', response: { status: 200, body: { status: 'running' } } },
    { kind: 'poll', response: { status: 200, body: { status: 'queued' } } },
    { kind: 'poll', response: { status: 200, body: { status: 'succeeded', content: { video_url: 'https://ark.example/video.mp4' } } } },
    { kind: 'download', response: { status: 200, bytes: MP4 } },
  ]);
  let run = startVideoRun({ prompt: 'a slow wave', settings: DEFAULT_VIDEO_SETTINGS, now: 0 });
  run = await tickVideoRun(run, 0); // queued → running, no HTTP yet
  assert.equal(run.state, 'running');
  assert.equal(calls.length, 0);
  run = await tickVideoRun(run, 10); // submit
  assert.equal(run.taskId, 'task-1');
  run = await tickVideoRun(run, 10 + VIDEO_POLL_INTERVAL_MS);
  assert.equal(run.polls, 1);
  run = await tickVideoRun(run, 10 + VIDEO_POLL_INTERVAL_MS * 2);
  assert.equal(run.state, 'running');
  run = await tickVideoRun(run, 10 + VIDEO_POLL_INTERVAL_MS * 3);
  assert.equal(run.state, 'succeeded');
  assert.equal(run.result?.mode, 'real');
  assert.equal(run.result?.mime, 'video/mp4');
  assert.equal(run.result?.duration, 4);
  assert.equal(run.result?.resolution, '480p');
  assert.equal(run.result?.bytes.length, MP4.length);
  assert.equal(run.result?.url, 'https://ark.example/video.mp4');
  assert.equal(calls.map(call => call.kind).join(','), 'submit,poll,poll,poll,download');
  resetVideoTransport();
});

test('1.3 request shape: endpoint model, prompt flags, Bearer key', async () => {
  enable();
  const calls = fakeTransport([{ kind: 'submit', response: { status: 200, body: { id: 'task-9' } } }]);
  let run = startVideoRun({ prompt: 'a paper boat', settings: DEFAULT_VIDEO_SETTINGS, now: 0 });
  run = await tickVideoRun(run, 0);
  await tickVideoRun(run, 5);
  const submit = calls[0];
  assert.equal(submit.url, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
  assert.equal(submit.headers.Authorization, `Bearer ${KEY}`);
  const body = JSON.parse(String(submit.body)) as { model: string; content: { type: string; text: string }[] };
  assert.equal(body.model, ENDPOINT);
  assert.equal(body.content[0].type, 'text');
  assert.equal(body.content[0].text, 'a paper boat --resolution 480p --duration 4 --ratio 16:9');
  resetVideoTransport();
});

test('1.3 poll throttle: a poll inside the interval is a no-op', async () => {
  enable();
  const calls = fakeTransport([
    { kind: 'submit', response: { status: 200, body: { id: 'task-2' } } },
    { kind: 'poll', response: { status: 200, body: { status: 'running' } } },
  ]);
  let run = startVideoRun({ prompt: 'x', settings: DEFAULT_VIDEO_SETTINGS, now: 0 });
  run = await tickVideoRun(run, 0);
  run = await tickVideoRun(run, 10);
  run = await tickVideoRun(run, 10 + VIDEO_POLL_INTERVAL_MS);
  assert.equal(run.polls, 1);
  run = await tickVideoRun(run, 10 + VIDEO_POLL_INTERVAL_MS + 100); // too early
  assert.equal(run.polls, 1);
  assert.equal(calls.length, 2);
  resetVideoTransport();
});

test('1.3 failed task is terminal and never polled again', async () => {
  enable();
  const calls = fakeTransport([
    { kind: 'submit', response: { status: 200, body: { id: 'task-3' } } },
    { kind: 'poll', response: { status: 200, body: { status: 'failed', error: { message: 'content rejected' } } } },
  ]);
  let run = startVideoRun({ prompt: 'x', settings: DEFAULT_VIDEO_SETTINGS, now: 0 });
  run = await tickVideoRun(run, 0);
  run = await tickVideoRun(run, 10);
  run = await tickVideoRun(run, 10 + VIDEO_POLL_INTERVAL_MS);
  assert.equal(run.state, 'failed');
  assert.match(String(run.error), /content rejected/);
  const again = await tickVideoRun(run, 10 + VIDEO_POLL_INTERVAL_MS * 5);
  assert.equal(again.state, 'failed');
  assert.equal(calls.length, 2);
  resetVideoTransport();
});

test('1.3 submit failure is terminal with the Ark message', async () => {
  enable();
  fakeTransport([{ kind: 'submit', response: { status: 400, body: { error: { message: 'invalid model' } } } }]);
  let run = startVideoRun({ prompt: 'x', settings: DEFAULT_VIDEO_SETTINGS, now: 0 });
  run = await tickVideoRun(run, 0);
  run = await tickVideoRun(run, 5);
  assert.equal(run.state, 'failed');
  assert.match(String(run.error), /invalid model/);
  resetVideoTransport();
});

test('1.3 timeout: a task that outlives 10 minutes fails once and stops polling', async () => {
  enable();
  const calls = fakeTransport([
    { kind: 'submit', response: { status: 200, body: { id: 'task-4' } } },
    { kind: 'poll', response: { status: 200, body: { status: 'running' } } },
  ]);
  let run = startVideoRun({ prompt: 'x', settings: DEFAULT_VIDEO_SETTINGS, now: 0 });
  run = await tickVideoRun(run, 0);
  run = await tickVideoRun(run, 10);
  run = await tickVideoRun(run, 10 + VIDEO_POLL_INTERVAL_MS);
  run = await tickVideoRun(run, VIDEO_TOTAL_TIMEOUT_MS + 1);
  assert.equal(run.state, 'failed');
  assert.match(String(run.error), /timed out after 10 minutes/);
  assert.equal(calls.length, 2);
  resetVideoTransport();
});

test('1.3 cancel: local only, no request, no result', async () => {
  enable();
  const calls = fakeTransport([]);
  let run = startVideoRun({ prompt: 'x', settings: DEFAULT_VIDEO_SETTINGS, now: 0 });
  run = await tickVideoRun(run, 0);
  run = cancelVideoRun(run);
  assert.equal(run.state, 'canceled');
  const after = await tickVideoRun(run, 10);
  assert.equal(after.state, 'canceled');
  assert.equal(calls.length, 0);
  resetVideoTransport();
});

test('1.3 cost: 6 credits per second, matching the simulated table', () => {
  assert.equal(VIDEO_CREDITS_PER_SECOND, 6);
  assert.equal(videoCost(4), 24);
  assert.equal(videoCost(5), 30);
  assert.equal(videoCost(0), 0);
  assert.deepEqual(ARK_VIDEO_MODELS[0].sizes, ['480p · 4s', '480p · 5s']);
});

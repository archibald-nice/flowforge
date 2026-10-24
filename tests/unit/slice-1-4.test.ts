import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cancelSpeechRun, resetSpeechTransport, setSpeechTransport, speechEnabled, speechPrice,
  startSpeechRun, tickSpeechRun, DEFAULT_SPEECH_SETTINGS, SPEECH_MODELS, SPEECH_BASE_URL,
} from '../../src/providers/speech-provider.ts';
import { addNode, createProject, isMediaNode, setDraftSettings, validateProject, DEFAULT_SETTINGS, type GenerationSettings } from '../../src/domain/project.ts';

/** Records every call and replays scripted HTTP responses. Never hits a network. */
function fakeTransport(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  setSpeechTransport(async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return next;
  });
  return calls;
}

const audioDraft = () => {
  let project = createProject();
  const node = addNode(project, 'audio');
  project = addNode(project, 'audio');
  const draft = project.nodes.filter(isMediaNode).at(-1)!;
  return { project, draft };
};

const withSpeechModel = (project: ReturnType<typeof createProject>, draftId: string) => setDraftSettings(project, draftId, {
  model: DEFAULT_SPEECH_SETTINGS.model as GenerationSettings['model'],
  size: DEFAULT_SPEECH_SETTINGS.size,
  variants: 1,
});

const B64 = Buffer.from('ID3-fake-audio-bytes').toString('base64');

test('1.4 success: base64 audio becomes a real mp3 result with billing duration', async () => {
  process.env.SPEECH_ENABLED = '1';
  process.env.SPEECH_API_KEY = 'test-speech-key';
  const calls = fakeTransport([{ status: 200, body: { code: 0, message: 'ok', audio: B64, duration: 10.02, original_duration: 10 } }]);
  let run = startSpeechRun({ prompt: '十秒钟的播客开场白', settings: DEFAULT_SPEECH_SETTINGS });
  run = await tickSpeechRun(run); // queued → running, no HTTP yet
  assert.equal(run.state, 'running');
  assert.equal(calls.length, 0);
  run = await tickSpeechRun(run);
  assert.equal(run.state, 'succeeded');
  assert.equal(run.result?.mime, 'audio/mpeg');
  assert.equal(run.result?.originalDuration, 10);
  assert.equal(run.result?.duration, 10.02);
  assert.equal(run.result?.bytes.length, 'ID3-fake-audio-bytes'.length);
  assert.equal(speechPrice(10), 16.67);
  resetSpeechTransport();
});

test('1.4 request shape: X-Api-Key header, seed-audio-1.0, mp3 48 kHz, no watermark', async () => {
  process.env.SPEECH_ENABLED = '1';
  process.env.SPEECH_API_KEY = 'test-speech-key';
  const calls = fakeTransport([{ status: 200, body: { code: 0, audio: B64, original_duration: 10 } }]);
  let run = startSpeechRun({ prompt: 'hello', settings: DEFAULT_SPEECH_SETTINGS });
  run = await tickSpeechRun(run);
  run = await tickSpeechRun(run);
  assert.equal(run.state, 'succeeded');
  const call = calls[0];
  assert.equal(call.url, SPEECH_BASE_URL);
  assert.equal(call.headers['X-Api-Key'], 'test-speech-key');
  const body = JSON.parse(call.body) as Record<string, unknown>;
  assert.equal(body.model, 'seed-audio-1.0');
  assert.equal(body.text_prompt, 'hello');
  assert.deepEqual(body.audio_config, { format: 'mp3', sample_rate: 48000, speech_rate: 0, loudness_rate: 0, pitch_rate: 0 });
  assert.equal('watermark' in body, false);
  assert.equal('references' in body, false);
  resetSpeechTransport();
});

test('1.4 failure: a non-zero code fails once and never retries', async () => {
  process.env.SPEECH_ENABLED = '1';
  process.env.SPEECH_API_KEY = 'test-speech-key';
  const calls = fakeTransport([{ status: 200, body: { code: 45000001, message: 'quota exceeded' } }]);
  let run = startSpeechRun({ prompt: 'hello', settings: DEFAULT_SPEECH_SETTINGS });
  run = await tickSpeechRun(run);
  run = await tickSpeechRun(run);
  assert.equal(run.state, 'failed');
  assert.match(String(run.error), /45000001|quota exceeded/);
  const afterFailure = await tickSpeechRun(run);
  assert.equal(afterFailure.state, 'failed');
  assert.equal(calls.length, 1, 'a failed run must not retry the HTTP call');
  resetSpeechTransport();
});

test('1.4 cancel: canceling before the call sends no request at all', async () => {
  process.env.SPEECH_ENABLED = '1';
  process.env.SPEECH_API_KEY = 'test-speech-key';
  const calls = fakeTransport([{ status: 200, body: { code: 0, audio: B64, original_duration: 10 } }]);
  const queued = startSpeechRun({ prompt: 'hello', settings: DEFAULT_SPEECH_SETTINGS });
  const canceled = cancelSpeechRun(queued);
  assert.equal(canceled.state, 'canceled');
  const afterCancel = await tickSpeechRun(canceled);
  assert.equal(afterCancel.state, 'canceled');
  assert.equal(calls.length, 0);
  resetSpeechTransport();
});

test('1.4 gating: the run refuses to start while SPEECH_ENABLED is off', () => {
  delete process.env.SPEECH_ENABLED;
  assert.equal(speechEnabled(), false);
  assert.throws(() => startSpeechRun({ prompt: 'hello', settings: DEFAULT_SPEECH_SETTINGS }), /SPEECH_ENABLED/);
});

test('1.4 domain: snapshots accept the speech model and price it by duration', () => {
  const { project, draft } = audioDraft();
  const next = withSpeechModel(project, draft.id);
  const node = next.nodes.find(entry => entry.id === draft.id) as { settings?: GenerationSettings };
  assert.equal(node.settings?.model, 'seed-audio-1.0');
  assert.equal(validateProject(structuredClone(next)).nodes.length, next.nodes.length);
  assert.equal(speechPrice(30), 50);
  assert.equal(speechPrice(120), 200);
  assert.equal(SPEECH_MODELS.length, 1);
  assert.equal(DEFAULT_SETTINGS.model, 'mock-still-a');
});

/**
 * Slice 1.6 — local generation proxy (development only).
 *
 * Why it exists: the browser must never hold a key, but the acceptance criteria
 * for this slice need a real click in a real browser. So a Vite dev middleware
 * forwards four JSON endpoints to the *existing* provider modules, which keep
 * their own validation, requests, parsing and cost accounting. Nothing here
 * talks to a model service directly.
 *
 * Hard rules (brief §3–§4):
 * 1. Registered only by the dev server; `ARK_PROXY_ENABLED=0` disables it.
 * 2. Loopback callers only — anything else gets 403.
 * 3. One request in flight; a second gets 429. No automatic retries.
 * 4. Keys are read from the environment inside this process and never appear in
 *    a response, a log line or the client bundle.
 */
import { ARK_IMAGE_MODELS, startArkRun, tickArkRun, type ArkRun } from '../providers/ark-provider.ts';
import { ARK_VIDEO_MODELS, startVideoRun, tickVideoRun, type VideoRun } from '../providers/video-provider.ts';
import { DEFAULT_SPEECH_SETTINGS, startSpeechRun, tickSpeechRun, type SpeechRun } from '../providers/speech-provider.ts';
import { completeChat } from '../providers/text-provider.ts';

export type ProxyRequest = Readonly<{
  method: string;
  path: string;
  remoteAddress?: string;
  body: string;
}>;

export type ProxyResponse = Readonly<{ status: number; body: unknown }>;

const fail = (status: number, error: string): ProxyResponse => ({ status, body: { ok: false, error } });

/** Only the local machine may drive real generation. */
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address === 'localhost';
}

/** The dev server registers the middleware only when this is true. */
export function proxyConfigured(env: Record<string, string | undefined> = process.env, command: 'serve' | 'build' = 'serve'): boolean {
  if (command !== 'serve') return false;
  if (env.ARK_PROXY_ENABLED === '0') return false;
  return Boolean(env.ARK_API_KEY || env.SPEECH_API_KEY);
}

let inFlight = 0;
/** Submitted video tasks live in memory; a restart loses them (brief §9.3). */
const videoTasks = new Map<string, VideoRun>();

/** Test seam: clears the in-flight counter and the task table. */
export function resetProxyState(): void {
  inFlight = 0;
  videoTasks.clear();
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? value as Record<string, unknown> : {});
const encode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

const parseBody = (body: string): Record<string, unknown> | null => {
  if (!body.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null ? asRecord(parsed) : null;
  } catch {
    return null;
  }
};

async function driveArk(run: ArkRun): Promise<ArkRun> {
  let current = run;
  current = await tickArkRun(current);
  current = await tickArkRun(current);
  return current;
}

/** Two ticks: queued → running, then the single real request. */
async function image(input: Record<string, unknown>): Promise<ProxyResponse> {
  const settings = { model: String(input.model ?? ARK_IMAGE_MODELS[0].id), size: String(input.size ?? ARK_IMAGE_MODELS[0].sizes[0]), variants: 1 as const };
  const prompt = String(input.prompt ?? '').trim();
  if (!prompt) return fail(400, 'Write a prompt first.');
  const run = await driveArk(startArkRun({ prompt, settings }));
  if (run.state !== 'succeeded' || !run.result) return fail(502, run.error ?? 'Generation failed.');
  return {
    status: 200,
    body: {
      ok: true,
      mode: 'real',
      bytes: encode(run.result.bytes),
      mime: run.result.mime,
      size: run.result.size,
      model: run.result.model,
      outputTokens: run.result.outputTokens,
    },
  };
}

async function videoSubmit(input: Record<string, unknown>): Promise<ProxyResponse> {
  const prompt = String(input.prompt ?? '').trim();
  if (!prompt) return fail(400, 'Write a prompt first.');
  let run = startVideoRun({ prompt, settings: { model: ARK_VIDEO_MODELS[0].id, size: ARK_VIDEO_MODELS[0].sizes[0], variants: 1 } });
  run = await tickVideoRun(run);
  run = await tickVideoRun(run);
  if (!run.taskId) return fail(502, run.error ?? 'The video task was not accepted.');
  // The client owns the 3 s cadence; mark the task due so its first poll lands
  // immediately instead of waiting out an interval nobody has elapsed yet.
  videoTasks.set(run.id, { ...run, lastPollAt: 0 });
  return { status: 200, body: { ok: true, taskId: run.id } };
}

async function videoPoll(taskId: string): Promise<ProxyResponse> {
  const held = videoTasks.get(taskId);
  if (!held) return fail(404, 'Unknown video task.');
  const next = await tickVideoRun(held);
  videoTasks.set(taskId, next);
  if (next.state === 'failed') return fail(502, next.error ?? 'The video task failed.');
  if (next.state === 'succeeded' && next.result) {
    videoTasks.delete(taskId);
    return {
      status: 200,
      body: {
        ok: true,
        state: 'succeeded',
        bytes: encode(next.result.bytes),
        mime: next.result.mime,
        durationSeconds: next.result.duration,
      },
    };
  }
  return { status: 200, body: { ok: true, state: next.state, polls: next.polls } };
}

/**
 * 1.6-fix — the browser only ever knows the placeholder id (`ark-text-endpoint`),
 * because the real endpoint stays in this process's environment. Any model
 * string that is not exactly the configured endpoint means "unspecified": the
 * server resolves it, and a client-supplied string is never forwarded upstream
 * as a model id (forwarding the placeholder produced a 404 from Ark in a real
 * browser click).
 */
export function resolveChatModel(
  requested: unknown,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const endpoint = (env.ARK_TEXT_ENDPOINT ?? '').trim();
  const value = typeof requested === 'string' ? requested.trim() : '';
  if (endpoint && value === endpoint) return endpoint;
  return null;
}

async function chat(input: Record<string, unknown>): Promise<ProxyResponse> {
  const messages = input.messages;
  if (!Array.isArray(messages) || messages.length === 0) return fail(400, 'Provide at least one message.');
  const clean = messages.slice(0, 8).map((entry) => {
    const item = asRecord(entry);
    const role = item.role === 'system' ? 'system' as const : 'user' as const;
    return { role, content: String(item.content ?? '').slice(0, 8000) };
  });
  const model = resolveChatModel(input.model);
  if (!model && !(process.env.ARK_TEXT_ENDPOINT ?? '').trim()) {
    return fail(503, '真实文本接入点未在服务端配置（ARK_TEXT_ENDPOINT）；本次不执行。');
  }
  const reply = await completeChat(clean, model ?? undefined);
  if (!reply.ok) return fail(502, reply.error);
  return {
    status: 200,
    body: {
      ok: true,
      content: reply.content,
      model: reply.model,
      usage: { promptTokens: reply.promptTokens, completionTokens: reply.completionTokens },
    },
  };
}

async function speech(input: Record<string, unknown>): Promise<ProxyResponse> {
  const text = String(input.text ?? '').trim();
  if (!text) return fail(400, 'Write something to speak first.');
  let run: SpeechRun = startSpeechRun({ prompt: text, settings: DEFAULT_SPEECH_SETTINGS });
  run = await tickSpeechRun(run);
  run = await tickSpeechRun(run);
  if (run.state !== 'succeeded' || !run.result) return fail(502, run.error ?? 'Speech failed.');
  return {
    status: 200,
    body: {
      ok: true,
      bytes: encode(run.result.bytes),
      mime: run.result.mime,
      durationSeconds: run.result.duration,
      originalDurationSeconds: run.result.originalDuration,
    },
  };
}

const VIDEO_TASK = /^\/api\/ark\/video\/tasks\/([^/]+)$/u;

/**
 * The whole proxy decision, with no Node req/res objects, so unit tests can
 * exercise every branch without a socket.
 */
export async function handleProxyRequest(request: ProxyRequest): Promise<ProxyResponse> {
  if (request.method !== 'POST') return fail(405, 'Only POST is allowed.');
  if (!isLoopback(request.remoteAddress)) return fail(403, 'The local proxy only serves this machine.');
  const body = parseBody(request.body);
  if (body === null) return fail(400, 'The request body must be JSON.');
  if (inFlight >= 1) return fail(429, 'One real request at a time; try again when the current one finishes.');
  inFlight += 1;
  try {
    if (request.path === '/api/ark/generate') return await image(body);
    if (request.path === '/api/ark/video/tasks') return await videoSubmit(body);
    const videoMatch = VIDEO_TASK.exec(request.path);
    if (videoMatch) return await videoPoll(decodeURIComponent(videoMatch[1]));
    if (request.path === '/api/ark/chat') return await chat(body);
    if (request.path === '/api/speech/tts') return await speech(body);
    return fail(404, 'Unknown endpoint.');
  } catch (error) {
    // Deliberately no logging: provider errors can echo upstream bodies.
    return fail(502, error instanceof Error ? error.message : 'The local proxy failed.');
  } finally {
    inFlight -= 1;
  }
}

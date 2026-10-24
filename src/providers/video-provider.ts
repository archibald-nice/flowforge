/**
 * Volcano Ark Seedance video provider for slice 1.3.
 *
 * Rules fixed by the user brief:
 * 1. The key lives in `.env.local` as ARK_API_KEY. It is never committed, logged
 *    or written into records.
 * 2. Mock stays the default: a real task runs only when ARK_VIDEO_ENABLED=1 and
 *    the endpoint is configured (ARK_VIDEO_ENDPOINT).
 * 3. Submit → poll → download. A failure is terminal: no automatic retry.
 * 4. The endpoint id is an account resource, not a secret, but it still stays out
 *    of the client bundle: the browser only receives a boolean availability flag.
 *
 * The HTTP layer is injected as `VideoTransport`, so tests never touch the network.
 */
import { yuanToCredits } from '../domain/money.ts';

export const ARK_VIDEO_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

/** Submit requests are short; polling is separate and long-lived. */
export const VIDEO_SUBMIT_TIMEOUT_MS = 30_000;
/** Poll every 3 s, give up after 10 minutes of wall clock. */
export const VIDEO_POLL_INTERVAL_MS = 3_000;
export const VIDEO_TOTAL_TIMEOUT_MS = 600_000;

/**
 * Designed local price: 6 credits per second of video, matching the simulated
 * table (a 5 s video costs 30). The Ark invoice is per-second and resolution
 * dependent; it stays authoritative.
 */
export const VIDEO_CREDITS_PER_SECOND = 6;

export type VideoModel = Readonly<{
  id: string;
  label: string;
  /** "resolution · seconds" pairs offered in the existing generation form. */
  sizes: readonly string[];
}>;

export const ARK_VIDEO_MODELS: readonly VideoModel[] = Object.freeze([
  // The select value is a local placeholder; the real endpoint id is read from
  // the environment at call time and never lands in the bundle.
  Object.freeze({ id: 'ark-video-endpoint', label: 'Seedance 1.0 Pro Fast（方舟接入点）', sizes: ['480p · 4s', '480p · 5s'] }),
]);

/** True only when the server side actually has an endpoint configured. */
export function videoEnabled(): boolean {
  return process.env.ARK_VIDEO_ENABLED === '1' && Boolean(process.env.ARK_VIDEO_ENDPOINT);
}

/** Slice 1.6: the browser reaches real video through the local dev proxy. */
export function videoReachable(): boolean {
  // Client bundle: only the inlined availability boolean exists there.
  return videoEnabled() || videoAvailable() || process.env.ARK_PROXY_AVAILABLE === '1';
}

/** Mirrors `videoEnabled` for the client bundle; inlined as a boolean by Vite. */
export function videoAvailable(): boolean {
  return process.env.ARK_VIDEO_AVAILABLE === '1';
}

/** Real models only exist when both the flag and the endpoint are present. */
export function videoModels(): readonly VideoModel[] {
  return videoReachable() ? ARK_VIDEO_MODELS : [];
}

export function videoEndpoint(): string {
  const endpoint = process.env.ARK_VIDEO_ENDPOINT;
  if (endpoint) return endpoint;
  // Slice 1.6: the browser never learns the endpoint id. The proxy resolves it
  // server-side, so the placeholder id in the body is enough to carry the shape.
  if (process.env.ARK_PROXY_AVAILABLE === '1') return ARK_VIDEO_MODELS[0].id;
  throw new Error('ARK_VIDEO_ENDPOINT is not set; real video stays unavailable.');
}

export function videoCost(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return yuanToCredits((seconds * VIDEO_CREDITS_PER_SECOND) / 100);
}

export type VideoTransportRequest = Readonly<{
  kind: 'submit' | 'poll' | 'download';
  url: string;
  headers: Record<string, string>;
  body?: string;
}>;

export type VideoTransportResponse = Readonly<{ status: number; body?: unknown; bytes?: Uint8Array }>;
export type VideoTransport = (request: VideoTransportRequest) => Promise<VideoTransportResponse>;

let transport: VideoTransport | null = null;

/** Test seam: replace the HTTP layer with a fake transport. */
export function setVideoTransport(fake: VideoTransport): void { transport = fake; }
export function resetVideoTransport(): void { transport = null; }

export type VideoResult = Readonly<{
  mode: 'real';
  bytes: Uint8Array;
  mime: 'video/mp4';
  /** Requested clip length in seconds (Ark echoes it in the task content). */
  duration: number;
  resolution: string;
  model: string;
  /** Temporary Ark url the bytes came from; recorded for the acceptance log. */
  url: string;
}>;

export type VideoRun = Readonly<{
  id: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  request: Readonly<{ prompt: string; settings: { model: string; size: string; variants: 1 }; resolution: string; duration: number }>;
  taskId: string | null;
  polls: number;
  startedAt: number;
  lastPollAt: number;
  result: VideoResult | null;
  error: string | null;
}>;

export const DEFAULT_VIDEO_SETTINGS = {
  model: ARK_VIDEO_MODELS[0].id,
  size: ARK_VIDEO_MODELS[0].sizes[0],
  variants: 1 as const,
};

/** Parses "480p · 4s" into the flags sent to Ark; also used by the UI cost badge. */
export const videoShape = (size: string): { resolution: string; duration: number } => {
  const match = /^(\d{3,4}p) · (\d+)s$/u.exec(size);
  if (!match) throw new Error('Choose a supported video shape.');
  return { resolution: match[1], duration: Number(match[2]) };
};

export function startVideoRun(request: { prompt: string; settings: { model: string; size: string; variants: 1 }; now?: number }): VideoRun {
  if (!videoReachable()) throw new Error('Real video requires ARK_VIDEO_ENABLED=1 and a configured endpoint.');
  const model = ARK_VIDEO_MODELS.find((entry) => entry.id === request.settings.model);
  if (!model || !model.sizes.includes(request.settings.size)) throw new Error('Unsupported video model or shape.');
  const shape = videoShape(request.settings.size);
  const now = request.now ?? Date.now();
  return {
    id: crypto.randomUUID(),
    state: 'queued',
    request: { prompt: request.prompt, settings: { model: model.id, size: request.settings.size, variants: 1 }, resolution: shape.resolution, duration: shape.duration },
    taskId: null,
    polls: 0,
    startedAt: now,
    lastPollAt: 0,
    result: null,
    error: null,
  };
}

/** Local-only cancel: stops polling and drops any later result; no request is sent. */
export function cancelVideoRun(run: VideoRun): VideoRun {
  if (run.state !== 'queued' && run.state !== 'running') return run;
  return { ...run, state: 'canceled' };
}

const errorMessage = (body: unknown, status: number): string => {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return message ? String(message) : `Ark task request failed with status ${status}.`;
};

/** Bearer header; resolved at call time so the key never sits in module state. */
function headers(): Record<string, string> {
  const key = process.env.ARK_API_KEY;
  const viaProxy = process.env.ARK_PROXY_AVAILABLE === '1';
  if (!key && !viaProxy) throw new Error('ARK_API_KEY is not set; real video stays unavailable.');
  return { 'Content-Type': 'application/json', Authorization: (key ? `Bearer ${key}` : '') };
}

const submitBody = (run: VideoRun): string => JSON.stringify({
  model: videoEndpoint(),
  content: [{ type: 'text', text: `${run.request.prompt} --resolution ${run.request.resolution} --duration ${run.request.duration} --ratio 16:9` }],
});

/** Drives one step of the task: submit once, then one poll per call. */
export async function tickVideoRun(run: VideoRun, now: number = Date.now()): Promise<VideoRun> {
  if (run.state === 'queued') return { ...run, state: 'running', startedAt: now };
  if (run.state !== 'running') return run;
  if (now - run.startedAt > VIDEO_TOTAL_TIMEOUT_MS) {
    return { ...run, state: 'failed', error: 'Video task timed out after 10 minutes.' };
  }
  const call = (request: VideoTransportRequest): Promise<VideoTransportResponse> => transport
    ? transport(request)
    : rawFetch(request);
  try {
    if (!run.taskId) {
      const response = await call({ kind: 'submit', url: `${ARK_VIDEO_BASE_URL}/contents/generations/tasks`, headers: headers(), body: submitBody(run) });
      if (response.status !== 200) return { ...run, state: 'failed', error: errorMessage(response.body, response.status) };
      const taskId = (response.body as { id?: unknown } | null)?.id;
      if (typeof taskId !== 'string' || !taskId) return { ...run, state: 'failed', error: 'Ark returned no task id.' };
      return { ...run, taskId, polls: 0, lastPollAt: now };
    }
    if (now - run.lastPollAt < VIDEO_POLL_INTERVAL_MS) return run;
    const poll = await call({ kind: 'poll', url: `${ARK_VIDEO_BASE_URL}/contents/generations/tasks/${run.taskId}`, headers: headers() });
    if (poll.status !== 200) return { ...run, state: 'failed', error: errorMessage(poll.body, poll.status), polls: run.polls + 1, lastPollAt: now };
    const body = poll.body as { status?: unknown; content?: { video_url?: unknown }; error?: { message?: unknown } } | null;
    const status = typeof body?.status === 'string' ? body.status : '';
    if (status === 'failed') {
      const reason = typeof body?.error?.message === 'string' ? body.error.message : 'Ark task failed.';
      return { ...run, state: 'failed', error: reason, polls: run.polls + 1, lastPollAt: now };
    }
    if (status !== 'succeeded') return { ...run, polls: run.polls + 1, lastPollAt: now };
    const url = typeof body?.content?.video_url === 'string' ? body.content.video_url : '';
    if (!url) return { ...run, state: 'failed', error: 'Ark returned no video url.', polls: run.polls + 1, lastPollAt: now };
    const download = await call({ kind: 'download', url, headers: {} });
    if (download.status !== 200 || !download.bytes?.length) {
      return { ...run, state: 'failed', error: 'Video download failed.', polls: run.polls + 1, lastPollAt: now };
    }
    const bytes = download.bytes;
    return {
      ...run,
      state: 'succeeded',
      polls: run.polls + 1,
      lastPollAt: now,
      result: Object.freeze({ mode: 'real' as const, bytes, mime: 'video/mp4' as const, duration: run.request.duration, resolution: run.request.resolution, model: run.request.settings.model, url }),
    };
  } catch (error) {
    return { ...run, state: 'failed', error: error instanceof Error ? error.message : 'Ark task request failed.' };
  }
}

/** Real network path used only when no fake transport is installed. */
async function rawFetch(request: VideoTransportRequest): Promise<VideoTransportResponse> {
  const timeoutMs = request.kind === 'submit' ? VIDEO_SUBMIT_TIMEOUT_MS : VIDEO_POLL_INTERVAL_MS * 3;
  const response = await fetch(request.url, {
    method: request.body ? 'POST' : 'GET',
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (request.kind === 'download') {
    const buffer = await response.arrayBuffer();
    return { status: response.status, bytes: new Uint8Array(buffer) };
  }
  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body };
}

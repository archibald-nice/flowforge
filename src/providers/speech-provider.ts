/**
 * ByteDance speech v3 real audio provider for slice 1.4.
 *
 * Rules fixed by the user brief:
 * 1. The key lives in `.env.local` as SPEECH_API_KEY (X-Api-Key header). It must
 *    never be committed, logged, or written into code, commit messages, or records.
 * 2. Mock stays the default: real calls happen only when SPEECH_ENABLED=1 and the
 *    user picks the real audio model in the form.
 * 3. Real results are marked `real` and never mixed with `simulated` paths.
 * 4. No automatic retries: a failed HTTP call fails the run exactly once.
 * 5. Billing basis is the response's `original_duration` (seconds) at the
 *    user-confirmed 1 CNY per minute; the invoice itself stays authoritative.
 *
 * The HTTP layer is injected as `SpeechTransport`, so tests use a fake transport
 * and never touch the network.
 */

import { yuanToCredits } from '../domain/money.ts';

export type SpeechModel = Readonly<{
  id: string;
  label: string;
  sizes: readonly string[];
  /** Local estimate in credits for the wallet UI; the real invoice is separate. */
  estimate: number;
}>;

export const SPEECH_MODELS: readonly SpeechModel[] = Object.freeze([
  Object.freeze({ id: 'seed-audio-1.0', label: '豆包语音（seed-audio-1.0）', sizes: ['mp3 48kHz'], estimate: 10 }),
]);

export const SPEECH_SIZES: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(SPEECH_MODELS.map((model) => [model.id, model.sizes])),
);

export const DEFAULT_SPEECH_SETTINGS = { model: SPEECH_MODELS[0].id, size: SPEECH_MODELS[0].sizes[0], variants: 1 as const };

export const SPEECH_BASE_URL = 'https://openspeech.bytedance.com/api/v3/tts/create';

/** Fixed audio shape for this slice: mp3 at 48 kHz, neutral prosody, no watermark. */
export const SPEECH_AUDIO_CONFIG = Object.freeze({ format: 'mp3', sample_rate: 48000, speech_rate: 0, loudness_rate: 0, pitch_rate: 0 });

/** Hard request timeout; the endpoint is synchronous, so one call must finish it. */
export const SPEECH_TIMEOUT_MS = 90_000;

/** User-confirmed price: 1 CNY per minute of `original_duration`. */
export const SPEECH_PRICE_PER_MINUTE_YUAN = 1;

/**
 * Local wallet deduction for one generation, in credits: the CNY price is
 * converted at 1 CNY = 100 credits so the wallet keeps a single unit that
 * matches the simulated price table. Rounded to 0.01 credits.
 */
export function speechPrice(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return yuanToCredits((seconds / 60) * SPEECH_PRICE_PER_MINUTE_YUAN);
}

export type SpeechTransport = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; body: unknown }>;

let transport: SpeechTransport | null = null;

/** Test seam: replace the HTTP layer with a fake transport. */
export function setSpeechTransport(fake: SpeechTransport): void { transport = fake; }
export function resetSpeechTransport(): void { transport = null; }

export function speechEnabled(): boolean {
  return process.env.SPEECH_ENABLED === '1';
}

/** Slice 1.6: the browser reaches real audio through the local dev proxy. */
export function speechReachable(): boolean {
  return speechEnabled() || process.env.ARK_PROXY_AVAILABLE === '1';
}

/** Resolves the key from the environment at call time; never stored or logged. */
function apiKey(): string {
  const key = process.env.SPEECH_API_KEY;
  const viaProxy = process.env.ARK_PROXY_AVAILABLE === '1';
  if (!key && !viaProxy) throw new Error('SPEECH_API_KEY is not set; real audio stays unavailable.');
  // Absent locally: the proxy transport ignores this header.
  return key ?? '';
}

function headers(): Record<string, string> {
  const base: Record<string, string> = { 'Content-Type': 'application/json', 'X-Api-Key': apiKey() };
  const appId = process.env.SPEECH_APP_ID;
  if (appId) base['X-Api-App-Id'] = appId;
  return base;
}

export type SpeechResult = Readonly<{
  mode: 'real';
  /** Raw audio bytes; the caller decides how to store them (IndexedDB asset). */
  bytes: Uint8Array;
  mime: string;
  /** Rendered duration reported by the service (seconds). */
  duration: number;
  /** Billing basis reported by the service (seconds). */
  originalDuration: number;
  /** Model id used; recorded in acceptance for cost accounting. */
  model: string;
  /** Local wallet deduction in credits, derived from originalDuration. */
  cost: number;
}>;

export type SpeechRun = Readonly<{
  id: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  request: { prompt: string; settings: { model: string; size: string; variants: 1 } };
  result: SpeechResult | null;
  error: string | null;
}>;

const realSettings = (value: unknown): { model: string; size: string; variants: 1 } => {
  const { model, size } = (value ?? {}) as { model?: unknown; size?: unknown };
  const known = SPEECH_MODELS.find((entry) => entry.id === model);
  if (!known) throw new Error('Unsupported speech model.');
  if (!known.sizes.includes(String(size))) throw new Error('Unsupported speech format.');
  return { model: known.id, size: String(size), variants: 1 };
};

export function startSpeechRun(request: { prompt: string; settings: { model: string; size: string; variants: 1 } }): SpeechRun {
  if (!speechReachable()) throw new Error('Real audio requires SPEECH_ENABLED=1.');
  const text = request.prompt.trim();
  if (!text) throw new Error('Write something to speak first.');
  if (text.length > 2048) throw new Error('The speech text is limited to 2048 characters.');
  return { id: crypto.randomUUID(), state: 'queued', request: { prompt: text, settings: realSettings(request.settings) }, result: null, error: null };
}

/** Canceling before the request is sent keeps the provider untouched. */
export function cancelSpeechRun(run: SpeechRun): SpeechRun {
  if (run.state === 'succeeded' || run.state === 'failed') return run;
  return { ...run, state: 'canceled' };
}

const failureMessage = (body: unknown, status: number): string => {
  const payload = (body ?? {}) as { code?: unknown; message?: unknown };
  const code = payload.code === undefined || payload.code === null ? '' : `code ${String(payload.code)}`;
  const message = typeof payload.message === 'string' ? payload.message : '';
  const detail = [code, message].filter(Boolean).join(' ');
  return detail ? `Speech request failed (${detail}).` : `Speech request failed with status ${status}.`;
};

/**
 * Drives one real request per call; state advances queued → running → succeeded
 * or failed. A failure terminal state is final: tickSpeechRun returns the same run.
 */
export function tickSpeechRun(run: SpeechRun): Promise<SpeechRun> | SpeechRun {
  if (run.state === 'queued') return { ...run, state: 'running' };
  if (run.state !== 'running') return run;
  const doCall = async (): Promise<SpeechRun> => {
    const url = SPEECH_BASE_URL;
    const body = JSON.stringify({
      model: run.request.settings.model,
      text_prompt: run.request.prompt,
      audio_config: { ...SPEECH_AUDIO_CONFIG },
    });
    try {
      const response = transport
        ? await transport(url, { method: 'POST', headers: headers(), body })
        : await rawFetch(url, body);
      const payload = (response.body ?? {}) as { audio?: unknown; duration?: unknown; original_duration?: unknown };
      const b64 = typeof payload.audio === 'string' ? payload.audio : '';
      if (response.status !== 200) return { ...run, state: 'failed', error: failureMessage(response.body, response.status) };
      if (!b64) return { ...run, state: 'failed', error: failureMessage(response.body, response.status) };
      const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
      const originalDuration = typeof payload.original_duration === 'number' ? payload.original_duration : 0;
      const duration = typeof payload.duration === 'number' ? payload.duration : originalDuration;
      return {
        ...run,
        state: 'succeeded',
        result: Object.freeze({
          mode: 'real' as const,
          bytes,
          mime: 'audio/mpeg',
          duration,
          originalDuration,
          model: run.request.settings.model,
          cost: speechPrice(originalDuration),
        }),
      };
    } catch (error) {
      return { ...run, state: 'failed', error: error instanceof Error ? error.message : 'Speech request failed.' };
    }
  };
  return doCall();
}

/** Real network path used only when no fake transport is installed. */
async function rawFetch(url: string, body: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { method: 'POST', headers: headers(), body, signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS) });
  let parsed: unknown = null;
  try { parsed = await response.json(); } catch { parsed = null; }
  return { status: response.status, body: parsed };
}

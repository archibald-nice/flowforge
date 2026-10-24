/**
 * Volcano Ark (火山方舟) real image provider for slice 1.2.
 *
 * Rules fixed by the user brief:
 * 1. The key lives in `.env.local` as ARK_API_KEY. It must never be committed,
 *    logged, or written into code, commit messages, or acceptance records.
 * 2. Mock stays the default: real calls happen only when ARK_ENABLED=1.
 * 3. Real results are marked `real` and are never mixed with `simulated` paths.
 * 4. No automatic retries: a failed HTTP call fails the run exactly once.
 *
 * The HTTP layer is injected as `ArkTransport`, so tests use a fake transport
 * and never touch the network.
 */

/** One documented Ark image model entry. IDs are Ark endpoint/model ids. */
import { yuanToCredits } from '../domain/money.ts';

export type ArkImageModel = Readonly<{
  id: string;
  label: string;
  sizes: readonly string[];
  /**
   * Local credits estimate for the wallet UI: 0.2 CNY per image is the list
   * price read from the Ark console on 2026-10-22, converted at 1 CNY = 100
   * credits.
   * The invoice stays authoritative.
   */
  estimate: number;
}>;

export const ARK_IMAGE_MODELS: readonly ArkImageModel[] = Object.freeze([
  // The catalog entry is a placeholder: the real Ark endpoint id lives in the
  // server environment (ARK_IMAGE_ENDPOINT) and the proxy substitutes it, so an
  // account resource id never ships in the client bundle. Sizes and the cost
  // estimate are UI data and stay here.
  Object.freeze({ id: 'ark-image-endpoint', label: 'Seedream 4.0（方舟）', sizes: ['1280x720', '1024x1024', '2K', '2304x1728'], estimate: yuanToCredits(0.2) }),
]);

export const ARK_SIZES: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(ARK_IMAGE_MODELS.map((model) => [model.id, model.sizes])),
);

export const DEFAULT_ARK_SETTINGS = { model: ARK_IMAGE_MODELS[0].id, size: ARK_IMAGE_MODELS[0].sizes[0], variants: 1 as const };

export const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

export type ArkTransport = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; body: unknown }>;

let transport: ArkTransport | null = null;

/** Test seam: replace the HTTP layer with a fake transport. */
export function setArkTransport(fake: ArkTransport): void { transport = fake; }
export function resetArkTransport(): void { transport = null; }

export function arkEnabled(): boolean {
  return process.env.ARK_ENABLED === '1';
}

/**
 * Slice 1.6: in the browser the key never exists, but the dev proxy can hold it.
 * "Reachable" means either the local key path or the proxy is usable.
 */
export function arkReachable(): boolean {
  return arkEnabled() || process.env.ARK_PROXY_AVAILABLE === '1';
}

/** Resolves the key from the environment at call time; never stored or logged. */
function apiKey(): string {
  const key = process.env.ARK_API_KEY;
  // Slice 1.6: with the local proxy the key stays in the dev server process.
  const viaProxy = process.env.ARK_PROXY_AVAILABLE === '1';
  if (!key && !viaProxy) throw new Error('ARK_API_KEY is not set; real generation stays unavailable.');
  // Absent locally: the proxy transport ignores this header.
  return key ?? '';
}

export type ArkResult = Readonly<{
  mode: 'real';
  /** Raw image bytes; the caller decides how to store them (IndexedDB asset). */
  bytes: Uint8Array;
  mime: string;
  /** Ark-reported size string, e.g. "1024x1024". */
  size: string;
  /** Ark model id used; recorded in acceptance for cost accounting. */
  model: string;
  /** Ark-reported output tokens for this generation (usage basis for billing). */
  outputTokens: number;
}>;

export type ArkRun = Readonly<{
  id: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  request: { prompt: string; settings: { model: string; size: string; variants: 1 } };
  result: ArkResult | null;
  error: string | null;
}>;

/**
 * Sizes for a model id: either a catalog entry, or the real endpoint id that the
 * proxy resolved from ARK_IMAGE_ENDPOINT (self-hosted builds). Anything else is
 * rejected, so a client string never becomes an upstream model.
 */
const imageSizesFor = (model: string): readonly string[] | null => {
  const known = ARK_IMAGE_MODELS.find((entry) => entry.id === model);
  if (known) return known.sizes;
  const endpoint = (process.env.ARK_IMAGE_ENDPOINT ?? '').trim();
  if (endpoint && model === endpoint) return ARK_IMAGE_MODELS[0].sizes;
  return null;
};

const realSettings = (value: unknown): { model: string; size: string; variants: 1 } => {
  const { model, size } = (value ?? {}) as { model?: unknown; size?: unknown };
  const sizes = typeof model === 'string' ? imageSizesFor(model) : null;
  if (!sizes) throw new Error('Unsupported Ark model.');
  if (!sizes.includes(String(size))) throw new Error('Unsupported Ark size.');
  return { model: String(model), size: String(size), variants: 1 };
};

export function startArkRun(request: { prompt: string; settings: { model: string; size: string; variants: 1 } }): ArkRun {
  if (!arkReachable()) throw new Error('Real generation requires ARK_ENABLED=1.');
  return { id: crypto.randomUUID(), state: 'queued', request: { prompt: request.prompt, settings: realSettings(request.settings) }, result: null, error: null };
}

const errorMessage = (body: unknown, status: number): string => {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return message ? String(message) : `Ark request failed with status ${status}.`;
};

/**
 * Slice 1.4 follow-up: a real run can be canceled while its request is in
 * flight. Cancel is local only — it never issues a new request, and the caller
 * must drop any result that resolves afterwards (see `stillRunning`).
 */
export function cancelArkRun(run: ArkRun): ArkRun {
  if (run.state !== 'queued' && run.state !== 'running') return run;
  return { ...run, state: 'canceled' };
}

/**
 * Drives one real request per call; state advances queued → running → succeeded
 * or failed. A failure terminal state is final: tickArkRun returns the same run.
 */
export function tickArkRun(run: ArkRun): Promise<ArkRun> | ArkRun {
  if (run.state === 'queued') return { ...run, state: 'running' };
  if (run.state !== 'running') return run;
  const doCall = async (): Promise<ArkRun> => {
    try {
      const response = transport
        ? await transport(`${ARK_BASE_URL}/images/generations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
          body: JSON.stringify({ model: run.request.settings.model, prompt: run.request.prompt, size: run.request.settings.size, response_format: 'b64_json' }),
        })
        : await rawFetch(`${ARK_BASE_URL}/images/generations`, run);
      if (response.status !== 200) return { ...run, state: 'failed', error: errorMessage(response.body, response.status) };
      const data = (response.body as { data?: { b64_json?: unknown; size?: unknown }[]; usage?: { output_tokens?: unknown } } | null)?.data?.[0];
      const b64 = typeof data?.b64_json === 'string' ? data.b64_json : '';
      if (!b64) return { ...run, state: 'failed', error: 'Ark returned no image data.' };
      const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
      const size = typeof data?.size === 'string' ? data.size : run.request.settings.size;
      const body = response.body as { usage?: { output_tokens?: unknown } };
      const outputTokens = typeof body.usage?.output_tokens === 'number' ? body.usage.output_tokens : 0;
      return { ...run, state: 'succeeded', result: Object.freeze({ mode: 'real' as const, bytes, mime: 'image/png', size, model: run.request.settings.model, outputTokens }) };
    } catch (error) {
      return { ...run, state: 'failed', error: error instanceof Error ? error.message : 'Ark request failed.' };
    }
  };
  return doCall();
}

/** Real network path used only when no fake transport is installed. */
async function rawFetch(url: string, run: ArkRun): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({ model: run.request.settings.model, prompt: run.request.prompt, size: run.request.settings.size, response_format: 'b64_json' }),
  });
  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body };
}

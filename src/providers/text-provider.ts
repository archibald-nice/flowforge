/**
 * Slice 1.4 (text part) — real text generation via Volcano Ark chat completions.
 *
 * Rules from the brief:
 * 1. Mock stays the default; a real call needs ARK_TEXT_ENABLED=1, ARK_TEXT_ENDPOINT
 *    and an explicitly picked Ark text model.
 * 2. One request, 60 s timeout, no automatic retry: failures stay failed.
 * 3. The generated text lands in the node content; the prompt is preserved on the
 *    node meta so a real run never loses the input.
 * 4. The key and the endpoint id stay in node context; the client only sees the
 *    `ARK_TEXT_AVAILABLE` boolean.
 */
import { TEXT_CREDITS_PER_CALL } from '../domain/money.ts';

export const ARK_TEXT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const TEXT_TIMEOUT_MS = 60_000;

/** Wire-format model id shown in the form; the real endpoint id stays in .env.local. */
export const ARK_TEXT_MODELS = [
  { id: 'ark-text-endpoint', label: 'DeepSeek V4.1 Flash（方舟接入点）', sizes: ['默认'] },
] as const;

export type ArkTextModel = (typeof ARK_TEXT_MODELS)[number]['id'];

export type TextResult = Readonly<{
  mode: 'real';
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}>;

export type TextRun = Readonly<{
  id: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  request: Readonly<{ prompt: string; nodeId: string; model: string }>;
  result: TextResult | null;
  error: string | null;
}>;

export type TextTransport = (url: string, init: RequestInit) => Promise<Response>;

export type ChatMessage = Readonly<{ role: 'system' | 'user'; content: string }>;
export type ChatReply =
  | { ok: true; content: string; model: string; promptTokens: number; completionTokens: number }
  | { ok: false; error: string };

export const rawTextFetch: TextTransport = (url, init) => fetch(url, init);

let transport: TextTransport | null = null;

export function setTextTransport(next: TextTransport): void { transport = next; }
export function resetTextTransport(): void { transport = null; }

/** True only when the flag and the endpoint are both present (node context). */
export function textEnabled(): boolean {
  return process.env.ARK_TEXT_ENABLED === '1' && Boolean(process.env.ARK_TEXT_ENDPOINT);
}

/** Browser-safe: true when the dev/build step inlined ARK_TEXT_AVAILABLE=1. */
/** Slice 1.6: the browser reaches real text through the local dev proxy. */
export function textReachable(): boolean {
  // Client bundle: only the inlined availability boolean exists there.
  return textEnabled() || textAvailable() || process.env.ARK_PROXY_AVAILABLE === '1';
}

export function textAvailable(): boolean {
  return process.env.ARK_TEXT_AVAILABLE === '1';
}

export function textEndpoint(): string {
  const endpoint = process.env.ARK_TEXT_ENDPOINT;
  if (endpoint) return endpoint;
  // Slice 1.6: the proxy owns the endpoint id; the browser only carries the shape.
  if (process.env.ARK_PROXY_AVAILABLE === '1') return ARK_TEXT_MODELS[0].id;
  throw new Error('真实文本已选中，但文本接入点未配置；本次不执行。');
}

export function startTextRun(input: { prompt: string; nodeId: string; model?: string }): TextRun {
  // Slice 1.6-fix: `ARK_TEXT_ENABLED` is never inlined into the browser bundle
  // (only booleans are), so gating on `textEnabled()` alone made a real browser
  // run impossible even when the dev proxy could serve it. Reachability covers
  // both contexts and still refuses when nothing can answer.
  if (!textReachable()) throw new Error('真实文本已选中，但文本模型不可达（ARK_TEXT_ENABLED 未开启且本地代理不可用）；本次不执行。');
  return Object.freeze({
    id: crypto.randomUUID(),
    state: 'queued',
    request: Object.freeze({ prompt: input.prompt, nodeId: input.nodeId, model: input.model ?? ARK_TEXT_MODELS[0].id }),
    result: null,
    error: null,
  });
}

export function cancelTextRun(run: TextRun): TextRun {
  if (run.state !== 'queued' && run.state !== 'running') return run;
  return Object.freeze({ ...run, state: 'canceled' });
}

/**
 * One chat completion, no retry. Used by both the text node run and the slice
 * 3.2-llm planner (same endpoint, same transport seam).
 */
export async function completeChat(messages: readonly ChatMessage[], model?: string): Promise<ChatReply> {
  // Slice 1.6-fix: fail closed, in this order. A browser bundle that has neither
  // a key nor the proxy must return an error instead of letting `textEndpoint()`
  // throw out of the run tick (which left the run stuck in `running` forever).
  const key = process.env.ARK_API_KEY;
  if (!key && process.env.ARK_PROXY_AVAILABLE !== '1') return { ok: false, error: 'ARK_API_KEY 未配置；本次不执行。' };
  let endpoint: string;
  try {
    endpoint = model ?? textEndpoint();
  } catch (reason) {
    return { ok: false, error: String(reason instanceof Error ? reason.message : reason) };
  }
  const send = transport ?? rawTextFetch;
  try {
    const response = await send(`${ARK_TEXT_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: (key ? `Bearer ${key}` : '') },
      body: JSON.stringify({ model: endpoint, messages }),
      signal: AbortSignal.timeout(TEXT_TIMEOUT_MS),
    });
    const body = await response.json() as {
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (!response.ok) return { ok: false, error: body?.error?.message ?? `文本接口返回 HTTP ${response.status}` };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: '文本接口未返回内容（no message content）。' };
    return { ok: true, content, model: body.model ?? endpoint,
      promptTokens: body.usage?.prompt_tokens ?? 0, completionTokens: body.usage?.completion_tokens ?? 0 };
  } catch (reason) {
    return { ok: false, error: String(reason) };
  }
}

/** Advances one step: queued → running (no request), running → one request, terminal stays. */
export async function tickTextRun(run: TextRun): Promise<TextRun> {
  if (run.state === 'queued') return Object.freeze({ ...run, state: 'running' });
  if (run.state !== 'running') return run;
  const reply = await completeChat([{ role: 'user', content: run.request.prompt }]);
  if (!reply.ok) return Object.freeze({ ...run, state: 'failed', error: reply.error });
  return Object.freeze({
    ...run,
    state: 'succeeded',
    result: Object.freeze({
      mode: 'real',
      text: reply.content,
      model: reply.model,
      promptTokens: reply.promptTokens,
      completionTokens: reply.completionTokens,
    }),
  });
}

export { TEXT_CREDITS_PER_CALL };

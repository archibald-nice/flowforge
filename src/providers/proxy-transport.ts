/**
 * Slice 1.6 — browser → local proxy HTTP transports.
 *
 * The providers keep their own validation, state machine and response parsing;
 * this module only swaps the HTTP layer when the local dev proxy is available
 * (`ARK_PROXY_AVAILABLE`, inlined as a boolean by Vite). Each transport
 * translates between the provider's native request/response shape and the
 * proxy's JSON endpoints, so nothing in the provider logic is rewritten.
 *
 * When the proxy is NOT available nothing is installed: real models stay
 * unreachable and the mock path is unchanged. There is no silent downgrade.
 */
import { setArkTransport, type ArkTransport } from './ark-provider.ts';
import { setVideoTransport, type VideoTransport, type VideoTransportResponse } from './video-provider.ts';
import { setSpeechTransport, type SpeechTransport } from './speech-provider.ts';
import { setTextTransport, type TextTransport } from './text-provider.ts';

/** Mirrors the dev middleware registration; inlined as a boolean by Vite. */
export function proxyAvailable(): boolean {
  return process.env.ARK_PROXY_AVAILABLE === '1';
}

type ProxyReply = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string };

const toBase64Bytes = (value: unknown): Uint8Array => {
  if (typeof value !== 'string' || !value) throw new Error('Proxy returned no bytes.');
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
};

async function postJson(path: string, body: unknown): Promise<ProxyReply> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as { ok?: unknown; error?: unknown } | null;
    if (!response.ok || !payload || payload.ok !== true) {
      return { ok: false, status: response.status, error: typeof payload?.error === 'string' ? payload.error : `Proxy request failed with status ${response.status}.` };
    }
    return { ok: true, data: payload as Record<string, unknown> };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : 'Proxy request failed.' };
  }
}

/** `{model, size, prompt}` → Ark-native `{data:[{b64_json,size}], usage}` response. */
const arkProxyTransport: ArkTransport = async (_url, init) => {
  const request = JSON.parse(init.body) as { model?: string; size?: string; prompt?: string };
  const reply = await postJson('/api/ark/generate', { model: request.model, size: request.size, prompt: request.prompt });
  if (!reply.ok) return { status: reply.status || 502, body: { error: { message: reply.error } } };
  return {
    status: 200,
    body: {
      data: [{ b64_json: reply.data.bytes, size: reply.data.size }],
      usage: { output_tokens: reply.data.outputTokens },
    },
  };
};

/** Video: submit → poll → inline download, mapped onto the provider's three calls. */
const videoProxyTransports = (): VideoTransport => {
  const pending = new Map<string, Uint8Array>();
  return async (request): Promise<VideoTransportResponse> => {
    if (request.kind === 'submit') {
      const body = JSON.parse(request.body ?? '{}') as { content?: { text?: string }[] };
      const raw = body.content?.[0]?.text ?? '';
      const reply = await postJson('/api/ark/video/tasks', { prompt: raw.replace(/ --resolution .*$/u, '') });
      if (!reply.ok) return { status: reply.status || 502, body: { error: { message: reply.error } } };
      return { status: 200, body: { id: reply.data.taskId } };
    }
    if (request.kind === 'poll') {
      const taskId = request.url.split('/').pop() ?? '';
      const reply = await postJson(`/api/ark/video/tasks/${encodeURIComponent(taskId)}`, {});
      if (!reply.ok) return { status: reply.status || 502, body: { error: { message: reply.error } } };
      if (reply.data.state === 'succeeded') {
        pending.set(taskId, toBase64Bytes(reply.data.bytes));
        return { status: 200, body: { status: 'succeeded', content: { video_url: `proxy://${taskId}` } } };
      }
      if (reply.data.state === 'failed') return { status: 200, body: { status: 'failed', error: { message: reply.data.error } } };
      return { status: 200, body: { status: String(reply.data.state ?? 'running') } };
    }
    const taskId = request.url.replace('proxy://', '');
    const bytes = pending.get(taskId);
    if (!bytes) return { status: 404 };
    pending.delete(taskId);
    return { status: 200, bytes };
  };
};

/** Text/planning: chat completion response shaped like the Ark one. */
const textProxyTransport: TextTransport = async (_url, init) => {
  const body = JSON.parse(String(init.body)) as { model?: string; messages?: unknown };
  const reply = await postJson('/api/ark/chat', { model: body.model, messages: body.messages });
  if (!reply.ok) {
    return new Response(JSON.stringify({ error: { message: reply.error } }), { status: reply.status || 502 });
  }
  const usage = (reply.data.usage ?? {}) as { promptTokens?: unknown; completionTokens?: unknown };
  return new Response(JSON.stringify({
    model: reply.data.model,
    choices: [{ message: { content: reply.data.content } }],
    usage: { prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

/** Speech: audio base64 + durations, shaped like the openspeech response. */
const speechProxyTransport: SpeechTransport = async (_url, init) => {
  const body = JSON.parse(init.body) as { text_prompt?: string };
  const reply = await postJson('/api/speech/tts', { text: body.text_prompt });
  if (!reply.ok) return { status: reply.status || 502, body: { message: reply.error } };
  return {
    status: 200,
    body: {
      audio: reply.data.bytes,
      duration: reply.data.durationSeconds,
      original_duration: reply.data.originalDurationSeconds,
    },
  };
};

let installed = false;

/**
 * Installs the proxy transports once. Called from the app entry when
 * `proxyAvailable()`; a no-op otherwise so real models stay unreachable.
 */
export function installProxyTransports(): void {
  if (installed || !proxyAvailable()) return;
  installed = true;
  setArkTransport(arkProxyTransport);
  setVideoTransport(videoProxyTransports());
  setTextTransport(textProxyTransport);
  setSpeechTransport(speechProxyTransport);
}

/** Test seam: forget that transports were installed. */
export function resetProxyTransports(): void {
  installed = false;
}

/**
 * Deterministic mock provider. FlowForge never calls a real model in this study;
 * every count here is simulated and must stay 0 until an explicit generation
 * submit action exists. Edge creation and deletion must never touch it.
 */
export type GenerationRequest = Readonly<{
  prompt: string;
  inputs: readonly { nodeId: string; revision: number; role: string }[];
  settings?: Readonly<{ model: string; size: string; variants: 1 }>;
}>;

export type SimulatedResult = Readonly<{
  mode: 'simulated';
  status: 'simulated-only';
  cost: 0;
  note: string;
  seed: number;
}>;

/**
 * Five-state mock lifecycle. Every state here is a FlowForge design: the target
 * never ran a generation in this study, so no state is aligned to its behaviour.
 */
export type RunState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type MockRun = Readonly<{
  id: string;
  state: RunState;
  request: GenerationRequest;
  seed: number;
  result: SimulatedResult | null;
  error: string | null;
}>;

/** Test hook: the next run that reaches `running` fails instead of succeeding. */
export const runControls = { failNext: false };

export const providerCalls = { total: 0, lastRequest: null as GenerationRequest | null };

export function resetProviderCalls(): void {
  providerCalls.total = 0;
  providerCalls.lastRequest = null;
}

export function providerCallCount(): number {
  return providerCalls.total;
}

export function mockGenerate(request: GenerationRequest): SimulatedResult {
  providerCalls.total += 1;
  providerCalls.lastRequest = request;
  return Object.freeze({ mode: 'simulated', status: 'simulated-only', cost: 0, note: 'No network request was made.', seed: runSeed(request) });
}

/** Same inputs produce the same seed; the seed never leaves the mock. */
export function runSeed(request: GenerationRequest): number {
  const payload = [request.prompt, request.settings?.model ?? '', request.settings?.size ?? '',
    ...request.inputs.map((input) => `${input.nodeId}:${input.revision}:${input.role}`)].join('|');
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function startRun(request: GenerationRequest): MockRun {
  providerCalls.total += 1;
  providerCalls.lastRequest = request;
  return { id: crypto.randomUUID(), state: 'queued', request, seed: runSeed(request), result: null, error: null };
}

export function tickRun(run: MockRun): MockRun {
  if (run.state === 'queued') return { ...run, state: 'running' };
  if (run.state !== 'running') return run;
  if (runControls.failNext) {
    runControls.failNext = false;
    return { ...run, state: 'failed', error: '模拟的模型失败；画布内容未变。' };
  }
  return { ...run, state: 'succeeded', result: Object.freeze({
    mode: 'simulated', status: 'simulated-only', cost: 0,
    note: 'No network request was made.', seed: run.seed }) };
}

/** Idempotent: canceling twice is safe, and a canceled run never yields a result. */
export function cancelRun(run: MockRun): MockRun {
  return run.state === 'queued' || run.state === 'running'
    ? { ...run, state: 'canceled', result: null }
    : run;
}

/** Runs a canvas transaction and fails loudly if it reached the provider. */
export function withoutProviderCalls<T>(transaction: string, run: () => T): T {
  const before = providerCalls.total;
  const result = run();
  if (providerCalls.total !== before) throw new Error(`A provider call happened while ${transaction}.`);
  return result;
}

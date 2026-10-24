/**
 * Slice 1.2 — real image generation via Volcano Ark (火山方舟).
 *
 * Rules from the user brief:
 * 1. Mock stays the default. Real calls happen only when ARK_ENABLED=1 and the
 *    user picks an Ark model in the form.
 * 2. Real results are stored as real local assets and marked `real` in the node
 *    meta; they are never mixed with `simulated` results.
 * 3. No automatic retry: a failed Ark run stays failed until the user submits
 *    again manually.
 * 4. The key lives in .env.local (ARK_API_KEY), loaded by Vite env files; it is
 *    never logged, committed, or written into documents.
 */
import { addNode, isMediaNode, setNodeAsset, type Project } from '../domain/project.ts';
import { arkEnabled, startArkRun, tickArkRun, ARK_IMAGE_MODELS } from './ark-provider.ts';

export type RealRunControls = {
  /** Test seam: force the next real run to fail without touching the network. */
  failNext: boolean;
};

export const realRunControls: RealRunControls = { failNext: false };

/** Only Ark image models may run for real in this slice; video/audio stay mock. */
export const realModelsAvailable = (): boolean => arkEnabled() && ARK_IMAGE_MODELS.length > 0;

/** Marks a real result on the node; distinct from simulated (assetSource 'asset' + meta.real). */
export function applyRealResult(project: Project, nodeId: string, assetPath: string): Project {
  const target = project.nodes.find(node => node.id === nodeId);
  if (!target || !isMediaNode(target)) throw new Error('Real results only apply to media nodes.');
  const next = setNodeAsset(project, nodeId, assetPath);
  return { ...next, nodes: next.nodes.map(node => node.id === nodeId
    ? { ...node, resultMeta: { mode: 'real', model: realModelOf(project, nodeId), recordedAt: new Date().toISOString() } }
    : node) };
}

const realModelOf = (project: Project, nodeId: string): string => {
  const node = project.nodes.find(entry => entry.id === nodeId);
  return (node as { settings?: { model?: string } } | undefined)?.settings?.model ?? 'unknown';
};

/** Stub used by tests: never called in production paths of this slice. */
export const realPlaceholderNode = (project: Project): Project => addNode(project, 'image');

/**
 * Slice 1.4 follow-up — cancel race guard.
 *
 * A real run is driven by an effect that awaits the provider call. While that
 * await is in flight the user can cancel, so the resolved result must not be
 * applied (and the wallet must not be charged) unless the run the UI still holds
 * is the same run and is still `running`.
 */
export type RealRunLike = { id: string; state: string } | null;

/**
 * True only while the UI still holds this exact run in the `running` state, i.e.
 * the user did not cancel and no newer run replaced it while the call was out.
 * The resolved state itself is the caller's business (succeeded / failed).
 */
/** The held run is still the same live run (a queued→running tick is not a cancel). */
export function stillRunning(held: RealRunLike, runId: string): boolean {
  return !!held && held.id === runId && (held.state === 'queued' || held.state === 'running');
}

import type { Viewport } from './viewport.ts';
import { ARK_IMAGE_MODELS } from '../providers/ark-provider.ts';
import { SPEECH_MODELS } from '../providers/speech-provider.ts';
import { ARK_VIDEO_MODELS } from '../providers/video-provider.ts';

type BaseNode = { id: string; title: string; revision: number; position: { x: number; y: number } };
export const REFERENCE_ROLES = ['reference', 'first-frame', 'style'] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];
export type Reference = { nodeId: string; role: ReferenceRole };
export type TextNode = BaseNode & {
  kind: 'text';
  text: string;
  /** Slice 1.4-text: a real text result keeps the prompt it answered. */
  textMeta?: Readonly<{ mode: 'real' | 'simulated'; model: string; recordedAt: string; prompt: string; promptTokens: number; completionTokens: number }>;
};
export type MediaNode = BaseNode & {
  kind: MediaKind;
  // Empty media drafts are valid: no asset until the user uploads or generates.
  assetPath?: string;
  assetSource?: 'fixture' | 'asset' | 'simulated';
  posterPath?: string;
  prompt: string;
  references: Reference[];
  settings?: GenerationSettings;
  // Slice 1.2: a real provider result is recorded here; simulated results never set it.
  resultMeta?: { mode: 'real'; model: string; recordedAt: string };
};
export type SceneNode = BaseNode & { kind: 'scene' };
export type ContentNode = TextNode | MediaNode | SceneNode;
// Mock generation form. Structure follows the observed four segments, but the
// model names and parameter values are FlowForge designs, not the target product's.
export const MOCK_MODELS = ['mock-still-a', 'mock-still-b'] as const;
export type MockModel = (typeof MOCK_MODELS)[number];
export const MOCK_SIZES: Readonly<Record<MockModel, readonly string[]>> = {
  'mock-still-a': ['512', '1024'],
  'mock-still-b': ['1024'],
};
export type GenerationSettings = Readonly<{ model: MockModel; size: string; variants: 1 }>;
export const DEFAULT_SETTINGS: GenerationSettings = { model: 'mock-still-a', size: '512', variants: 1 };
export const MEDIA_KINDS = ['image', 'video', 'audio'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const isMediaKind = (kind: string): kind is MediaKind => (MEDIA_KINDS as readonly string[]).includes(kind);
export type ProjectNode = ContentNode;
export function isMediaNode(node: ProjectNode): node is MediaNode { return isMediaKind(node.kind); }
export function settingsOf(node: { settings?: GenerationSettings }): GenerationSettings { return node.settings ?? DEFAULT_SETTINGS; }
export type ReferenceEdge = { id: string; source: string; target: string };
export type Snapshot = Readonly<{
  id: string; targetNodeId: string; prompt: string; createdAt: string;
  mode: 'inspection-only'; settings?: GenerationSettings; inputs: readonly Readonly<Reference & {
    revision: number; kind: 'text' | 'image' | 'video' | 'audio'; text?: string; assetPath?: string;
  }>[];
}>;
export const NODE_KINDS = ['text', 'image', 'video', 'audio', 'scene'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
/** 3D is a placeholder this round: it can be created but not generated. */
export const SCENE_NOTICE = '3D scene generation is deferred; the node is a placeholder.';
/** A simulated media result is a local data URL, never a provider artifact. */
export const SIMULATED_PREFIX = 'simulated:';
export const isSimulatedPath = (path: string) => path.startsWith(SIMULATED_PREFIX);
export const SCHEMA_VERSION = 4 as const;
// Designed local wallet default; see src/domain/pricing.ts for the price table.
export const DEFAULT_CREDITS = 200;
export type SchemaVersion = 1 | 2 | 3 | 4;
export type Project = {
  id: string; schemaVersion: SchemaVersion; name: string; revision: number; viewport: Viewport;
  nodes: ProjectNode[]; edges: ReferenceEdge[]; snapshots: Snapshot[];
  mediaVersion?: 1;
  // Local simulated wallet (slice 1.5). Optional so older records load and take
  // the designed default instead of failing validation.
  credits?: number;
  // Additive metadata for the local project list (M03). Optional so older
  // records keep loading without a schemaVersion bump.
  updatedAt?: string;
};

/** An empty canvas project. The target's new-project content is unknown; this is designed. */
export function createProject(id = `project-${crypto.randomUUID()}`, name = 'Untitled project'): Project {
  return { id, schemaVersion: SCHEMA_VERSION, name, revision: 0, viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [], edges: [], snapshots: [], credits: DEFAULT_CREDITS, updatedAt: new Date().toISOString() };
}

export function demoProject(): Project {
  return {
    id: 'm1-workbench', schemaVersion: SCHEMA_VERSION, name: 'The Quiet Launch', revision: 0,
    viewport: { x: 70, y: 90, zoom: 0.9 }, credits: DEFAULT_CREDITS,
    nodes: [
      { id: 'brief', title: '01 / Creative brief', kind: 'text', revision: 1, position: { x: 0, y: 0 }, text: 'A fictional bottle. A calmer launch. Keep the product unmistakable; make the space around it feel considered.' },
      { id: 'product', title: '02 / Original study', kind: 'image', revision: 1, position: { x: 0, y: 260 }, assetPath: '/fixtures/study-01.png', assetSource: 'fixture', prompt: '', references: [] },
      { id: 'draft', title: '03 / Input draft', kind: 'image', revision: 1, position: { x: 390, y: 120 }, prompt: 'A quieter direction, with clear product focus.', references: [] },
      { id: 'other', title: 'Unconnected note', kind: 'text', revision: 1, position: { x: 780, y: 420 }, text: 'This note is not an input.' },
    ],
    edges: [{ id: 'brief-draft', source: 'brief', target: 'draft' }, { id: 'product-draft', source: 'product', target: 'draft' }],
    snapshots: [],
  };
}

export function addReferenceEdge(project: Project, source: string, target: string): Project {
  if (source === target) throw new Error('A self edge is not allowed.');
  const from = project.nodes.find(node => node.id === source);
  const to = project.nodes.find(node => node.id === target);
  if (!from || !to || from.kind === 'scene' || !isMediaKind(to.kind)) throw new Error('Nodes are not compatible.');
  if (project.edges.some(edge => edge.source === source && edge.target === target)) throw new Error('A duplicate edge is not allowed.');
  if (reaches(project.edges, target, source)) throw new Error('A cyclic edge is not allowed.');
  return { ...project, edges: [...project.edges, { id: `${source}-${target}`, source, target }] };
}

export function freezeInputs(project: Project, targetNodeId: string): Snapshot {
  const draft = project.nodes.find(node => node.id === targetNodeId);
  if (!draft || !isMediaNode(draft)) throw new Error('Choose a media node.');
  if (!draft.references.length) throw new Error('请至少勾选一项显式输入。');
  const seen = new Set<string>();
  const inputs = draft.references.map(ref => {
    if (seen.has(ref.nodeId)) throw new Error('A duplicate reference is not allowed.');
    seen.add(ref.nodeId);
    if (!project.edges.some(edge => edge.target === targetNodeId && edge.source === ref.nodeId)) throw new Error('Input is not a connected candidate.');
    const node = project.nodes.find(candidate => candidate.id === ref.nodeId);
    if (!node || node.kind === 'scene') throw new Error('Input type is not compatible.');
    const content = node.kind === 'text' ? { text: node.text } : { assetPath: node.assetPath ?? '' };
    return Object.freeze({ ...ref, revision: node.revision, kind: node.kind, ...content });
  });
  return Object.freeze({ id: crypto.randomUUID(), targetNodeId, mode: 'inspection-only', prompt: draft.prompt,
    settings: settingsOf(draft), createdAt: new Date().toISOString(), inputs: Object.freeze(inputs) });
}

// Legacy projects stored brief / product / other. They load as the designed
// three-value role set so an existing local project stays readable.
const roleAliases: Record<string, ReferenceRole> = { brief: 'reference', product: 'first-frame', other: 'style' };
function normalizeRole(value: unknown): ReferenceRole {
  const key = String(value);
  if ((REFERENCE_ROLES as readonly string[]).includes(key)) return key as ReferenceRole;
  const alias = roleAliases[key];
  if (!alias) throw new Error('Invalid reference role.');
  return alias;
}
function settings(value: unknown): GenerationSettings {
  const raw = object(value);
  const model = String(raw.model);
  // Slice 1.2: real Ark models are accepted in snapshots so a real run can be
  // frozen and audited; their sizes come from the Ark table.
  if (ARK_IMAGE_MODELS.some(entry => entry.id === model)) {
    const arkSizes = ARK_IMAGE_MODELS.find(entry => entry.id === model)!.sizes;
    if (!arkSizes.includes(String(raw.size))) throw new Error('Unsupported Ark size.');
    if (raw.variants !== 1) throw new Error('Only one variant is supported.');
    return { model: model as GenerationSettings['model'], size: String(raw.size), variants: 1 };
  }
  // Slice 1.3: real video models are accepted so a video run can be frozen.
  if (ARK_VIDEO_MODELS.some(entry => entry.id === model)) {
    const videoSizes = ARK_VIDEO_MODELS.find(entry => entry.id === model)!.sizes;
    if (!videoSizes.includes(String(raw.size))) throw new Error('Unsupported video shape.');
    if (raw.variants !== 1) throw new Error('Only one variant is supported.');
    return { model: model as GenerationSettings['model'], size: String(raw.size), variants: 1 };
  }
  // Slice 1.4: real speech models are accepted so an audio run can be frozen.
  if (SPEECH_MODELS.some(entry => entry.id === model)) {
    const speechSizes = SPEECH_MODELS.find(entry => entry.id === model)!.sizes;
    if (!speechSizes.includes(String(raw.size))) throw new Error('Unsupported speech format.');
    if (raw.variants !== 1) throw new Error('Only one variant is supported.');
    return { model: model as GenerationSettings['model'], size: String(raw.size), variants: 1 };
  }
  if (!(MOCK_MODELS as readonly string[]).includes(model)) throw new Error('Unsupported mock model.');
  const sizes = MOCK_SIZES[model as MockModel];
  if (!sizes.includes(String(raw.size))) throw new Error('Unsupported mock size.');
  if (raw.variants !== 1) throw new Error('Only one variant is supported.');
  return { model: model as MockModel, size: String(raw.size), variants: 1 };
}

function strictRole(value: unknown): ReferenceRole {
  const key = String(value);
  if (!(REFERENCE_ROLES as readonly string[]).includes(key)) throw new Error('Invalid reference role.');
  return key as ReferenceRole;
}
import { isAssetPath } from './assets.ts';

const assetPattern = /^\/fixtures\/study-(0[1-9]|[12]\d|30)\.png$/;
/** Bundled fixture images and locally added assets (M19) are the only sources. */
const isAssetSource = (path: string) => assetPattern.test(path) || isAssetPath(path);
/** Exported for tests: real provider paths (`ark:`) are never canvas sources. */
export const isCanvasAssetSource = isAssetSource;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid project object.');
  return value as Record<string, unknown>;
}
function string(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 100_000) throw new Error('Invalid string field.');
}
function integer(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid revision.');
}
function reference(value: unknown) {
  const ref = object(value); string(ref.nodeId); normalizeRole(ref.role);
  return ref;
}

/** Legacy projects used a single `generation` kind and a mandatory image asset. */
export function migrateProject(value: unknown): Record<string, unknown> {
  const project = object(value);
  const version = Number(project.schemaVersion ?? 1);
  if (version >= SCHEMA_VERSION) return project;
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  return { ...project, schemaVersion: SCHEMA_VERSION,
    nodes: nodes.map((item) => {
      const node = object(item);
      if (node.kind === 'generation') {
        const rest = { ...node } as Record<string, unknown>;
        delete rest.kind;
        return { ...rest, kind: 'image',
          prompt: typeof rest.prompt === 'string' ? rest.prompt : '',
          references: Array.isArray(rest.references) ? rest.references : [] };
      }
      if (isMediaKind(String(node.kind))) {
        const path = typeof node.assetPath === 'string' ? node.assetPath : undefined;
        const source = path
          ? (node.assetSource ?? (path.startsWith('/fixtures/') ? 'fixture' : path.startsWith('asset:') ? 'asset' : isSimulatedPath(path) ? 'simulated' : undefined))
          : undefined;
        return { ...node,
          prompt: typeof node.prompt === 'string' ? node.prompt : '',
          references: Array.isArray(node.references) ? node.references : [],
          ...(source ? { assetSource: source } : {}) };
      }
      return node;
    }) };
}

export function validateProject(value: unknown): Project {
  const project = migrateProject(value);
  const version = Number(project.schemaVersion);
  if (![1, 2, 3, 4].includes(version)) throw new Error('Unsupported schema version.');
  if (version !== SCHEMA_VERSION) throw new Error('Unsupported schema version.');
  if (project.mediaVersion !== undefined && project.mediaVersion !== 1) throw new Error('Unsupported media version.');
  string(project.id); string(project.name); integer(project.revision);
  if (project.credits !== undefined) {
    if (typeof project.credits !== 'number' || !Number.isInteger(project.credits) || project.credits < 0) throw new Error('Invalid credits.');
  }
  if (project.updatedAt !== undefined) {
    string(project.updatedAt);
    if (!Number.isFinite(Date.parse(project.updatedAt))) throw new Error('Invalid project timestamp.');
  }
  if (!Array.isArray(project.nodes) || project.nodes.length > 1000 || !Array.isArray(project.edges) || project.edges.length > 5000 || !Array.isArray(project.snapshots) || project.snapshots.length > 1000) throw new Error('Invalid project collections.');
  const view = object(project.viewport);
  if (![view.x, view.y, view.zoom].every(v => typeof v === 'number' && Number.isFinite(v)) || Number(view.zoom) < 0.1 || Number(view.zoom) > 4) throw new Error('Invalid viewport.');
  const ids = new Set<string>();
  for (const item of project.nodes) {
    const node = object(item); string(node.id); string(node.title); integer(node.revision);
    if (!node.id || ids.has(node.id)) throw new Error('Invalid or duplicate node ID.');
    ids.add(node.id);
    const position = object(node.position);
    if (![position.x, position.y].every(v => typeof v === 'number' && Number.isFinite(v))) throw new Error('Invalid position.');
    if (node.kind === 'text') string(node.text);
    else if (node.kind === 'scene') { /* placeholder node: no payload yet */ }
    else if (isMediaKind(String(node.kind))) {
      string(node.prompt);
      if (!Array.isArray(node.references)) throw new Error('Invalid references.');
      node.references.forEach(reference);
      if (node.settings !== undefined) settings(node.settings);
      if (node.assetPath !== undefined) {
        string(node.assetPath);
        if (!isAssetSource(node.assetPath) && !isSimulatedPath(node.assetPath)) throw new Error('Invalid asset source.');
      }
      if (node.assetSource !== undefined && !['fixture', 'asset', 'simulated'].includes(String(node.assetSource))) throw new Error('Invalid asset source kind.');
      if (node.posterPath !== undefined) string(node.posterPath);
    } else throw new Error('Unsupported node kind.');
  }
  const typed = project as unknown as Project;
  const edgeIds = new Set<string>();
  const nodeById = new Map(typed.nodes.map(node => [node.id, node]));
  const connections = new Map<string, Set<string>>();
  for (const item of project.edges) {
    const edge = object(item); string(edge.id); string(edge.source); string(edge.target);
    if (!edge.id || edgeIds.has(edge.id)) throw new Error('Invalid or duplicate edge ID.');
    edgeIds.add(edge.id);
    if (edge.source === edge.target) throw new Error('A self edge is not allowed.');
    const from = nodeById.get(edge.source); const to = nodeById.get(edge.target);
    if (!from || !to || from.kind === 'scene' || !isMediaKind(to.kind)) throw new Error('Nodes are not compatible.');
    const sources = connections.get(edge.target) ?? new Set<string>();
    if (sources.has(edge.source)) throw new Error('A duplicate edge is not allowed.');
    sources.add(edge.source); connections.set(edge.target, sources);
  }
  for (const node of typed.nodes) if (isMediaNode(node)) {
    const seen = new Set<string>();
    for (const ref of node.references) {
      if (seen.has(ref.nodeId)) throw new Error('A duplicate reference is not allowed.');
      if (!connections.get(node.id)?.has(ref.nodeId)) throw new Error('Input is not a connected candidate.');
      seen.add(ref.nodeId);
    }
  }
  const snapshotIds = new Set<string>();
  for (const item of project.snapshots) {
    const snap = object(item);
    if (snap.mode !== 'inspection-only' || !Array.isArray(snap.inputs) || !snap.inputs.length) throw new Error('Invalid snapshot.');
    string(snap.id); string(snap.targetNodeId); string(snap.prompt); string(snap.createdAt);
    if (snap.settings !== undefined) settings(snap.settings);
    if (!snap.id || snapshotIds.has(snap.id)) throw new Error('Invalid or duplicate snapshot ID.');
    snapshotIds.add(snap.id);
    if (!isMediaKind(String(typed.nodes.find(node => node.id === snap.targetNodeId)?.kind))) throw new Error('Invalid snapshot target.');
    if (!Number.isFinite(Date.parse(snap.createdAt))) throw new Error('Invalid snapshot timestamp.');
    const seen = new Set<string>();
    for (const input of snap.inputs) {
      const ref = reference(input); integer(ref.revision);
      if (seen.has(String(ref.nodeId))) throw new Error('Invalid duplicate snapshot input.');
      seen.add(String(ref.nodeId));
      if (ref.kind === 'text') string(ref.text);
      else if (['image', 'video', 'audio'].includes(String(ref.kind))) {
        string(ref.assetPath);
        if (ref.assetPath !== '' && !isAssetSource(ref.assetPath) && !isSimulatedPath(String(ref.assetPath))) throw new Error('Invalid snapshot asset.');
      } else throw new Error('Invalid snapshot input kind.');
    }
  }
  const copy = structuredClone(typed);
  if (copy.credits === undefined) copy.credits = DEFAULT_CREDITS;
  // Normalise legacy roles on the clone: live snapshots are frozen and must not be mutated.
  for (const node of copy.nodes) if (isMediaNode(node)) {
    node.references = node.references.map(ref => ({ nodeId: ref.nodeId, role: normalizeRole(ref.role) }));
  }
  for (const snapshot of copy.snapshots) for (const input of snapshot.inputs) {
    (input as { role: ReferenceRole }).role = normalizeRole(input.role);
  }
  // IndexedDB structured cloning removes frozen descriptors; restore that boundary.
  for (const snapshot of copy.snapshots) {
    snapshot.inputs.forEach(Object.freeze);
    Object.freeze(snapshot.inputs); Object.freeze(snapshot);
  }
  return copy;
}

export function benchmarkProject(count = 300): Project {
  const project = demoProject();
  project.id = `benchmark-${count}`; project.name = `${count} nodes / ${count === 300 ? 500 : 1600} edges`;
  project.nodes = Array.from({ length: count }, (_, index): ProjectNode => {
    const base = { id: `node-${index}`, title: `Study ${index + 1}`, revision: 1, position: { x: (index % 20) * 310, y: Math.floor(index / 20) * 230 } };
    if (index < 30) return { ...base, kind: 'image', assetPath: `/fixtures/study-${String(index + 1).padStart(2, '0')}.png`, assetSource: 'fixture', prompt: '', references: [] };
    if (index < count / 2) return { ...base, kind: 'text', text: `Original benchmark note ${index}.` };
    return { ...base, kind: 'image', prompt: 'Inspection only.', references: [] };
  });
  const half = Math.floor(count / 2);
  project.edges = Array.from({ length: count === 300 ? 500 : 1600 }, (_, index) => ({
    id: `edge-${index}`, source: `node-${index % half}`, target: `node-${half + (Math.floor(index / half) + index) % (count - half)}`,
  }));
  project.snapshots = []; project.viewport = { x: 20, y: 20, zoom: 0.3 };
  return project;
}

function reaches(edges: readonly ReferenceEdge[], from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === to) return true;
    for (const edge of edges) {
      if (edge.source === current && !seen.has(edge.target)) { seen.add(edge.target); queue.push(edge.target); }
    }
  }
  return false;
}

const defaultTitles: Record<NodeKind, string> = { text: 'New text', image: 'New image', video: 'New video', audio: 'New audio', scene: 'New 3D scene' };

export function addNode(project: Project, kind: NodeKind, options: {
  id?: string; title?: string; position?: { x: number; y: number }; assetPath?: string;
} = {}): Project {
  if (!NODE_KINDS.includes(kind)) throw new Error('Unsupported node kind.');
  const id = options.id ?? `${kind}-${crypto.randomUUID()}`;
  if (project.nodes.some(node => node.id === id)) throw new Error('A duplicate node ID is not allowed.');
  const base = { id, title: options.title ?? defaultTitles[kind], revision: 0,
    position: options.position ?? { x: 60 + (project.nodes.length % 4) * 300, y: 60 + Math.floor(project.nodes.length / 4) * 220 } };
  let node: ProjectNode;
  if (kind === 'text') node = { ...base, kind: 'text', text: '' };
  else if (kind === 'scene') node = { ...base, kind: 'scene' };
  else {
    // Media nodes are born empty: no asset until an upload or a simulated run.
    const node_: MediaNode = { ...base, kind, prompt: '', references: [] };
    if (options.assetPath !== undefined) {
      if (!isAssetSource(options.assetPath) && !isSimulatedPath(options.assetPath)) throw new Error('Choose a bundled fixture image or a local asset.');
      node_.assetPath = options.assetPath;
      node_.assetSource = options.assetPath.startsWith('/fixtures/') ? 'fixture' : options.assetPath.startsWith('asset:') ? 'asset' : 'simulated';
    }
    node = node_;
  }
  return { ...project, nodes: [...project.nodes, node] };
}

export function removeNode(project: Project, nodeId: string): Project {
  if (!project.nodes.some(node => node.id === nodeId)) throw new Error('Unknown node.');
  const nodes = project.nodes.filter(node => node.id !== nodeId).map((node): ProjectNode => {
    if (!isMediaNode(node)) return node;
    const references = node.references.filter(reference => reference.nodeId !== nodeId);
    return references.length === node.references.length ? node : { ...node, references, revision: node.revision + 1 };
  });
  return { ...project, nodes, edges: project.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId) };
}

export function removeReferenceEdge(project: Project, edgeId: string): Project {
  const edge = project.edges.find(candidate => candidate.id === edgeId);
  if (!edge) throw new Error('Unknown candidate edge.');
  const nodes = project.nodes.map((node): ProjectNode => {
    if (!isMediaNode(node) || node.id !== edge.target) return node;
    const references = node.references.filter(reference => reference.nodeId !== edge.source);
    return references.length === node.references.length ? node : { ...node, references, revision: node.revision + 1 };
  });
  return { ...project, edges: project.edges.filter(candidate => candidate.id !== edgeId), nodes };
}

export function mediaNode(project: Project, nodeId: string): MediaNode {
  const node = project.nodes.find(candidate => candidate.id === nodeId);
  if (!node || !isMediaNode(node)) throw new Error('Choose a media node.');
  return node;
}
function inputDraft(project: Project, draftId: string): MediaNode {
  return mediaNode(project, draftId);
}

function candidateSource(project: Project, draftId: string, sourceId: string): ProjectNode {
  if (!project.edges.some(edge => edge.source === sourceId && edge.target === draftId)) throw new Error('Input is not a connected candidate.');
  const node = project.nodes.find(item => item.id === sourceId);
  if (!node || node.kind === 'scene') throw new Error('Input type is not compatible.');
  return node;
}

function withReferences(project: Project, draftId: string, references: Reference[]): Project {
  return { ...project,
    nodes: project.nodes.map((node): ProjectNode => node.id === draftId && isMediaNode(node)
      ? { ...node, references, revision: node.revision + 1 }
      : node) };
}

/** A reference is a prompt-level input. It must already be a candidate edge. */
export function addReference(project: Project, draftId: string, sourceId: string, role?: ReferenceRole): Project {
  const draft = inputDraft(project, draftId);
  const source = candidateSource(project, draftId, sourceId);
  if (draft.references.some(ref => ref.nodeId === sourceId)) throw new Error('A duplicate reference is not allowed.');
  const next = role === undefined ? (isMediaKind(source.kind) ? 'first-frame' : 'reference') : strictRole(role);
  return withReferences(project, draftId, [...draft.references, { nodeId: sourceId, role: next }]);
}

/** Role labels are a FlowForge design choice; they are not a field from the target product. */
export function setReferenceRole(project: Project, draftId: string, sourceId: string, role: ReferenceRole): Project {
  const draft = inputDraft(project, draftId);
  if (!draft.references.some(ref => ref.nodeId === sourceId)) throw new Error('Unknown reference.');
  const next = strictRole(role);
  return withReferences(project, draftId, draft.references.map(ref => ref.nodeId === sourceId ? { ...ref, role: next } : ref));
}

/** Removes the prompt-level reference only; edges and node content stay intact. */
export function removeReference(project: Project, draftId: string, sourceId: string): Project {
  const draft = inputDraft(project, draftId);
  const references = draft.references.filter(ref => ref.nodeId !== sourceId);
  if (references.length === draft.references.length) throw new Error('Unknown reference.');
  return withReferences(project, draftId, references);
}

/** Form edits bump the draft revision; snapshots and earlier runs are untouched. */
export function setDraftSettings(project: Project, draftId: string, patch: Partial<GenerationSettings>): Project {
  const draft = inputDraft(project, draftId);
  const next = settings({ ...settingsOf(draft), ...patch });
  return { ...project,
    nodes: project.nodes.map((node): ProjectNode => node.id === draftId && isMediaNode(node)
      ? { ...node, settings: next, revision: node.revision + 1 }
      : node) };
}

/** Copy keeps the source untouched and hands the duplicate a fresh id. */
export function duplicateNode(project: Project, nodeId: string): Project {
  const source = project.nodes.find(node => node.id === nodeId);
  if (!source) throw new Error('Choose a node to duplicate.');
  const copy = { ...structuredClone(source), id: `${source.kind}-${crypto.randomUUID().slice(0, 8)}`,
    title: `${source.title} copy`, revision: 1,
    position: { x: source.position.x + 40, y: source.position.y + 40 } } as ProjectNode;
  return { ...project, nodes: [...project.nodes, copy] };
}

/**
 * Writes a simulated run result into the node itself, so the card renders the
 * result in place (target behaviour observed 2026-10-22). Nothing leaves the
 * browser and the path is a local marker, never a provider artifact.
 */
export function applySimulatedResult(project: Project, nodeId: string, resultId: string): Project {
  const node = mediaNode(project, nodeId);
  const path = `${SIMULATED_PREFIX}${resultId}`;
  return { ...project, nodes: project.nodes.map((candidate): ProjectNode => candidate.id === node.id
    ? { ...candidate, assetPath: path, assetSource: 'simulated', revision: candidate.revision + 1 } as MediaNode
    : candidate) };
}

/** Drops a simulated result (used when a node is reset to an empty draft). */
export function clearSimulatedResult(project: Project, nodeId: string): Project {
  const node = mediaNode(project, nodeId);
  if (!node.assetPath || !isSimulatedPath(node.assetPath)) return project;
  return { ...project, nodes: project.nodes.map((candidate): ProjectNode => candidate.id === node.id
    ? { ...candidate, assetPath: undefined, assetSource: undefined, revision: candidate.revision + 1 } as MediaNode
    : candidate) };
}

/** Sets an uploaded or bundled asset on a media node. */
export function setNodeAsset(project: Project, nodeId: string, assetPath: string): Project {
  const node = mediaNode(project, nodeId);
  if (!isAssetSource(assetPath) && !isSimulatedPath(assetPath)) throw new Error('Choose a bundled fixture image or a local asset.');
  const assetSource = assetPath.startsWith('/fixtures/') ? 'fixture' : assetPath.startsWith('asset:') ? 'asset' : 'simulated';
  return { ...project, nodes: project.nodes.map((candidate): ProjectNode => candidate.id === node.id
    ? { ...candidate, assetPath, assetSource, revision: candidate.revision + 1 } as MediaNode
    : candidate) };
}

/**
 * Slice 1.4-text: writes a real answer into the node content and records the
 * prompt it answered plus token usage. The node keeps `kind: 'text'`, so no
 * media field is invented.
 */
export function applyTextResult(
  project: Project,
  nodeId: string,
  text: string,
  meta: { model: string; promptTokens: number; completionTokens: number; mode?: 'real' | 'simulated' },
): Project {
  const node = project.nodes.find(candidate => candidate.id === nodeId);
  if (!node || node.kind !== 'text') throw new Error('Real text results only apply to text nodes.');
  if (!text.trim()) throw new Error('A real text result cannot be empty.');
  // The prompt is whatever the node said before the answer replaced it, captured here
  // so the input is never lost when a real result overwrites the content.
  const textMeta = Object.freeze({ mode: meta.mode ?? ('real' as const), model: meta.model, recordedAt: new Date().toISOString(),
    prompt: (node as TextNode).text, promptTokens: meta.promptTokens, completionTokens: meta.completionTokens });
  return { ...project, nodes: project.nodes.map(candidate => candidate.id === nodeId
    ? { ...candidate, text, textMeta, revision: candidate.revision + 1 } as ProjectNode
    : candidate) };
}

import { isMediaNode, type MediaNode, type Project, type ProjectNode } from './project.ts';

/** A timeline is an ordered list of clips; merging only ever writes a simulated cut. */
export type Clip = Readonly<{ nodeId: string; start: number; end: number }>;
export type Timeline = Readonly<{ clips: readonly Clip[]; targetNodeId?: string }>;

const DEFAULT_RANGE = 5;
export const MAX_SECONDS = 60;
const MAX_RANGE = MAX_SECONDS;

export function createTimeline(project: Project): Timeline {
  const clips = project.nodes
    .filter((node): node is MediaNode => isMediaNode(node) && Boolean(node.assetPath))
    .map(node => ({ nodeId: node.id, start: 0, end: DEFAULT_RANGE }));
  if (clips.length < 2) throw new Error('时间线至少需要 2 段素材。');
  return { clips };
}

export function setClipRange(timeline: Timeline, nodeId: string, start: number, end: number): Timeline {
  const index = timeline.clips.findIndex(clip => clip.nodeId === nodeId);
  if (index < 0) throw new Error('这段素材不在时间线里。');
  if (![start, end].every(value => Number.isFinite(value)) || start < 0 || end <= start) {
    throw new Error('请在素材范围内选择正区间。');
  }
  if (end > MAX_RANGE) throw new Error(`每段素材请控制在 ${MAX_RANGE} 秒以内。`);
  return { ...timeline, clips: timeline.clips.map((clip, position) => position === index ? { ...clip, start, end } : clip) };
}

export const durationOf = (timeline: Timeline): number =>
  timeline.clips.reduce((total, clip) => total + (clip.end - clip.start), 0);

export function aimAt(timeline: Timeline, nodeId: string): Timeline {
  if (!timeline.clips.some(clip => clip.nodeId === nodeId)) throw new Error('这段素材不在时间线里。');
  return { ...timeline, targetNodeId: nodeId };
}

export function mergeTimeline(project: Project, timeline: Timeline, runId = crypto.randomUUID().slice(0, 8)): Project {
  if (!timeline.clips.length) throw new Error('合并前至少需要一段素材。');
  const targetId = timeline.targetNodeId
    ?? project.nodes.find((node): node is MediaNode => isMediaNode(node) && node.kind === 'video')?.id
    ?? null;
  const path = `simulated:timeline/${runId}`;
  if (!targetId) {
    const node: ProjectNode = { id: `video-${crypto.randomUUID().slice(0, 8)}`, title: 'Timeline cut', kind: 'video',
      revision: 1, position: { x: 120, y: 640 }, assetPath: path, assetSource: 'simulated', prompt: 'Merged timeline', references: [] };
    return { ...project, nodes: [...project.nodes, node] };
  }
  return { ...project, nodes: project.nodes.map(node => node.id === targetId && isMediaNode(node)
    ? { ...node, assetPath: path, assetSource: 'simulated', prompt: node.prompt || 'Merged timeline', revision: node.revision + 1 }
    : node) };
}

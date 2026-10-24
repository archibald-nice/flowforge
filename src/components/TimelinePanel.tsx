import type { Dispatch, SetStateAction } from 'react';
import { MAX_SECONDS, aimAt, durationOf, setClipRange, type Timeline } from '../domain/timeline.ts';
import type { Project } from '../domain/project.ts';

export interface TimelinePanelProps {
  timeline: Timeline;
  setTimeline: Dispatch<SetStateAction<Timeline | null>>;
  mergeCut: () => void;
  project: Project;
}

/** Simulated cutting room: in/out points per clip, merge back to canvas. No
 * provider call; the merged result stays a local simulated asset. */
export function TimelinePanel({ timeline, setTimeline, mergeCut, project }: TimelinePanelProps) {
  return <section className="timeline-panel" data-testid="timeline-panel">
    <header><span className="eyebrow">时间线 · 模拟剪辑</span><output data-testid="timeline-duration">{durationOf(timeline)} s</output></header>
    <ul>{timeline.clips.map(clip => <li key={clip.nodeId} data-testid={`clip-${clip.nodeId}`}>
      <strong>{project.nodes.find(node => node.id === clip.nodeId)?.title}</strong>
      <div className="timeline-strip" aria-hidden="true" />
      <label>入点<input type="number" min={0} max={MAX_SECONDS} value={clip.start} aria-label={`In ${clip.nodeId}`} onChange={event => setTimeline(setClipRange(timeline, clip.nodeId, Number(event.target.value), clip.end))} /></label>
      <label>出点<input type="number" min={0} max={MAX_SECONDS} value={clip.end} aria-label={`Out ${clip.nodeId}`} onChange={event => setTimeline(setClipRange(timeline, clip.nodeId, clip.start, Number(event.target.value)))} /></label>
      <button className="linkish" aria-pressed={timeline.targetNodeId === clip.nodeId} onClick={() => setTimeline(aimAt(timeline, clip.nodeId))}>在此剪切</button>
    </li>)}</ul>
    <footer><button className="primary" data-testid="timeline-merge" onClick={mergeCut}>合并回画布</button>
      <button className="linkish" onClick={() => setTimeline(null)}>关闭时间线</button></footer>
  </section>;
}

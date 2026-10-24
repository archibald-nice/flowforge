import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aimAt, createTimeline, durationOf, MAX_SECONDS, mergeTimeline, setClipRange } from '../../src/domain/timeline.ts';
import { addNode, demoProject, isMediaNode } from '../../src/domain/project.ts';

function withClips() {
  let project = demoProject();
  project = addNode(project, 'video', { id: 'clip-a', assetPath: '/fixtures/study-02.png', position: { x: 0, y: 700 } });
  project = addNode(project, 'image', { id: 'clip-b', assetPath: '/fixtures/study-02.png', position: { x: 300, y: 700 } });
  return project;
}

test('2.4: a timeline needs at least two clips and starts with a 5 s range', () => {
  assert.throws(() => createTimeline(demoProject()), /至少需要 2 段/);
  const timeline = createTimeline(withClips());
  assert.ok(timeline.clips.length >= 2);
  assert.deepEqual(timeline.clips.find(clip => clip.nodeId === 'clip-a'), { nodeId: 'clip-a', start: 0, end: 5 });
  assert.equal(durationOf(timeline), timeline.clips.length * 5);
});

test('2.4: clip ranges are validated and durations follow', () => {
  const timeline = createTimeline(withClips());
  const trimmed = setClipRange(timeline, 'clip-a', 1, 4);
  assert.equal(durationOf(trimmed), durationOf(timeline) - 2);
  assert.throws(() => setClipRange(timeline, 'clip-a', 4, 4), /正区间/);
  assert.throws(() => setClipRange(timeline, 'clip-a', -1, 3), /正区间/);
  assert.throws(() => setClipRange(timeline, 'clip-a', 0, MAX_SECONDS + 1), /60 秒以内/);
  assert.throws(() => setClipRange(timeline, 'missing', 0, 2), /不在时间线里/);
});

test('2.4: merging writes a simulated video into the target node', () => {
  const project = withClips();
  const timeline = aimAt(createTimeline(project), 'clip-a');
  const beforeRevision = (project.nodes.find(node => node.id === 'clip-a') as { revision: number }).revision;
  const merged = mergeTimeline(project, timeline, 'run-9');
  const target = merged.nodes.find(node => node.id === 'clip-a')!;
  assert.ok(isMediaNode(target));
  if (!isMediaNode(target)) throw new Error('fixture');
  assert.equal(target.kind, 'video');
  assert.equal(target.assetPath, 'simulated:timeline/run-9');
  assert.equal(target.assetSource, 'simulated');
  assert.equal(target.revision, beforeRevision + 1);
  assert.equal(merged.nodes.length, project.nodes.length);
});

test('2.4: merging reuses an existing video node, or creates one when none exists', () => {
  const project = withClips();
  const reused = mergeTimeline(project, createTimeline(project), 'run-10');
  assert.equal(reused.nodes.length, project.nodes.length, 'an existing video node is reused');
  const withoutVideo = addNode(demoProject(), 'image', { id: 'still-a', assetPath: '/fixtures/study-02.png' });
  const created = mergeTimeline(withoutVideo, createTimeline(withoutVideo), 'run-11');
  assert.equal(created.nodes.length, withoutVideo.nodes.length + 1);
  const added = created.nodes[created.nodes.length - 1];
  assert.equal(added.kind, 'video');
  if (!isMediaNode(added)) throw new Error('fixture');
  assert.equal(added.assetPath, 'simulated:timeline/run-11');
  assert.throws(() => mergeTimeline(project, { clips: [] }), /至少需要一段素材/);
});

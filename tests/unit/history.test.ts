import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addNode, addReferenceEdge, demoProject, duplicateNode, removeNode, type Project } from '../../src/domain/project.ts';
import { breakRun, createHistory, depth, HISTORY_LIMIT, record, redo, undo } from '../../src/domain/history.ts';
import { providerCallCount, resetProviderCalls, withoutProviderCalls } from '../../src/providers/mock-provider.ts';

const moved = (project: Project, id: string, dx: number): Project => ({
  ...project,
  nodes: project.nodes.map(node => node.id === id ? { ...node, position: { x: node.position.x + dx, y: node.position.y } } : node),
});

test('M14: each command type undoes and redoes', () => {
  resetProviderCalls();
  const history = createHistory();

  // create
  let project = demoProject();
  const created = withoutProviderCalls('create', () => addNode(project, 'text'));
  record(history, project, { kind: 'create' }); project = created;
  assert.equal(project.nodes.length, 5);
  project = undo(history, project)!;
  assert.equal(project.nodes.length, 4);
  project = redo(history, project)!;
  assert.equal(project.nodes.length, 5);

  // edit
  const edited = { ...project, nodes: project.nodes.map(node => node.id === 'brief' ? { ...node, title: 'Edited' } : node) };
  record(history, project, { kind: 'edit', key: 'text:brief' }); project = edited;
  project = undo(history, project)!;
  assert.equal(project.nodes.find(node => node.id === 'brief')?.title, '01 / Creative brief');
  project = redo(history, project)!;
  assert.equal(project.nodes.find(node => node.id === 'brief')?.title, 'Edited');

  // edge
  const linked = withoutProviderCalls('edge', () => addReferenceEdge(project, 'other', 'draft'));
  record(history, project, { kind: 'edge' }); project = linked;
  assert.equal(project.edges.length, 3);
  project = undo(history, project)!;
  assert.equal(project.edges.length, 2);
  project = redo(history, project)!;
  assert.equal(project.edges.length, 3);

  // delete
  const removed = withoutProviderCalls('delete', () => removeNode(project, 'other'));
  record(history, project, { kind: 'delete' }); project = removed;
  project = undo(history, project)!;
  assert.ok(project.nodes.some(node => node.id === 'other'));
  project = redo(history, project)!;
  assert.ok(!project.nodes.some(node => node.id === 'other'));

  assert.equal(providerCallCount(), 0);
});

test('M14: copy remaps the id and undo keeps the source intact', () => {
  const history = createHistory();
  const project = demoProject();
  const copied = withoutProviderCalls('copy', () => duplicateNode(project, 'brief'));
  const duplicate = copied.nodes[copied.nodes.length - 1];
  assert.notEqual(duplicate.id, 'brief');
  assert.equal(duplicate.title, '01 / Creative brief copy');
  assert.equal(duplicate.revision, 1);
  record(history, project, { kind: 'copy', key: duplicate.id });
  const undone = undo(history, copied)!;
  assert.equal(undone.nodes.length, project.nodes.length);
  assert.ok(undone.nodes.some(node => node.id === 'brief'));
  assert.ok(!undone.nodes.some(node => node.id === duplicate.id));
  const redone = redo(history, undone)!;
  assert.ok(redone.nodes.some(node => node.id === duplicate.id));
});

test('M14: one drag is one history step', () => {
  const history = createHistory();
  const project = demoProject();
  record(history, project, { kind: 'move' }, 1000);
  let current = moved(project, 'brief', 10);
  for (let step = 1; step <= 8; step++) {
    record(history, current, { kind: 'move' }, 1000 + step * 40);
    current = moved(current, 'brief', 10);
  }
  assert.deepEqual(depth(history), { back: 1, forward: 0 });
  const restored = undo(history, current)!;
  assert.deepEqual(restored.nodes.find(node => node.id === 'brief')?.position, project.nodes.find(node => node.id === 'brief')?.position);
});

test('M14: a second drag after breakRun records a new step', () => {
  const history = createHistory();
  let project = demoProject();
  record(history, project, { kind: 'move' }, 2000);
  project = moved(project, 'brief', 10);
  breakRun(history);
  record(history, project, { kind: 'move' }, 2050);
  project = moved(project, 'brief', 10);
  assert.equal(depth(history).back, 2);
});

test('M14: consecutive keystrokes in one field coalesce, another field does not', () => {
  const history = createHistory();
  let project = demoProject();
  for (let key = 0; key < 5; key++) {
    record(history, project, { kind: 'edit', key: 'text:brief:text' }, 3000 + key * 60);
    project = { ...project, nodes: project.nodes.map(node => node.id === 'brief' && node.kind === 'text' ? { ...node, text: `${node.text}x` } : node) };
  }
  assert.equal(depth(history).back, 1);
  record(history, project, { kind: 'edit', key: 'text:draft:prompt' }, 3400);
  assert.equal(depth(history).back, 2);
});

test('M14: the stack keeps at least the designed 50 steps', () => {
  const history = createHistory();
  let project = demoProject();
  for (let step = 0; step < HISTORY_LIMIT + 20; step++) {
    record(history, project, { kind: 'create' }, 10_000 + step);
    project = { ...project, nodes: [...project.nodes, { ...project.nodes[0], id: `node-${step}` }] };
  }
  assert.equal(depth(history).back, HISTORY_LIMIT);
  assert.ok(HISTORY_LIMIT >= 50);
  let undone = 0;
  while (undo(history, project)) { undone++; }
  assert.equal(undone, HISTORY_LIMIT);
  assert.equal(depth(history).forward, HISTORY_LIMIT);
});

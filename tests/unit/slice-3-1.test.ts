import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPlan } from '../../src/domain/agent-plan.ts';
import { addNode, demoProject } from '../../src/domain/project.ts';

test('3.1: a composer message without context asks for a node instead of guessing', () => {
  const plan = buildPlan(demoProject(), null, '生成一张产品图');
  assert.equal(plan.kind, 'decline');
  assert.equal(plan.estimate, 0);
  assert.match(plan.steps[0].detail, /点选一个节点/);
  assert.throws(() => buildPlan(demoProject(), null, '   '), /消息/);
});

test('3.1: a text node becomes a reference step with no cost', () => {
  const plan = buildPlan(demoProject(), 'brief', '用它生成');
  assert.equal(plan.kind, 'reference');
  assert.equal(plan.estimate, 0);
  assert.equal(plan.targetNodeId, 'brief');
});

test('3.1: a media node with a generate verb carries the local price as an estimate', () => {
  const project = addNode(demoProject(), 'image', { id: 'still' });
  const plan = buildPlan(project, 'still', '帮我生成一张 1:1 的图');
  assert.equal(plan.kind, 'generate');
  assert.equal(plan.estimate, 5);
  assert.equal(plan.steps.length, 2);
  const quiet = buildPlan(project, 'still', '只是整理一下');
  assert.equal(quiet.estimate, 0);
  assert.throws(() => buildPlan(project, 'missing', '生成'), /不在当前画布/);
});

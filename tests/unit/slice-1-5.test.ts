import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CREDITS, PLANS, priceFor, priceTable, spendCredits, topUp, walletOf } from '../../src/domain/pricing.ts';
import { demoProject, validateProject } from '../../src/domain/project.ts';

test('1.5: the local price table is deterministic per node kind', () => {
  assert.equal(priceFor('image'), 5);
  assert.equal(priceFor('video'), 30);
  assert.equal(priceFor('audio'), 10);
  assert.equal(priceFor('text'), 1);
  assert.equal(priceFor('scene'), 0);
  assert.deepEqual(Object.keys(priceTable()).sort(), ['audio', 'image', 'scene', 'text', 'video']);
});

test('1.5: a project starts with the designed wallet and spends exactly the shown price', () => {
  const project = demoProject();
  assert.equal(walletOf(project), DEFAULT_CREDITS);
  assert.equal(DEFAULT_CREDITS, 200);
  const spent = spendCredits(project, 'image');
  assert.equal(walletOf(spent), 195);
  assert.equal(spent.credits, 195);
  // Spending never touches nodes, edges or snapshots.
  assert.deepEqual(spent.nodes, project.nodes);
  assert.deepEqual(spent.snapshots, project.snapshots);
});

test('1.5: an empty wallet refuses the spend instead of going negative', () => {
  const broke = { ...demoProject(), credits: 3 };
  assert.throws(() => spendCredits(broke, 'image'), /额度不足/);
  assert.equal(walletOf(broke), 3);
});

test('1.5: topping up is simulated and keeps a stable plan list', () => {
  const project = topUp({ ...demoProject(), credits: 10 }, 500);
  assert.equal(walletOf(project), 510);
  assert.deepEqual(PLANS.map(plan => plan.id), ['starter', 'studio']);
  for (const plan of PLANS) {
    assert.ok(plan.credits > 0);
    assert.equal(plan.simulated, true);
  }
});

test('1.5: the wallet survives validation and old projects default to the designed value', () => {
  const legacy = structuredClone(demoProject()) as Record<string, unknown>;
  delete legacy.credits;
  legacy.schemaVersion = 3;
  const restored = validateProject(legacy);
  assert.equal(restored.credits, DEFAULT_CREDITS);
  const roundTrip = validateProject(structuredClone({ ...demoProject(), credits: 42 }));
  assert.equal(roundTrip.credits, 42);
  assert.throws(() => validateProject({ ...demoProject(), credits: -1 }), /credits/);
});

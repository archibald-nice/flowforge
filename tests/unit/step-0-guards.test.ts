import assert from 'node:assert/strict';
import test from 'node:test';
import { CREDITS_PER_YUAN, priceTable, priceFor, spendAmount, walletOf, yuanToCredits } from '../../src/domain/pricing.ts';
import { stillRunning } from '../../src/providers/real-provider.ts';
import { ARK_IMAGE_MODELS } from '../../src/providers/ark-provider.ts';
import { speechPrice } from '../../src/providers/speech-provider.ts';
import { createProject } from '../../src/domain/project.ts';

test('wallet unit: 1 CNY = 100 credits and real costs convert through it', () => {
  assert.equal(CREDITS_PER_YUAN, 100);
  assert.equal(yuanToCredits(0.2), 20);
  assert.equal(yuanToCredits(1), 100);
  assert.equal(yuanToCredits(1.5), 150);
  assert.equal(yuanToCredits(0.0001), 0.01);
  assert.throws(() => yuanToCredits(-1), /valid real cost/);
  // The simulated table keeps its own credits numbers, unchanged by the rate.
  assert.equal(priceFor('image'), 5);
  assert.deepEqual(priceTable(), { text: 1, image: 5, video: 30, audio: 10, scene: 0 });
});

test('wallet unit: fractional credits deductions round to 0.01 and never go negative', () => {
  const project = createProject('step-0-wallet');
  const after = spendAmount(project, 16.67);
  assert.equal(walletOf(after), Math.round((walletOf(project) - 16.67) * 100) / 100);
  assert.throws(() => spendAmount(project, Number.POSITIVE_INFINITY), /valid simulated amount/);
  assert.throws(() => spendAmount(project, walletOf(project) + 1), /模拟额度不足/);
});

test('wallet unit: real prices are expressed in credits, not CNY', () => {
  // Ark list price 0.2 CNY per image read from the console on 2026-10-22.
  assert.equal(ARK_IMAGE_MODELS[0].estimate, yuanToCredits(0.2));
  // Speech is 1 CNY per minute of original_duration.
  assert.equal(speechPrice(60), 100);
  assert.equal(speechPrice(10), 16.67);
  assert.equal(speechPrice(0), 0);
});

test('cancel race: a result is only applied while the held run is the same run and still running', () => {
  assert.equal(stillRunning({ id: 'run-1', state: 'running' }, 'run-1'), true);
  // The first tick only flips queued → running; that transition must survive the
  // guard, otherwise a real run would freeze before ever calling the provider.
  assert.equal(stillRunning({ id: 'run-1', state: 'queued' }, 'run-1'), true);
  // Canceled while the request was in flight → drop the result, no charge.
  assert.equal(stillRunning({ id: 'run-1', state: 'canceled' }, 'run-1'), false);
  // A newer run replaced the held one → the stale result must not land on it.
  assert.equal(stillRunning({ id: 'run-2', state: 'running' }, 'run-1'), false);
  // Already failed or finished locally → nothing to apply.
  assert.equal(stillRunning({ id: 'run-1', state: 'failed' }, 'run-1'), false);
  assert.equal(stillRunning({ id: 'run-1', state: 'succeeded' }, 'run-1'), false);
  assert.equal(stillRunning(null, 'run-1'), false);
});

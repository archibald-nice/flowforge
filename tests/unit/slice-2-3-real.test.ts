import assert from 'node:assert/strict';
import test from 'node:test';
import { addVariant, canSave, copyPlan, currentVariant, generateVariant, isSimulatedPath, openEditor } from '../../src/domain/editor.ts';
import { ARK_IMAGE_MODELS } from '../../src/providers/ark-provider.ts';
import { yuanToCredits } from '../../src/domain/money.ts';

// Slice 2.3-real: real variants join the same list as simulated ones, keep their
// own provenance, and cost the Ark image price converted through the single rate.

test('a real variant joins the list and becomes the current one', () => {
  const base = openEditor('image-1', 'a cobalt bottle');
  const next = addVariant(base, 'asset:abc-123');
  assert.deepEqual(next.variants, ['asset:abc-123']);
  assert.equal(next.selected, 0);
  assert.equal(currentVariant(next), 'asset:abc-123');
  assert.equal(canSave(next), true);
  assert.equal(isSimulatedPath('asset:abc-123'), false);
});

test('simulated and real variants coexist, and provenance stays distinguishable', () => {
  const withMock = generateVariant(openEditor('image-1', 'a cobalt bottle'));
  const mixed = addVariant(withMock, 'asset:def-456');
  assert.equal(mixed.variants.length, 2);
  assert.equal(isSimulatedPath(mixed.variants[0]), true);
  assert.equal(isSimulatedPath(mixed.variants[1]), false);
  assert.equal(mixed.selected, 1);
  assert.deepEqual(copyPlan(mixed), { nodeId: 'image-1', variant: 'asset:def-456' });
});

test('a real variant is rejected when it is empty or already listed', () => {
  const base = openEditor('image-1', 'x');
  assert.throws(() => addVariant(base, '   '), /本地素材路径/u);
  const once = addVariant(base, 'asset:abc-123');
  assert.throws(() => addVariant(once, 'asset:abc-123'), /已经在列表里/u);
});

test('the real image price is the Ark list price converted at 1 CNY = 100 credits', () => {
  assert.equal(ARK_IMAGE_MODELS.length, 1);
  assert.equal(ARK_IMAGE_MODELS[0].estimate, yuanToCredits(0.2));
  assert.equal(ARK_IMAGE_MODELS[0].estimate, 20);
});

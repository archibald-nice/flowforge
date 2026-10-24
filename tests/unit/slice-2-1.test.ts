import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASSET_CATEGORIES, CATEGORY_LABELS, DEFAULT_FILTER, categoryOf, filterAssets } from '../../src/domain/asset-library.ts';
import type { StoredAsset } from '../../src/persistence/project-store.ts';

const asset = (name: string, patch: Partial<StoredAsset> = {}): StoredAsset => ({
  path: `asset:${name}`, name, type: 'image/png', size: 10, blob: new Blob(['x']), createdAt: '2026-10-22T00:00:00.000Z', ...patch,
});

test('2.1: six designed categories with Chinese labels', () => {
  assert.deepEqual([...ASSET_CATEGORIES], ['character', 'scene', 'prop', 'style', 'sound', 'other']);
  assert.equal(CATEGORY_LABELS.character, '角色');
  assert.equal(categoryOf(asset('a.png')), 'other');
  assert.equal(categoryOf(asset('a.png', { category: 'prop' })), 'prop');
});

test('2.1: filters combine tab, category and query', () => {
  const assets = [
    asset('bottle.png', { category: 'prop', favorite: true }),
    asset('stage.png', { category: 'scene' }),
    asset('bottle-wide.png', { category: 'scene', favorite: true }),
  ];
  assert.equal(filterAssets(assets, DEFAULT_FILTER).length, 3);
  assert.equal(filterAssets(assets, { ...DEFAULT_FILTER, tab: 'favorites' }).length, 2);
  assert.equal(filterAssets(assets, { ...DEFAULT_FILTER, category: 'scene' }).length, 2);
  assert.deepEqual(filterAssets(assets, { ...DEFAULT_FILTER, query: 'BOTTLE' }).map(item => item.name), ['bottle.png', 'bottle-wide.png']);
  assert.deepEqual(filterAssets(assets, { tab: 'favorites', category: 'scene', query: 'wide' }).map(item => item.name), ['bottle-wide.png']);
  assert.equal(filterAssets(assets, { ...DEFAULT_FILTER, query: '  ' }).length, 3);
});

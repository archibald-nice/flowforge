import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoProject, type Project } from '../../src/domain/project.ts';
import { ACCEPTED_ASSET_TYPES, MAX_ASSET_BYTES, MAX_GENERATED_BYTES, assetCeiling, assetPathFor, isAssetPath, validateAsset } from '../../src/domain/assets.ts';
import { createBundle, readBundle, resultBundle } from '../../src/persistence/bundle.ts';

test('M19: the asset whitelist, the ceiling and the messages are explicit', () => {
  assert.deepEqual([...ACCEPTED_ASSET_TYPES], ['image/png', 'image/jpeg', 'image/webp', 'video/mp4']);
  assert.equal(MAX_ASSET_BYTES, 5 * 1024 * 1024);
  assert.deepEqual(validateAsset({ name: 'a.png', type: 'image/png', size: 10 }), { name: 'a.png', type: 'image/png', size: 10 });
  // 6.5-fix: local MP4 replacement is allowed, with the 50 MB provider ceiling.
  assert.deepEqual(validateAsset({ name: 'a.mp4', type: 'video/mp4', size: 10 }), { name: 'a.mp4', type: 'video/mp4', size: 10 });
  assert.equal(assetCeiling('video/mp4'), MAX_GENERATED_BYTES);
  assert.equal(assetCeiling('image/png'), MAX_ASSET_BYTES);
  assert.doesNotThrow(() => validateAsset({ name: 'a.mp4', type: 'video/mp4', size: MAX_GENERATED_BYTES }));
  assert.throws(() => validateAsset({ name: 'a.mp4', type: 'video/mp4', size: MAX_GENERATED_BYTES + 1 }), /本地上限 50 MB/);
  assert.throws(() => validateAsset({ name: 'a.svg', type: 'image/svg+xml', size: 10 }), /只能添加 PNG/);
  assert.throws(() => validateAsset({ name: 'a.gif', type: 'image/gif', size: 10 }), /只能添加 PNG/);
  assert.throws(() => validateAsset({ name: 'a.png', type: 'image/png', size: 0 }), /空的/);
  assert.throws(() => validateAsset({ name: 'a.png', type: 'image/png', size: MAX_ASSET_BYTES + 1 }), /本地上限 5 MB/);
  assert.ok(isAssetPath(assetPathFor('abc')));
  assert.equal(assetPathFor('abc'), 'asset:abc');
});

test('M20: a bundle round trips the project and its media', async () => {
  const project: Project = { ...demoProject(), nodes: demoProject().nodes.map(node =>
    node.kind === 'image' ? { ...node, assetPath: assetPathFor('local-1') } : node) };
  const media = new Map([['asset:local-1', { path: 'asset:local-1', sha256: '', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) }]]);
  const bundle = await createBundle(project, media);
  assert.equal(bundle.format, 'flowforge-bundle');
  assert.equal(bundle.files.length, 1);
  const restored = await readBundle(JSON.stringify(bundle));
  assert.equal(restored.project.nodes.length, project.nodes.length);
  assert.equal(restored.project.nodes.find(node => node.id === 'product')?.kind, 'image');
  assert.deepEqual([...(await restored.media.keys())], ['asset:local-1']);
  assert.equal((await restored.media.get('asset:local-1')!).size, 3);
});

test('M20: malformed bundles and stray media are refused', async () => {
  await assert.rejects(() => readBundle('{"format":"nope"}'), /不是 FlowForge 整包文件/);
  await assert.rejects(() => readBundle('not json'), /不是 FlowForge 整包文件/);
  const project = demoProject();
  const stray = await createBundle(project, new Map([['/fixtures/study-01.png', { path: '/fixtures/study-01.png', sha256: '', blob: new Blob([new Uint8Array([1])]) }]]));
  const strayBundle = { ...stray, files: [...stray.files, { path: 'asset:unused', type: 'image/png', base64: 'AQ==' }] };
  await assert.rejects(() => readBundle(JSON.stringify(strayBundle)), /does not use/);
});

test('M20: an exported result always carries the simulated marker', () => {
  const body = resultBundle({ prompt: 'x', inputs: [] }, { status: 'simulated-only', cost: 0 }) as Record<string, unknown>;
  assert.equal(body.simulated, true);
  assert.equal(body.format, 'flowforge-result');
});

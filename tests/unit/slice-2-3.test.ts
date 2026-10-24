import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSave, copyPlan, currentVariant, generateVariant, openEditor, selectVariant, setPrompt } from '../../src/domain/editor.ts';
import { applySimulatedResult, demoProject, isMediaNode, isSimulatedPath } from '../../src/domain/project.ts';

test('2.3: an empty editor cannot save and needs a prompt for a variation', () => {
  let state = openEditor('draft');
  assert.equal(canSave(state), false);
  assert.equal(currentVariant(state), null);
  assert.throws(() => generateVariant(state), /提示词/);
  state = setPrompt(state, '  ');
  assert.throws(() => generateVariant(state), /提示词/);
});

test('2.3: variations are appended, selectable and always marked simulated', () => {
  let state = setPrompt(openEditor('draft'), 'A softer crop.');
  state = generateVariant(state);
  state = generateVariant(state);
  assert.equal(state.variants.length, 2);
  assert.equal(state.selected, 1);
  assert.ok(state.variants.every(path => isSimulatedPath(path)));
  state = selectVariant(state, 0);
  assert.equal(currentVariant(state), 'simulated:editor/draft/1');
  assert.throws(() => selectVariant(state, 5), /已存在的变体/);
  assert.equal(canSave(state), true);
});

test('2.3: saving an editor variant writes it into the node without adding nodes', () => {
  const project = demoProject();
  const state = generateVariant(setPrompt(openEditor('draft'), 'Editor variant'), 7);
  const saved = applySimulatedResult(project, state.nodeId, state.variants[0].split('/').pop() ?? '1');
  const node = saved.nodes.find(item => item.id === 'draft')!;
  assert.equal(saved.nodes.length, project.nodes.length);
  assert.ok(isMediaNode(node));
  if (!isMediaNode(node)) throw new Error('fixture');
  assert.equal(node.assetSource, 'simulated');
  assert.ok(isSimulatedPath(node.assetPath ?? ''));
});

test('2.3: saving a copy is explicit and refuses an empty editor', () => {
  const empty = openEditor('draft');
  assert.throws(() => copyPlan(empty), /变体/);
  const filled = generateVariant(setPrompt(openEditor('draft'), 'Copy this.'), 3);
  assert.deepEqual(copyPlan(filled), { nodeId: 'draft', variant: 'simulated:editor/draft/3' });
});

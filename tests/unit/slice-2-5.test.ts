import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TEMPLATES, findTemplate, instantiateTemplate } from '../../src/domain/templates.ts';
import { validateProject } from '../../src/domain/project.ts';

test('2.5: twelve templates, each with a summary and at least two steps', () => {
  assert.equal(TEMPLATES.length, 12);
  for (const template of TEMPLATES) {
    assert.ok(template.summary.length > 0);
    assert.ok(template.steps.length >= 2);
  }
  assert.throws(() => findTemplate('missing'), /Unknown template/);
});

test('2.5: instantiating a template yields a valid project with drafts and no results', () => {
  const project = instantiateTemplate('product-still', 'project-tpl');
  const checked = validateProject(structuredClone(project));
  assert.equal(checked.id, 'project-tpl');
  assert.equal(checked.name, '产品静物（模板）');
  assert.equal(checked.nodes.length, 3);
  assert.deepEqual(checked.nodes.map(node => node.kind), ['text', 'image', 'video']);
  assert.ok(checked.nodes.filter(node => node.kind !== 'text').every(node => !('assetPath' in node) || node.assetPath === undefined));
  assert.equal(checked.snapshots.length, 0);
  assert.equal(checked.edges.length, 0);
});

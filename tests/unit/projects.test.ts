import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, demoProject, validateProject } from '../../src/domain/project.ts';

test('M03: a new project is an empty canvas with a timestamp', () => {
  const project = createProject();
  assert.equal(project.name, 'Untitled project');
  assert.match(project.id, /^project-/);
  assert.deepEqual(project.nodes, []);
  assert.deepEqual(project.edges, []);
  assert.deepEqual(project.snapshots, []);
  assert.equal(project.revision, 0);
  assert.equal(project.schemaVersion, 4);
  assert.ok(Number.isFinite(Date.parse(project.updatedAt!)));
  const validated = validateProject(project);
  assert.deepEqual(validated.nodes, []);
  assert.equal(validated.updatedAt, project.updatedAt);
  // The identifier and name are both caller-controlled.
  const named = createProject('project-fixed', 'Rehearsal one');
  assert.equal(named.id, 'project-fixed');
  assert.equal(named.name, 'Rehearsal one');
});

test('M03/M13: the timestamp is optional for older records but must parse when present', () => {
  const older = demoProject();
  assert.equal(older.updatedAt, undefined);
  assert.equal(validateProject(older).id, older.id);
  assert.throws(() => validateProject({ ...demoProject(), updatedAt: 'not a date' }), /project timestamp/);
  assert.throws(() => validateProject({ ...demoProject(), updatedAt: 12 as never }), /Invalid string/);
});

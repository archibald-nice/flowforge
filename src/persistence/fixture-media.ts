import manifest from '../assets/fixture-manifest.json';
import type { Project } from '../domain/project.ts';

export type StoredMedia = { path: string; sha256: string; blob: Blob };
const entries = new Map(manifest.map(item => [`/fixtures/${item.file}`, item]));

export function mediaPaths(project: Project): string[] {
  const paths: string[] = [];
  const add = (path?: string) => { if (path && !path.startsWith('simulated:')) paths.push(path); };
  for (const node of project.nodes) if (node.kind !== 'text' && node.kind !== 'scene') add(node.assetPath);
  for (const snapshot of project.snapshots) for (const input of snapshot.inputs) if (input.kind !== 'text') add(input.assetPath);
  return [...new Set(paths)];
}

export async function verifyMedia(value: unknown, path: string): Promise<StoredMedia> {
  const expected = entries.get(path);
  const record = value as StoredMedia | undefined;
  if (!expected || !record || record.path !== path || !(record.blob instanceof Blob) || record.blob.type !== 'image/png' || record.blob.size !== expected.bytes || record.sha256 !== expected.sha256) throw new Error(`Missing or invalid local media: ${path}`);
  const digest = await crypto.subtle.digest('SHA-256', await record.blob.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== expected.sha256) throw new Error(`Local media checksum mismatch: ${path}`);
  const image = await createImageBitmap(record.blob);
  const valid = image.width === expected.width && image.height === expected.height;
  image.close();
  if (!valid) throw new Error(`Local media dimensions mismatch: ${path}`);
  return record;
}

export async function fetchFixture(path: string): Promise<StoredMedia> {
  const expected = entries.get(path);
  if (!expected) throw new Error('Only original fixture media is supported in this spike.');
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Fixture unavailable: ${path}`);
  return verifyMedia({ path, sha256: expected.sha256, blob: await response.blob() }, path);
}

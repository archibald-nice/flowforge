import { validateProject, type Project } from '../domain/project.ts';
import type { StoredMedia } from './fixture-media.ts';

/**
 * FlowForge bundle. The target never produced a downloadable result or export
 * (U5), so the container, the manifest shape and the file naming are designed.
 * A bundle carries the whole project plus the media its nodes refer to.
 */
export type BundleFile = Readonly<{ path: string; type: string; base64: string }>;
export type Bundle = Readonly<{
  format: 'flowforge-bundle'; version: 1; exportedAt: string;
  note: string; project: Project; files: readonly BundleFile[];
}>;

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export async function createBundle(project: Project, media: Map<string, StoredMedia>): Promise<Bundle> {
  const files: BundleFile[] = [];
  for (const [path, asset] of media) files.push({ path, type: asset.blob.type, base64: await toBase64(asset.blob) });
  return { format: 'flowforge-bundle', version: 1, exportedAt: new Date().toISOString(),
    note: 'Exported by FlowForge. Simulated results keep their simulated marker.', project, files };
}

export async function readBundle(text: string): Promise<{ project: Project; media: Map<string, Blob> }> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('这不是 FlowForge 整包文件。'); }
  const bundle = parsed as Partial<Bundle>;
  if (bundle?.format !== 'flowforge-bundle' || bundle.version !== 1 || !bundle.project) {
    throw new Error('这不是 FlowForge 整包文件。');
  }
  const project = validateProject(bundle.project);
  const media = new Map<string, Blob>();
  for (const file of bundle.files ?? []) {
    if (!file?.path || typeof file.base64 !== 'string') throw new Error('The bundle has an unreadable media entry.');
    media.set(file.path, new Blob([fromBase64(file.base64)], { type: file.type || 'application/octet-stream' }));
  }
  for (const path of media.keys()) if (!project.nodes.some(node => node.kind === 'image' && node.assetPath === path)
    && !project.snapshots.some(snapshot => snapshot.inputs.some(input => input.assetPath === path))) {
    throw new Error(`The bundle carries media the project does not use: ${path}`);
  }
  return { project, media };
}

/** One result at a time, always with the simulated marker attached. */
export function resultBundle(request: unknown, result: unknown): object {
  return { format: 'flowforge-result', version: 1, exportedAt: new Date().toISOString(),
    simulated: true, request, result: result ?? null };
}

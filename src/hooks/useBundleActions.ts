import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Project } from '../domain/project.ts';
import type { MockRun } from '../providers/mock-provider.ts';
import { download } from '../lib/download.ts';
import { slugify } from '../lib/format.ts';
import { createBundle, readBundle, resultBundle } from '../persistence/bundle.ts';
import { renderReadonly } from '../persistence/readonly-export.ts';
import { instantiateTemplate, findTemplate } from '../domain/templates.ts';
import type { ProjectStore } from '../persistence/project-store.ts';
import type { Command } from '../domain/history.ts';

export interface BundleActionsDeps {
  store: ProjectStore;
  projectRef: RefObject<Project>;
  setNotice: Dispatch<SetStateAction<string>>;
  setStatus: Dispatch<SetStateAction<string>>;
  hydrateMedia: (value: Project) => Promise<void>;
  hydrate: (value: Project) => void;
  refreshAssets: () => Promise<void>;
  revisionRef: RefObject<number | null>;
  setStoredRevision: Dispatch<SetStateAction<number | null>>;
  run: MockRun | null;
}

/** Export / import actions: readonly HTML, full bundle, per-run result bundle,
 * and local template instantiation. Everything stays on this machine. */
export function useBundleActions({ store, projectRef, setNotice, setStatus, hydrateMedia, hydrate, refreshAssets, revisionRef, setStoredRevision, run }: BundleActionsDeps) {
  const exportReadonly = async () => {
    try {
      const current = projectRef.current;
      const media = await store.prepareMedia(current);
      const slug = slugify(current.name) || 'project';
      download(`${slug}.readonly.html`, await renderReadonly(current, media));
      setNotice('只读视图已导出：静态文件，不可编辑、不运行、不联网。');
    } catch (reason) { setNotice(String(reason)); }
  };

  const exportBundleFile = async () => {
    try {
      const current = projectRef.current;
      const media = await store.prepareMedia(current);
      download(`${slugify(current.name)}.flowforge.json`,
        JSON.stringify(await createBundle(current, media), null, 2));
      setNotice('整包已导出；模拟结果保留其标记。');
    } catch (reason) { setNotice(String(reason)); }
  };

  const importBundleFile = async (file: File) => {
    try {
      const { project: imported, media } = await readBundle(await file.text());
      await store.importMedia(media);
      const fresh = { ...imported, id: `project-${crypto.randomUUID()}`, name: `${imported.name} (imported)`, revision: 0 };
      const saved = await store.save(fresh, null);
      await hydrateMedia(saved); hydrate(saved); await refreshAssets();
      revisionRef.current = saved.revision; setStoredRevision(saved.revision);
      setStatus(`已保存到本地 / r${saved.revision}`);
      setNotice('整包已作为新项目导入到本地；未上传任何内容。');
    } catch (reason) { setNotice(String(reason)); }
  };

  const exportResult = async () => {
    if (!run?.result) return;
    const current = projectRef.current;
    const media = await store.prepareMedia(current);
    const files = await Promise.all([...media].map(async ([path, asset]) => ({
      path, type: asset.blob.type,
      base64: btoa(String.fromCharCode(...new Uint8Array(await asset.blob.arrayBuffer()))),
    })));
    download(`${slugify(current.name)}-result.json`,
      JSON.stringify({ ...resultBundle(run.request, run.result), files }, null, 2));
    setNotice('结果已导出，并保留模拟标记。');
  };

  const useTemplate = async (templateId: string) => {
    try {
      const created = instantiateTemplate(templateId);
      await store.save(created, null);
      setNotice(`模板「${findTemplate(templateId).title}」已在本机实例化：只生成草稿，不生成内容。`);
      window.location.href = `/?project=${created.id}`;
    } catch (reason) { setNotice(String(reason)); }
  };

  return { exportReadonly, exportBundleFile, importBundleFile, exportResult, useTemplate };
}

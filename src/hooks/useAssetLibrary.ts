import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { isMediaNode, setNodeAsset, type Project } from '../domain/project.ts';
import type { LibraryFilter } from '../domain/asset-library.ts';
import { DEFAULT_FILTER } from '../domain/asset-library.ts';
import { ProjectStore, type StoredAsset, type AssetCategory } from '../persistence/project-store.ts';
import type { Command } from '../domain/history.ts';

export interface AssetLibraryDeps {
  store: ProjectStore;
  ready: boolean;
  projectRef: RefObject<Project>;
  selectedIdRef: RefObject<string>;
  change: (next: Project, command?: Command) => void;
  hydrateMedia: (value: Project) => Promise<void>;
  setNotice: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
}

/** Local asset library: the stored asset list, its derived object URLs, the
 * library filter, and every mutation entry point (upload, save-from-node,
 * metadata edits, "use on node"). */
export function useAssetLibrary({ store, ready, projectRef, selectedIdRef, change, hydrateMedia, setNotice, setError }: AssetLibraryDeps) {
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<LibraryFilter>(DEFAULT_FILTER);

  useEffect(() => {
    if (!ready) return;
    void store.listAssets().then(list => {
      setAssets(list);
      const urls = Object.fromEntries(list.map(asset => [asset.path, URL.createObjectURL(asset.blob)]));
      setAssetUrls(current => { Object.values(current).forEach(URL.revokeObjectURL); return urls; });
    }).catch(reason => setError(String(reason)));
  }, [ready, store]);

  const refreshAssets = async () => {
    const list = await store.listAssets();
    setAssets(list);
    const urls = Object.fromEntries(list.map(asset => [asset.path, URL.createObjectURL(asset.blob)]));
    setAssetUrls(current => { Object.values(current).forEach(URL.revokeObjectURL); return urls; });
  };

  const addAssetFile = async (file: File) => {
    try {
      const asset = await store.addAsset(file);
      await refreshAssets();
      setNotice(`素材已保存在本地：${asset.name}；未上传。`);
    } catch (reason) { setNotice(String(reason)); }
  };

  const saveNodeToLibrary = async () => {
    const node = projectRef.current.nodes.find(item => item.id === selectedIdRef.current);
    if (!node || !isMediaNode(node) || !node.assetPath) { setNotice('请选择已有素材的媒体节点。'); return; }
    const blob = await store.mediaBlob(node.assetPath);
    if (!blob) { setNotice('这张素材只存在于当前整包里，请先导入。'); return; }
    try {
      const asset = await store.addAssetFromBlob(blob, `${node.title}.png`, 'other');
      await refreshAssets();
      setNotice(`已保存到本地素材库：${asset.name}；未上传。`);
    } catch (reason) { setNotice(String(reason)); }
  };

  const setAssetMeta = async (asset: StoredAsset, patch: { category?: AssetCategory; favorite?: boolean }) => {
    try { await store.updateAsset(asset.path, patch); await refreshAssets(); setNotice('素材信息已更新到本地。'); }
    catch (reason) { setNotice(String(reason)); }
  };

  const useAsset = (asset: StoredAsset) => {
    const target = projectRef.current.nodes.find(node => node.id === selectedIdRef.current);
    if (!target || (target.kind !== 'image' && target.kind !== 'video')) return;
    const next = setNodeAsset(projectRef.current, target.id, asset.path);
    change(next, { kind: 'edit', key: `asset:${target.id}` });
    void hydrateMedia(next);
    setNotice(`Image now uses ${asset.name}. Local file; no upload.`);
  };

  return { assets, assetUrls, filter, setFilter, refreshAssets, addAssetFile, saveNodeToLibrary, setAssetMeta, useAsset };
}

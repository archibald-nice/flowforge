import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { useReactFlow } from '@xyflow/react';
import { createHistory, depth, record, redo, undo, type Command } from '../domain/history.ts';
import { isMediaNode, type Project } from '../domain/project.ts';
import { providerCallCount } from '../providers/mock-provider.ts';
import { ConflictError, ProjectStore } from '../persistence/project-store.ts';
import type { CardNode } from '../components/NodeCard.tsx';

const pickDefault = (value: Project) =>
  value.nodes.find(node => isMediaNode(node) && node.prompt)?.id
  ?? value.nodes.find(node => isMediaNode(node))?.id
  ?? value.nodes[0]?.id ?? '';

/** Canvas-facing collaborators the project hook needs from the workbench:
 * viewport/flow for hydrate, node list for hydrate, selection + notice setters
 * for undo/redo fallbacks. */
export interface ProjectCanvasDeps {
  flow: ReturnType<typeof useReactFlow<CardNode>>;
  setNodes: Dispatch<SetStateAction<CardNode[]>>;
  setSelectedId: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
}

/** Project state plus the persistence and command-stack machinery: debounced
 * autosave, revision tracking, media hydration (object URLs), apply/change/
 * undo/redo. */
export function useProject(initial: Project, { flow, setNodes, setSelectedId, setNotice }: ProjectCanvasDeps) {
  const [project, setProject] = useState<Project>(initial);
  const [status, setStatus] = useState('Opening local storage');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(0);
  const [storedRevision, setStoredRevision] = useState<number | null>(null);
  const revisionRef = useRef<number | null>(null);
  const projectRef = useRef(project); projectRef.current = project;
  const [store] = useState(() => new ProjectStore());
  const [providerTotal, setProviderTotal] = useState(providerCallCount());
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const history = useRef(createHistory()).current;
  const [historyVersion, setHistoryVersion] = useState(0);
  const historyDepth = depth(history);
  void historyVersion;
  const activeUrls = useRef<Record<string, string>>({});
  const loaded = useRef(false);
  const saving = useRef(false);
  const editSerial = useRef(0);
  const failed = useRef(false);

  const hydrateMedia = useCallback(async (value: Project) => {
    const assets = await store.prepareMedia(value);
    const urls = Object.fromEntries([...assets].map(([path, asset]) => [path, URL.createObjectURL(asset.blob)]));
    Object.values(activeUrls.current).forEach(URL.revokeObjectURL);
    activeUrls.current = urls; setMediaUrls(urls);
  }, [store]);

  useEffect(() => () => { Object.values(activeUrls.current).forEach(URL.revokeObjectURL); }, []);

  const hydrate = useCallback((value: Project) => {
    setProject(value); projectRef.current = value;
    const selected = pickDefault(value);
    setSelectedId(selected);
    setNodes(value.nodes.map(item => ({ id: item.id, type: 'card', data: { item }, position: item.position, dragHandle: '.node-drag', selected: item.id === selected })));
    void flow.setViewport(value.viewport);
  }, [flow, setNodes, setSelectedId]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    store.load(initial.id).then(async value => {
      await hydrateMedia(value ?? initial);
      hydrate(value ?? initial); revisionRef.current = value?.revision ?? null;
      setStoredRevision(revisionRef.current); setReady(true);
      setStatus(value ? `已保存到本地 / r${value.revision}` : '演示项目未保存');
      if (!value || value.mediaVersion !== 1) { setStatus('正在本地保存原始媒体'); setDirty(n => n + 1); }
    }).catch(reason => { setError(String(reason)); setStatus('恢复失败 / 未覆盖本地'); });
  }, [store, initial, hydrate, hydrateMedia]);

  // Applying a project never records history; commands call record() first.
  const apply = (next: Project) => {
    editSerial.current++; failed.current = false; setError(''); setStatus('有未保存的改动');
    setProject(next); projectRef.current = next; setDirty(n => n + 1); setProviderTotal(providerCallCount());
  };
  const change = (next: Project, command?: Command) => {
    const previous = projectRef.current;
    if (command && next !== previous) { record(history, previous, command); setHistoryVersion(value => value + 1); }
    apply(next);
  };

  const undoCommand = () => {
    const previous = undo(history, projectRef.current);
    setHistoryVersion(value => value + 1);
    if (!previous) { setNotice('没有可撤销的操作。'); return; }
    apply(previous);
    setSelectedId(current => previous.nodes.some(node => node.id === current) ? current : pickDefault(previous));
    setNotice('已撤销上一步画布操作；输入框内的文字使用浏览器自带撤销。');
  };

  const redoCommand = () => {
    const next = redo(history, projectRef.current);
    setHistoryVersion(value => value + 1);
    if (!next) { setNotice('没有可重做的操作。'); return; }
    apply(next);
    setSelectedId(current => next.nodes.some(node => node.id === current) ? current : pickDefault(next));
    setNotice('已重做上一步画布操作。');
  };

  useEffect(() => {
    if (!ready || dirty === 0 || failed.current) return;
    const timer = window.setTimeout(async () => {
      if (saving.current) { setDirty(n => n + 1); return; }
      saving.current = true;
      const serial = editSerial.current;
      setStatus('保存中');
      try {
        const saved = await store.save(projectRef.current, revisionRef.current);
        projectRef.current = { ...projectRef.current, mediaVersion: 1 };
        revisionRef.current = saved.revision; setStoredRevision(saved.revision);
        if (serial === editSerial.current) setStatus(`已保存到本地 / r${saved.revision}`);
        else { setStatus('有未保存的改动'); setDirty(n => n + 1); }
      } catch (reason) {
        failed.current = true; setStatus(reason instanceof ConflictError ? '有冲突 / 草稿保留' : '保存失败 / 草稿保留'); setError(String(reason));
      } finally { saving.current = false; }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [dirty, ready, store]);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!status.startsWith('已保存到本地')) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [status]);

  return {
    project, setProject, projectRef, store, mediaUrls,
    status, setStatus, error, setError, ready, setReady,
    dirty, setDirty, storedRevision, setStoredRevision, revisionRef,
    providerTotal, setProviderTotal,
    history, historyDepth, saving, editSerial, failed,
    hydrateMedia, hydrate, apply, change, undoCommand, redoCommand,
  };
}

import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { ProjectStore } from '../persistence/project-store.ts';
import type { Project } from '../domain/project.ts';

export interface DiagnosticsProps {
  storedRevision: number | null;
  providerTotal: number;
  mediaUrls: Record<string, string>;
  store: ProjectStore;
  failed: RefObject<boolean>;
  setDirty: Dispatch<SetStateAction<number>>;
  status: string;
  initial: Project;
  hydrate: (value: Project) => void;
  hydrateMedia: (value: Project) => Promise<void>;
  revisionRef: RefObject<number | null>;
  setStoredRevision: Dispatch<SetStateAction<number | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setStatus: Dispatch<SetStateAction<string>>;
}

/** Collapsed storage diagnostics: stored revision, provider-call counter,
 * media count, save timing, and the simulated-failure buttons. */
export function Diagnostics({ storedRevision, providerTotal, mediaUrls, store, failed, setDirty, status, initial,
  hydrate, hydrateMedia, revisionRef, setStoredRevision, setError, setStatus }: DiagnosticsProps) {
  return <details className="diagnostics"><summary>存储诊断</summary><p>已存版本：<output data-testid="stored-revision">{storedRevision ?? '无'}</output></p><p>模型调用次数：<output data-testid="provider-calls">{providerTotal}</output>（仅模拟）</p><p>已校验媒体：<output data-testid="media-count">{Object.keys(mediaUrls).length}</output> 个原始 PNG</p><p>上次保存准备 / 事务：<output data-testid="save-timing">{store.lastSaveTiming ? JSON.stringify(store.lastSaveTiming) : '本标签页未测量'}</output></p><button onClick={() => { store.failNextSave = true; failed.current = false; setDirty(value => value + 1); }}>模拟下一次写失败</button><button onClick={() => { store.simulateQuota = true; failed.current = false; setDirty(value => value + 1); }}>模拟配额耗尽</button><button onClick={() => { failed.current = false; setError(''); setDirty(value => value + 1); }}>重试本地保存</button><button disabled={status === 'Saving'} onClick={() => {
    // Cancel the pending autosave before replacing a discarded local draft.
    setDirty(0); failed.current = true;
    void store.load(initial.id).then(async value => { if (value) { await hydrateMedia(value); hydrate(value); revisionRef.current = value.revision; setStoredRevision(value.revision); failed.current = false; setError(''); setStatus(`已保存到本地 / r${value.revision}`); } }).catch(reason => { setStatus('恢复失败 / 未覆盖本地'); setError(String(reason)); });
  }}>重载已存版本</button></details>;
}

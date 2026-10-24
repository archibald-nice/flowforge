import { useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { applyNodeChanges, type NodeChange, type Connection } from '@xyflow/react';
import { addNode, addReference, addReferenceEdge, duplicateNode, freezeInputs, isMediaNode, removeNode, removeReference, removeReferenceEdge, setDraftSettings, setNodeAsset, setReferenceRole, type GenerationSettings, type MediaNode, type Project, type ProjectNode, type ReferenceRole } from '../domain/project.ts';
import { withoutProviderCalls, runControls, startRun, type MockRun } from '../providers/mock-provider.ts';
import { arkReachable, startArkRun, ARK_IMAGE_MODELS, type ArkRun } from '../providers/ark-provider.ts';
import { speechReachable, startSpeechRun, SPEECH_MODELS, type SpeechRun } from '../providers/speech-provider.ts';
import { videoReachable, startVideoRun, ARK_VIDEO_MODELS, type VideoRun } from '../providers/video-provider.ts';
import { priceFor, walletOf } from '../domain/pricing.ts';
import { downloadBlob } from '../lib/download.ts';
import { roleLabels } from '../lib/format.ts';
import type { ProjectStore } from '../persistence/project-store.ts';
import type { Command } from '../domain/history.ts';
import type { CardNode, HoverToolbarActions } from '../components/NodeCard.tsx';

export interface NodeActionsDeps {
  change: (next: Project, command?: Command) => void;
  projectRef: RefObject<Project>;
  selectedIdRef: RefObject<string>;
  setSelectedId: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setPrepared: Dispatch<SetStateAction<boolean>>;
  setPalette: Dispatch<SetStateAction<boolean>>;
  setNodes: Dispatch<SetStateAction<CardNode[]>>;
  store: ProjectStore;
  refreshAssets: () => Promise<void>;
  hydrateMedia: (value: Project) => Promise<void>;
  selected: ProjectNode | undefined;
  draft: MediaNode | null;
  outcome: 'succeed' | 'fail';
  applyRun: (next: MockRun | null) => void;
  applyArkRun: (next: ArkRun | null) => void;
  applySpeechRun: (next: SpeechRun | null) => void;
  applyVideoRun: (next: VideoRun | null) => void;
  pendingTarget: RefObject<string>;
}

/** Canvas and node mutations: duplicate/create/delete, hover-toolbar entries,
 * candidate edges, references, the generation form, and the submit router that
 * picks mock vs real provider from the draft's selected model. Every mutation
 * goes through change() so history stays consistent. */
export function useNodeActions({ change, projectRef, selectedIdRef, setSelectedId, setNotice, setPrepared, setPalette,
  setNodes, store, refreshAssets, hydrateMedia, selected, draft, outcome,
  applyRun, applyArkRun, applySpeechRun, applyVideoRun, pendingTarget }: NodeActionsDeps) {
  const patch = (id: string, values: Partial<ProjectNode>) => change({ ...projectRef.current,
    nodes: projectRef.current.nodes.map(node => node.id === id ? { ...node, ...values, revision: node.revision + 1 } as ProjectNode : node) },
    { kind: 'edit', key: `text:${id}:${Object.keys(values).join(',')}` });

  const duplicateSelected = () => {
    const target = projectRef.current.nodes.find(node => node.id === selectedIdRef.current);
    if (!target) return;
    try {
      const next = withoutProviderCalls('duplicating a node', () => duplicateNode(projectRef.current, target.id));
      const created = next.nodes[next.nodes.length - 1];
      change(next, { kind: 'copy', key: created.id });
      setSelectedId(created.id);
      setNotice('已复制为新节点（新 id）；未调用模型。');
    } catch (reason) { setNotice(String(reason)); }
  };

  // Slice 6.5 — hover toolbar actions. Each one reuses the inspector's
  // existing function; the toolbar is only another entry point.
  const toolbarActions = useMemo<HoverToolbarActions>(() => ({
    onEdit: nodeId => {
      const node = projectRef.current.nodes.find(item => item.id === nodeId);
      if (!node) return;
      setSelectedId(nodeId); setPrepared(false);
      setNotice(`已在右侧详情面板打开「${node.title}」；悬停工具条只做入口。`);
    },
    onCopy: nodeId => {
      const target = projectRef.current.nodes.find(item => item.id === nodeId);
      if (!target) return;
      try {
        const next = withoutProviderCalls('duplicating a node', () => duplicateNode(projectRef.current, nodeId));
        const created = next.nodes[next.nodes.length - 1];
        change(next, { kind: 'copy', key: created.id });
        setSelectedId(created.id);
        setNotice('已复制为新节点（新 id）；未调用模型。');
      } catch (reason) { setNotice(String(reason)); }
    },
    onDelete: nodeId => {
      try {
        const next = withoutProviderCalls('deleting a node', () => removeNode(projectRef.current, nodeId));
        change(next, { kind: 'delete' });
        if (selectedIdRef.current === nodeId) {
          setSelectedId(next.nodes.find(node => isMediaNode(node))?.id ?? next.nodes[0]?.id ?? '');
        }
        setNotice('节点与其候选已删除；未调用模型。');
      } catch (reason) { setNotice(String(reason)); }
    },
    onReplace: (nodeId, file) => {
      void (async () => {
        try {
          const node = projectRef.current.nodes.find(item => item.id === nodeId);
          if (!node || !isMediaNode(node)) return;
          const asset = await store.addAsset(file);
          await refreshAssets();
          const next = setNodeAsset(projectRef.current, nodeId, asset.path);
          change(next, { kind: 'edit', key: `asset:${nodeId}` });
          void hydrateMedia(next);
          setNotice(`素材已替换为 ${asset.name}；本地文件，未上传。`);
        } catch (reason) { setNotice(String(reason)); }
      })();
    },
    onDownload: nodeId => {
      void (async () => {
        const node = projectRef.current.nodes.find(item => item.id === nodeId);
        if (!node || !isMediaNode(node) || !node.assetPath) { setNotice('这个节点还没有素材可下载。'); return; }
        const blob = await store.mediaBlob(node.assetPath);
        if (!blob) { setNotice('这张素材只存在于当前整包里，请先导入。'); return; }
        const extension = blob.type === 'video/mp4' ? 'mp4' : blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
        downloadBlob(`${node.title}.${extension}`, blob);
        setNotice(`已下载 ${node.title}.${extension}；这是本地文件，未经过模型。`);
      })();
    },
  }), [store]);

  const onNodesChange = (changes: NodeChange<CardNode>[]) => {
    setNodes(current => applyNodeChanges(changes, current));
    const positions = changes.filter(item => item.type === 'position');
    if (positions.length) change({ ...projectRef.current, nodes: projectRef.current.nodes.map(node => {
      const update = positions.find(item => item.id === node.id);
      return update?.type === 'position' && update.position ? { ...node, position: update.position } : node;
    }) }, { kind: 'move' });
  };

  const connect = (connection: Connection) => {
    try {
      change(withoutProviderCalls('creating a candidate edge', () => addReferenceEdge(projectRef.current, connection.source, connection.target)), { kind: 'edge' });
      setNotice('已添加候选；未调用模型。');
    } catch (reason) { setNotice(String(reason)); }
  };

  const createNode = (kind: Parameters<typeof addNode>[1]) => {
    try {
      const next = withoutProviderCalls('creating a node', () => addNode(projectRef.current, kind));
      change(next, { kind: 'create' }); setSelectedId(next.nodes[next.nodes.length - 1].id); setPalette(false);
      setNotice('已创建草稿；未调用模型。');
    } catch (reason) { setNotice(String(reason)); }
  };

  const deleteSelectedNode = () => {
    if (!selected) return;
    try {
      const next = withoutProviderCalls('deleting a node', () => removeNode(projectRef.current, selected.id));
      change(next, { kind: 'delete' });
      setSelectedId(next.nodes.find(node => isMediaNode(node))?.id ?? next.nodes[0]?.id ?? '');
      setNotice('节点与其候选已删除；未调用模型。');
    } catch (reason) { setNotice(String(reason)); }
  };

  const removeCandidate = (nodeId: string) => {
    if (!draft) return;
    const edge = projectRef.current.edges.find(item => item.source === nodeId && item.target === draft.id);
    if (!edge) return;
    try {
      change(withoutProviderCalls('removing a candidate', () => removeReferenceEdge(projectRef.current, edge.id)), { kind: 'edge' });
      setNotice('候选已移除；未调用模型。');
    } catch (reason) { setNotice(String(reason)); }
  };

  const referenceInput = (nodeId: string) => {
    if (!draft) return;
    try {
      change(withoutProviderCalls('adding a reference', () => addReference(projectRef.current, draft.id, nodeId,
        isMediaNode(projectRef.current.nodes.find(node => node.id === nodeId) ?? ({} as ProjectNode)) ? 'first-frame' : 'reference')), { kind: 'edit', key: `refs:${draft.id}` });
      setNotice('已加入引用；未调用模型。');
    } catch (reason) { setNotice(String(reason)); }
  };

  const dropReference = (nodeId: string) => {
    if (!draft) return;
    try {
      change(withoutProviderCalls('removing a reference', () => removeReference(projectRef.current, draft.id, nodeId)), { kind: 'edit', key: `refs:${draft.id}` });
      setNotice('已从提示词移除引用；连线与源节点保持不变，未调用模型。');
    } catch (reason) { setNotice(String(reason)); }
  };

  const changeRole = (nodeId: string, role: ReferenceRole) => {
    if (!draft) return;
    try {
      change(withoutProviderCalls('changing a reference role', () => setReferenceRole(projectRef.current, draft.id, nodeId, role)), { kind: 'edit', key: `role:${draft.id}:${nodeId}` });
      setNotice(`用途已设为${roleLabels[role]}（本地标签，未调用模型）。`);
    } catch (reason) { setNotice(String(reason)); }
  };

  const changeForm = (formPatch: Partial<GenerationSettings>) => {
    if (!draft) return;
    try {
      change(withoutProviderCalls('changing the generation form', () => setDraftSettings(projectRef.current, draft.id, formPatch)), { kind: 'edit', key: `form:${draft.id}` });
      setNotice('参数已修改；早先的快照与结果不受影响，未调用模型。');
    } catch (reason) { setNotice(String(reason)); }
  };

  const submitSimulated = () => {
    if (!draft) return;
    try {
      const price = priceFor(draft.kind);
      if (price > walletOf(projectRef.current)) throw new Error(`模拟额度不足：需要 ${price}，剩余 ${walletOf(projectRef.current)}。`);
      const snapshot = freezeInputs(projectRef.current, draft.id);
      const settings = snapshot.settings ?? { model: 'mock-still-a', size: '512', variants: 1 as const };
      // Slice 1.2: an Ark model selected while ARK_ENABLED=1 routes this submit
      // to the real provider; every other combination stays mock.
      if (ARK_IMAGE_MODELS.some(entry => entry.id === settings.model)) {
        if (!arkReachable()) throw new Error('Real generation requires ARK_ENABLED=1 (it is off; run stays mock).');
        const started = startArkRun({ prompt: snapshot.prompt, settings: { model: settings.model, size: settings.size, variants: 1 } });
        change({ ...projectRef.current, snapshots: [...projectRef.current.snapshots, snapshot] }, { kind: 'snapshot' });
        pendingTarget.current = draft.id;
        applyArkRun(started);
        setNotice('真实生成已提交到方舟（真实调用，会产生实际费用）。结果只落本地，不上传。');
        return;
      }
      // Slice 1.3: video drafts with the real video model route to the Ark task
      // provider (submit → poll → download); everything else stays mock.
      if (draft.kind === 'video' && ARK_VIDEO_MODELS.some(entry => entry.id === settings.model)) {
        if (!videoReachable()) throw new Error('真实视频已选中，但 ARK_VIDEO_ENABLED 或视频接入点未配置；本次不执行。');
        const started = startVideoRun({ prompt: snapshot.prompt, settings: { model: settings.model, size: settings.size, variants: 1 } });
        change({ ...projectRef.current, snapshots: [...projectRef.current.snapshots, snapshot] }, { kind: 'snapshot' });
        pendingTarget.current = draft.id;
        applyVideoRun(started);
        setNotice('真实视频任务已提交到方舟（提交 → 轮询 → 下载，会产生实际费用）。结果只落本地。');
        return;
      }
      // Slice 1.4: audio drafts with the real speech model route to the speech
      // provider; the text is what gets spoken, so an empty draft is rejected.
      if (draft.kind === 'audio' && SPEECH_MODELS.some(entry => entry.id === settings.model)) {
        if (!speechReachable()) throw new Error('真实音频已选中，但 SPEECH_ENABLED 未开启；本次不执行。');
        const started = startSpeechRun({ prompt: snapshot.prompt, settings: { model: settings.model, size: settings.size, variants: 1 } });
        change({ ...projectRef.current, snapshots: [...projectRef.current.snapshots, snapshot] }, { kind: 'snapshot' });
        pendingTarget.current = draft.id;
        applySpeechRun(started);
        setNotice('真实音频已提交到豆包语音（按分钟计费，实际以账单为准）。结果只落本地。');
        return;
      }
      runControls.failNext = outcome === 'fail';
      const started = startRun({ prompt: snapshot.prompt, settings: snapshot.settings,
        inputs: snapshot.inputs.map(input => ({ nodeId: input.nodeId, revision: input.revision, role: input.role })) });
      change({ ...projectRef.current, snapshots: [...projectRef.current.snapshots, snapshot] }, { kind: 'snapshot' });
      pendingTarget.current = draft.id;
      applyRun(started); setNotice('模拟运行已记录；未发起网络请求。');
    } catch (reason) { setNotice(String(reason)); }
  };

  return { patch, duplicateSelected, toolbarActions, onNodesChange, connect, createNode, deleteSelectedNode, removeCandidate, referenceInput, dropReference, changeRole, changeForm, submitSimulated };
}

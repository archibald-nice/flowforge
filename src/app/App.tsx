import { useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { demoProject, benchmarkProject, createProject, isMediaNode, SCENE_NOTICE, type Project, type ProjectNode } from '../domain/project.ts';
import { adviceFor } from '../domain/agent-advice.ts';
import { priceFor } from '../domain/pricing.ts';
import { installProxyTransports, proxyAvailable } from '../providers/proxy-transport.ts';
import { zoomAt } from '../domain/viewport.ts';
import { simulatedUrl } from '../lib/format.ts';
import { type EditorState } from '../domain/editor.ts';
import { type AgentPlan } from '../domain/agent-plan.ts';
import { type Timeline } from '../domain/timeline.ts';
import { ProjectList } from './ProjectList.tsx';
import { type CardNode } from '../components/NodeCard.tsx';
import { WalletBadge } from '../components/WalletBadge.tsx';
import { CanvasStage } from '../components/CanvasStage.tsx';
import { Inspector } from '../components/Inspector.tsx';
import { useSelection } from '../hooks/useSelection.ts';
import { useProject } from '../hooks/useProject.ts';
import { useAssetLibrary } from '../hooks/useAssetLibrary.ts';
import { useRuns } from '../hooks/useRuns.ts';
import { useNodeActions } from '../hooks/useNodeActions.ts';
import { useAgentActions } from '../hooks/useAgentActions.ts';
import { useBundleActions } from '../hooks/useBundleActions.ts';
import { useEditorActions } from '../hooks/useEditorActions.ts';

// Slice 1.6: when the dev server exposes the local proxy, the four real paths
// switch to HTTP transports. Otherwise this is a no-op and real models stay
// unreachable — no silent downgrade to mock.
if (proxyAvailable()) installProxyTransports();

const editable = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"]');

function Workbench() {
  const params = new URLSearchParams(location.search);
  const mode = params.get('benchmark');
  const projectParam = params.get('project');
  const [initial] = useState(() => mode ? benchmarkProject(mode === '1000' ? 1000 : 300)
    : projectParam ? createProject(projectParam) : demoProject());
  const [nodes, setNodes] = useState<CardNode[]>([]);
  const [notice, setNotice] = useState('');
  const [minimap, setMinimap] = useState(true);
  const [palette, setPalette] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  // Slice 2.3-real: the editor's own model choice and the pending real variant.
  const [editorModel, setEditorModel] = useState<string>('simulated');
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [composerText, setComposerText] = useState('');
  const [manualMode, setManualMode] = useState(true);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  useEffect(() => {
    if (!capabilitiesOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setCapabilitiesOpen(false); setCapabilityDetail(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capabilitiesOpen]);
  const [capabilityDetail, setCapabilityDetail] = useState('');
  const [agentLog, setAgentLog] = useState<{ role: 'user' | 'agent'; text: string }[]>([]);
  const [space, setSpace] = useState(false);
  const [prepared, setPrepared] = useState(false);

  const { selectedId, setSelectedId, selectedIdRef, selectionCount, setSelectionCount } = useSelection('draft');
  const flow = useReactFlow<CardNode>();
  const { project, projectRef, store, mediaUrls, status, setStatus, error, setError, ready,
    dirty, setDirty, storedRevision, setStoredRevision, revisionRef, providerTotal,
    history, historyDepth, failed, hydrateMedia, hydrate, change, undoCommand, redoCommand }
    = useProject(initial, { flow, setNodes, setSelectedId, setNotice });
  const { assets, assetUrls, filter, setFilter, refreshAssets, addAssetFile, saveNodeToLibrary, setAssetMeta, useAsset }
    = useAssetLibrary({ store, ready, projectRef, selectedIdRef, change, hydrateMedia, setNotice, setError });
  const { run, runRef, applyRun, cancelRun, arkRun, arkRunRef, applyArkRun, cancelArkRun,
    speechRun, speechRunRef, applySpeechRun, cancelSpeechRun,
    videoRun, videoRunRef, applyVideoRun, cancelVideoRun,
    textRun, textRunRef, applyTextRun, cancelTextRun,
    textModel, setTextModel, outcome, setOutcome, pendingTarget, pendingEditor }
    = useRuns({ change, projectRef, store, refreshAssets, setNotice, setEditor });

  const selected = project.nodes.find(node => node.id === selectedId);
  const advice = selected ? adviceFor(project, selected.id) : [];
  const draft = selected && isMediaNode(selected) ? selected : null;
  const candidates = draft ? project.edges.filter(edge => edge.target === draft.id).map(edge => project.nodes.find(node => node.id === edge.source)!).filter(Boolean) : [];
  const spent = draft ? priceFor(draft.kind) : 0;

  const { patch, duplicateSelected, toolbarActions, onNodesChange, connect, createNode, deleteSelectedNode,
    removeCandidate, referenceInput, dropReference, changeRole, changeForm, submitSimulated }
    = useNodeActions({ change, projectRef, selectedIdRef, setSelectedId, setNotice, setPrepared, setPalette, setNodes,
      store, refreshAssets, hydrateMedia, selected, draft, outcome, applyRun, applyArkRun, applySpeechRun, applyVideoRun, pendingTarget });
  const { sendToAgent, confirmPlan, approveAdvice, runText }
    = useAgentActions({ change, projectRef, selectedIdRef, selected, setNotice, setPrepared, composerText, setComposerText,
      plan, setPlan, setAgentLog, textModel, applyTextRun, outcome, applyRun, applyArkRun, applySpeechRun, pendingTarget });
  const { exportReadonly, exportBundleFile, importBundleFile, exportResult, useTemplate }
    = useBundleActions({ store, projectRef, setNotice, setStatus, hydrateMedia, hydrate, refreshAssets, revisionRef, setStoredRevision, run });
  const { startEditorVariant, saveEditor, openTimeline, mergeCut, saveEditorCopy }
    = useEditorActions({ editor, setEditor, editorModel, pendingEditor, applyArkRun, setNotice, change, projectRef, timeline, setTimeline });

  const edges = useMemo(() => project.edges.map(edge => ({ ...edge, type: 'default', className: 'reference-edge' })), [project.edges]);

  useEffect(() => {
    setNodes(current => {
      const known = new Map(current.map(node => [node.id, node]));
      return project.nodes.map(item => {
        const mediaUrl = isMediaNode(item) && item.assetPath ? mediaUrls[item.assetPath] ?? assetUrls[item.assetPath] ?? simulatedUrl(item) : undefined;
        const existing = known.get(item.id);
        if (!existing) return { id: item.id, type: 'card' as const, data: { item, mediaUrl, toolbar: toolbarActions }, position: item.position, dragHandle: '.node-drag', selected: false };
        if (existing.data.item === item && existing.position === item.position && existing.data.mediaUrl === mediaUrl && existing.data.toolbar === toolbarActions) return existing;
        return { ...existing, data: { item, mediaUrl, toolbar: toolbarActions }, position: item.position };
      });
    });
  }, [project.nodes, mediaUrls, assetUrls, toolbarActions]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (editable(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); if (event.shiftKey) redoCommand(); else undoCommand(); return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); return; }
      if (event.code === 'Space') { event.preventDefault(); setSpace(true); }
      if ((event.metaKey || event.ctrlKey) && ['-', '=', '+'].includes(event.key)) {
        event.preventDefault(); const rect = document.querySelector('.canvas-stage')!.getBoundingClientRect();
        const next = zoomAt(flow.getViewport(), { x: rect.width / 2, y: rect.height / 2 }, event.key === '-' ? 0.85 : 1.15);
        void flow.setViewport(next);
      }
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') setSpace(false); };
    const blur = () => setSpace(false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [flow]);

  const inspectorProps = {
    selected, selectionCount, advice, approveAdvice, patch, runText, project, projectRef, change, setNotice,
    mediaUrls, assetUrls, assets, saveNodeToLibrary, setEditor, addAssetFile, useAsset, draft, candidates, changeForm,
    dropReference, changeRole, referenceInput, removeCandidate, submitSimulated, prepared, setPrepared, outcome, setOutcome,
    videoRun, videoRunRef, applyVideoRun, cancelVideoRun,
    arkRun, arkRunRef, applyArkRun, cancelArkRun,
    speechRun, speechRunRef, applySpeechRun, cancelSpeechRun,
    run, runRef, applyRun, cancelRun, spent, exportResult,
    textModel, setTextModel, textRun, textRunRef, applyTextRun, cancelTextRun,
    libraryOpen, setLibraryOpen, filter, setFilter, setAssetMeta,
    historyDepth, undoCommand, redoCommand, duplicateSelected, deleteSelectedNode,
    templatesOpen, setTemplatesOpen, preview, setPreview, useTemplate,
    plan, setPlan, confirmPlan, composerText, setComposerText, sendToAgent, manualMode, setManualMode,
    capabilitiesOpen, setCapabilitiesOpen, capabilityDetail, setCapabilityDetail, agentLog,
    timeline, setTimeline, mergeCut, editor, editorModel, setEditorModel, pendingEditor,
    saveEditor, saveEditorCopy, startEditorVariant, notice, error,
    storedRevision, providerTotal, store, failed, setDirty, status, initial, hydrate, hydrateMedia, revisionRef, setStoredRevision, setError, setStatus,
  };

  return <div className="workbench">
    <header className="masthead"><a className="projects-link" href="/?view=projects">← 项目</a><a className="wordmark" href="/">flowforge<span>画布</span></a><div className="bundle-tools"><button className="linkish" data-testid="export-readonly" onClick={() => void exportReadonly()}>导出只读视图</button><button className="linkish" onClick={() => void exportBundleFile()}>导出整包</button><label className="linkish bundle-trigger">导入整包<input type="file" hidden accept=".json,application/json" aria-label="导入整包" onChange={event => { const file = event.target.files?.[0]; if (file) void importBundleFile(file); event.target.value = ''; }} /></label></div><WalletBadge project={project} projectRef={projectRef} change={change} walletOpen={walletOpen} setWalletOpen={setWalletOpen} setNotice={setNotice} /><span className="save-state" role="status" data-testid="save-status">{status}</span></header>
    <section className="project-strip"><div><span className="eyebrow">画布</span><h1>{project.name}</h1></div><div className="project-stats"><strong>{project.nodes.length}</strong> 个节点 <span>/</span> <strong>{project.edges.length}</strong> 条连线 <span>/</span> <strong data-testid="snapshot-count">{project.snapshots.length}</strong> 次快照</div></section>
    <main className="workspace" data-testid="workspace-skeleton"><aside className="rail" data-testid="rail">
        <button className="rail-button" aria-label="Asset library" aria-expanded={libraryOpen} title="素材库" data-testid="library-toggle" onClick={() => setLibraryOpen(value => !value)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2c.6 0 1.2.24 1.6.7l.9 1.05c.3.35.75.55 1.2.55H18.5A2.5 2.5 0 0 1 21 9.8v7.7A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" /></svg></button>
        <button className="rail-button" aria-label="Templates" aria-expanded={templatesOpen} title="模板库" data-testid="templates-toggle" onClick={() => setTemplatesOpen(value => !value)}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.6" /><rect x="13" y="4" width="7" height="7" rx="1.6" /><rect x="4" y="13" width="7" height="7" rx="1.6" /><rect x="13" y="13" width="7" height="7" rx="1.6" /></svg></button>
        <button className="rail-button" aria-label="Timeline" aria-expanded={Boolean(timeline)} title="时间线" data-testid="timeline-toggle" onClick={() => timeline ? setTimeline(null) : openTimeline()}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.4" /><path d="M3 9h18M8 9v10M16 9v10" /></svg></button>
        <div className="add-node"><button aria-label="添加节点" aria-haspopup="menu" aria-expanded={palette} className="add-trigger" onClick={() => setPalette(value => !value)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
          {palette && <div className="add-menu" role="menu" aria-label="Node types">
            <button role="menuitem" aria-label="Text" onClick={() => createNode('text')}>文本</button>
            <button role="menuitem" aria-label="Image" onClick={() => createNode('image')}>图片</button>
            <button role="menuitem" aria-label="Video" onClick={() => createNode('video')}>视频</button>
            <button role="menuitem" aria-label="Audio" onClick={() => createNode('audio')}>音频</button>
            <button role="menuitem" disabled title={SCENE_NOTICE}>3D · 暂缓</button>
          </div>}
        </div>
        <button className="rail-button rail-soft" onClick={() => void flow.fitView({ padding: 0.2 })} aria-label="适应视图" title="适应视图"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5A1.5 1.5 0 0 1 18.5 20H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" /></svg></button>
        <button className="rail-button rail-soft" onClick={() => setMinimap(value => !value)} aria-pressed={minimap} aria-label="Map" title="小地图"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7l5-2.5 6 2.5 5-2.5v12.5L15 19.5 9 17l-5 2.5z" /></svg></button>
</aside>
      <CanvasStage ready={ready} nodes={nodes} edges={edges} minimap={minimap} space={space} project={project}
        projectRef={projectRef} change={change} flow={flow} onNodesChange={onNodesChange} connect={connect} history={history}
        setSelectedId={setSelectedId} setPrepared={setPrepared} setNotice={setNotice} setSelectionCount={setSelectionCount} />
      <Inspector {...inspectorProps} />
    </main>
    <footer className="page-footer"><span>本地优先 · 独立实现</span><span>拖动平移 · Ctrl/⌘ + 滚轮缩放 · Shift 多选</span><span>无遥测</span></footer>
    <section className="mobile-summary"><h2>需要更大的屏幕。</h2><p>这是桌面画布。当前屏幕上可以查看项目与输入内容；空间编辑请用桌面浏览器。</p></section>
  </div>;
}

export function App() {
  // The list is its own page; the canvas keeps its existing single-project route.
  if (new URLSearchParams(location.search).get('view') === 'projects') return <ProjectList />;
  return <ReactFlowProvider><Workbench /></ReactFlowProvider>;
}

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { freezeInputs, MOCK_MODELS, MOCK_SIZES, REFERENCE_ROLES, settingsOf, type GenerationSettings, type MediaNode, type Project, type ProjectNode, type ReferenceRole } from '../domain/project.ts';
import { arkReachable, ARK_IMAGE_MODELS, ARK_SIZES, type ArkRun } from '../providers/ark-provider.ts';
import { speechReachable, SPEECH_MODELS, SPEECH_SIZES, type SpeechRun } from '../providers/speech-provider.ts';
import { videoReachable, ARK_VIDEO_MODELS, videoCost, videoShape, type VideoRun } from '../providers/video-provider.ts';
import { textReachable, ARK_TEXT_MODELS, cancelTextRun, type TextRun } from '../providers/text-provider.ts';
import { TEXT_CREDITS_PER_CALL } from '../domain/money.ts';
import { openEditor, type EditorState } from '../domain/editor.ts';
import { isVideoAsset } from '../domain/assets.ts';
import { roleLabels, simulatedUrl } from '../lib/format.ts';
import { priceFor } from '../domain/pricing.ts';
import type { MockRun } from '../providers/mock-provider.ts';
import type { Advice } from '../domain/agent-advice.ts';

import type { AgentPlan } from '../domain/agent-plan.ts';
import type { AssetCategory, ProjectStore, StoredAsset } from '../persistence/project-store.ts';
import type { Command } from '../domain/history.ts';
import type { LibraryFilter } from '../domain/asset-library.ts';
import { RunPanels } from './RunPanels.tsx';
import { LibraryPanel } from './LibraryPanel.tsx';
import { TemplatePanel, TemplatePreview } from './TemplatePanel.tsx';
import { PlanCard } from './PlanCard.tsx';
import { AgentPanel } from './AgentPanel.tsx';
import { TimelinePanel } from './TimelinePanel.tsx';
import { EditorOverlay } from './EditorOverlay.tsx';
import { Diagnostics } from './Diagnostics.tsx';

interface InspectorProps {
  selected: ProjectNode | undefined;
  selectionCount: number;
  advice: readonly Advice[];
  approveAdvice: (advice: Advice) => void;
  patch: (id: string, values: Partial<ProjectNode>) => void;
  runText: () => void;
  project: Project;
  projectRef: RefObject<Project>;
  change: (next: Project, command?: Command) => void;
  setNotice: Dispatch<SetStateAction<string>>;
  mediaUrls: Record<string, string>;
  assetUrls: Record<string, string>;
  assets: StoredAsset[];
  saveNodeToLibrary: () => Promise<void>;
  setEditor: Dispatch<SetStateAction<EditorState | null>>;
  addAssetFile: (file: File) => Promise<void>;
  useAsset: (asset: StoredAsset) => void;
  draft: MediaNode | null;
  candidates: ProjectNode[];
  changeForm: (patch: Partial<GenerationSettings>) => void;
  dropReference: (nodeId: string) => void;
  changeRole: (nodeId: string, role: ReferenceRole) => void;
  referenceInput: (nodeId: string) => void;
  removeCandidate: (nodeId: string) => void;
  submitSimulated: () => void;
  prepared: boolean;
  setPrepared: Dispatch<SetStateAction<boolean>>;
  outcome: 'succeed' | 'fail';
  setOutcome: Dispatch<SetStateAction<'succeed' | 'fail'>>;
  videoRun: VideoRun | null; videoRunRef: RefObject<VideoRun | null>; applyVideoRun: (next: VideoRun | null) => void; cancelVideoRun: (run: VideoRun) => VideoRun;
  arkRun: ArkRun | null; arkRunRef: RefObject<ArkRun | null>; applyArkRun: (next: ArkRun | null) => void; cancelArkRun: (run: ArkRun) => ArkRun;
  speechRun: SpeechRun | null; speechRunRef: RefObject<SpeechRun | null>; applySpeechRun: (next: SpeechRun | null) => void; cancelSpeechRun: (run: SpeechRun) => SpeechRun;
  run: MockRun | null; runRef: RefObject<MockRun | null>; applyRun: (next: MockRun | null) => void; cancelRun: (run: MockRun) => MockRun;
  spent: number;
  exportResult: () => Promise<void>;
  textModel: string; setTextModel: Dispatch<SetStateAction<string>>;
  textRun: TextRun | null; textRunRef: RefObject<TextRun | null>; applyTextRun: (next: TextRun | null) => void; cancelTextRun: (run: TextRun) => TextRun;
  libraryOpen: boolean; setLibraryOpen: Dispatch<SetStateAction<boolean>>;
  filter: LibraryFilter; setFilter: Dispatch<SetStateAction<LibraryFilter>>;
  setAssetMeta: (asset: StoredAsset, patch: { category?: AssetCategory; favorite?: boolean }) => Promise<void>;
  historyDepth: { back: number; forward: number };
  undoCommand: () => void; redoCommand: () => void;
  duplicateSelected: () => void; deleteSelectedNode: () => void;
  templatesOpen: boolean; setTemplatesOpen: Dispatch<SetStateAction<boolean>>;
  preview: string | null; setPreview: Dispatch<SetStateAction<string | null>>;
  useTemplate: (templateId: string) => Promise<void>;
  plan: AgentPlan | null; setPlan: Dispatch<SetStateAction<AgentPlan | null>>; confirmPlan: () => void;
  composerText: string; setComposerText: Dispatch<SetStateAction<string>>;
  sendToAgent: () => void;
  manualMode: boolean; setManualMode: Dispatch<SetStateAction<boolean>>;
  capabilitiesOpen: boolean; setCapabilitiesOpen: Dispatch<SetStateAction<boolean>>;
  capabilityDetail: string; setCapabilityDetail: Dispatch<SetStateAction<string>>;
  agentLog: { role: 'user' | 'agent'; text: string }[];
  timeline: import('../domain/timeline.ts').Timeline | null; setTimeline: Dispatch<SetStateAction<import('../domain/timeline.ts').Timeline | null>>;
  mergeCut: () => void;
  editor: EditorState | null; editorModel: string; setEditorModel: Dispatch<SetStateAction<string>>;
  pendingEditor: RefObject<boolean>;
  saveEditor: () => void; saveEditorCopy: () => void; startEditorVariant: () => void;
  notice: string; error: string;
  storedRevision: number | null; providerTotal: number;
  store: ProjectStore; failed: RefObject<boolean>; setDirty: Dispatch<SetStateAction<number>>;
  status: string; initial: Project;
  hydrate: (value: Project) => void; hydrateMedia: (value: Project) => Promise<void>;
  revisionRef: RefObject<number | null>; setStoredRevision: Dispatch<SetStateAction<number | null>>;
  setError: Dispatch<SetStateAction<string>>; setStatus: Dispatch<SetStateAction<string>>;
}

/** Right-hand inspector: selection context, node editors, the generation form,
 * run panels, library/templates/plan/composer overlays, snapshots, diagnostics.
 * Pure rendering plus the small inline freeze action; every mutation goes
 * through the workbench callbacks. */
export function Inspector(props: InspectorProps) {
  const { selected, selectionCount, advice, approveAdvice, patch, runText, project, projectRef, change, setNotice,
    mediaUrls, assetUrls, assets, saveNodeToLibrary, setEditor, addAssetFile, useAsset, draft, candidates, changeForm,
    dropReference, changeRole, referenceInput, removeCandidate, submitSimulated, prepared, setPrepared, outcome, setOutcome,
    spent, textModel, setTextModel, textRun, textRunRef, applyTextRun, cancelTextRun,
    libraryOpen, setLibraryOpen, filter, setFilter, setAssetMeta,
    historyDepth, undoCommand, redoCommand, duplicateSelected, deleteSelectedNode,
    templatesOpen, setTemplatesOpen, preview, setPreview, useTemplate,
    plan, setPlan, confirmPlan, notice, error } = props;
  return <aside className="inspector" aria-label="Selection inspector" data-testid="inspector"><span className="eyebrow">节点详情</span>
    <div className="agent-context" data-testid="agent-context"><div className="section-label">上下文 <span>单步 · 不发送</span></div>
      {selected ? <p data-testid="context-line">{`上下文：${selected.title}`}{selectionCount > 1 ? `（多选 ${selectionCount} 个节点，主选中：${selected.title}）` : ''}</p>
        : <p className="muted" data-testid="context-empty">先选一个节点作为上下文；这里不会自动生成。</p>}
      {advice.length > 0 && <ul className="advice-list" data-testid="advice-list">{advice.map(item => <li key={item.id}><span>{item.title}</span><button className="linkish" aria-label={`Approve: ${item.title}`} onClick={() => approveAdvice(item)}>采纳</button></li>)}</ul>}
    </div>
    <h2>{selected?.title ?? '选择一个节点'}</h2>
    {selected && <label className="title-field">节点标题<input type="text" aria-label="节点标题" value={selected.title} onChange={event => patch(selected.id, { title: event.target.value })} /></label>}
    {selected?.kind === 'text' && <label>简报正文<textarea value={selected.text} onChange={event => patch(selected.id, { text: event.target.value })} /></label>}
    {selected?.kind === 'text' && <div className="text-generation" data-testid="text-panel">
      <div className="section-label">文本生成 <span>{textModel === 'simulated' ? '模拟' : '真实（文本）'}</span></div>
      <label>文本模型<select aria-label="Text model" value={textModel} onChange={event => setTextModel(event.target.value)}>
        <option value="simulated">模拟文本</option>
        {textReachable() && ARK_TEXT_MODELS.map(model => <option key={model.id} value={model.id}>{`${model.label} · 真实`}</option>)}
      </select></label>
      <p className="cost-badge" data-testid="text-cost">{textModel === 'simulated' ? '模拟 · 0 平台代币' : `${TEXT_CREDITS_PER_CALL} 平台代币 · 真实（文本）`}</p>
      <button className="primary" data-testid="text-run" onClick={runText} disabled={!selected.text.trim()}>生成文本 <span>↗</span></button>
      {textRun && <div className="run-panel" data-testid="text-run-panel"><span className="eyebrow">真实文本运行</span>
        <p>状态：<output data-testid="text-state">{textRun.state}</output></p>
        {textRun.state === 'running' && <button className="linkish" onClick={() => applyTextRun(cancelTextRun(textRunRef.current ?? textRun))}>取消真实文本</button>}
        {textRun.error && <p className="muted">{textRun.error}</p>}
      </div>}
      <p className="boundary">真实文本只在配置了接入点的环境发起；模拟输出不联网、不计费。</p>
    </div>}
    {selected?.kind === 'image' && <>{selected.assetPath
      ? <><img className="asset-preview" src={mediaUrls[selected.assetPath] ?? assetUrls[selected.assetPath] ?? simulatedUrl(selected)} alt="所选图片" /><p className="muted">{selected.assetSource === 'asset' ? '本地素材，仅存在此浏览器；未上传。' : selected.assetSource === 'simulated' ? '模拟结果：本地占位图，无模型产物。' : '内置示例图（CC0），本地 Blob，未上传。'}</p></>
      : <p className="muted" data-testid="empty-image">空图片草稿：可模拟生成，或添加本地素材；不会上传。</p>}
      <button className="linkish" data-testid="save-to-library" onClick={() => void saveNodeToLibrary()}>保存到素材库</button>
      <button className="linkish" data-testid="open-editor" onClick={() => setEditor(openEditor(selected.id, selected.prompt))}>打开图片编辑器</button>
      <label className="linkish asset-trigger">添加本地图片<input type="file" hidden data-testid="asset-input" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) void addAssetFile(file); event.target.value = ''; }} /></label>
      <div className="section-label">素材库 <span>本地 {assets.length} 个</span></div>
      {assets.length ? <ul className="asset-list">{assets.map(asset => <li key={asset.path} data-testid={`asset-${asset.name}`}>{isVideoAsset(asset.type) ? <video src={assetUrls[asset.path]} width={34} height={34} muted playsInline preload="metadata" /> : <img src={assetUrls[asset.path]} alt="" width={34} height={34} />}<span title={asset.name}>{asset.name}</span><button className="linkish" aria-label={`Use ${asset.name}`} onClick={() => useAsset(asset)}>使用</button></li>)}</ul> : <p className="empty-record">还没有素材。支持 PNG / JPEG / WebP 图片（单个 ≤5 MB）与 MP4 视频（≤50 MB），只存在此浏览器。</p>}
    </>}
    {draft && <><label>提示词草稿<textarea value={draft.prompt} onChange={event => patch(draft.id, { prompt: event.target.value })} /></label>
      <div className="section-label">生成参数 <span>{ARK_IMAGE_MODELS.some(entry => entry.id === settingsOf(draft).model) ? '真实（方舟）' : SPEECH_MODELS.some(entry => entry.id === settingsOf(draft).model) ? '真实（语音）' : ARK_VIDEO_MODELS.some(entry => entry.id === settingsOf(draft).model) ? '真实（视频）' : '模拟'}</span></div>
      <div className="form-grid">
        <label>模型<select aria-label="Model" value={settingsOf(draft).model} onChange={event => {
          const model = event.target.value as GenerationSettings['model'];
          const realSizes = ARK_SIZES[model] ?? SPEECH_SIZES[model] ?? ARK_VIDEO_MODELS.find(entry => entry.id === model)?.sizes;
          changeForm({ model, size: realSizes ? realSizes[0] : MOCK_SIZES[model as GenerationSettings['model']][0] });
        }}>
          {MOCK_MODELS.map(model => <option key={model} value={model}>{model}</option>)}
          {arkReachable() && ARK_IMAGE_MODELS.map(model => <option key={model.id} value={model.id}>{`${model.label} · 真实`}</option>)}
          {speechReachable() && draft.kind === 'audio' && SPEECH_MODELS.map(model => <option key={model.id} value={model.id}>{`${model.label} · 真实`}</option>)}
          {videoReachable() && draft.kind === 'video' && ARK_VIDEO_MODELS.map(model => <option key={model.id} value={model.id}>{`${model.label} · 真实`}</option>)}
        </select></label>
        <label>尺寸<select aria-label="Size" value={settingsOf(draft).size} onChange={event => changeForm({ size: event.target.value })}>
          {(ARK_SIZES[settingsOf(draft).model] ?? SPEECH_SIZES[settingsOf(draft).model] ?? ARK_VIDEO_MODELS.find(entry => entry.id === settingsOf(draft).model)?.sizes ?? MOCK_SIZES[settingsOf(draft).model as GenerationSettings['model']]).map(size => <option key={size} value={size}>{size}</option>)}
        </select></label>
        <label>变体数量<output data-testid="variants">1×</output></label>
        <label>预计消耗<output data-testid="cost-badge">{ARK_IMAGE_MODELS.some(entry => entry.id === settingsOf(draft).model)
          ? `${ARK_IMAGE_MODELS.find(entry => entry.id === settingsOf(draft).model)?.estimate} 平台代币 · 真实（方舟）`
          : SPEECH_MODELS.some(entry => entry.id === settingsOf(draft).model)
            ? '100 平台代币/分钟 · 真实（语音）'
            : ARK_VIDEO_MODELS.some(entry => entry.id === settingsOf(draft).model)
              ? `${videoCost(videoShape(settingsOf(draft).size).duration)} 平台代币 · 真实（视频）`
              : `${priceFor(draft.kind)} 平台代币 · 模拟`}</output></label>
      </div>
      <label className="outcome-field">模拟结果走向<select aria-label="Simulated outcome" value={outcome} onChange={event => setOutcome(event.target.value as 'succeed' | 'fail')}>
        <option value="succeed">成功</option>
        <option value="fail">失败</option>
      </select></label>
      <p className="muted">只有这里的值会进入快照；改动它们不会影响已生成的快照与结果。</p>
      <div className="section-label">已引用内容 <span>快照内 {draft.references.length} 项</span></div>
      <p className="muted">只有勾选的内容进入快照；画布上的连线本身不是输入。</p>
      {draft.references.length ? <ul className="reference-list" aria-label="References">{draft.references.map(ref => {
        const node = project.nodes.find(item => item.id === ref.nodeId);
        return <li className="reference-chip" data-testid={`reference-${ref.nodeId}`} key={ref.nodeId}>
          <span className="chip-kind">{node?.kind ?? 'unknown'}</span>
          <span className="chip-title" title={node?.title ?? ref.nodeId}>{node?.title ?? ref.nodeId}</span>
          <button className="chip-remove" aria-label={`Remove reference ${node?.title ?? ref.nodeId}`} onClick={() => dropReference(ref.nodeId)}>×</button>
          <div className="chip-meta">
            <small>第 {node?.revision} 版</small>
            <select aria-label={`Purpose of ${node?.title ?? ref.nodeId}`} value={ref.role} onChange={event => changeRole(ref.nodeId, event.target.value as ReferenceRole)}>
              {REFERENCE_ROLES.map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}
            </select>
          </div>
        </li>;
      })}</ul> : <p className="empty-record">还没有引用。在下面的可选节点里勾选。</p>}
      <div className="section-label">可选节点 <span>画布节点</span></div>
      <p className="muted">连线只产生候选；勾选后才算引用。</p>
      {candidates.map(node => { const ref = draft.references.find(item => item.nodeId === node.id); return <div className="reference-row" key={node.id}><label><input type="checkbox" aria-label={`引用 ${node.title}`} checked={!!ref} onChange={event => event.target.checked ? referenceInput(node.id) : dropReference(node.id)} /><span>{node.title}<small>第 {node.revision} 版</small></span></label><button className="linkish" aria-label={`移除候选 ${node.title}`} onClick={() => removeCandidate(node.id)}>移除候选</button></div>; })}
      <button className={prepared ? "primary is-prepared" : "primary"} data-testid="run-button" onClick={() => { setPrepared(false); submitSimulated(); }} disabled={!draft.references.length}>模拟运行 <span>↗</span></button>
      <button className="linkish freeze" data-testid="freeze-button" onClick={() => { try { const snapshot = freezeInputs(projectRef.current, draft.id); change({ ...projectRef.current, snapshots: [...projectRef.current.snapshots, snapshot] }, { kind: 'snapshot' }); setNotice('Input snapshot frozen. Inspection only; no generation.'); } catch (reason) { setNotice(String(reason)); } }}>冻结输入快照</button>
      <p className="boundary">仅本地模拟：不联网、不扣费、不读密钥。</p>
      <RunPanels {...props} />
    </>}
    {libraryOpen && <LibraryPanel assets={assets} assetUrls={assetUrls} filter={filter} setFilter={setFilter} setLibraryOpen={setLibraryOpen} useAsset={useAsset} setAssetMeta={setAssetMeta} />}
    <div className="history-bar"><span className="eyebrow">画布历史</span><output data-testid="history-depth">{historyDepth.back} back / {historyDepth.forward} forward</output>
      <div><button onClick={undoCommand} disabled={!historyDepth.back} aria-label="撤销画布操作">撤销</button><button onClick={redoCommand} disabled={!historyDepth.forward} aria-label="重做画布操作">重做</button></div>
      <p className="muted">自建命令栈；输入框内的文字编辑使用浏览器自带撤销。</p></div>
    {selected && <button className="linkish" onClick={duplicateSelected} data-testid="inspector-copy">复制节点</button>}
    {selected && <button className="danger" onClick={deleteSelectedNode} data-testid="inspector-delete">删除节点</button>}
    {templatesOpen && <TemplatePanel setTemplatesOpen={setTemplatesOpen} setPreview={setPreview} useTemplate={useTemplate} />}
    {preview && <TemplatePreview preview={preview} setPreview={setPreview} />}
    {plan && <PlanCard plan={plan} setPlan={setPlan} setNotice={setNotice} confirmPlan={confirmPlan} />}
    <AgentPanel selected={selected} composerText={props.composerText} setComposerText={props.setComposerText} sendToAgent={props.sendToAgent}
      manualMode={props.manualMode} setManualMode={props.setManualMode} capabilitiesOpen={props.capabilitiesOpen} setCapabilitiesOpen={props.setCapabilitiesOpen}
      capabilityDetail={props.capabilityDetail} setCapabilityDetail={props.setCapabilityDetail} agentLog={props.agentLog} />
    {props.timeline && <TimelinePanel timeline={props.timeline} setTimeline={props.setTimeline} mergeCut={props.mergeCut} project={project} />}
    {props.editor && <EditorOverlay editor={props.editor} setEditor={setEditor} editorModel={props.editorModel} setEditorModel={props.setEditorModel}
      project={project} mediaUrls={mediaUrls} arkRun={props.arkRun} arkRunRef={props.arkRunRef} applyArkRun={props.applyArkRun} cancelArkRun={props.cancelArkRun}
      pendingEditor={props.pendingEditor} saveEditor={props.saveEditor} saveEditorCopy={props.saveEditorCopy} startEditorVariant={props.startEditorVariant} setNotice={setNotice} />}
    {notice && <p className="notice" role="alert" data-testid="notice">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}
    <section className="snapshot-section"><div className="section-label">冻结快照 <span>仅查看</span></div>{project.snapshots.length ? <pre data-testid="snapshot-json">{JSON.stringify(project.snapshots.at(-1), null, 2)}</pre> : <div className="empty-record">还没有输入快照。<br />没有发送任何内容。</div>}</section>
    <Diagnostics storedRevision={props.storedRevision} providerTotal={props.providerTotal} mediaUrls={mediaUrls} store={props.store} failed={props.failed}
      setDirty={props.setDirty} status={props.status} initial={props.initial} hydrate={props.hydrate} hydrateMedia={props.hydrateMedia}
      revisionRef={props.revisionRef} setStoredRevision={props.setStoredRevision} setError={props.setError} setStatus={props.setStatus} />
  </aside>;
}

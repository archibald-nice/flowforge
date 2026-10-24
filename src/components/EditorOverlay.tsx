import type { Dispatch, RefObject, SetStateAction } from 'react';
import { arkReachable, ARK_IMAGE_MODELS, type ArkRun } from '../providers/ark-provider.ts';
import { canSave, currentVariant, selectVariant, setPrompt, type EditorState } from '../domain/editor.ts';
import { isMediaNode, type Project } from '../domain/project.ts';

export interface EditorOverlayProps {
  editor: EditorState;
  setEditor: Dispatch<SetStateAction<EditorState | null>>;
  editorModel: string;
  setEditorModel: Dispatch<SetStateAction<string>>;
  project: Project;
  mediaUrls: Record<string, string>;
  arkRun: ArkRun | null;
  arkRunRef: RefObject<ArkRun | null>;
  applyArkRun: (next: ArkRun | null) => void;
  cancelArkRun: (run: ArkRun) => ArkRun;
  pendingEditor: RefObject<boolean>;
  saveEditor: () => void;
  saveEditorCopy: () => void;
  startEditorVariant: () => void;
  setNotice: Dispatch<SetStateAction<string>>;
}

/** Fullscreen image editor dialog: base image or variant preview, thumbnails,
 * prompt + model picker, generate/cancel. The editor itself never calls a
 * model; generation goes through the workbench's Ark run. */
export function EditorOverlay({ editor, setEditor, editorModel, setEditorModel, project, mediaUrls, arkRun,
  arkRunRef, applyArkRun, cancelArkRun, pendingEditor, saveEditor, saveEditorCopy, startEditorVariant, setNotice }: EditorOverlayProps) {
  return <div className="editor-shell" role="dialog" aria-label="Image editor" data-testid="editor-shell">
    <header><span className="eyebrow">{`图片编辑器 · ${editorModel === 'simulated' ? '模拟' : '真实（方舟）'}`}</span>
      <div><button className="linkish" data-testid="editor-save" disabled={!canSave(editor)} onClick={saveEditor}>保存到节点</button>
      <button className="linkish" data-testid="editor-save-copy" disabled={!canSave(editor)} onClick={saveEditorCopy}>另存为副本</button>
      <button className="linkish" onClick={() => setEditor(null)} aria-label="Close editor">关闭</button></div></header>
    <div className="editor-canvas" data-testid="editor-canvas">
      {(() => {
        const source = project.nodes.find(node => node.id === editor.nodeId);
        const base = source && isMediaNode(source) ? source.assetPath : undefined;
        const baseUrl = base ? (mediaUrls[base] ?? base) : undefined;
        return <>
          {baseUrl && !currentVariant(editor) ? <figure className="editor-base"><img src={baseUrl} alt="当前节点图片" /><figcaption>{source?.title}</figcaption></figure> : null}
          {currentVariant(editor)
            ? <div className="editor-variant">模拟变体 {editor.selected + 1} / {editor.variants.length}<small>无真实像素，仅占位</small></div>
            : null}
          {!baseUrl && !currentVariant(editor) ? <p className="muted">还没有变体；这张草稿还没有图片，生成后才会出现在这里。</p> : null}
          <p className="muted editor-note">这个编辑器不会自己调用模型；生成前不会发出任何请求。</p>
        </>;
      })()}
      <ol className="editor-thumbs">{editor.variants.map((path, index) => <li key={path}><button aria-label={`Select variation ${index + 1}`} aria-pressed={editor.selected === index} onClick={() => setEditor(selectVariant(editor, index))}>v{index + 1}</button></li>)}</ol>
    </div>
    <footer className="editor-prompt"><input aria-label="编辑器提示词" placeholder="请输入图像生成的提示词" value={editor.prompt} onChange={event => setEditor(setPrompt(editor, event.target.value))} />
      <label className="editor-model">模型<select aria-label="Editor model" value={editorModel} onChange={event => setEditorModel(event.target.value)}>
        <option value="simulated">模拟变体</option>
        {arkReachable() && ARK_IMAGE_MODELS.map(model => <option key={model.id} value={model.id}>{`${model.label} · 真实`}</option>)}
      </select></label>
      <p className="cost-badge" data-testid="editor-cost">{editorModel === 'simulated' ? '模拟 · 0 平台代币' : `${ARK_IMAGE_MODELS.find(model => model.id === editorModel)?.estimate ?? 0} 平台代币 · 真实（方舟）`}</p>
      <button className="primary" data-testid="editor-generate" onClick={startEditorVariant}>生成变体</button>
      {arkRun && editorModel !== 'simulated' && <span className="muted" data-testid="editor-run-state">状态：{arkRun.state}</span>}
      {arkRun && arkRun.state === 'running' && <button className="linkish" data-testid="editor-cancel" onClick={() => { pendingEditor.current = false; applyArkRun(cancelArkRun(arkRunRef.current ?? arkRun)); setNotice('已取消编辑器内的真实生成：不写回变体。'); }}>取消真实变体</button>}
    </footer>
  </div>;
}

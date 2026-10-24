import type { Dispatch, RefObject, SetStateAction } from 'react';
import { duplicateNode, setNodeAsset, type GenerationSettings, type Project } from '../domain/project.ts';
import { startArkRun, ARK_IMAGE_MODELS, ARK_SIZES, type ArkRun } from '../providers/ark-provider.ts';
import { copyPlan, currentVariant, generateVariant, type EditorState } from '../domain/editor.ts';
import { createTimeline, durationOf, mergeTimeline, type Timeline } from '../domain/timeline.ts';
import type { Command } from '../domain/history.ts';

export interface EditorActionsDeps {
  editor: EditorState | null;
  setEditor: Dispatch<SetStateAction<EditorState | null>>;
  editorModel: string;
  pendingEditor: RefObject<boolean>;
  applyArkRun: (next: ArkRun | null) => void;
  setNotice: Dispatch<SetStateAction<string>>;
  change: (next: Project, command?: Command) => void;
  projectRef: RefObject<Project>;
  timeline: Timeline | null;
  setTimeline: Dispatch<SetStateAction<Timeline | null>>;
}

/** Image-editor and timeline actions: editor variant generation (simulated or
 * real via Ark), save/copy-back, and the simulated cutting room. */
export function useEditorActions({ editor, setEditor, editorModel, pendingEditor, applyArkRun, setNotice, change, projectRef, timeline, setTimeline }: EditorActionsDeps) {
  // Slice 2.3-real: the editor's generate button routes to the Ark provider when a
  // real image model is picked and the flag is on; the variant lands in the same
  // list as simulated ones, but as a real local asset path.
  const startEditorVariant = () => {
    if (!editor) return;
    if (!editor.prompt.trim()) { setNotice('先写提示词再生成变体。'); return; }
    if (editorModel === 'simulated') {
      try { setEditor(generateVariant(editor)); setNotice('模拟变体已加入列表；未联网。'); }
      catch (reason) { setNotice(String(reason)); }
      return;
    }
    const entry = ARK_IMAGE_MODELS.find(model => model.id === editorModel);
    if (!entry) { setNotice('未知的真实模型；本次不执行。'); return; }
    try {
      const started = startArkRun({ prompt: editor.prompt, settings: { model: entry.id as GenerationSettings['model'], size: ARK_SIZES[entry.id][0], variants: 1 } });
      pendingEditor.current = true;
      applyArkRun(started);
      setNotice('真实变体已提交到方舟（编辑器内生成，会产生实际费用）。结果只落本地。');
    } catch (reason) { setNotice(String(reason)); }
  };

  const saveEditor = () => {
    if (!editor) return;
    const variant = currentVariant(editor);
    if (!variant) return;
    try {
      change(setNodeAsset(projectRef.current, editor.nodeId, variant), { kind: 'edit', key: `editor:${editor.nodeId}` });
      setNotice('编辑器变体已保存到节点；未调用模型。');
      setEditor(null);
    } catch (reason) { setNotice(String(reason)); }
  };

  const openTimeline = () => {
    try { setTimeline(createTimeline(projectRef.current)); setNotice('已打开时间线：只做模拟剪辑，不调用模型。'); }
    catch (reason) { setNotice(String(reason)); setTimeline(null); }
  };

  const mergeCut = () => {
    if (!timeline) return;
    try {
      change(mergeTimeline(projectRef.current, timeline), { kind: 'edit', key: 'timeline' });
      setNotice(`已把模拟剪辑合并回画布（${durationOf(timeline)} 秒）；未调用模型。`);
      setTimeline(null);
    } catch (reason) { setNotice(String(reason)); }
  };

  const saveEditorCopy = () => {
    if (!editor) return;
    try {
      const plan = copyPlan(editor);
      const withCopy = duplicateNode(projectRef.current, plan.nodeId);
      const copy = withCopy.nodes[withCopy.nodes.length - 1];
      change(setNodeAsset(withCopy, copy.id, plan.variant), { kind: 'copy' });
      setNotice('已另存为新草稿：源节点未改动；仅模拟。');
      setEditor(null);
    } catch (reason) { setNotice(String(reason)); }
  };

  return { startEditorVariant, saveEditor, openTimeline, mergeCut, saveEditorCopy };
}

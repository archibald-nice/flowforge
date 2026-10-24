import type { Dispatch, RefObject, SetStateAction } from 'react';
import { addReference, freezeInputs, isMediaNode, applyTextResult, type MediaNode, type Project, type ProjectNode } from '../domain/project.ts';
import { withoutProviderCalls, runControls, startRun, type MockRun } from '../providers/mock-provider.ts';
import { arkReachable, startArkRun, ARK_IMAGE_MODELS, type ArkRun } from '../providers/ark-provider.ts';
import { speechReachable, startSpeechRun, SPEECH_MODELS, type SpeechRun } from '../providers/speech-provider.ts';
import { videoReachable, ARK_VIDEO_MODELS } from '../providers/video-provider.ts';
import { textReachable, startTextRun, ARK_TEXT_MODELS, type TextRun } from '../providers/text-provider.ts';
import { MOCK_MODELS } from '../domain/project.ts';
import { priceFor, walletOf } from '../domain/pricing.ts';
import { type Advice } from '../domain/agent-advice.ts';
import { type AgentPlan } from '../domain/agent-plan.ts';
import { localPlan, type PlanContext } from '../domain/llm-plan.ts';
import { plannerEnabled, requestPlan } from '../providers/llm-planner.ts';
import type { Command } from '../domain/history.ts';

export interface AgentActionsDeps {
  change: (next: Project, command?: Command) => void;
  projectRef: RefObject<Project>;
  selectedIdRef: RefObject<string>;
  selected: ProjectNode | undefined;
  setNotice: Dispatch<SetStateAction<string>>;
  setPrepared: Dispatch<SetStateAction<boolean>>;
  composerText: string;
  setComposerText: Dispatch<SetStateAction<string>>;
  plan: AgentPlan | null;
  setPlan: Dispatch<SetStateAction<AgentPlan | null>>;
  setAgentLog: Dispatch<SetStateAction<{ role: 'user' | 'agent'; text: string }[]>>;
  textModel: string;
  applyTextRun: (next: TextRun | null) => void;
  outcome: 'succeed' | 'fail';
  applyRun: (next: MockRun | null) => void;
  applyArkRun: (next: ArkRun | null) => void;
  applySpeechRun: (next: SpeechRun | null) => void;
  pendingTarget: RefObject<string>;
}

/** Agent-planning and text actions: build a plan (local or via the LLM
 * planner), confirm it onto the right provider path, approve advice cards, and
 * run text generation for text nodes. */
export function useAgentActions({ change, projectRef, selectedIdRef, selected, setNotice, setPrepared, composerText, setComposerText,
  plan, setPlan, setAgentLog, textModel, applyTextRun, outcome, applyRun, applyArkRun, applySpeechRun, pendingTarget }: AgentActionsDeps) {
  const planContext = (): PlanContext => ({
    allowedModels: [
      ...MOCK_MODELS,
      ...(arkReachable() ? ARK_IMAGE_MODELS.map(entry => entry.id) : []),
      ...(speechReachable() ? SPEECH_MODELS.map(entry => entry.id) : []),
      ...(videoReachable() ? ARK_VIDEO_MODELS.map(entry => entry.id) : []),
      ...(textReachable() ? ARK_TEXT_MODELS.map(entry => entry.id) : []),
    ],
    nodeIds: projectRef.current.nodes.map(node => node.id),
  });

  /**
   * Planner context: enabled model ids + canvas nodes. The model needs both —
   * without the model list it answers `targetModel: ""` and the plan is dropped.
   */
  const plannerContext = (planContextValue: PlanContext) => [
    `Enabled models: ${planContextValue.allowedModels.join(', ')}`,
    'Canvas nodes (nodeId · kind · title · content):',
    ...projectRef.current.nodes.map(node => {
      const body = node.kind === 'text' ? node.text : ('prompt' in node ? node.prompt : '');
      return `- ${node.id} · ${node.kind} · ${node.title}${body ? ` · ${String(body).slice(0, 120)}` : ''}`;
    }),
  ].join('\n');

  const sendToAgent = () => {
    const message = composerText.trim();
    const nodeId = selectedIdRef.current;
    if (plannerEnabled()) {
      const snapshotProject = projectRef.current;
      const context = planContext();
      setNotice('正在请求模型规划……');
      void requestPlan({ message, context: plannerContext(context), planContext: context }).then(plannerOutcome => {
        const chosen = plannerOutcome.plan ?? localPlan(snapshotProject, nodeId, message);
        setPlan(chosen);
        setAgentLog(log => [...log, { role: 'user', text: message }, { role: 'agent', text: chosen.title }]);
        setComposerText('');
        setNotice(plannerOutcome.plan
          ? `${chosen.title}：模型计划已生成，尚未执行（usage ${plannerOutcome.promptTokens}+${plannerOutcome.completionTokens} tokens）。`
          : `模型计划不可用，已回退本地建议（${plannerOutcome.error}）。尚未执行。`);
      });
      return;
    }
    try {
      const built = localPlan(projectRef.current, nodeId, message);
      setPlan(built);
      setAgentLog(log => [...log, { role: 'user', text: message }, { role: 'agent', text: built.title }]);
      setComposerText('');
      setNotice(`${built.title}：计划已生成，尚未执行。`);
    } catch (reason) { setNotice(String(reason)); }
  };

  const confirmPlan = () => {
    if (!plan) return;
    if (plan.modelKnown === false) {
      setNotice(`计划里的模型 ${plan.targetModel ?? '(空)'} 未在本机启用；请先换模型，本次不执行。`);
      return;
    }
    if (plan.kind === 'decline') { setNotice(plan.steps[0].detail); setPlan(null); return; }
    if (plan.kind === 'reference') {
      try {
        const sourceId = projectRef.current.nodes.find(node => node.id !== plan.targetNodeId && !isMediaNode(node) || node.id !== plan.targetNodeId)?.id;
        if (!sourceId) throw new Error('画布上还没有可引用的来源节点。');
        change(addReference(projectRef.current, plan.targetNodeId, sourceId), { kind: 'edit', key: `refs:${plan.targetNodeId}` });
        setNotice('引用已加入提交前清单。没有触发任何生成。');
      } catch (reason) { setNotice(String(reason)); }
      setPlan(null); return;
    }
    try {
      const target = projectRef.current.nodes.find(node => node.id === plan.targetNodeId);
      const price = priceFor(target?.kind ?? 'image');
      if (price > walletOf(projectRef.current)) throw new Error(`模拟额度不足：需要 ${price}，剩余 ${walletOf(projectRef.current)}。`);
      const snapshot = freezeInputs(projectRef.current, plan.targetNodeId);
      // Slice 3.3: a plan whose target has an Ark model selected routes the
      // confirmed execution to the real provider; every other target keeps the
      // mock five-state path. Video/audio plans never go real in this slice.
      const planSettings = snapshot.settings ?? { model: 'mock-still-a', size: '512', variants: 1 as const };
      if (target?.kind === 'image' && ARK_IMAGE_MODELS.some(entry => entry.id === planSettings.model)) {
        if (!arkReachable()) throw new Error('真实模型已选中，但 ARK_ENABLED 未开启；本次不执行。');
        const started = startArkRun({ prompt: snapshot.prompt, settings: { model: planSettings.model, size: planSettings.size, variants: 1 } });
        change({ ...projectRef.current, snapshots: [...projectRef.current.snapshots, snapshot] }, { kind: 'snapshot' });
        pendingTarget.current = plan.targetNodeId;
        applyArkRun(started);
        setPlan(null);
        setNotice('计划已确认：真实生成已提交到方舟（实际费用以方舟账单为准）。结果只落本地。');
        return;
      }
      // Slice 1.4: a plan targeting an audio node with the speech model runs real.
      if (target?.kind === 'audio' && SPEECH_MODELS.some(entry => entry.id === planSettings.model)) {
        if (!speechReachable()) throw new Error('真实音频已选中，但 SPEECH_ENABLED 未开启；本次不执行。');
        const started = startSpeechRun({ prompt: snapshot.prompt, settings: { model: planSettings.model, size: planSettings.size, variants: 1 } });
        change({ ...projectRef.current, snapshots: [...projectRef.current.snapshots, snapshot] }, { kind: 'snapshot' });
        pendingTarget.current = plan.targetNodeId;
        applySpeechRun(started);
        setPlan(null);
        setNotice('计划已确认：真实音频已提交到豆包语音（按分钟计费，实际以账单为准）。结果只落本地。');
        return;
      }
      runControls.failNext = outcome === 'fail';
      const started = startRun({ prompt: snapshot.prompt, settings: snapshot.settings,
        inputs: snapshot.inputs.map(input => ({ nodeId: input.nodeId, revision: input.revision, role: input.role })) });
      change({ ...projectRef.current, snapshots: [...projectRef.current.snapshots, snapshot] }, { kind: 'snapshot' });
      pendingTarget.current = plan.targetNodeId;
      applyRun(started);
      setNotice('计划已确认：模拟运行开始，可随时取消。');
      setPlan(null);
    } catch (reason) { setNotice(String(reason)); }
  };

  const approveAdvice = (advice: Advice) => {
    const target = projectRef.current.nodes.find(node => node.id === selectedIdRef.current);
    if (!target) return;
    if (advice.action === 'reference') {
      const draft = projectRef.current.edges
        .filter(edge => edge.source === target.id)
        .map(edge => projectRef.current.nodes.find(node => node.id === edge.target))
        .find(node => node && isMediaNode(node) && node.references.every(reference => reference.nodeId !== target.id));
      if (!draft) return;
      try {
        change(addReference(projectRef.current, draft.id, target.id), { kind: 'edit', key: `refs:${draft.id}` });
        setNotice('已采纳：加入草稿的提交前清单；没有运行，也没有调用模型。');
      } catch (reason) { setNotice(String(reason)); }
      return;
    }
    setPrepared(true);
    setNotice(advice.action === 'fill-prompt'
      ? '已采纳：没有执行任何操作；请先写好提示词，再自己提交。'
      : '已采纳：没有执行任何操作；需要时点「模拟运行」提交。');
  };

  // Slice 1.4-text: text nodes have no media form, so the text panel owns its own
  // model choice. Simulated writes a labelled placeholder; real does one request.
  const runText = () => {
    const node = selected && selected.kind === 'text' ? selected : null;
    if (!node) return;
    const prompt = node.text.trim();
    if (!prompt) { setNotice('先写提示词再生成文本。'); return; }
    if (textModel === 'simulated') {
      change(applyTextResult(projectRef.current, node.id, `${prompt}（模拟输出，未联网）`, {
        mode: 'simulated', model: 'simulated', promptTokens: 0, completionTokens: 0,
      }), { kind: 'edit', key: `textresult:${node.id}` });
      setNotice('模拟文本已写入节点（simulated）。未发起任何请求，未扣额度。');
      return;
    }
    try {
      applyTextRun(startTextRun({ prompt, nodeId: node.id, model: textModel }));
      setNotice('真实文本已提交到方舟（一次请求，失败不重试）。结果只落本地。');
    } catch (reason) { setNotice(String(reason)); }
  };

  return { sendToAgent, confirmPlan, approveAdvice, runText };
}

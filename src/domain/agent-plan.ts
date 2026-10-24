import { isMediaNode, settingsOf, type Project } from './project.ts';
import { priceFor } from './pricing.ts';

/** A plan is local rule output. Nothing here is an LLM call. */
export type PlanStep = Readonly<{ title: string; detail: string }>;
export type AgentPlan = Readonly<{
  id: string; title: string; steps: readonly PlanStep[]; estimate: number;
  targetNodeId: string; kind: 'generate' | 'reference' | 'decline';
  /** Slice 3.2-llm: where the plan came from, and the model it names. */
  source?: 'local' | 'model';
  targetModel?: string;
  /** false when the plan names a model that is not enabled here (confirm is blocked). */
  modelKnown?: boolean;
  /** What the model itself estimated, before the local price table replaced it. */
  modelEstimate?: number;
}>;

const ORDER = /生成|出图|画一?张|渲染|generate/i;

export function buildPlan(project: Project, nodeId: string | null, message: string): AgentPlan {
  const id = `plan-${crypto.randomUUID().slice(0, 8)}`;
  const text = message.trim();
  if (!text) throw new Error('先写一条消息，再生成计划。');
  if (!nodeId) {
    return { id, title: '先选一个节点作为上下文', steps: [{ title: '选择节点', detail: '在画布上点选一个节点，再发送一次。' }],
      estimate: 0, targetNodeId: '', kind: 'decline' };
  }
  const node = project.nodes.find(item => item.id === nodeId);
  if (!node) throw new Error('这个节点不在当前画布上。');
  if (node.kind === 'text') {
    return { id, title: '把这段文字接到草稿', steps: [
      { title: '读取文本节点', detail: `「${node.title}」的正文会作为提示词来源。` },
      { title: '等待你确认', detail: '确认只勾选引用，不触发任何生成。' },
    ], estimate: 0, targetNodeId: node.id, kind: 'reference' };
  }
  if (!isMediaNode(node)) {
    return { id, title: '这个节点暂不支持', steps: [{ title: '换一个节点', detail: '选文本或媒体节点再试。' }],
      estimate: 0, targetNodeId: node.id, kind: 'decline' };
  }
  const wantsGeneration = ORDER.test(text);
  const model = settingsOf(node).model;
  return { id, title: wantsGeneration ? `${node.kind === 'video' ? '视频' : '图片'}生成` : '整理这次提交', source: 'local', targetModel: model, modelKnown: true, steps: [
    { title: '读取上下文', detail: `「${node.title}」的提示词与显式引用进入快照。` },
    { title: wantsGeneration ? '提交一次模拟运行' : '保持草稿', detail: wantsGeneration ? '确认后才运行；可取消。' : '只更新草稿，不运行。' },
  ], estimate: wantsGeneration ? priceFor(node.kind) : 0, targetNodeId: node.id, kind: 'generate' };
}

/**
 * Slice 3.2-llm — a plan produced by the text model, validated before it is shown.
 *
 * Two rules from the brief shape everything here:
 * 1. The model output is data, never a command: only whitelisted fields are read,
 *    unknown fields are dropped, and an unenabled target model disables the
 *    confirm button instead of being silently replaced.
 * 2. Anything malformed falls back to the local rule plan with an explicit notice;
 *    there is no retry loop.
 */
import { buildPlan, type AgentPlan, type PlanStep } from './agent-plan.ts';
import { priceFor } from './pricing.ts';
import type { Project } from './project.ts';

export const PLAN_MAX_STEPS = 8;
export const PLAN_ACTIONS = ['reference', 'generate'] as const;
export const PLAN_KINDS = ['image', 'video', 'audio', 'text'] as const;

export const PLAN_SYSTEM_PROMPT = [
  'You plan canvas work for FlowForge.',
  'Answer with JSON only, no prose and no markdown fences:',
  '{"steps":[{"action":"reference|generate","nodeId":"<id from the context>","note":"one short sentence"}],',
  '"targetModel":"<model id from the enabled list>","estimate":{"kind":"image|video|audio|text","amount":<number>,"unit":"credits"}}',
  'Copy nodeId verbatim from the context line (the token before the first "·"). Do not invent indices or short codes.',
  'Never invent model ids. Keep notes under 20 words. Never claim anything was executed.',
].join('\n');

export type ModelPlanCheck =
  | { ok: true; plan: AgentPlan }
  | { ok: false; error: string };

export type PlanContext = Readonly<{
  /** Model ids enabled in this build; anything else disables confirmation. */
  allowedModels: readonly string[];
  /** Canvas node ids the plan may reference. */
  nodeIds: readonly string[];
}>;

/** Models often wrap JSON in a fence; strip it before parsing (brief §6.1). */
export function stripCodeFence(raw: string): string {
  const text = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function planFromModel(raw: string, context: PlanContext): ModelPlanCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    return { ok: false, error: '模型输出不是合法 JSON' };
  }
  if (!isRecord(parsed)) return { ok: false, error: '模型输出不是对象' };
  const steps = parsed.steps;
  if (!Array.isArray(steps) || steps.length === 0) return { ok: false, error: '计划缺少步骤' };
  if (steps.length > PLAN_MAX_STEPS) return { ok: false, error: `计划步骤超过 ${PLAN_MAX_STEPS} 条` };
  const allowedActions = new Set<string>(PLAN_ACTIONS);
  const allowedKinds = new Set<string>(PLAN_KINDS);
  const nodeIds = new Set(context.nodeIds);
  const cleanSteps: PlanStep[] = [];
  let targetNodeId = '';
  for (const step of steps) {
    if (!isRecord(step)) return { ok: false, error: '步骤格式不合法' };
    const action = String(step.action ?? '');
    if (!allowedActions.has(action)) return { ok: false, error: `未知动作：${action || '(空)'}` };
    const nodeId = String(step.nodeId ?? '');
    if (!nodeIds.has(nodeId)) return { ok: false, error: `步骤引用了不存在的节点：${nodeId || '(空)'}` };
    const note = typeof step.note === 'string' ? step.note.slice(0, 200) : '';
    cleanSteps.push({ title: action === 'generate' ? '生成' : '引用', detail: note || `节点 ${nodeId}` });
    if (!targetNodeId && action === 'generate') targetNodeId = nodeId;
  }
  if (!targetNodeId) targetNodeId = String((steps[0] as Record<string, unknown>).nodeId ?? '');
  const estimate = parsed.estimate;
  if (!isRecord(estimate)) return { ok: false, error: '计划缺少预估成本' };
  const kind = String(estimate.kind ?? '');
  if (!allowedKinds.has(kind)) return { ok: false, error: `未知的成本类型：${kind || '(空)'}` };
  const amount = Number(estimate.amount);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: '预估成本不是有效数字' };
  if (String(estimate.unit ?? '') !== 'credits') return { ok: false, error: '预估成本单位必须是 credits' };
  const targetModel = String(parsed.targetModel ?? '');
  if (!targetModel) return { ok: false, error: '计划缺少目标模型' };
  return {
    ok: true,
    plan: Object.freeze({
      id: `plan-${crypto.randomUUID().slice(0, 8)}`,
      title: '模型给出的计划',
      steps: Object.freeze(cleanSteps),
      // The card's number is the local price table (brief §6.2); the model's own
      // figure is kept beside it so the difference stays visible instead of hidden.
      estimate: priceFor(kind as (typeof PLAN_KINDS)[number]),
      modelEstimate: Math.round(amount * 100) / 100,
      targetNodeId,
      kind: cleanSteps.some(step => step.title === '生成') ? 'generate' : 'reference',
      source: 'model',
      targetModel,
      modelKnown: context.allowedModels.includes(targetModel),
    }),
  };
}

/** Local rule fallback: same card shape, explicitly marked as not model output. */
export function localPlan(project: Project, nodeId: string | null, message: string): AgentPlan {
  return { ...buildPlan(project, nodeId, message), source: 'local' };
}

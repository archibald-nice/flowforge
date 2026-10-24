/**
 * Slice 3.2-llm — ask the text model for a structured plan.
 *
 * Same endpoint and transport seam as the 1.4 text run, one request per attempt,
 * no retry loop (brief §5.2). The model's answer is only ever data: it is parsed
 * by `planFromModel`, which fails closed back to the local rule plan.
 */
import { completeChat, textEnabled } from './text-provider.ts';
import { PLAN_SYSTEM_PROMPT, planFromModel, type PlanContext } from '../domain/llm-plan.ts';
import type { AgentPlan } from '../domain/agent-plan.ts';

export type PlannerOutcome = Readonly<{
  plan: AgentPlan | null;
  error: string | null;
  promptTokens: number;
  completionTokens: number;
}>;

export function plannerEnabled(): boolean {
  return textEnabled();
}

export type PlannerInput = Readonly<{
  message: string;
  /** Canvas summary the model may reference; node ids must appear here. */
  context: string;
  planContext: PlanContext;
}>;

export async function requestPlan(input: PlannerInput): Promise<PlannerOutcome> {
  if (!plannerEnabled()) {
    return { plan: null, error: '文本接入点未启用', promptTokens: 0, completionTokens: 0 };
  }
  const reply = await completeChat([
    { role: 'system', content: PLAN_SYSTEM_PROMPT },
    { role: 'user', content: `${input.context}\n\n请求：${input.message}` },
  ]);
  if (!reply.ok) return { plan: null, error: reply.error, promptTokens: 0, completionTokens: 0 };
  const checked = planFromModel(reply.content, input.planContext);
  return {
    plan: checked.ok ? checked.plan : null,
    error: checked.ok ? null : checked.error,
    promptTokens: reply.promptTokens,
    completionTokens: reply.completionTokens,
  };
}

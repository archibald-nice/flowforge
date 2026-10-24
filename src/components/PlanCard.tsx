import type { Dispatch, SetStateAction } from 'react';
import type { AgentPlan } from '../domain/agent-plan.ts';

export interface PlanCardProps {
  plan: AgentPlan;
  setPlan: Dispatch<SetStateAction<AgentPlan | null>>;
  setNotice: Dispatch<SetStateAction<string>>;
  confirmPlan: () => void;
}

/** The agent plan card: steps, estimate, confirm/cancel. Confirming never runs
 * a provider call by itself — see Workbench.confirmPlan. */
export function PlanCard({ plan, setPlan, setNotice, confirmPlan }: PlanCardProps) {
  return <section className="plan-card" data-testid="plan-card">
    <header><span className="eyebrow">计划 · 未执行</span><strong>{plan.title}</strong></header>
    <ol>{plan.steps.map((step, index) => <li key={step.title} data-step={index + 1}><div><strong>{step.title}</strong><p>{step.detail}</p></div></li>)}</ol>
    <p className="muted" data-testid="plan-source">{plan.source === 'model' ? '来源：文本模型' : '来源：本地规则（未调用模型）'}{plan.targetModel ? ` · 目标模型 ${plan.targetModel}` : ''}{plan.modelKnown === false ? ' · 未启用，不可确认' : ''}</p>
    <footer><span data-testid="plan-estimate">预估 {plan.estimate} 平台代币 · 本地单价表{typeof plan.modelEstimate === 'number' && plan.modelEstimate !== plan.estimate ? `（模型自估 ${plan.modelEstimate}）` : ''}</span>
      {plan.kind === 'decline' ? <button className="primary" onClick={() => setPlan(null)}>知道了</button>
        : <><button className="linkish" data-testid="plan-cancel" onClick={() => { setPlan(null); setNotice('计划已取消，没有执行任何动作。'); }}>取消</button>
          <button className="primary" data-testid="plan-confirm" disabled={plan.modelKnown === false} onClick={confirmPlan}>{plan.kind === 'reference' ? '确认加入引用' : '确认执行'}</button></>}
    </footer>
  </section>;
}

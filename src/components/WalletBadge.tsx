import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Project } from '../domain/project.ts';
import { PLANS, topUp, walletOf } from '../domain/pricing.ts';
import type { Command } from '../domain/history.ts';

export interface WalletBadgeProps {
  project: Project;
  projectRef: RefObject<Project>;
  change: (next: Project, command?: Command) => void;
  walletOpen: boolean;
  setWalletOpen: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<string>>;
}

/** Masthead wallet button + the simulated top-up panel. Local credits only:
 * no card, no bill, no account. */
export function WalletBadge({ project, projectRef, change, walletOpen, setWalletOpen, setNotice }: WalletBadgeProps) {
  return <div className="wallet"><button className="credits" data-testid="credits" aria-expanded={walletOpen} onClick={() => setWalletOpen(v => !v)}>{walletOf(project)} 额度</button>{walletOpen && <div className="wallet-panel" data-testid="wallet-panel"><span className="eyebrow">本地模拟额度</span><p className="muted">本地单价：文本 1、图片 5、视频 30、音频 10 平台代币 / 次；真实调用按 100 平台代币 = 1 元换算。本版本不提供支付。</p><ul>{PLANS.map(plan => <li key={plan.id}>{plan.name} · {plan.credits} 额度 · 模拟<button className="linkish" aria-label={`Top up ${plan.name}`} onClick={() => { change(topUp(projectRef.current, plan.credits), { kind: 'edit', key: 'wallet' }); setNotice(`${plan.name} 已加到本地额度；未发生支付。`); }}>充值</button></li>)}</ul><p className="boundary">仅本地模拟：无卡、无账单、无账户。</p></div>}</div>;
}

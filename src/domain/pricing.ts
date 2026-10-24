import { DEFAULT_CREDITS, type NodeKind, type Project } from './project.ts';
import { CREDITS_PER_YUAN, yuanToCredits } from './money.ts';

export { CREDITS_PER_YUAN, yuanToCredits };

/**
 * Local, simulated pricing. These numbers mirror what the target UI displayed on
 * 2026-10-22 (image 5, video 6 per second at 480p → 30 for the default 5 s,
 * audio 10, text 1) but the unit itself is unverified, so everything here is a
 * designed local table, never a claim about the real billing system.
 *
 * Slice 1.4 follow-up: 1 CNY = 100 credits (CREDITS_PER_YUAN), so real runs and
 * the simulated table share one credits ledger.
 */
export { DEFAULT_CREDITS };
const TABLE: Record<NodeKind, number> = { text: 1, image: 5, video: 30, audio: 10, scene: 0 };

export type Plan = Readonly<{ id: string; name: string; credits: number; simulated: true }>;
export const PLANS: readonly Plan[] = Object.freeze([
  Object.freeze({ id: 'starter', name: 'Starter pack', credits: 500, simulated: true as const }),
  Object.freeze({ id: 'studio', name: 'Studio pack', credits: 2000, simulated: true as const }),
]);

export const priceTable = (): Readonly<Record<NodeKind, number>> => Object.freeze({ ...TABLE });
export const priceFor = (kind: NodeKind): number => TABLE[kind];

export const walletOf = (project: Project): number => project.credits ?? DEFAULT_CREDITS;

export function spendCredits(project: Project, kind: NodeKind): Project {
  const price = priceFor(kind);
  const wallet = walletOf(project);
  if (price > wallet) throw new Error(`模拟额度不足：需要 ${price}，剩余 ${wallet}。`);
  return { ...project, credits: wallet - price };
}

/**
 * Slice 1.4: real audio is billed by duration (1 CNY per minute), so the local
 * wallet has to accept fractional amounts. Kept separate from the integer kind
 * table so the simulated price list stays untouched.
 */
export function spendAmount(project: Project, amount: number): Project {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Choose a valid simulated amount.');
  const wallet = walletOf(project);
  if (amount > wallet) throw new Error(`模拟额度不足：需要 ${amount}，剩余 ${wallet}。`);
  return { ...project, credits: Math.round((wallet - amount) * 100) / 100 };
}

export function topUp(project: Project, amount: number): Project {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Choose a positive simulated top-up.');
  return { ...project, credits: walletOf(project) + amount };
}

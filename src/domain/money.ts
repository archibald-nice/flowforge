/**
 * One local wallet unit is 100 credits per CNY. The target UI showed
 * "1 USD = 100 credits" on 2026-10-22; the simulated price table is expressed
 * in the same credits unit, and real providers bill in CNY, so every real run converts
 * through this single rate instead of keeping a second currency.
 *
 * This module has no imports on purpose: providers can use the rate without
 * creating a project ↔ provider ↔ pricing cycle.
 */
export const CREDITS_PER_YUAN = 100;

/**
 * Designed: the observed product shows no cost for text generation ("-"), so a
 * local text call costs one unit instead of a token-derived amount. Token usage
 * is still recorded on the node; billing stays inferred until the invoice.
 */
export const TEXT_CREDITS_PER_CALL = 1;

export function yuanToCredits(yuan: number): number {
  if (!Number.isFinite(yuan) || yuan < 0) throw new Error('Choose a valid real cost.');
  return Math.round(yuan * CREDITS_PER_YUAN * 100) / 100;
}

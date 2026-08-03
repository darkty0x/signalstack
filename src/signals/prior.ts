import type { AgentConfig } from "../config.js";
import type { ObservedMarket, SignalEstimate } from "../types.js";
import { clampProb } from "../util/math.js";

/**
 * Soft base-rate prior for thin / extreme Delphi books when Polymarket/LLM
 * don't match. Extreme implied (e.g. 99.9%) gets faded toward a calmer band
 * so edge isn't stuck at 0 just because signals are missing.
 */
export function priorSignals(
  market: ObservedMarket,
  cfg: AgentConfig,
): SignalEstimate[] {
  const hi = cfg.prior.extremeHigh;
  const lo = cfg.prior.extremeLow;
  const targetHi = cfg.prior.targetHigh;
  const targetLo = cfg.prior.targetLow;
  const out: SignalEstimate[] = [];

  for (const outcome of market.outcomes) {
    const p = outcome.marketProb;
    let target: number | null = null;
    if (p >= hi) target = targetHi;
    else if (p <= lo) target = targetLo;
    if (target === null) continue;

    const faded = clampProb(
      p + (target - p) * cfg.prior.fadeStrength,
    );
    const gap = Math.abs(faded - p);
    if (gap < 0.01) continue;

    out.push({
      source: "prior",
      outcomeIdx: outcome.idx,
      probability: faded,
      confidence: Math.min(0.7, 0.35 + gap),
      note: `prior fade ${(p * 100).toFixed(1)}%→${(faded * 100).toFixed(1)}%`,
    });
  }
  return out;
}

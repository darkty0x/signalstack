import type { AgentConfig } from "../config.js";
import type { ObservedMarket, SignalEstimate } from "../types.js";
import { clampProb } from "../util/math.js";

/**
 * Anti-herd: when Delphi implied is far from external (or a soft prior),
 * fade the crowded side toward the external / mean.
 */
export function antiHerdSignals(
  market: ObservedMarket,
  external: SignalEstimate[],
  cfg: AgentConfig,
): SignalEstimate[] {
  const byIdx = new Map(external.map((e) => [e.outcomeIdx, e]));
  const out: SignalEstimate[] = [];

  for (const outcome of market.outcomes) {
    const ext = byIdx.get(outcome.idx);
    if (!ext) continue;
    const gap = outcome.marketProb - ext.probability;
    if (Math.abs(gap) < cfg.antiHerd.crowdGap) continue;

    // Pull probability away from crowded Delphi toward external.
    const faded = clampProb(
      outcome.marketProb - gap * cfg.antiHerd.fadeStrength,
    );
    out.push({
      source: "antiHerd",
      outcomeIdx: outcome.idx,
      probability: faded,
      confidence: Math.min(0.8, 0.4 + Math.abs(gap)),
      note: `fade crowd gap=${(gap * 100).toFixed(1)}pp vs external`,
    });
  }
  return out;
}

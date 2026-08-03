import type { AgentConfig } from "../config.js";
import type { BlendedView, ObservedMarket, SignalEstimate } from "../types.js";
import { clampProb } from "../util/math.js";
import { antiHerdSignals } from "./antiHerd.js";
import { externalSignals } from "./external.js";
import { llmSignals } from "./llm.js";
import { priorSignals } from "./prior.js";

function weightedMean(
  parts: Array<{ p: number; w: number; conf: number }>,
): { p: number; conf: number } {
  let num = 0;
  let den = 0;
  let confNum = 0;
  for (const part of parts) {
    const w = part.w * part.conf;
    if (w <= 0) continue;
    num += part.p * w;
    den += w;
    confNum += part.conf * part.w;
  }
  if (den <= 0) return { p: 0.5, conf: 0 };
  return { p: clampProb(num / den), conf: clampProb(confNum / den) };
}

/**
 * Priority when signals disagree: external > calibrated LLM > anti-herd >
 * extreme-book prior. Market implied alone only when nothing else fires.
 */
export async function blendMarket(
  market: ObservedMarket,
  cfg: AgentConfig,
): Promise<BlendedView[]> {
  const external = await externalSignals(market, cfg);
  const needLlm = external.length === 0 || cfg.llm.enabled;
  const llm = needLlm ? await llmSignals(market, cfg) : [];
  const anti = antiHerdSignals(market, external, cfg);
  const prior = external.length === 0 ? priorSignals(market, cfg) : [];

  const byOutcome = (rows: SignalEstimate[], idx: number) =>
    rows.filter((r) => r.outcomeIdx === idx);

  return market.outcomes.map((outcome) => {
    const signals: SignalEstimate[] = [
      ...byOutcome(external, outcome.idx),
      ...byOutcome(llm, outcome.idx),
      ...byOutcome(anti, outcome.idx),
      ...byOutcome(prior, outcome.idx),
    ];

    const parts: Array<{ p: number; w: number; conf: number; reason: string }> =
      [];

    for (const s of byOutcome(external, outcome.idx)) {
      parts.push({
        p: s.probability,
        w: cfg.weights.external,
        conf: s.confidence,
        reason: s.note,
      });
    }
    for (const s of byOutcome(llm, outcome.idx)) {
      parts.push({
        p: s.probability,
        w: cfg.weights.llm,
        conf: s.confidence,
        reason: s.note,
      });
    }
    for (const s of byOutcome(anti, outcome.idx)) {
      parts.push({
        p: s.probability,
        w: cfg.weights.antiHerd,
        conf: s.confidence,
        reason: s.note,
      });
    }
    for (const s of byOutcome(prior, outcome.idx)) {
      parts.push({
        p: s.probability,
        w: cfg.weights.prior,
        conf: s.confidence,
        reason: s.note,
      });
    }

    // If no independent signal, stay near market (no trade incentive).
    if (parts.length === 0) {
      parts.push({
        p: outcome.marketProb,
        w: 1,
        conf: 0.2,
        reason: "no external/llm/prior signal — use market",
      });
    }

    const { p, conf } = weightedMean(parts);
    const edge = p - outcome.marketProb;
    return {
      outcomeIdx: outcome.idx,
      label: outcome.label,
      marketProb: outcome.marketProb,
      blendedProb: p,
      edge,
      confidence: conf,
      signals,
      reasons: parts.map((x) => x.reason),
    };
  });
}

import type { Market } from "@gensyn-ai/gensyn-delphi-sdk";
import type { DelphiClient } from "@gensyn-ai/gensyn-delphi-sdk";
import type { AgentConfig } from "../config.js";
import type { ObservedMarket } from "../types.js";
import { hoursUntil, settlementScore } from "../util/math.js";

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function toObserved(market: Market, cfg: AgentConfig): ObservedMarket | null {
  const question = market.metadata?.question?.trim();
  const outcomes = market.metadata?.outcomes ?? [];
  const probs = market.spotImpliedProbabilities;
  if (!question || outcomes.length < 2 || !probs || probs.length < 2) {
    return null;
  }

  const settlesAtMs =
    parseTime(market.settlesAt) ?? parseTime(market.resolvesAt);
  const resolvesAtMs = parseTime(market.resolvesAt);
  const hours = hoursUntil(settlesAtMs);
  const score = settlementScore(hours, {
    minHours: cfg.minSettlementHours,
    maxHours: cfg.maxSettlementHours,
    deadlineMs: cfg.deadlineMs,
    settleMs: settlesAtMs,
  });

  return {
    id: market.id as `0x${string}`,
    question,
    category: market.category || "miscellaneous",
    marketUrl: market.marketUrl,
    resolvesAtMs,
    settlesAtMs,
    hoursToSettlement: hours,
    settlementScore: score,
    outcomes: outcomes.map((label, idx) => ({
      idx,
      label,
      marketProb: probs[idx] ?? 0,
      spotPrice: market.spotPrices?.[idx],
    })),
  };
}

export async function observeMarkets(
  client: DelphiClient,
  cfg: AgentConfig,
): Promise<ObservedMarket[]> {
  const { markets } = await client.listMarkets({
    status: "open",
    limit: cfg.marketLimit,
    orderBy: "settles_at",
    pricesAndImpliedProbabilities: true,
  });

  const observed = (markets ?? [])
    .map((m) => toObserved(m, cfg))
    .filter((m): m is ObservedMarket => m !== null)
    .filter((m) => m.settlementScore > 0)
    .sort((a, b) => b.settlementScore - a.settlementScore);

  return observed;
}

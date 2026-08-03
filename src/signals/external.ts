import type { AgentConfig } from "../config.js";
import type { ObservedMarket, SignalEstimate } from "../types.js";
import { similarity } from "../util/math.js";
import { log } from "../util/log.js";

type GammaEvent = {
  title?: string;
  slug?: string;
  markets?: Array<{
    question?: string;
    outcomePrices?: string;
    outcomes?: string;
    active?: boolean;
    closed?: boolean;
  }>;
};

function parsePrices(raw?: string): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    }
  } catch {
    // ignore
  }
  return [];
}

function parseOutcomes(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // ignore
  }
  return [];
}

/**
 * Match Delphi questions to Polymarket Gamma events and map YES/multi prices.
 * External odds are the primary truth anchor when similarity clears the floor.
 */
export async function externalSignals(
  market: ObservedMarket,
  cfg: AgentConfig,
): Promise<SignalEstimate[]> {
  const q = encodeURIComponent(market.question.slice(0, 120));
  const url = `${cfg.polymarketGammaUrl}/public-search?q=${q}&limit_per_type=${cfg.external.maxResults}`;

  let events: GammaEvent[] = [];
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      log("warn", "polymarket search failed", { status: res.status });
      return [];
    }
    const body = (await res.json()) as { events?: GammaEvent[] } | GammaEvent[];
    events = Array.isArray(body) ? body : (body.events ?? []);
  } catch (err) {
    log("warn", "polymarket search error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  let best:
    | {
        sim: number;
        title: string;
        prices: number[];
        outcomes: string[];
      }
    | undefined;

  for (const ev of events) {
    const title = ev.title ?? "";
    for (const m of ev.markets ?? []) {
      if (m.closed) continue;
      const question = m.question ?? title;
      const sim = Math.max(
        similarity(market.question, question),
        similarity(market.question, title),
      );
      if (sim < cfg.external.minSimilarity) continue;
      const prices = parsePrices(m.outcomePrices);
      const outcomes = parseOutcomes(m.outcomes);
      if (prices.length === 0) continue;
      if (!best || sim > best.sim) {
        best = { sim, title: question, prices, outcomes };
      }
    }
  }

  if (!best) return [];

  const out: SignalEstimate[] = [];
  for (const outcome of market.outcomes) {
    // Prefer label match; fall back to same index for binary YES/NO.
    let price: number | undefined;
    const label = outcome.label.toLowerCase();
    const idx = best.outcomes.findIndex((o) => o.toLowerCase() === label);
    if (idx >= 0) price = best.prices[idx];
    else if (
      best.prices.length === market.outcomes.length &&
      best.prices[outcome.idx] !== undefined
    ) {
      price = best.prices[outcome.idx];
    } else if (
      market.outcomes.length === 2 &&
      best.prices.length >= 2 &&
      (label === "yes" || label === "no")
    ) {
      price = label === "yes" ? best.prices[0] : best.prices[1];
    }

    if (price === undefined || !Number.isFinite(price)) continue;
    out.push({
      source: "external",
      outcomeIdx: outcome.idx,
      probability: Math.min(0.99, Math.max(0.01, price)),
      confidence: Math.min(0.95, 0.55 + best.sim),
      note: `Polymarket~${best.sim.toFixed(2)}: ${best.title}`,
    });
  }
  return out;
}

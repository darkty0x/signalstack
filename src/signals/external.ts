import type { AgentConfig } from "../config.js";
import type { ObservedMarket, SignalEstimate } from "../types.js";
import { similarity, tokenize } from "../util/math.js";
import { log } from "../util/log.js";

type GammaEvent = {
  title?: string;
  closed?: boolean;
  markets?: Array<{
    question?: string;
    outcomePrices?: string;
    outcomes?: string;
    active?: boolean;
    closed?: boolean;
  }>;
};

const STOP = new Set([
  "will",
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "by",
  "to",
  "for",
  "and",
  "or",
  "be",
  "at",
  "end",
  "before",
  "after",
  "reach",
  "year",
  "price",
  "close",
  "less",
  "than",
  "more",
  "next",
  "this",
  "that",
  "with",
  "from",
  "into",
  "over",
  "under",
  "official",
  "announced",
  "released",
]);

const CRYPTO = new Set([
  "btc",
  "bitcoin",
  "eth",
  "ethereum",
  "doge",
  "dogecoin",
  "sol",
  "solana",
  "usdc",
  "usdt",
  "pi",
]);

function keyTokens(text: string): string[] {
  return tokenize(text).filter((t) => {
    if (STOP.has(t)) return false;
    if (/^20\d{2}$/.test(t)) return false; // years are too common
    if (CRYPTO.has(t)) return true;
    if (/\d/.test(t)) return true;
    return t.length >= 4;
  });
}

const WEAK_KEYS = new Set([
  "airdrop",
  "token",
  "network",
  "launch",
  "price",
  "win",
  "wins",
  "return",
  "open",
  "year",
]);

function themes(text: string): Set<string> {
  const raw = text.toLowerCase();
  const t = new Set<string>();
  if (
    /championship|formula\s*1|\bf1\b|drivers|grand slam|us open|masters 1000|verstappen|sinner/.test(
      raw,
    )
  ) {
    t.add("sports");
  }
  if (
    /(\$|usd|price|reach \$|touch \$?\d)/.test(raw) &&
    /(bitcoin|btc|eth|ethereum|doge|sol|pi network|\bpi\b)/.test(raw)
  ) {
    t.add("crypto_price");
  }
  if (/airdrop/.test(raw)) t.add("airdrop");
  if (/launch a token|token launch|perform an airdrop/.test(raw)) {
    t.add("token_event");
  }
  if (/pandemic|who-declared/.test(raw)) t.add("pandemic");
  if (/doge-1|lunar mission|spacex/.test(raw)) t.add("space");
  if (/election|chancellor|resign|voter turnout/.test(raw)) t.add("politics");
  if (/gta|released before/.test(raw)) t.add("entertainment");
  return t;
}

function matchQuality(delphiQ: string, polyQ: string): number {
  const sim = similarity(delphiQ, polyQ);
  const A = keyTokens(delphiQ);
  const B = new Set(keyTokens(polyQ));
  if (A.length === 0) return 0;
  const shared = A.filter((t) => B.has(t));
  const cover = shared.length / A.length;
  const strong = shared.filter(
    (t) => CRYPTO.has(t) || t.length >= 6 || /\d/.test(t),
  );
  const strongShared = shared.filter((t) => !WEAK_KEYS.has(t));
  if (shared.length === 0) return 0;
  if (strongShared.length === 0) return 0;
  if (shared.length === 1 && strong.length === 0) return 0;

  const ta = themes(delphiQ);
  const tb = themes(polyQ);
  if (ta.size > 0 && tb.size > 0 && ![...ta].some((x) => tb.has(x))) {
    return 0;
  }

  // Single-token name matches need high coverage (avoid Verstappen≠Action).
  if (shared.length === 1 && cover < 0.5) return 0;

  return Math.min(1, sim * 0.45 + cover * 0.55 + (strong.length > 0 ? 0.08 : 0));
}

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

function searchQueries(question: string): string[] {
  const full = question.slice(0, 120).trim();
  const tokens = tokenize(question).filter((t) => !STOP.has(t));
  const short = tokens.slice(0, 7).join(" ");
  const shorter = tokens.slice(0, 4).join(" ");
  return [...new Set([full, short, shorter].filter((q) => q.length >= 3))];
}

async function fetchEvents(
  baseUrl: string,
  q: string,
  limit: number,
): Promise<GammaEvent[]> {
  const url = `${baseUrl}/public-search?q=${encodeURIComponent(q)}&limit_per_type=${limit}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    log("warn", "polymarket search failed", { status: res.status, q });
    return [];
  }
  const body = (await res.json()) as { events?: GammaEvent[] } | GammaEvent[];
  return Array.isArray(body) ? body : (body.events ?? []);
}

/**
 * Match Delphi questions to Polymarket Gamma events and map YES/multi prices.
 * External odds are the primary truth anchor when similarity clears the floor.
 */
export async function externalSignals(
  market: ObservedMarket,
  cfg: AgentConfig,
): Promise<SignalEstimate[]> {
  const queries = searchQueries(market.question);
  const eventLists = await Promise.all(
    queries.map((q) =>
      fetchEvents(cfg.polymarketGammaUrl, q, cfg.external.maxResults).catch(
        () => [] as GammaEvent[],
      ),
    ),
  );
  const events = eventLists.flat();

  let best:
    | {
        sim: number;
        title: string;
        prices: number[];
        outcomes: string[];
      }
    | undefined;

  for (const ev of events) {
    if (ev.closed) continue;
    const title = ev.title ?? "";
    for (const m of ev.markets ?? []) {
      if (m.closed) continue;
      const question = m.question ?? title;
      const sim = Math.max(
        matchQuality(market.question, question),
        matchQuality(market.question, title),
      );
      if (sim < cfg.external.minSimilarity) continue;
      const prices = parsePrices(m.outcomePrices);
      const outcomes = parseOutcomes(m.outcomes);
      if (prices.length === 0) continue;
      if (!best || sim > best.sim) {
        best = { sim, title: question || title, prices, outcomes };
      }
    }
  }

  if (!best) return [];

  const out: SignalEstimate[] = [];
  for (const outcome of market.outcomes) {
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

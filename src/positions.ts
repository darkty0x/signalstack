import type { DelphiClient } from "@gensyn-ai/gensyn-delphi-sdk";
import type { AgentConfig } from "./config.js";
import type { PositionRow } from "./types.js";

/** Parse share amounts that may arrive as integer strings or decimal strings. */
export function parseShares(raw: string): bigint {
  const s = raw.trim();
  if (!s) return 0n;
  if (/^\d+$/.test(s)) return BigInt(s);
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  // If already human shares (e.g. "12.5"), convert to 18 decimals.
  if (s.includes(".")) return BigInt(Math.floor(n * 1e18));
  return BigInt(Math.floor(n));
}

export async function listOpenPositions(
  client: DelphiClient,
  cfg: AgentConfig,
): Promise<PositionRow[]> {
  const { positions } = await client.listPositions({
    wallet: cfg.wallet,
    redeemedOrLiquidated: false,
    limit: 200,
  });

  const rows: PositionRow[] = [];
  for (const p of positions ?? []) {
    const shares = parseShares(p.shares);
    if (shares <= 0n) continue;

    let question: string | undefined;
    let outcome: string | undefined;
    let url: string | undefined;
    try {
      const market = await client.getMarket({
        id: p.marketProxy,
        pricesAndImpliedProbabilities: false,
      });
      question = market.metadata?.question;
      outcome = market.metadata?.outcomes?.[Number(p.outcomeIdx)];
      url = market.marketUrl;
    } catch {
      // market metadata optional
    }

    rows.push({
      market: p.marketProxy,
      outcomeIdx: Number(p.outcomeIdx),
      shares: shares.toString(),
      sharesHuman: Number(shares) / 1e18,
      marketStatus: p.marketStatus,
      question,
      outcome,
      url,
    });
  }
  return rows;
}

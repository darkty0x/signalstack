import type { DelphiClient } from "@gensyn-ai/gensyn-delphi-sdk";
import type { AgentConfig } from "./config.js";
import type { PortfolioSummary, PositionRow } from "./types.js";
import { readBalances } from "./balances.js";

/** Competition / practice starting bankroll (allowlist faucet). */
export const STARTING_BANKROLL = 1000;

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
    const sharesHuman = Number(shares) / 1e18;
    const outcomeIdx = Number(p.outcomeIdx);

    let question: string | undefined;
    let outcome: string | undefined;
    let url: string | undefined;
    let spotPrice: number | undefined;
    try {
      const market = await client.getMarket({
        id: p.marketProxy,
        pricesAndImpliedProbabilities: true,
      });
      question = market.metadata?.question;
      outcome = market.metadata?.outcomes?.[outcomeIdx];
      url = market.marketUrl;
      const spot = market.spotPrices?.[outcomeIdx];
      const implied = market.spotImpliedProbabilities?.[outcomeIdx];
      if (typeof spot === "number" && Number.isFinite(spot) && spot > 0) {
        spotPrice = spot;
      } else if (
        typeof implied === "number" &&
        Number.isFinite(implied) &&
        implied > 0
      ) {
        spotPrice = implied;
      }
    } catch {
      // market metadata optional
    }

    const markValue =
      spotPrice !== undefined ? sharesHuman * spotPrice : undefined;
    rows.push({
      market: p.marketProxy,
      outcomeIdx,
      shares: shares.toString(),
      sharesHuman,
      marketStatus: p.marketStatus,
      question,
      outcome,
      url,
      spotPrice,
      markValue,
      settleIfWin: sharesHuman,
    });
  }
  return rows;
}

export function summarizePortfolio(
  positions: PositionRow[],
  cash: number,
  cfg: AgentConfig,
): PortfolioSummary {
  const markValue = positions.reduce(
    (sum, p) => sum + (Number(p.markValue) || 0),
    0,
  );
  const settleIfWin = positions.reduce(
    (sum, p) => sum + (Number(p.settleIfWin) || Number(p.sharesHuman) || 0),
    0,
  );
  const sharesHeld = positions.reduce(
    (sum, p) => sum + (Number(p.sharesHuman) || 0),
    0,
  );
  const equity = cash + markValue;
  const tokenLabel =
    cfg.network === "competition-testnet" ? "TST" : "USDC";
  return {
    cash,
    markValue,
    equity,
    settleIfWin: cash + settleIfWin,
    pnlMark: equity - STARTING_BANKROLL,
    startingBankroll: STARTING_BANKROLL,
    tokenLabel,
    positionCount: positions.length,
    sharesHeld,
  };
}

export async function loadPortfolio(
  client: DelphiClient,
  cfg: AgentConfig,
): Promise<{ positions: PositionRow[]; portfolio: PortfolioSummary }> {
  const [positions, bal] = await Promise.all([
    listOpenPositions(client, cfg),
    readBalances(client, cfg),
  ]);
  const cash = Number(bal.token) || bal.bankrollUsdc || 0;
  return {
    positions,
    portfolio: summarizePortfolio(positions, cash, cfg),
  };
}

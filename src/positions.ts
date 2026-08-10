import type { DelphiClient } from "@gensyn-ai/gensyn-delphi-sdk";
import type { AgentConfig } from "./config.js";
import type { PortfolioSummary, PositionRow } from "./types.js";
import { readBalances } from "./balances.js";
import { journal, log } from "./util/log.js";

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

export type SellResult = {
  ok: boolean;
  dryRun: boolean;
  market: string;
  outcomeIdx: number;
  outcome?: string;
  question?: string;
  sharesIn: string;
  sharesHuman: number;
  tokensOut?: string;
  minTokensOut?: string;
  tx?: string;
  error?: string;
};

/** Sell one open position (full size by default). */
export async function sellPosition(
  client: DelphiClient,
  cfg: AgentConfig,
  args: {
    market: string;
    outcomeIdx: number;
    /** 0–1 fraction of held shares; default 1 = all. */
    fraction?: number;
  },
): Promise<SellResult> {
  const market = args.market.toLowerCase() as `0x${string}`;
  const outcomeIdx = Number(args.outcomeIdx);
  const fraction = Math.min(1, Math.max(0.01, Number(args.fraction) || 1));

  const positions = await listOpenPositions(client, cfg);
  const row = positions.find(
    (p) =>
      p.market.toLowerCase() === market && Number(p.outcomeIdx) === outcomeIdx,
  );
  if (!row) {
    return {
      ok: false,
      dryRun: cfg.dryRun,
      market,
      outcomeIdx,
      sharesIn: "0",
      sharesHuman: 0,
      error: "Position not found",
    };
  }

  const held = parseShares(row.shares);
  const sharesIn =
    fraction >= 0.999
      ? held
      : (held * BigInt(Math.floor(fraction * 10_000))) / 10_000n;
  if (sharesIn <= 0n) {
    return {
      ok: false,
      dryRun: cfg.dryRun,
      market,
      outcomeIdx,
      outcome: row.outcome,
      question: row.question,
      sharesIn: "0",
      sharesHuman: 0,
      error: "Nothing to sell",
    };
  }

  const base: SellResult = {
    ok: true,
    dryRun: cfg.dryRun,
    market,
    outcomeIdx,
    outcome: row.outcome,
    question: row.question,
    sharesIn: sharesIn.toString(),
    sharesHuman: Number(sharesIn) / 1e18,
  };

  try {
    const quote = await client.quoteSell({
      marketAddress: market,
      outcomeIdx,
      sharesIn,
    });
    const minTokensOut =
      (quote.tokensOut * BigInt(10_000 - cfg.slippageBps)) / 10_000n;
    base.tokensOut = quote.tokensOut.toString();
    base.minTokensOut = minTokensOut.toString();

    if (cfg.dryRun) {
      journal("dry_run_sell", {
        market,
        outcomeIdx,
        outcome: row.outcome,
        question: row.question,
        sharesIn: sharesIn.toString(),
        tokensOut: quote.tokensOut.toString(),
        minTokensOut: minTokensOut.toString(),
        manual: true,
      });
      log("info", "DRY_RUN manual sell", base);
      return base;
    }

    const tx = await client.sellShares({
      marketAddress: market,
      outcomeIdx,
      sharesIn,
      minTokensOut,
    });
    base.tx = tx.transactionHash;
    journal("sell", {
      market,
      outcomeIdx,
      outcome: row.outcome,
      question: row.question,
      sharesIn: sharesIn.toString(),
      tokensOut: quote.tokensOut.toString(),
      minTokensOut: minTokensOut.toString(),
      tx: tx.transactionHash,
      manual: true,
    });
    log("info", "manual sell filled", base);
    return base;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    journal("sell_error", {
      market,
      outcomeIdx,
      error,
      manual: true,
    });
    log("error", "manual sell failed", { market, error });
    return { ...base, ok: false, error };
  }
}

/** Sell every open position. Continues after individual failures. */
export async function sellAllPositions(
  client: DelphiClient,
  cfg: AgentConfig,
): Promise<{ ok: boolean; results: SellResult[] }> {
  const positions = await listOpenPositions(client, cfg);
  const results: SellResult[] = [];
  for (const p of positions) {
    results.push(
      await sellPosition(client, cfg, {
        market: p.market,
        outcomeIdx: p.outcomeIdx,
        fraction: 1,
      }),
    );
  }
  return {
    ok: results.length > 0 && results.every((r) => r.ok),
    results,
  };
}

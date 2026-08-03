import type { DelphiClient } from "@gensyn-ai/gensyn-delphi-sdk";
import type { AgentConfig } from "../config.js";
import { blendMarket } from "../signals/blend.js";
import type { ObservedMarket, TradeIntent } from "../types.js";
import { kellyFraction } from "../util/math.js";
import { log } from "../util/log.js";
import { readBalances } from "../balances.js";
import { parseShares } from "../positions.js";

type Inventory = Map<string, bigint>;

async function loadInventory(
  client: DelphiClient,
  cfg: AgentConfig,
): Promise<Inventory> {
  const map: Inventory = new Map();
  try {
    const { positions } = await client.listPositions({
      wallet: cfg.wallet,
      redeemedOrLiquidated: false,
      limit: 200,
    });
    for (const p of positions ?? []) {
      const shares = parseShares(p.shares);
      if (shares <= 0n) continue;
      map.set(`${p.marketProxy.toLowerCase()}:${p.outcomeIdx}`, shares);
    }
  } catch {
    // inventory optional pre-funding
  }
  return map;
}

function invKey(market: string, outcomeIdx: number) {
  return `${market.toLowerCase()}:${outcomeIdx}`;
}

function edgeAfterImpact(args: {
  edge: number;
  marketProb: number;
  spotPrice?: number;
  probeTokensIn: bigint;
  probeShares: bigint;
  fullTokensIn: bigint;
  fullShares: bigint;
  slippageBps: number;
}): number {
  const slip = args.slippageBps / 10_000;
  const sharesHuman = Number(args.fullShares) / 1e18;
  if (!(sharesHuman > 0)) return args.edge - slip;

  const quotedCps = Number(args.fullTokensIn) / 1e6 / sharesHuman;
  const spot = args.spotPrice && args.spotPrice > 0 ? args.spotPrice : null;
  let impactPct = 0;
  if (spot) {
    impactPct = Math.max(0, (quotedCps - spot) / spot);
  } else {
    const probeCps = Number(args.probeTokensIn) / Number(args.probeShares);
    const fullCps = Number(args.fullTokensIn) / Number(args.fullShares);
    impactPct = probeCps > 0 ? Math.max(0, fullCps / probeCps - 1) : 0;
  }
  // Thin DPM books can quote absurd impact; cap the haircut.
  if (!Number.isFinite(impactPct)) impactPct = 0.25;
  impactPct = Math.min(0.25, impactPct);
  return args.edge - impactPct - slip;
}

export async function decideTrades(
  client: DelphiClient,
  markets: ObservedMarket[],
  cfg: AgentConfig,
): Promise<TradeIntent[]> {
  let bankroll = 1000;
  try {
    const bal = await readBalances(client, cfg);
    if (bal.bankrollUsdc > 0) bankroll = bal.bankrollUsdc;
  } catch {
    // default until signer wired
  }

  const inventory = await loadInventory(client, cfg);
  const intents: TradeIntent[] = [];
  let actions = 0;

  for (const market of markets) {
    if (actions >= cfg.maxTradesPerCycle) break;

    const views = await blendMarket(market, cfg);
    const ranked = [...views].sort(
      (a, b) =>
        Math.abs(b.edge) * b.confidence * market.settlementScore -
        Math.abs(a.edge) * a.confidence * market.settlementScore,
    );

    for (const view of ranked.slice(0, 2)) {
      if (actions >= cfg.maxTradesPerCycle) break;

      const held = inventory.get(invKey(market.id, view.outcomeIdx)) ?? 0n;
      const spotPrice = market.outcomes.find(
        (o) => o.idx === view.outcomeIdx,
      )?.spotPrice;

      if (view.edge <= -cfg.minEdge && held > 0n) {
        try {
          const quote = await client.quoteSell({
            marketAddress: market.id,
            outcomeIdx: view.outcomeIdx,
            sharesIn: held,
          });
          const minOut =
            (quote.tokensOut * BigInt(10_000 - cfg.slippageBps)) / 10_000n;
          intents.push({
            market,
            view,
            side: "sell",
            shares: held,
            tokensEstimate: quote.tokensOut,
            minTokensOut: minOut,
            edgeAfterCost: view.edge,
            sizeFraction: 0,
          });
          actions += 1;
          log("info", "sell candidate", {
            question: market.question,
            outcome: view.label,
            edge: view.edge,
          });
        } catch (err) {
          intents.push({
            market,
            view,
            side: "sell",
            shares: 0n,
            tokensEstimate: 0n,
            edgeAfterCost: view.edge,
            sizeFraction: 0,
            skipReason: "illiquid",
          });
          log("warn", "sell quote failed", {
            question: market.question,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }

      if (Math.abs(view.edge) < cfg.minEdge) {
        intents.push({
          market,
          view,
          side: view.edge >= 0 ? "buy" : "sell",
          shares: 0n,
          tokensEstimate: 0n,
          edgeAfterCost: view.edge,
          sizeFraction: 0,
          skipReason: "below_floor",
        });
        continue;
      }

      if (view.edge <= 0) {
        intents.push({
          market,
          view,
          side: "sell",
          shares: 0n,
          tokensEstimate: 0n,
          edgeAfterCost: view.edge,
          sizeFraction: 0,
          skipReason: held > 0n ? "hold" : "no_shares",
        });
        continue;
      }

      const frac = Math.min(
        cfg.maxBetFraction,
        kellyFraction(view.blendedProb, view.marketProb, cfg.kellyFraction) *
          view.confidence *
          market.settlementScore,
      );
      if (frac <= 0.005) {
        intents.push({
          market,
          view,
          side: "buy",
          shares: 0n,
          tokensEstimate: 0n,
          edgeAfterCost: view.edge,
          sizeFraction: frac,
          skipReason: "too_small",
        });
        continue;
      }

      try {
        const probe = await client.quoteBuy({
          marketAddress: market.id,
          outcomeIdx: view.outcomeIdx,
          sharesOut: cfg.probeShares,
        });
        const probeCost = Number(probe.tokensIn) / 1e6;
        if (!(probeCost > 0)) {
          intents.push({
            market,
            view,
            side: "buy",
            shares: 0n,
            tokensEstimate: 0n,
            edgeAfterCost: view.edge,
            sizeFraction: frac,
            skipReason: "illiquid",
          });
          continue;
        }

        const targetUsdc = Math.min(bankroll * frac, bankroll * 0.95);
        const shareUnits = Math.max(0.2, targetUsdc / probeCost);
        const sharesOut = BigInt(Math.floor(shareUnits * 1e18));

        const quote = await client.quoteBuy({
          marketAddress: market.id,
          outcomeIdx: view.outcomeIdx,
          sharesOut,
        });

        const edgeAfterCost = edgeAfterImpact({
          edge: view.edge,
          marketProb: view.marketProb,
          spotPrice,
          probeTokensIn: probe.tokensIn,
          probeShares: cfg.probeShares,
          fullTokensIn: quote.tokensIn,
          fullShares: sharesOut,
          slippageBps: cfg.slippageBps,
        });

        const maxTokensIn =
          (quote.tokensIn * BigInt(10_000 + cfg.slippageBps)) / 10_000n;

        if (edgeAfterCost < cfg.minEdge) {
          intents.push({
            market,
            view,
            side: "buy",
            shares: sharesOut,
            tokensEstimate: quote.tokensIn,
            maxTokensIn,
            edgeAfterCost,
            sizeFraction: frac,
            skipReason: "impact",
          });
          continue;
        }

        intents.push({
          market,
          view,
          side: "buy",
          shares: sharesOut,
          tokensEstimate: quote.tokensIn,
          maxTokensIn,
          edgeAfterCost,
          sizeFraction: frac,
        });
        actions += 1;
        bankroll = Math.max(0, bankroll - Number(quote.tokensIn) / 1e6);

        log("info", "buy candidate", {
          question: market.question,
          outcome: view.label,
          edge: view.edge,
          edgeAfterCost,
          frac,
          reasons: view.reasons.slice(0, 3),
        });
      } catch (err) {
        intents.push({
          market,
          view,
          side: "buy",
          shares: 0n,
          tokensEstimate: 0n,
          edgeAfterCost: view.edge,
          sizeFraction: frac,
          skipReason: "illiquid",
        });
        log("warn", "buy quote failed", {
          question: market.question,
          error: err instanceof Error ? err.message.slice(0, 160) : String(err),
        });
      }
    }
  }

  return intents;
}

/** Fast desk preview: blend only, no quotes/inventory RPCs. */
export async function previewTrades(
  markets: ObservedMarket[],
  cfg: AgentConfig,
): Promise<TradeIntent[]> {
  const blended = await Promise.all(
    markets.map(async (market) => {
      const views = await blendMarket(market, cfg);
      const ranked = [...views].sort(
        (a, b) =>
          Math.abs(b.edge) * b.confidence * market.settlementScore -
          Math.abs(a.edge) * a.confidence * market.settlementScore,
      );
      return { market, views: ranked.slice(0, 2) };
    }),
  );

  const intents: TradeIntent[] = [];
  for (const row of blended) {
    for (const view of row.views) {
      if (Math.abs(view.edge) < cfg.minEdge) {
        intents.push({
          market: row.market,
          view,
          side: view.edge >= 0 ? "buy" : "sell",
          shares: 0n,
          tokensEstimate: 0n,
          edgeAfterCost: view.edge,
          sizeFraction: 0,
          skipReason: "below_floor",
        });
        continue;
      }
      if (view.edge <= 0) {
        intents.push({
          market: row.market,
          view,
          side: "sell",
          shares: 0n,
          tokensEstimate: 0n,
          edgeAfterCost: view.edge,
          sizeFraction: 0,
          skipReason: "no_shares",
        });
        continue;
      }
      intents.push({
        market: row.market,
        view,
        side: "buy",
        shares: 0n,
        tokensEstimate: 0n,
        edgeAfterCost: view.edge,
        sizeFraction: 0,
        skipReason: "preview",
      });
    }
  }
  return intents;
}

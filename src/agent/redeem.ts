import {
  LIQUIDATABLE_MARKET_STATUSES,
  type DelphiClient,
} from "@gensyn-ai/gensyn-delphi-sdk";
import type { AgentConfig } from "../config.js";
import { journal, log } from "../util/log.js";

export async function redeemAndLiquidate(
  client: DelphiClient,
  cfg: AgentConfig,
): Promise<number> {
  const { positions } = await client.listPositions({
    wallet: cfg.wallet,
    redeemedOrLiquidated: false,
    limit: 100,
  });

  let done = 0;
  const byMarket = new Map<string, number[]>();
  for (const p of positions ?? []) {
    const list = byMarket.get(p.marketProxy) ?? [];
    list.push(Number(p.outcomeIdx));
    byMarket.set(p.marketProxy, list);
  }

  for (const [marketAddress, outcomeIndices] of byMarket) {
    const status = await client.getMarketStatus(marketAddress as `0x${string}`);
    if (cfg.dryRun) {
      log("info", "DRY_RUN exit check", { marketAddress, status });
      continue;
    }

    try {
      if (LIQUIDATABLE_MARKET_STATUSES.includes(status)) {
        const tx = await client.liquidate({
          marketAddress: marketAddress as `0x${string}`,
          outcomeIndices: [...new Set(outcomeIndices)],
        });
        journal("liquidate", {
          marketAddress,
          status,
          tx: tx.transactionHash,
        });
        done += 1;
      } else if (status === "settled") {
        const tx = await client.redeemMarket({
          marketAddress: marketAddress as `0x${string}`,
        });
        journal("redeem", {
          marketAddress,
          status,
          tx: tx.transactionHash,
          tokensOut: tx.tokensOut.toString(),
        });
        done += 1;
      }
    } catch (err) {
      log("warn", "exit failed", {
        marketAddress,
        status,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return done;
}

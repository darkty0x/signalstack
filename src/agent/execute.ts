import type { DelphiClient } from "@gensyn-ai/gensyn-delphi-sdk";
import type { AgentConfig } from "../config.js";
import type { TradeIntent } from "../types.js";
import { journal, log } from "../util/log.js";

export async function executeIntents(
  client: DelphiClient,
  intents: TradeIntent[],
  cfg: AgentConfig,
): Promise<{ executed: number; skipped: number }> {
  let executed = 0;
  let skipped = 0;

  // Execute sells first to free capital, then buys.
  const ordered = [
    ...intents.filter((i) => i.side === "sell"),
    ...intents.filter((i) => i.side !== "sell"),
  ];

  for (const intent of ordered) {
    const needsBuy = intent.side === "buy" && intent.maxTokensIn;
    const needsSell = intent.side === "sell" && intent.minTokensOut;
    if (
      intent.skipReason ||
      intent.shares <= 0n ||
      (!needsBuy && !needsSell)
    ) {
      skipped += 1;
      journal("skip", {
        market: intent.market.id,
        question: intent.market.question,
        outcome: intent.view.label,
        reason: intent.skipReason ?? "no size",
        edge: intent.view.edge,
        edgeAfterCost: intent.edgeAfterCost,
      });
      continue;
    }

    const payload = {
      dryRun: cfg.dryRun,
      market: intent.market.id,
      question: intent.market.question,
      outcomeIdx: intent.view.outcomeIdx,
      outcome: intent.view.label,
      side: intent.side,
      shares: intent.shares.toString(),
      maxTokensIn: intent.maxTokensIn?.toString(),
      minTokensOut: intent.minTokensOut?.toString(),
      edge: intent.view.edge,
      edgeAfterCost: intent.edgeAfterCost,
      blendedProb: intent.view.blendedProb,
      marketProb: intent.view.marketProb,
      reasons: intent.view.reasons,
      url: intent.market.marketUrl,
    };

    if (cfg.dryRun) {
      log("info", `DRY_RUN ${intent.side}`, payload);
      journal(`dry_run_${intent.side}`, payload);
      executed += 1;
      continue;
    }

    try {
      if (intent.side === "sell" && intent.minTokensOut) {
        const tx = await client.sellShares({
          marketAddress: intent.market.id,
          outcomeIdx: intent.view.outcomeIdx,
          sharesIn: intent.shares,
          minTokensOut: intent.minTokensOut,
        });
        log("info", "sell filled", { ...payload, tx: tx.transactionHash });
        journal("sell", { ...payload, tx: tx.transactionHash });
      } else if (intent.maxTokensIn) {
        await client.ensureTokenApproval({
          marketAddress: intent.market.id,
          minimumAmount: intent.maxTokensIn,
        });
        const tx = await client.buyShares({
          marketAddress: intent.market.id,
          outcomeIdx: intent.view.outcomeIdx,
          sharesOut: intent.shares,
          maxTokensIn: intent.maxTokensIn,
        });
        log("info", "buy filled", { ...payload, tx: tx.transactionHash });
        journal("buy", { ...payload, tx: tx.transactionHash });
      }
      executed += 1;
    } catch (err) {
      skipped += 1;
      log("error", `${intent.side} failed`, {
        market: intent.market.id,
        error: err instanceof Error ? err.message : String(err),
      });
      journal(`${intent.side}_error`, {
        market: intent.market.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { executed, skipped };
}

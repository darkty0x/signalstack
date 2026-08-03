#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { getClient } from "./client.js";
import { readBalances } from "./balances.js";
import { runCycle, watch } from "./agent/loop.js";
import { observeMarkets } from "./agent/observe.js";
import { blendMarket } from "./signals/blend.js";
import { redeemAndLiquidate } from "./agent/redeem.js";
import { formatPct } from "./util/math.js";
import { log } from "./util/log.js";

async function scanOnly() {
  const cfg = loadConfig();
  const client = getClient(cfg);
  const markets = await observeMarkets(client, cfg);
  for (const m of markets.slice(0, 15)) {
    const views = await blendMarket(m, cfg);
    const best = [...views].sort(
      (a, b) => Math.abs(b.edge) - Math.abs(a.edge),
    )[0];
    console.log("\n" + m.question);
    console.log(`  ${m.marketUrl}`);
    console.log(
      `  settleScore=${m.settlementScore.toFixed(2)} hours=${m.hoursToSettlement?.toFixed(1) ?? "?"}`,
    );
    if (best) {
      console.log(
        `  best: [${best.outcomeIdx}] ${best.label} market=${formatPct(best.marketProb)} blend=${formatPct(best.blendedProb)} edge=${formatPct(best.edge)}`,
      );
      console.log(`  reasons: ${best.reasons.slice(0, 2).join(" | ")}`);
    }
  }
}

async function main() {
  const cmd = process.argv[2] ?? "once";
  const cfg = loadConfig();

  if (cmd === "once") {
    await runCycle(cfg);
    return;
  }
  if (cmd === "watch") {
    await watch(cfg);
    return;
  }
  if (cmd === "scan") {
    await scanOnly();
    return;
  }
  if (cmd === "redeem") {
    const n = await redeemAndLiquidate(getClient(cfg), cfg);
    log("info", "redeem/liquidate done", { count: n });
    return;
  }
  if (cmd === "balances") {
    console.log(`Wallet: ${cfg.wallet}`);
    console.log(`Network: ${cfg.network}`);
    console.log(`Dry run: ${cfg.dryRun}`);
    try {
      const bal = await readBalances(getClient(cfg), cfg);
      console.log(`ETH: ${bal.eth}`);
      console.log(`Token: ${bal.token} (decimals ${bal.tokenDecimals})`);
    } catch (err) {
      console.error(
        "Balance read failed (need API key + signer):",
        err instanceof Error ? err.message : err,
      );
    }
    return;
  }

  console.error("Usage: npm run cli -- <once|watch|scan|redeem|balances>");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Open a small practice position so the desk Positions panel has inventory.
 * Ignores the edge floor — for wiring/proof only, not competition strategy.
 *
 * Usage: npm run practice-buy [-- 25]
 *   optional USDC budget (default 25)
 */
import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { getClient } from "../src/client.js";
import { observeMarkets } from "../src/agent/observe.js";
import { listOpenPositions } from "../src/positions.js";
import { journal, log } from "../src/util/log.js";

const budgetUsdc = Number(process.argv[2] || "25");
if (!(budgetUsdc > 0 && budgetUsdc <= 200)) {
  console.error("Budget must be between 0 and 200 USDC");
  process.exit(1);
}

const cfg = loadConfig();
const client = getClient(cfg);
const markets = await observeMarkets(client, cfg);

if (!markets.length) {
  console.error("No open markets found");
  process.exit(1);
}

// Prefer a 2-outcome market with mid prices (not 99/1).
const ranked = [...markets].sort((a, b) => {
  const mid = (m: typeof a) => {
    const p = m.outcomes[0]?.marketProb ?? 0.5;
    return Math.abs(p - 0.5);
  };
  return mid(a) - mid(b) || b.settlementScore - a.settlementScore;
});

const market = ranked[0]!;
const outcome =
  [...market.outcomes].sort(
    (a, b) => Math.abs(a.marketProb - 0.5) - Math.abs(b.marketProb - 0.5),
  )[0] ?? market.outcomes[0]!;

const probeShares = 10n ** 18n; // 1 share
const probe = await client.quoteBuy({
  marketAddress: market.id,
  outcomeIdx: outcome.idx,
  sharesOut: probeShares,
});
const costPerShare = Number(probe.tokensIn) / 1e6;
if (!(costPerShare > 0)) {
  console.error("Quote returned zero cost");
  process.exit(1);
}

const shareUnits = Math.max(0.5, budgetUsdc / costPerShare);
const sharesOut = BigInt(Math.floor(shareUnits * 1e18));
const quote = await client.quoteBuy({
  marketAddress: market.id,
  outcomeIdx: outcome.idx,
  sharesOut,
});
const maxTokensIn =
  (quote.tokensIn * BigInt(10_000 + cfg.slippageBps)) / 10_000n;

console.log("Market:   " + market.question);
console.log("URL:      " + market.marketUrl);
console.log("Outcome:  " + outcome.label + ` (${outcome.idx})`);
console.log("Shares:   " + (Number(sharesOut) / 1e18).toFixed(4));
console.log("Est USDC: " + (Number(quote.tokensIn) / 1e6).toFixed(4));
console.log("Max USDC: " + (Number(maxTokensIn) / 1e6).toFixed(4));
console.log("Dry run:  " + cfg.dryRun);

if (cfg.dryRun) {
  console.error("SIGNALSTACK_DRY_RUN=1 — set to 0 for a real practice fill");
  process.exit(1);
}

await client.ensureTokenApproval({
  marketAddress: market.id,
  minimumAmount: maxTokensIn,
});

const tx = await client.buyShares({
  marketAddress: market.id,
  outcomeIdx: outcome.idx,
  sharesOut,
  maxTokensIn,
});

log("info", "practice buy filled", {
  question: market.question,
  outcome: outcome.label,
  tx: tx.transactionHash,
});
journal("practice_buy", {
  market: market.id,
  question: market.question,
  outcome: outcome.label,
  outcomeIdx: outcome.idx,
  shares: sharesOut.toString(),
  maxTokensIn: maxTokensIn.toString(),
  tx: tx.transactionHash,
  url: market.marketUrl,
});

console.log("\nFilled: " + tx.transactionHash);
console.log(
  "Explorer: https://gensyn-testnet.explorer.alchemy.com/tx/" +
    tx.transactionHash,
);

const positions = await listOpenPositions(client, cfg);
console.log("\nOpen positions: " + positions.length);
for (const p of positions.slice(0, 5)) {
  console.log(
    ` - ${p.question ?? p.market} · ${p.outcome} · ${p.sharesHuman.toFixed(4)} shares`,
  );
}

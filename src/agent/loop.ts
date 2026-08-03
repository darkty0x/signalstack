import type { AgentConfig } from "../config.js";
import { getClient } from "../client.js";
import type { CycleResult } from "../types.js";
import { log } from "../util/log.js";
import {
  getState,
  recordCycle,
  recordWatchError,
  setLastScan,
  setWatchRunning,
} from "../state.js";
import { decideTrades, previewTrades } from "./decide.js";
import { executeIntents } from "./execute.js";
import { observeMarkets } from "./observe.js";
import { redeemAndLiquidate } from "./redeem.js";

export async function runScan(cfg: AgentConfig): Promise<CycleResult> {
  const client = getClient(cfg);
  log("info", "scan start", {
    agent: cfg.agentName,
    network: cfg.network,
    minEdge: cfg.minEdge,
  });

  const markets = await observeMarkets(client, cfg);
  const intents = await previewTrades(markets, cfg);
  const actionable = intents.filter((i) => !i.skipReason);

  const result: CycleResult = {
    scanned: markets.length,
    candidates: actionable.length,
    intents,
    executed: 0,
    skipped: intents.length - actionable.length,
    redeemed: 0,
  };

  setLastScan(result);
  log("info", "scan done", {
    scanned: result.scanned,
    candidates: result.candidates,
  });
  return result;
}

export async function runCycle(cfg: AgentConfig): Promise<CycleResult> {
  const client = getClient(cfg);
  log("info", "cycle start", {
    agent: cfg.agentName,
    wallet: cfg.wallet,
    dryRun: cfg.dryRun,
    network: cfg.network,
    minEdge: cfg.minEdge,
  });

  const redeemed = await redeemAndLiquidate(client, cfg);
  const markets = await observeMarkets(client, cfg);
  log("info", "observed markets", { count: markets.length });

  const intents = await decideTrades(client, markets, cfg);
  const actionable = intents.filter((i) => !i.skipReason && i.shares > 0n);
  const { executed, skipped } = await executeIntents(client, intents, cfg);

  const result: CycleResult = {
    scanned: markets.length,
    candidates: actionable.length,
    intents,
    executed,
    skipped,
    redeemed,
  };

  setLastScan(result);
  log("info", "cycle done", {
    scanned: result.scanned,
    candidates: result.candidates,
    executed: result.executed,
    skipped: result.skipped,
    redeemed: result.redeemed,
  });
  return result;
}

let watchTimer: ReturnType<typeof setTimeout> | null = null;
let watchCfg: AgentConfig | null = null;

async function watchTick() {
  if (!watchCfg || !getState().watch.running) return;
  try {
    const result = await runCycle(watchCfg);
    recordCycle(result);
  } catch (err) {
    recordWatchError(err);
    log("error", "cycle error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (getState().watch.running && watchCfg) {
    watchTimer = setTimeout(watchTick, watchCfg.pollSeconds * 1000);
  }
}

export function startWatch(cfg: AgentConfig): void {
  if (getState().watch.running) return;
  watchCfg = cfg;
  setWatchRunning(true);
  void watchTick();
}

export function stopWatch(): void {
  setWatchRunning(false);
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = null;
}

export async function watch(cfg: AgentConfig): Promise<void> {
  startWatch(cfg);
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    if (!getState().watch.running) break;
  }
}

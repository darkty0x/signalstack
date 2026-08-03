import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CycleResult, TradeIntent } from "./types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scanCachePath = resolve(root, "data/last-scan.json");

export type WatchState = {
  running: boolean;
  startedAt: string | null;
  lastCycleAt: string | null;
  lastError: string | null;
  cycles: number;
  lastResult: SummaryResult | null;
};

export type SummaryResult = {
  scanned: number;
  candidates: number;
  executed: number;
  skipped: number;
  redeemed: number;
  topIntents: Array<{
    question: string;
    outcome: string;
    side: string;
    edge: number;
    edgeAfterCost: number;
    marketProb: number;
    blendedProb: number;
    skipReason?: string;
    url: string;
    market: string;
  }>;
};

export type AppState = {
  watch: WatchState;
  lastScanAt: string | null;
  lastScan: SummaryResult | null;
};

function loadCachedScan(): { at: string | null; scan: SummaryResult | null } {
  try {
    if (!existsSync(scanCachePath)) return { at: null, scan: null };
    const raw = JSON.parse(readFileSync(scanCachePath, "utf8")) as {
      at?: string;
      scan?: SummaryResult;
    };
    return { at: raw.at ?? null, scan: raw.scan ?? null };
  } catch {
    return { at: null, scan: null };
  }
}

const cached = loadCachedScan();

const state: AppState = {
  watch: {
    running: false,
    startedAt: null,
    lastCycleAt: null,
    lastError: null,
    cycles: 0,
    lastResult: null,
  },
  lastScanAt: cached.at,
  lastScan: cached.scan,
};

export function getState(): AppState {
  return state;
}

export function summarize(result: CycleResult): SummaryResult {
  const ranked = [...result.intents].sort(
    (a, b) => Math.abs(b.edgeAfterCost) - Math.abs(a.edgeAfterCost),
  );
  return {
    scanned: result.scanned,
    candidates: result.candidates,
    executed: result.executed,
    skipped: result.skipped,
    redeemed: result.redeemed,
    topIntents: ranked.slice(0, 25).map(intentRow),
  };
}

function intentRow(i: TradeIntent) {
  return {
    question: i.market.question,
    outcome: i.view.label,
    side: i.side,
    edge: i.view.edge,
    edgeAfterCost: i.edgeAfterCost,
    marketProb: i.view.marketProb,
    blendedProb: i.view.blendedProb,
    skipReason: i.skipReason,
    url: i.market.marketUrl,
    market: i.market.id,
  };
}

function persistScan(summary: SummaryResult, at: string) {
  try {
    mkdirSync(resolve(root, "data"), { recursive: true });
    writeFileSync(
      scanCachePath,
      JSON.stringify({ at, scan: summary }),
      "utf8",
    );
  } catch {
    // best-effort cache
  }
}

export function setLastScan(result: CycleResult) {
  state.lastScanAt = new Date().toISOString();
  state.lastScan = summarize(result);
  persistScan(state.lastScan, state.lastScanAt);
}

export function setWatchRunning(running: boolean) {
  state.watch.running = running;
  if (running) {
    state.watch.startedAt = new Date().toISOString();
    state.watch.lastError = null;
  }
}

export function recordCycle(result: CycleResult) {
  state.watch.cycles += 1;
  state.watch.lastCycleAt = new Date().toISOString();
  state.watch.lastResult = summarize(result);
  state.lastScanAt = state.watch.lastCycleAt;
  state.lastScan = state.watch.lastResult;
  persistScan(state.lastScan, state.lastScanAt);
}

export function recordWatchError(err: unknown) {
  state.watch.lastError = err instanceof Error ? err.message : String(err);
}

export function readJournal(limit = 80): unknown[] {
  const path = resolve(root, "data/journal/trades.jsonl");
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  return lines
    .slice(-limit)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
}

export function readLogs(limit = 100): string[] {
  const path = resolve(root, "data/logs/agent.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .reverse();
}

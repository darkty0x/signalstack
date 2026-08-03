import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type SignalWeights = {
  external: number;
  llm: number;
  antiHerd: number;
  prior: number;
};

export type AgentConfig = {
  agentName: string;
  wallet: `0x${string}`;
  network: "testnet" | "mainnet";
  dryRun: boolean;
  deadlineIso: string;
  deadlineMs: number;
  minEdge: number;
  maxBetFraction: number;
  kellyFraction: number;
  maxTradesPerCycle: number;
  pollSeconds: number;
  marketLimit: number;
  probeShares: bigint;
  slippageBps: number;
  minSettlementHours: number;
  maxSettlementHours: number;
  categories: string[];
  weights: SignalWeights;
  antiHerd: { crowdGap: number; fadeStrength: number };
  prior: {
    extremeHigh: number;
    extremeLow: number;
    targetHigh: number;
    targetLow: number;
    fadeStrength: number;
  };
  external: { minSimilarity: number; maxResults: number };
  llm: {
    enabled: boolean;
    apiKey?: string;
    baseUrl: string;
    model: string;
  };
  polymarketGammaUrl: string;
};

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return !["0", "false", "no", "off"].includes(v.toLowerCase());
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asAddress(value: string): `0x${string}` {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid wallet address: ${value}`);
  }
  return value.toLowerCase() as `0x${string}`;
}

export function loadConfig(): AgentConfig {
  const raw = JSON.parse(
    readFileSync(resolve(root, "config/default.json"), "utf8"),
  ) as Omit<AgentConfig, "deadlineMs" | "probeShares" | "llm" | "polymarketGammaUrl" | "dryRun" | "wallet" | "network" | "minEdge" | "maxBetFraction" | "pollSeconds" | "deadlineIso"> & {
    probeShares: string;
    dryRun: boolean;
    wallet: string;
    network: "testnet" | "mainnet";
    minEdge: number;
    maxBetFraction: number;
    pollSeconds: number;
    deadlineIso: string;
  };

  const deadlineIso =
    process.env.SIGNALSTACK_DEADLINE?.trim() || raw.deadlineIso;
  const wallet = asAddress(
    process.env.SIGNALSTACK_WALLET?.trim() || raw.wallet,
  );
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const weights = {
    external: raw.weights?.external ?? 0.55,
    llm: raw.weights?.llm ?? 0.3,
    antiHerd: raw.weights?.antiHerd ?? 0.15,
    prior: (raw.weights as { prior?: number } | undefined)?.prior ?? 0.35,
  };
  const prior = (raw as { prior?: AgentConfig["prior"] }).prior ?? {
    extremeHigh: 0.88,
    extremeLow: 0.12,
    targetHigh: 0.78,
    targetLow: 0.22,
    fadeStrength: 0.55,
  };

  return {
    ...raw,
    weights,
    prior,
    external: {
      minSimilarity: raw.external?.minSimilarity ?? 0.3,
      maxResults: raw.external?.maxResults ?? 8,
    },
    wallet,
    network: (process.env.DELPHI_NETWORK as "testnet" | "mainnet") || raw.network,
    dryRun: envBool("SIGNALSTACK_DRY_RUN", raw.dryRun),
    deadlineIso,
    deadlineMs: Date.parse(deadlineIso),
    minEdge: envNum("SIGNALSTACK_MIN_EDGE", raw.minEdge),
    maxBetFraction: envNum(
      "SIGNALSTACK_MAX_BET_FRACTION",
      raw.maxBetFraction,
    ),
    maxTradesPerCycle: envNum(
      "SIGNALSTACK_MAX_TRADES_PER_CYCLE",
      (raw as { maxTradesPerCycle?: number }).maxTradesPerCycle ?? 3,
    ),
    pollSeconds: envNum("SIGNALSTACK_POLL_SECONDS", raw.pollSeconds),
    probeShares: BigInt(raw.probeShares),
    llm: {
      enabled: Boolean(apiKey),
      apiKey,
      baseUrl:
        process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    },
    polymarketGammaUrl:
      process.env.POLYMARKET_GAMMA_URL?.trim() ||
      "https://gamma-api.polymarket.com",
  };
}

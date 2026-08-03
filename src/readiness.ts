import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type Check = {
  id: string;
  ok: boolean;
  label: string;
  detail: string;
  required: boolean;
};

export function readinessChecks(): Check[] {
  const cfg = loadConfig();
  const envPath = resolve(root, ".env");
  const hasEnv = existsSync(envPath);
  const api = Boolean(process.env.DELPHI_API_ACCESS_KEY?.trim());
  const pk =
    process.env.DELPHI_SIGNER_TYPE === "private_key" &&
    Boolean(process.env.WALLET_PRIVATE_KEY?.trim());
  const cdp =
    process.env.DELPHI_SIGNER_TYPE !== "private_key" &&
    Boolean(process.env.CDP_API_KEY_ID?.trim()) &&
    Boolean(process.env.CDP_API_KEY_SECRET?.trim()) &&
    Boolean(process.env.CDP_WALLET_SECRET?.trim()) &&
    Boolean(process.env.CDP_WALLET_ADDRESS?.trim());
  const signer = pk || cdp;
  const llm = cfg.llm.enabled;

  return [
    {
      id: "env",
      ok: hasEnv,
      label: ".env file",
      detail: hasEnv
        ? "Found"
        : "Missing — run: cp .env.example .env and fill keys",
      required: true,
    },
    {
      id: "api",
      ok: api,
      label: "Delphi API key",
      detail: api
        ? "DELPHI_API_ACCESS_KEY set"
        : "Get one at https://delphi-api-access.gensyn.ai/",
      required: true,
    },
    {
      id: "signer",
      ok: signer,
      label: "Wallet signer",
      detail: signer
        ? pk
          ? "private_key signer configured"
          : "CDP signer configured"
        : "Set WALLET_PRIVATE_KEY or CDP_* vars (must match registered wallet)",
      required: true,
    },
    {
      id: "wallet",
      ok: Boolean(cfg.wallet),
      label: "Registered wallet",
      detail: cfg.wallet,
      required: true,
    },
    {
      id: "dry",
      ok: true,
      label: "Trade mode",
      detail: cfg.dryRun
        ? "DRY RUN (safe) — set SIGNALSTACK_DRY_RUN=0 on Aug 10"
        : "LIVE trading enabled",
      required: false,
    },
    {
      id: "llm",
      ok: true,
      label: "LLM calibration",
      detail: llm
        ? `on (${cfg.llm.model})`
        : "off — external + anti-herd still active (optional OPENAI_API_KEY)",
      required: false,
    },
  ];
}

export function readinessSummary() {
  const checks = readinessChecks();
  const requiredOk = checks.filter((c) => c.required).every((c) => c.ok);
  return { ready: requiredOk, checks };
}

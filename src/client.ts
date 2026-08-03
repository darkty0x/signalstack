import { DelphiClient } from "@gensyn-ai/gensyn-delphi-sdk";
import type { AgentConfig } from "./config.js";

let cached: DelphiClient | null = null;

export function getClient(cfg: AgentConfig): DelphiClient {
  if (cached) return cached;
  if (!process.env.DELPHI_API_ACCESS_KEY?.trim()) {
    throw new Error(
      "Missing DELPHI_API_ACCESS_KEY. Generate at https://delphi-api-access.gensyn.ai/ and put it in .env",
    );
  }
  cached = new DelphiClient({
    network: cfg.network,
    apiKey: process.env.DELPHI_API_ACCESS_KEY,
  });
  return cached;
}

import type { AgentConfig } from "./config.js";

const EXPLORER_API =
  process.env.SIGNALSTACK_EXPLORER_API?.trim() ||
  "https://gensyn-testnet.explorer.alchemy.com/api/v2";
const EXPLORER_TX =
  process.env.SIGNALSTACK_EXPLORER_TX?.trim() ||
  "https://gensyn-testnet.explorer.alchemy.com/tx";

export type ActivityEntry = {
  ts: string;
  event: string;
  source: "journal" | "chain";
  question?: string;
  market?: string;
  outcome?: string;
  side?: string;
  tx?: string;
  txUrl?: string;
  method?: string;
  status?: string;
  reason?: string;
  shares?: string;
  manual?: boolean;
  [key: string]: unknown;
};

type MemoryRow = ActivityEntry;

const memory: MemoryRow[] = [];
const MEMORY_LIMIT = 400;

export function rememberActivity(row: ActivityEntry) {
  memory.push(row);
  if (memory.length > MEMORY_LIMIT) {
    memory.splice(0, memory.length - MEMORY_LIMIT);
  }
}

export function readMemoryActivity(limit = 100): ActivityEntry[] {
  return memory.slice(-limit).reverse();
}

function mapMethod(method: string | null | undefined): string {
  const m = String(method || "").toLowerCase();
  if (m.includes("buy")) return "buy";
  if (m.includes("sell")) return "sell";
  if (m.includes("redeem")) return "redeem";
  if (m.includes("liquidat")) return "liquidate";
  return method || "tx";
}

function paramMap(
  decoded:
    | {
        parameters?: Array<{ name?: string; value?: string }>;
      }
    | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of decoded?.parameters ?? []) {
    if (p.name && p.value !== undefined) out[p.name] = String(p.value);
  }
  return out;
}

export async function fetchChainActivity(
  wallet: string,
  limit = 40,
): Promise<ActivityEntry[]> {
  const addr = wallet.toLowerCase();
  const url = `${EXPLORER_API}/addresses/${addr}/transactions`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`explorer ${res.status}`);
  }
  const body = (await res.json()) as {
    items?: Array<{
      hash?: string;
      method?: string;
      timestamp?: string;
      result?: string;
      status?: string;
      to?: { name?: string | null; hash?: string };
      decoded_input?: {
        method_call?: string;
        parameters?: Array<{ name?: string; value?: string }>;
      };
    }>;
  };
  const items = body.items ?? [];
  const out: ActivityEntry[] = [];
  for (const t of items) {
    if (!t.hash) continue;
    const method = t.method || "";
    if (
      method &&
      !/buy|sell|redeem|liquidat/i.test(method) &&
      method !== "0x"
    ) {
      continue;
    }
    const event = mapMethod(method);
    const params = paramMap(t.decoded_input);
    const outcomeIdx =
      params.outcomeIdx !== undefined ? Number(params.outcomeIdx) : undefined;
    const sharesRaw = params.sharesOut || params.sharesIn;
    let sharesHuman: number | undefined;
    if (sharesRaw && /^\d+$/.test(sharesRaw)) {
      sharesHuman = Number(BigInt(sharesRaw)) / 1e18;
    }
    const market = params.marketProxy || params.market;
    out.push({
      ts: t.timestamp || new Date().toISOString(),
      event,
      source: "chain",
      method,
      status: t.result || t.status || "ok",
      tx: t.hash,
      txUrl: `${EXPLORER_TX}/${t.hash}`,
      reason: t.to?.name || t.to?.hash || "on-chain",
      market,
      outcomeIdx,
      outcome:
        outcomeIdx === 0 ? "Yes" : outcomeIdx === 1 ? "No" : undefined,
      sharesHuman,
      question: market
        ? `${event === "buy" ? "Buy" : event === "sell" ? "Sell" : "Trade"} · ${market.slice(0, 8)}…${market.slice(-4)}`
        : method || "Market fill",
    });
    if (out.length >= limit) break;
  }
  return out;
}

function dedupeKey(e: ActivityEntry): string {
  if (e.tx) return `tx:${String(e.tx).toLowerCase()}`;
  return `j:${e.ts}:${e.event}:${e.market ?? ""}:${e.outcome ?? ""}:${e.reason ?? ""}`;
}

/** Merge journal + memory + chain fills, newest first. Prefer journal detail. */
export function mergeActivity(
  parts: ActivityEntry[][],
  limit = 80,
): ActivityEntry[] {
  const map = new Map<string, ActivityEntry>();
  // Later sources overwrite earlier — pass journal last so it wins on same tx.
  for (const list of parts) {
    for (const row of list) {
      const key = dedupeKey(row);
      const prev = map.get(key);
      if (!prev) {
        map.set(key, row);
        continue;
      }
      // Prefer richer journal rows over bare chain rows.
      if (prev.source === "chain" && row.source === "journal") {
        map.set(key, {
          ...prev,
          ...row,
          tx: row.tx || prev.tx,
          txUrl: row.txUrl || prev.txUrl,
          source: "journal",
        });
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    .slice(0, limit);
}

export async function loadActivity(
  cfg: AgentConfig,
  journalEntries: ActivityEntry[],
  limit = 80,
): Promise<ActivityEntry[]> {
  let chain: ActivityEntry[] = [];
  try {
    chain = await fetchChainActivity(cfg.wallet, Math.min(60, limit));
  } catch {
    chain = [];
  }
  const mem = readMemoryActivity(limit);
  // Enrich journal rows with explorer URLs when tx present.
  const journal = journalEntries.map((e) => {
    const tx = e.tx ? String(e.tx) : undefined;
    return {
      ...e,
      source: "journal" as const,
      tx,
      txUrl: tx ? `${EXPLORER_TX}/${tx}` : e.txUrl,
    };
  });
  const merged = mergeActivity([chain, mem, journal], limit * 2);
  // Activity panel is for fills — drop scan skips / holds.
  return merged
    .filter((e) => {
      const ev = String(e.event || "").toLowerCase();
      if (ev === "skip" || ev === "hold") return false;
      if (ev.includes("below_floor")) return false;
      return true;
    })
    .slice(0, limit);
}

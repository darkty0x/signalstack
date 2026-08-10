import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { getClient } from "./client.js";
import { readBalances } from "./balances.js";
import { loadPortfolio, sellAllPositions, sellPosition } from "./positions.js";
import { readinessSummary } from "./readiness.js";
import { runCycle, runScan, startWatch, stopWatch } from "./agent/loop.js";
import { getState, readJournal, readLogs, summarize } from "./state.js";
import { log } from "./util/log.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = resolve(root, "web");
const port = Number(process.env.PORT || 4173);

let balanceCache: {
  at: number;
  balances: Awaited<ReturnType<typeof readBalances>> | null;
  error: string | null;
} = { at: 0, balances: null, error: null };

async function cachedBalances(cfg: ReturnType<typeof loadConfig>) {
  const now = Date.now();
  if (now - balanceCache.at < 20_000 && balanceCache.at > 0) {
    return balanceCache;
  }
  try {
    const balances = await readBalances(getClient(cfg), cfg);
    balanceCache = { at: now, balances, error: null };
  } catch (err) {
    balanceCache = {
      at: now,
      balances: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return balanceCache;
}

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function json(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
) {
  const raw = JSON.stringify(body, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(raw);
}

async function readBody(
  req: import("node:http").IncomingMessage,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function serveStatic(
  res: import("node:http").ServerResponse,
  pathname: string,
) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = resolve(webRoot, "." + rel);
  if (!file.startsWith(webRoot) || !existsSync(file)) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, {
    "content-type": mime[extname(file)] || "application/octet-stream",
  });
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const path = url.pathname;
    const method = req.method || "GET";

    if (path === "/api/health") {
      return json(res, 200, {
        ok: true,
        service: "signalstack",
        ts: new Date().toISOString(),
      });
    }

    if (path === "/api/readiness" && method === "GET") {
      return json(res, 200, readinessSummary());
    }

    if (path === "/api/status" && method === "GET") {
      const cfg = loadConfig();
      const light = url.searchParams.get("light") === "1";
      let balances = null;
      let apiReady = Boolean(process.env.DELPHI_API_ACCESS_KEY?.trim());
      let balanceError: string | null = null;
      if (apiReady && !light) {
        const bal = await cachedBalances(cfg);
        balances = bal.balances;
        balanceError = bal.error;
      } else if (apiReady && balanceCache.balances) {
        balances = balanceCache.balances;
        balanceError = balanceCache.error;
      }
      return json(res, 200, {
        agent: cfg.agentName,
        wallet: cfg.wallet,
        network: cfg.network,
        dryRun: cfg.dryRun,
        minEdge: cfg.minEdge,
        maxBetFraction: cfg.maxBetFraction,
        maxTradesPerCycle: cfg.maxTradesPerCycle,
        deadlineIso: cfg.deadlineIso,
        pollSeconds: cfg.pollSeconds,
        llmEnabled: cfg.llm.enabled,
        weights: cfg.weights,
        apiReady,
        balances,
        balanceError,
        readiness: readinessSummary(),
        state: getState(),
      });
    }

    if (path === "/api/positions/sell" && method === "POST") {
      const ready = readinessSummary();
      if (!ready.ready) {
        return json(res, 400, {
          error: "Not ready — fix checklist first",
          readiness: ready,
        });
      }
      const raw = await readBody(req);
      let body: {
        market?: string;
        outcomeIdx?: number;
        fraction?: number;
      } = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return json(res, 400, { error: "Invalid JSON body" });
      }
      if (!body.market || body.outcomeIdx === undefined) {
        return json(res, 400, {
          error: "market and outcomeIdx are required",
        });
      }
      const cfg = loadConfig();
      const result = await sellPosition(getClient(cfg), cfg, {
        market: body.market,
        outcomeIdx: Number(body.outcomeIdx),
        fraction: body.fraction,
      });
      balanceCache = { at: 0, balances: null, error: null };
      return json(res, result.ok ? 200 : 400, result);
    }

    if (path === "/api/positions/sell-all" && method === "POST") {
      const ready = readinessSummary();
      if (!ready.ready) {
        return json(res, 400, {
          error: "Not ready — fix checklist first",
          readiness: ready,
        });
      }
      await readBody(req);
      const cfg = loadConfig();
      const result = await sellAllPositions(getClient(cfg), cfg);
      balanceCache = { at: 0, balances: null, error: null };
      return json(res, result.ok || result.results.length === 0 ? 200 : 207, result);
    }

    if (path === "/api/positions" && method === "GET") {
      const cfg = loadConfig();
      if (!process.env.DELPHI_API_ACCESS_KEY?.trim()) {
        return json(res, 200, {
          positions: [],
          portfolio: null,
          error: "API key missing",
        });
      }
      try {
        const { positions, portfolio } = await loadPortfolio(
          getClient(cfg),
          cfg,
        );
        return json(res, 200, { positions, portfolio });
      } catch (err) {
        return json(res, 200, {
          positions: [],
          portfolio: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (path === "/api/journal" && method === "GET") {
      return json(res, 200, { entries: readJournal(100) });
    }

    if (path === "/api/logs" && method === "GET") {
      return json(res, 200, { lines: readLogs(120) });
    }

    if (path === "/api/scan" && (method === "GET" || method === "POST")) {
      const ready = readinessSummary();
      if (!ready.ready) {
        return json(res, 400, {
          error: "Not ready — fix checklist first",
          readiness: ready,
        });
      }
      const result = await runScan(loadConfig());
      return json(res, 200, summarize(result));
    }

    if (path === "/api/once" && method === "POST") {
      const ready = readinessSummary();
      if (!ready.ready) {
        return json(res, 400, {
          error: "Not ready — fix checklist first",
          readiness: ready,
        });
      }
      const result = await runCycle(loadConfig());
      return json(res, 200, summarize(result));
    }

    if (path === "/api/watch/start" && method === "POST") {
      const ready = readinessSummary();
      if (!ready.ready) {
        return json(res, 400, {
          error: "Not ready — fix checklist first",
          readiness: ready,
        });
      }
      startWatch(loadConfig());
      return json(res, 200, { ok: true, watch: getState().watch });
    }

    if (path === "/api/watch/stop" && method === "POST") {
      stopWatch();
      return json(res, 200, { ok: true, watch: getState().watch });
    }

    if (path.startsWith("/api/")) {
      await readBody(req);
      return json(res, 404, { error: "unknown api route" });
    }

    return serveStatic(res, path);
  } catch (err) {
    log("error", "api error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return json(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  log("info", `SignalStack desk on http://0.0.0.0:${port}`);
});

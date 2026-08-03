import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { getClient } from "./client.js";
import { readBalances } from "./balances.js";
import { listOpenPositions } from "./positions.js";
import { readinessSummary } from "./readiness.js";
import { runCycle, startWatch, stopWatch } from "./agent/loop.js";
import { getState, readJournal, readLogs, summarize } from "./state.js";
import { log } from "./util/log.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = resolve(root, "web");
const port = Number(process.env.PORT || 4173);

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
      let balances = null;
      let apiReady = Boolean(process.env.DELPHI_API_ACCESS_KEY?.trim());
      let balanceError: string | null = null;
      if (apiReady) {
        try {
          balances = await readBalances(getClient(cfg), cfg);
        } catch (err) {
          balanceError = err instanceof Error ? err.message : String(err);
        }
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

    if (path === "/api/positions" && method === "GET") {
      const cfg = loadConfig();
      if (!process.env.DELPHI_API_ACCESS_KEY?.trim()) {
        return json(res, 200, {
          positions: [],
          error: "API key missing",
        });
      }
      try {
        const positions = await listOpenPositions(getClient(cfg), cfg);
        return json(res, 200, { positions });
      } catch (err) {
        return json(res, 200, {
          positions: [],
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

const $ = (id) => document.getElementById(id);

function pct(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(2)}%`;
}

function shortAddr(a) {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll('"', "&quot;");
}

function renderChecks(readiness) {
  const el = $("checks");
  const summary = $("readySummary");
  if (!readiness) {
    el.innerHTML = "";
    summary.textContent = "—";
    return;
  }
  summary.textContent = readiness.ready
    ? "Ready for dry-run cycles"
    : "Blocked — finish required items";
  summary.className = readiness.ready
    ? "sub ready-ok"
    : "sub ready-bad";

  el.innerHTML = (readiness.checks || [])
    .map((c) => {
      return `<div class="check ${c.ok ? "ok" : ""}">
        <div class="dot"></div>
        <div>
          <p class="title">${escapeHtml(c.label)}${c.required ? " *" : ""}</p>
          <p class="detail">${escapeHtml(c.detail)}</p>
        </div>
      </div>`;
    })
    .join("");
}

function renderEdges(intents = []) {
  const body = $("edgeBody");
  if (!intents.length) {
    body.innerHTML =
      '<tr><td colspan="8" class="empty">No edges yet. Run a cycle.</td></tr>';
    return;
  }
  body.innerHTML = intents
    .map((i) => {
      const edgeCls = i.edgeAfterCost >= 0 ? "pos" : "neg";
      const status = i.skipReason
        ? `<span class="sub">${escapeHtml(i.skipReason)}</span>`
        : `<span class="pos">ACTION</span>`;
      return `<tr>
        <td><a href="${escapeAttr(i.url)}" target="_blank" rel="noreferrer">${escapeHtml(i.question)}</a></td>
        <td>${escapeHtml(i.outcome)}</td>
        <td class="side-${i.side}">${i.side.toUpperCase()}</td>
        <td class="mono">${pct(i.marketProb)}</td>
        <td class="mono">${pct(i.blendedProb)}</td>
        <td class="${i.edge >= 0 ? "pos" : "neg"}">${pct(i.edge)}</td>
        <td class="${edgeCls}">${pct(i.edgeAfterCost)}</td>
        <td>${status}</td>
      </tr>`;
    })
    .join("");
}

function renderPositions(positions = [], error) {
  const body = $("posBody");
  if (error && !positions.length) {
    body.innerHTML = `<tr><td colspan="4" class="empty">${escapeHtml(error)}</td></tr>`;
    return;
  }
  if (!positions.length) {
    body.innerHTML =
      '<tr><td colspan="4" class="empty">No open positions.</td></tr>';
    return;
  }
  body.innerHTML = positions
    .map((p) => {
      const q = p.question
        ? p.url
          ? `<a href="${escapeAttr(p.url)}" target="_blank" rel="noreferrer">${escapeHtml(p.question)}</a>`
          : escapeHtml(p.question)
        : `<span class="mono">${escapeHtml(p.market)}</span>`;
      return `<tr>
        <td>${q}</td>
        <td>${escapeHtml(p.outcome ?? `#${p.outcomeIdx}`)}</td>
        <td class="mono">${Number(p.sharesHuman).toFixed(4)}</td>
        <td>${escapeHtml(p.marketStatus)}</td>
      </tr>`;
    })
    .join("");
}

function renderJournal(entries = []) {
  const el = $("journal");
  if (!entries.length) {
    el.innerHTML = '<div class="sub">No journal entries yet.</div>';
    return;
  }
  el.innerHTML = entries
    .slice(0, 40)
    .map((e) => {
      const title = e.event || "event";
      const q = e.question || e.market || "";
      return `<div class="feed-item"><div class="t">${escapeHtml(e.ts)} · ${escapeHtml(title)}</div><div>${escapeHtml(q)}</div><div class="sub">${escapeHtml(e.reason || e.tx || e.outcome || "")}</div></div>`;
    })
    .join("");
}

function renderLogs(lines = []) {
  $("logs").textContent = lines.slice(0, 60).join("\n") || "No logs yet.";
}

function applyStatus(s) {
  $("wallet").textContent = s.wallet || "—";
  $("wallet").title = s.wallet || "";
  $("minEdge").textContent = pct(s.minEdge);
  $("deadline").textContent = s.deadlineIso
    ? new Date(s.deadlineIso).toLocaleString()
    : "—";
  $("llmState").textContent = s.llmEnabled
    ? "LLM calibration on"
    : "LLM off · external + anti-herd active";

  const dry = s.dryRun;
  const mode = $("modePill");
  mode.textContent = dry ? "DRY RUN" : "LIVE";
  mode.className = dry ? "pill warn" : "pill live";

  $("netPill").textContent = (s.network || "testnet").toUpperCase();

  const watching = s.state?.watch?.running;
  const watch = $("watchPill");
  watch.textContent = watching ? "WATCHING" : "IDLE";
  watch.className = watching ? "pill live" : "pill ghost";

  const ready = s.readiness?.ready;
  $("btnWatch").disabled = !!watching || !ready;
  $("btnStop").disabled = !watching;
  $("btnOnce").disabled = !ready;

  if (s.balances) {
    $("bankroll").textContent = `${Number(s.balances.token).toLocaleString()} USDC`;
    $("ethBal").textContent = `ETH ${Number(s.balances.eth).toFixed(5)}`;
  } else {
    $("bankroll").textContent = s.apiReady ? "—" : "API key missing";
    $("ethBal").textContent = s.balanceError
      ? s.balanceError.slice(0, 80)
      : "Connect signer in .env for live balances";
  }

  const last = s.state?.watch?.lastResult || s.state?.lastScan;
  const lastAt = s.state?.watch?.lastCycleAt || s.state?.lastScanAt;
  $("lastCycle").textContent = fmtTime(lastAt);
  $("scanStats").textContent = last
    ? `${last.scanned} scanned · ${last.candidates} actionable · ${last.executed} exec`
    : "—";
  $("errLine").textContent = s.state?.watch?.lastError || "";

  renderChecks(s.readiness);
  if (last?.topIntents) renderEdges(last.topIntents);
}

async function refresh() {
  const [status, journal, logs, health, positions] = await Promise.all([
    api("/api/status"),
    api("/api/journal"),
    api("/api/logs"),
    api("/api/health"),
    api("/api/positions"),
  ]);
  applyStatus(status);
  renderJournal(journal.entries || []);
  renderLogs(logs.lines || []);
  renderPositions(positions.positions || [], positions.error);
  $("health").textContent = `ok · ${shortAddr(status.wallet)} · ${health.ts}`;
}

async function withBusy(btn, fn) {
  const prev = btn.disabled;
  btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    $("errLine").textContent = err.message || String(err);
  } finally {
    btn.disabled = prev;
    await refresh();
  }
}

$("btnRefresh").onclick = () => refresh();
$("btnOnce").onclick = () =>
  withBusy($("btnOnce"), async () => {
    const result = await api("/api/once", { method: "POST" });
    renderEdges(result.topIntents || []);
  });
$("btnWatch").onclick = () =>
  withBusy($("btnWatch"), () => api("/api/watch/start", { method: "POST" }));
$("btnStop").onclick = () =>
  withBusy($("btnStop"), () => api("/api/watch/stop", { method: "POST" }));

refresh();
setInterval(refresh, 8000);

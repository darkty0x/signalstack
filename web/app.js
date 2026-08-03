const $ = (id) => document.getElementById(id);

function pct(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

function shortAddr(a) {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
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

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

function renderChecks(readiness) {
  const el = $("checks");
  const summary = $("readySummary");
  const note = $("heroNote");
  if (!readiness) {
    el.innerHTML = "";
    summary.textContent = "—";
    return;
  }

  summary.textContent = readiness.ready
    ? "Ready to scan"
    : "Finish setup to unlock trading";
  summary.className = readiness.ready ? "ready-ok" : "ready-bad";
  note.textContent = readiness.ready
    ? "Setup looks good. Scan markets or leave watch mode running."
    : "Complete the checklist below, then come back to find edges.";

  el.innerHTML = (readiness.checks || [])
    .map((c) => {
      return `<li class="step ${c.ok ? "ok" : ""}">
        <div class="dot" aria-hidden="true"></div>
        <div>
          <strong>${escapeHtml(c.label)}${c.required ? "" : ""}</strong>
          <span>${escapeHtml(c.detail)}</span>
        </div>
      </li>`;
    })
    .join("");

  $("setupSection").hidden = readiness.ready;
}

function renderEdges(intents = []) {
  const el = $("edgeCards");
  const actionable = intents.filter((i) => !i.skipReason);
  const shown = (actionable.length ? actionable : intents).slice(0, 8);

  if (!shown.length) {
    el.innerHTML = `<div class="empty-card"><strong>No opportunities yet</strong><span>Tap “Find edges now” to scan open Delphi markets.</span></div>`;
    $("bestEdge").textContent = "—";
    return;
  }

  const best = [...shown].sort(
    (a, b) => Math.abs(b.edgeAfterCost) - Math.abs(a.edgeAfterCost),
  )[0];
  $("bestEdge").textContent = pct(best?.edgeAfterCost);

  el.innerHTML = shown
    .map((i) => {
      const actionableRow = !i.skipReason;
      const badgeClass = actionableRow ? i.side : "skip";
      const badge = actionableRow ? i.side : "skip";
      return `<article class="edge-card">
        <div class="edge-top">
          <p class="edge-question"><a href="${escapeAttr(i.url)}" target="_blank" rel="noreferrer">${escapeHtml(i.question)}</a></p>
          <span class="edge-badge ${badgeClass}">${escapeHtml(badge)}</span>
        </div>
        <div class="edge-meta">
          <div><span class="lbl">Outcome</span><span class="val">${escapeHtml(i.outcome)}</span></div>
          <div><span class="lbl">Market</span><span class="val">${pct(i.marketProb)}</span></div>
          <div><span class="lbl">Our view</span><span class="val">${pct(i.blendedProb)}</span></div>
          <div><span class="lbl">Edge</span><span class="val ${i.edgeAfterCost >= 0 ? "pos" : "neg"}">${pct(i.edgeAfterCost)}</span></div>
        </div>
        ${i.skipReason ? `<p class="stat-sub">${escapeHtml(i.skipReason)}</p>` : `<p class="stat-sub pos">Ready to trade this edge</p>`}
      </article>`;
    })
    .join("");
}

function renderPositions(positions = [], error) {
  const el = $("posList");
  if (error && !positions.length) {
    el.innerHTML = `<div class="empty-inline">${escapeHtml(error)}</div>`;
    return;
  }
  if (!positions.length) {
    el.innerHTML = `<div class="empty-inline">No open positions.</div>`;
    return;
  }
  el.innerHTML = positions
    .slice(0, 12)
    .map((p) => {
      const title = p.question
        ? p.url
          ? `<a href="${escapeAttr(p.url)}" target="_blank" rel="noreferrer">${escapeHtml(p.question)}</a>`
          : escapeHtml(p.question)
        : escapeHtml(p.market);
      return `<div class="pos-row"><strong>${title}</strong><span class="stat-sub">${escapeHtml(p.outcome ?? `#${p.outcomeIdx}`)} · ${Number(p.sharesHuman).toFixed(3)} shares · ${escapeHtml(p.marketStatus)}</span></div>`;
    })
    .join("");
}

function renderJournal(entries = []) {
  const el = $("journal");
  if (!entries.length) {
    el.innerHTML = `<div class="empty-inline">Nothing recorded yet.</div>`;
    return;
  }
  el.innerHTML = entries
    .slice(0, 30)
    .map((e) => {
      return `<div class="feed-item"><div class="t">${escapeHtml(e.ts)} · ${escapeHtml(e.event || "event")}</div><strong>${escapeHtml(e.question || e.market || "")}</strong><div class="stat-sub">${escapeHtml(e.reason || e.tx || e.outcome || "")}</div></div>`;
    })
    .join("");
}

function renderLogs(lines = []) {
  $("logs").textContent = lines.slice(0, 50).join("\n") || "No logs yet.";
}

function applyStatus(s) {
  $("wallet").textContent = s.wallet || "—";
  $("minEdge").textContent = pct(s.minEdge);
  $("deadline").textContent = s.deadlineIso
    ? `Ends ${new Date(s.deadlineIso).toLocaleDateString()}`
    : "Deadline —";
  $("llmState").textContent = s.llmEnabled
    ? "Signals: external + LLM + anti-herd"
    : "Signals: external odds + anti-herd";

  const mode = $("modeChip");
  mode.textContent = s.dryRun ? "Dry run" : "Live";
  mode.className = s.dryRun ? "chip warn" : "chip live";

  const watching = s.state?.watch?.running;
  const watch = $("watchChip");
  watch.textContent = watching ? "Watching" : "Idle";
  watch.className = watching ? "chip live" : "chip soft";

  const ready = s.readiness?.ready;
  $("btnWatch").disabled = !!watching || !ready;
  $("btnStop").disabled = !watching;
  $("btnOnce").disabled = !ready;

  if (s.balances) {
    $("bankroll").textContent = `${Number(s.balances.token).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
    $("ethBal").textContent = `Gas ${Number(s.balances.eth).toFixed(5)} ETH`;
  } else {
    $("bankroll").textContent = s.apiReady ? "—" : "Setup needed";
    $("ethBal").textContent = s.balanceError
      ? s.balanceError.slice(0, 70)
      : "Connect wallet signer for balances";
  }

  const last = s.state?.watch?.lastResult || s.state?.lastScan;
  const lastAt = s.state?.watch?.lastCycleAt || s.state?.lastScanAt;
  $("scanStats").textContent = last
    ? `${last.scanned} markets · ${last.candidates} actionable`
    : lastAt
      ? `Last scan ${fmtTime(lastAt)}`
      : "No scan yet";

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
  $("health").textContent = `${shortAddr(status.wallet)} · synced`;
  void health;
}

async function withBusy(btn, fn) {
  const prev = btn.disabled;
  btn.disabled = true;
  const old = btn.textContent;
  if (btn.id === "btnOnce") btn.textContent = "Scanning…";
  try {
    await fn();
  } catch (err) {
    $("errLine").textContent = err.message || String(err);
    $("heroNote").textContent = err.message || String(err);
  } finally {
    btn.textContent = old;
    btn.disabled = prev;
    await refresh();
  }
}

$("btnRefresh").onclick = () => refresh();
$("btnOnce").onclick = () =>
  withBusy($("btnOnce"), async () => {
    const result = await api("/api/once", { method: "POST" });
    renderEdges(result.topIntents || []);
    $("heroNote").textContent = result.candidates
      ? `Found ${result.candidates} actionable edge${result.candidates === 1 ? "" : "s"}.`
      : "Scan finished — no edges cleared the floor this round.";
  });
$("btnWatch").onclick = () =>
  withBusy($("btnWatch"), () => api("/api/watch/start", { method: "POST" }));
$("btnStop").onclick = () =>
  withBusy($("btnStop"), () => api("/api/watch/stop", { method: "POST" }));

refresh();
setInterval(refresh, 8000);

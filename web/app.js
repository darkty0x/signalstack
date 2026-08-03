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

  summary.textContent = readiness.ready ? "Ready" : "Blocked";
  summary.className = readiness.ready ? "ready-ok" : "ready-bad";
  note.textContent = readiness.ready
    ? "Ready on Gensyn testnet. Find edges or start watch."
    : "Finish setup before trading.";

  el.innerHTML = (readiness.checks || [])
    .map(
      (c) => `<li class="${c.ok ? "ok" : ""}">
        <div class="dot" aria-hidden="true"></div>
        <div>
          <strong>${escapeHtml(c.label)}</strong>
          <span>${escapeHtml(c.detail)}</span>
        </div>
      </li>`,
    )
    .join("");

  $("setupSection").hidden = readiness.ready;
}

function renderEdges(intents = []) {
  const body = $("edgeBody");
  const actionable = intents.filter((i) => !i.skipReason);
  const shown = (actionable.length ? actionable : intents).slice(0, 12);

  if (!shown.length) {
    body.innerHTML =
      '<tr><td colspan="7" class="empty">No opportunities yet. Run Find edges.</td></tr>';
    $("bestEdge").textContent = "—";
    return;
  }

  const best = [...shown].sort(
    (a, b) => Math.abs(b.edgeAfterCost) - Math.abs(a.edgeAfterCost),
  )[0];
  $("bestEdge").textContent = pct(best?.edgeAfterCost);

  body.innerHTML = shown
    .map((i) => {
      const status = i.skipReason
        ? escapeHtml(i.skipReason)
        : "Action";
      return `<tr>
        <td><a href="${escapeAttr(i.url)}" target="_blank" rel="noreferrer">${escapeHtml(i.question)}</a></td>
        <td>${escapeHtml(i.outcome)}</td>
        <td>${escapeHtml(i.side)}</td>
        <td class="mono">${pct(i.marketProb)}</td>
        <td class="mono">${pct(i.blendedProb)}</td>
        <td class="mono">${pct(i.edgeAfterCost)}</td>
        <td>${status}</td>
      </tr>`;
    })
    .join("");
}

function renderPositions(positions = [], error) {
  const el = $("posList");
  if (error && !positions.length) {
    el.innerHTML = `<p class="empty-inline">${escapeHtml(error)}</p>`;
    return;
  }
  if (!positions.length) {
    el.innerHTML = `<p class="empty-inline">No open positions.</p>`;
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
      return `<div class="row"><strong>${title}</strong><div class="s">${escapeHtml(p.outcome ?? `#${p.outcomeIdx}`)} · ${Number(p.sharesHuman).toFixed(3)} shares · ${escapeHtml(p.marketStatus)}</div></div>`;
    })
    .join("");
}

function renderJournal(entries = []) {
  const el = $("journal");
  if (!entries.length) {
    el.innerHTML = `<p class="empty-inline">Nothing recorded yet.</p>`;
    return;
  }
  el.innerHTML = entries
    .slice(0, 30)
    .map((e) => {
      return `<div class="row"><div class="t">${escapeHtml(e.ts)} · ${escapeHtml(e.event || "event")}</div><strong>${escapeHtml(e.question || e.market || "")}</strong><div class="s">${escapeHtml(e.reason || e.tx || e.outcome || "")}</div></div>`;
    })
    .join("");
}

function renderLogs(lines = []) {
  $("logs").textContent = lines.slice(0, 50).join("\n") || "No logs yet.";
}

function applyStatus(s) {
  const wallet = s.wallet || "";
  $("wallet").textContent = wallet || "—";
  $("minEdge").textContent = pct(s.minEdge);
  $("deadline").textContent = s.deadlineIso
    ? `Ends ${new Date(s.deadlineIso).toLocaleDateString()}`
    : "Deadline —";
  $("llmState").textContent = s.llmEnabled
    ? "External + LLM + anti-herd"
    : "External + anti-herd";
  $("signalMode").textContent = s.llmEnabled ? "Full stack" : "Core stack";

  const mode = s.dryRun ? "Dry run" : "Live";
  const network = s.network || "testnet";
  const watch = s.state?.watch?.running ? "Watching" : "Idle";
  $("statusLine").textContent = `${mode} · ${network} · ${watch}`;

  const watching = s.state?.watch?.running;
  const ready = s.readiness?.ready;
  $("btnWatch").disabled = !!watching || !ready;
  $("btnStop").disabled = !watching;
  $("btnOnce").disabled = !ready;

  if (s.balances) {
    $("bankroll").textContent = `${Number(s.balances.token).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
    $("ethBal").textContent = `Gas ${Number(s.balances.eth).toFixed(5)} ETH`;
  } else {
    $("bankroll").textContent = "—";
    $("ethBal").textContent = s.balanceError
      ? s.balanceError.slice(0, 70)
      : "Gas —";
  }

  const last = s.state?.watch?.lastResult || s.state?.lastScan;
  $("scanStats").textContent = last
    ? `${last.scanned} scanned · ${last.candidates} actionable`
    : "No scan yet";

  $("errLine").textContent = s.state?.watch?.lastError || "";
  renderChecks(s.readiness);
  if (last?.topIntents) renderEdges(last.topIntents);
}

async function copyWallet() {
  const value = $("wallet").textContent.trim();
  const note = $("copyNote");
  if (!value || value === "—") {
    note.textContent = "No wallet to copy.";
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    note.textContent = "Copied.";
  } catch {
    note.textContent = "Copy failed — select the address manually.";
  }
  setTimeout(() => {
    note.textContent = "";
  }, 1800);
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
  $("health").textContent = shortAddr(status.wallet);
  void health;
}

async function withBusy(btn, fn) {
  const prev = btn.disabled;
  const old = btn.textContent;
  btn.disabled = true;
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

$("btnCopyWallet").onclick = () => copyWallet();
$("btnRefresh").onclick = () => refresh();
$("btnOnce").onclick = () =>
  withBusy($("btnOnce"), async () => {
    const result = await api("/api/once", { method: "POST" });
    renderEdges(result.topIntents || []);
    $("heroNote").textContent = result.candidates
      ? `${result.candidates} actionable edge${result.candidates === 1 ? "" : "s"} found.`
      : "Scan finished. No edges cleared the floor.";
  });
$("btnWatch").onclick = () =>
  withBusy($("btnWatch"), () => api("/api/watch/start", { method: "POST" }));
$("btnStop").onclick = () =>
  withBusy($("btnStop"), () => api("/api/watch/stop", { method: "POST" }));

refresh();
setInterval(refresh, 8000);

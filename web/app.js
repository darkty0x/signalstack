const $ = (id) => document.getElementById(id);

let autoScanStarted = false;
let refreshing = false;

const ICONS = {
  buy: `<svg class="mini-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 2.2 13.2 8H9.5v5.8H6.5V8H2.8L8 2.2Z"/></svg>`,
  sell: `<svg class="mini-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 13.8 2.8 8H6.5V2.2h3V8h3.7L8 13.8Z"/></svg>`,
  yes: `<svg class="mini-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.4 11.5 3.2 8.3l1.1-1.1 2.1 2.1 5.2-5.2 1.1 1.1-6.3 6.3Z"/></svg>`,
  no: `<svg class="mini-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="m4.2 4.2 1.1-1.1L8 5.8l2.7-2.7 1.1 1.1L9.1 6.9l2.7 2.7-1.1 1.1L8 8l-2.7 2.7-1.1-1.1 2.7-2.7-2.7-2.7Z"/></svg>`,
  floor: `<svg class="mini-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2.5 11.2h11v1.4h-11v-1.4Zm5.3-7.4h1.4v4.1l1.8-1.8 1 1-3.5 3.5-3.5-3.5 1-1 1.8 1.8V3.8Z"/></svg>`,
  ready: `<svg class="mini-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.4 11.5 3.2 8.3l1.1-1.1 2.1 2.1 5.2-5.2 1.1 1.1-6.3 6.3Z"/></svg>`,
  impact: `<svg class="mini-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.8 13.4 13H2.6L8 1.8Zm0 3.4L4.9 11.4h6.2L8 5.2Zm-.7 6.6h1.4v1.4H7.3v-1.4Z"/></svg>`,
  hold: `<svg class="mini-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5.2 3.2h1.5v9.6H5.2V3.2Zm4.1 0h1.5v9.6H9.3V3.2Z"/></svg>`,
  shares: `<svg class="mini-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 12.5h10v1.3H3v-1.3Zm1.2-2.4h1.6V11H4.2v-.9Zm2.5-2.2h1.6v3.1H6.7V7.9Zm2.5-2.3h1.6v5.4H9.2V5.6Zm2.5-2.4h1.6v7.8h-1.6V3.2Z"/></svg>`,
  tiny: `<svg class="mini-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm0 1.4a4.1 4.1 0 1 0 0 8.2 4.1 4.1 0 0 0 0-8.2Zm-.7 1.8h1.4v2.1H10v1.3H7.3V5.7Z"/></svg>`,
  watch: `<svg class="mini-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 3.2A7.2 7.2 0 0 0 1.4 8 7.2 7.2 0 0 0 8 12.8 7.2 7.2 0 0 0 14.6 8 7.2 7.2 0 0 0 8 3.2Zm0 1.5A4.2 4.2 0 0 1 12.9 8 4.2 4.2 0 0 1 8 11.3 4.2 4.2 0 0 1 3.1 8 4.2 4.2 0 0 1 8 4.7Z"/></svg>`,
};

function pct(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (Math.abs(n) < 5e-4) return "0%";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(2)}%`;
}

function pctPlain(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function pctClass(n) {
  if (!(typeof n === "number") || Number.isNaN(n) || Math.abs(n) < 5e-4) {
    return "num flat";
  }
  return n > 0 ? "num pos" : "num neg";
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

function statusMeta(skipReason) {
  if (!skipReason) return { label: "Ready", kind: "go", icon: "ready" };
  const key = String(skipReason);
  if (key === "below_floor" || /edge .+ < min/.test(key)) {
    return { label: "Below floor", kind: "wait", icon: "floor" };
  }
  if (key === "impact" || key.includes("impact")) {
    return { label: "Impact", kind: "wait", icon: "impact" };
  }
  if (key === "too_small" || key.includes("size")) {
    return { label: "Too small", kind: "mute", icon: "tiny" };
  }
  if (key === "no_shares" || key.includes("inventory")) {
    return { label: "No shares", kind: "mute", icon: "shares" };
  }
  if (key === "hold" || key.includes("weak")) {
    return { label: "Hold", kind: "mute", icon: "hold" };
  }
  if (key === "preview") return { label: "Watch", kind: "wait", icon: "watch" };
  return { label: key.slice(0, 18), kind: "mute", icon: "hold" };
}

function outcomeChip(label) {
  const raw = String(label || "");
  const low = raw.toLowerCase();
  const kind = low === "yes" ? "yes" : low === "no" ? "no" : "neutral";
  const text =
    kind === "yes" ? "Yes" : kind === "no" ? "No" : raw;
  const icon = ICONS[kind] || "";
  return `<span class="chip out-${kind}">${icon}<span>${escapeHtml(text)}</span></span>`;
}

function sideChip(side) {
  const s = String(side || "").toLowerCase();
  const label = s === "buy" ? "Buy" : s === "sell" ? "Sell" : s;
  const icon = ICONS[s] || "";
  return `<span class="chip side-${s}">${icon}<span>${escapeHtml(label)}</span></span>`;
}

function skeletonRows(n = 5) {
  return Array.from({ length: n })
    .map(
      () => `<tr class="skel-row"><td colspan="7"><div class="skel-lines"><span></span><span></span><span></span><span></span></div></td></tr>`,
    )
    .join("");
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
  if (!autoScanStarted) {
    note.textContent = readiness.ready
      ? "Ready on Gensyn testnet. Find edges or start watch."
      : "Finish setup before trading.";
  }

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
  const ranked = [...intents].sort(
    (a, b) => Math.abs(b.edgeAfterCost) - Math.abs(a.edgeAfterCost),
  );
  const shown = ranked.slice(0, 16);

  if (!shown.length) {
    body.innerHTML =
      '<tr><td colspan="7" class="empty">No markets yet. Run Find edges.</td></tr>';
    $("bestEdge").textContent = "—";
    $("bestEdge").className = "num flat";
    return;
  }

  const best = shown[0]?.edgeAfterCost;
  $("bestEdge").textContent = pct(best);
  $("bestEdge").className = pctClass(best);

  body.innerHTML = shown
    .map((i) => {
      const st = statusMeta(i.skipReason);
      return `<tr>
        <td class="market-cell"><a href="${escapeAttr(i.url)}" target="_blank" rel="noreferrer">${escapeHtml(i.question)}</a></td>
        <td>${outcomeChip(i.outcome)}</td>
        <td>${sideChip(i.side)}</td>
        <td class="mono">${pctPlain(i.marketProb)}</td>
        <td class="mono">${pctPlain(i.blendedProb)}</td>
        <td class="mono ${pctClass(i.edgeAfterCost)}">${pct(i.edgeAfterCost)}</td>
        <td><span class="status-pill ${st.kind}">${ICONS[st.icon] || ""}<span>${escapeHtml(st.label)}</span></span></td>
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
    el.innerHTML = `<p class="empty-inline">No market shares yet. Bankroll sits as USDC until an edge clears the floor (or a practice buy).</p>`;
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
  $("minEdge").className = "num flat";
  $("deadline").textContent = s.deadlineIso
    ? `Ends ${new Date(s.deadlineIso).toLocaleDateString()}`
    : "Deadline —";
  $("llmState").textContent = s.llmEnabled
    ? "External + LLM + prior"
    : "External + prior + anti-herd";
  $("signalMode").textContent = s.llmEnabled ? "Full stack" : "Core stack";
  $("signalMode").className = "";
  $("bankroll").className = "";

  const mode = s.dryRun ? "Dry run" : "Live";
  const network = s.network || "testnet";
  const watching = !!s.state?.watch?.running;

  const liveDot = $("liveDot");
  const netLabel = $("netLabel");
  const watchMark = $("watchMark");
  if (liveDot) {
    liveDot.className = s.dryRun ? "live-dot dry" : "live-dot";
    liveDot.title = mode;
    liveDot.setAttribute("aria-label", mode);
  }
  if (netLabel) netLabel.textContent = network;
  if (watchMark) {
    watchMark.hidden = !watching;
  }
  const ready = s.readiness?.ready;
  $("btnWatch").disabled = !!watching || !ready;
  $("btnStop").disabled = !watching;
  $("btnOnce").disabled = !ready;

  if (s.balances) {
    $("bankroll").textContent = `${Number(s.balances.token).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
    $("ethBal").textContent = `Gas ${Number(s.balances.eth).toFixed(5)} ETH`;
  } else if (!s.balances && $("bankroll").textContent === "—") {
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
  if (last?.topIntents?.length) renderEdges(last.topIntents);
  return { ready, hasEdges: Boolean(last?.topIntents?.length), lastAt: s.state?.lastScanAt };
}

async function copyWallet() {
  const value = $("wallet").textContent.trim();
  const note = $("copyNote");
  const btn = $("btnCopyWallet");
  if (!value || value === "—") {
    note.textContent = "No wallet to copy.";
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    note.textContent = "Copied.";
    btn.classList.add("ok");
  } catch {
    note.textContent = "Copy failed — select the address manually.";
  }
  setTimeout(() => {
    note.textContent = "";
    btn.classList.remove("ok");
  }, 1400);
}

async function ensureScan(ready, hasEdges) {
  if (!ready || hasEdges || autoScanStarted) return;
  autoScanStarted = true;
  if (!$("edgeBody").querySelector("tr:not(.skel-row)")) {
    $("edgeBody").innerHTML = skeletonRows(5);
  }
  $("heroNote").textContent = "Refreshing market scan…";
  try {
    const result = await api("/api/scan");
    renderEdges(result.topIntents || []);
    $("scanStats").textContent = `${result.scanned} scanned · ${result.candidates} actionable`;
    $("heroNote").textContent = result.candidates
      ? `${result.candidates} actionable edge${result.candidates === 1 ? "" : "s"} found.`
      : `${result.scanned} markets scanned. No edges cleared the floor yet.`;
  } catch (err) {
    autoScanStarted = false;
    $("heroNote").textContent = err.message || String(err);
    if (!$("edgeBody").querySelector("a")) {
      $("edgeBody").innerHTML =
        '<tr><td colspan="7" class="empty">Scan failed. Try Find edges.</td></tr>';
    }
  }
}

async function refresh({ light = false } = {}) {
  if (refreshing) return;
  refreshing = true;
  $("btnRefresh")?.classList.add("spin");
  try {
    const statusPath = light ? "/api/status?light=1" : "/api/status";
    const statusP = api(statusPath);
    const extras = light
      ? Promise.resolve(null)
      : Promise.all([
          api("/api/journal"),
          api("/api/logs"),
          api("/api/positions"),
        ]);

    const status = await statusP;
    const view = applyStatus(status);

    const extra = await extras;
    if (extra) {
      const [journal, logs, positions] = extra;
      renderJournal(journal.entries || []);
      renderLogs(logs.lines || []);
      renderPositions(positions.positions || [], positions.error);
    }

    // Never block first paint on a fresh scan when cache is empty —
    // kick it off in the background.
    void ensureScan(view.ready, view.hasEdges);
  } catch (err) {
    $("heroNote").textContent = err.message || String(err);
  } finally {
    refreshing = false;
    $("btnRefresh")?.classList.remove("spin");
  }
}

async function withBusy(btn, fn) {
  const prev = btn.disabled;
  const old = btn.textContent;
  btn.disabled = true;
  if (btn.id === "btnOnce") {
    btn.textContent = "Scanning…";
    $("edgeBody").innerHTML = skeletonRows(5);
  }
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

$("edgeBody").innerHTML = skeletonRows(5);
refresh();
setInterval(() => refresh({ light: true }), 12_000);
setInterval(() => refresh(), 45_000);

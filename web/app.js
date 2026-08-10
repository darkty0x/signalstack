const $ = (id) => document.getElementById(id);

let autoScanStarted = false;
let refreshing = false;
/** @type {"idle" | "starting" | "watching" | "stopping"} */
let watchPhase = "idle";
let watchBusy = false;
let lastWatchSnapshot = null;
let pollSeconds = 90;
let deskReady = false;

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
  if (key === "illiquid" || key.includes("illiquid")) {
    return { label: "Illiquid", kind: "mute", icon: "shares" };
  }
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

function relativeAge(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const sec = Math.round(ms / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

function nextCycleEta(lastCycleAt, intervalSec) {
  if (!lastCycleAt || !intervalSec) return `every ${intervalSec}s`;
  const elapsed = (Date.now() - new Date(lastCycleAt).getTime()) / 1000;
  const remain = Math.max(0, Math.ceil(intervalSec - elapsed));
  if (remain <= 0) return "cycle due now";
  return `next ~${remain}s`;
}

function setBanner(text, tone = "idle") {
  const note = $("heroNote");
  if (!note) return;
  note.textContent = text;
  note.classList.toggle("is-watch", tone === "watch");
  note.classList.toggle("is-transition", tone === "transition");
}

function setWatchStatus(html, visible) {
  const el = $("watchStatus");
  if (!el) return;
  el.innerHTML = html || "";
  el.hidden = !visible;
  el.classList.toggle("is-visible", !!visible);
}

function describeWatchDetail(watch, intervalSec) {
  if (!watch) return "";
  const parts = [];
  const cycles = Number(watch.cycles || 0);
  parts.push(`<strong>Cycle ${cycles}</strong>`);
  if (watch.startedAt) {
    parts.push(`running since ${relativeAge(watch.startedAt)}`);
  }
  if (watch.lastCycleAt) {
    parts.push(`last ${relativeAge(watch.lastCycleAt)}`);
  } else {
    parts.push("first cycle in progress");
  }
  parts.push(nextCycleEta(watch.lastCycleAt, intervalSec));

  const last = watch.lastResult;
  if (last) {
    parts.push(
      `${last.scanned} scanned · ${last.candidates} actionable · ${last.executed} traded · ${last.redeemed} redeemed`,
    );
  }
  return parts.join(" · ");
}

function applyWatchPhase(phase, { ready = true, watch = null } = {}) {
  watchPhase = phase;
  const toggle = $("watchToggle");
  const startBtn = $("btnWatch");
  const stopBtn = $("btnStop");
  const watchMark = $("watchMark");
  if (toggle) toggle.dataset.phase = phase;

  const watching = phase === "watching";
  const starting = phase === "starting";
  const stopping = phase === "stopping";

  if (watchMark) {
    watchMark.hidden = !(watching || starting);
    watchMark.classList.toggle("is-on", watching || starting);
  }

  if (startBtn) {
    startBtn.classList.toggle("is-active", watching || starting);
    if (starting) {
      startBtn.textContent = "Starting…";
      startBtn.disabled = true;
    } else if (watching) {
      startBtn.textContent = "Watching";
      startBtn.disabled = true;
    } else if (stopping) {
      startBtn.textContent = "Start watch";
      startBtn.disabled = true;
    } else {
      startBtn.textContent = "Start watch";
      startBtn.disabled = !ready || watchBusy;
    }
  }

  if (stopBtn) {
    if (stopping) {
      stopBtn.textContent = "Stopping…";
      stopBtn.disabled = true;
    } else if (watching || starting) {
      stopBtn.textContent = "Stop watch";
      stopBtn.disabled = starting || watchBusy;
    } else {
      stopBtn.textContent = "Stop";
      stopBtn.disabled = true;
    }
  }

  if (starting) {
    setBanner(
      "Starting watch — first cycle runs now (redeem → scan → size → trade).",
      "transition",
    );
    setWatchStatus(
      `Loop will keep scanning about every <strong>${intervalLabel(pollSeconds)}</strong>.`,
      true,
    );
    return;
  }

  if (stopping) {
    setBanner("Stopping watch — ending the loop after this handoff.", "transition");
    setWatchStatus(
      watch
        ? describeWatchDetail(watch, pollSeconds)
        : "Watch loop is shutting down.",
      true,
    );
    return;
  }

  if (watching) {
    const detail = describeWatchDetail(watch, pollSeconds);
    const err = watch?.lastError;
    setBanner(
      err
        ? `Watching with error — ${err}`
        : "Watching markets — loop is live on this desk.",
      "watch",
    );
    setWatchStatus(detail || "Waiting for the first cycle to finish.", true);
    return;
  }

  setBanner(
    ready
      ? "Ready on Gensyn testnet. Find edges or start watch."
      : "Finish setup before trading.",
    "idle",
  );
  setWatchStatus("", false);
}

function intervalLabel(sec) {
  if (!sec) return "90s";
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  return m === 1 ? "1 min" : `${m} min`;
}

function renderChecks(readiness) {
  const el = $("checks");
  const summary = $("readySummary");
  if (!readiness) {
    el.innerHTML = "";
    summary.textContent = "—";
    return;
  }

  summary.textContent = readiness.ready ? "Ready" : "Blocked";
  summary.className = readiness.ready ? "ready-ok" : "ready-bad";

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
    (a, b) =>
      Math.abs(b.edge ?? b.edgeAfterCost) -
      Math.abs(a.edge ?? a.edgeAfterCost),
  );
  const shown = ranked.slice(0, 16);

  if (!shown.length) {
    body.innerHTML =
      '<tr><td colspan="7" class="empty">No markets yet. Run Find edges.</td></tr>';
    return;
  }

  body.innerHTML = shown
    .map((i) => {
      const st = statusMeta(i.skipReason);
      const edge = i.edge ?? i.edgeAfterCost;
      return `<tr>
        <td class="market-cell"><a href="${escapeAttr(i.url)}" target="_blank" rel="noreferrer">${escapeHtml(i.question)}</a></td>
        <td>${outcomeChip(i.outcome)}</td>
        <td>${sideChip(i.side)}</td>
        <td class="mono">${pctPlain(i.marketProb)}</td>
        <td class="mono">${pctPlain(i.blendedProb)}</td>
        <td class="mono ${pctClass(edge)}">${pct(edge)}</td>
        <td><span class="status-pill ${st.kind}">${ICONS[st.icon] || ""}<span>${escapeHtml(st.label)}</span></span></td>
      </tr>`;
    })
    .join("");
}

function renderPositions(positions = [], error) {
  const el = $("posList");
  const countEl = $("posCount");
  const sharesEl = $("posShares");
  const list = Array.isArray(positions) ? positions : [];
  const totalShares = list.reduce(
    (sum, p) => sum + (Number(p.sharesHuman) || 0),
    0,
  );

  if (countEl) {
    countEl.textContent = String(list.length);
    countEl.className = list.length ? "num pos" : "";
  }
  if (sharesEl) {
    sharesEl.textContent = list.length
      ? `${totalShares.toLocaleString(undefined, { maximumFractionDigits: 1 })} shares held`
      : "No fills yet";
  }

  if (error && !list.length) {
    el.innerHTML = `<p class="empty-inline">${escapeHtml(error)}</p>`;
    return;
  }
  if (!list.length) {
    el.innerHTML = `<p class="empty-inline">No market shares yet. Cash sits in bankroll until an edge clears the floor and the agent buys.</p>`;
    return;
  }
  el.innerHTML = list
    .slice(0, 12)
    .map((p) => {
      const title = p.question
        ? p.url
          ? `<a href="${escapeAttr(p.url)}" target="_blank" rel="noreferrer">${escapeHtml(p.question)}</a>`
          : escapeHtml(p.question)
        : escapeHtml(p.market);
      const shares = Number(p.sharesHuman || 0).toLocaleString(undefined, {
        maximumFractionDigits: 1,
      });
      return `<div class="row pos-row"><strong>${title}</strong><div class="s"><span class="status-pill go">${escapeHtml(p.outcome ?? `#${p.outcomeIdx}`)}</span> · <span class="mono">${shares} shares</span> · ${escapeHtml(p.marketStatus)}</div></div>`;
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
  $("bankroll").className = "";

  if (typeof s.pollSeconds === "number" && s.pollSeconds > 0) {
    pollSeconds = s.pollSeconds;
  }

  const mode = s.dryRun ? "Dry run" : "Live";
  const network = s.network || "testnet";
  const watching = !!s.state?.watch?.running;
  lastWatchSnapshot = s.state?.watch || null;

  const liveDot = $("liveDot");
  const netLabel = $("netLabel");
  if (liveDot) {
    liveDot.className = s.dryRun ? "live-dot dry" : "live-dot";
    liveDot.title = mode;
    liveDot.setAttribute("aria-label", mode);
  }
  if (netLabel) netLabel.textContent = network;

  const ready = s.readiness?.ready;
  deskReady = !!ready;
  $("btnOnce").disabled = !ready || watchBusy;

  // Don't clobber in-flight start/stop transitions from a background poll.
  if (!watchBusy) {
    applyWatchPhase(watching ? "watching" : "idle", {
      ready,
      watch: lastWatchSnapshot,
    });
  } else if (watchPhase === "starting" || watchPhase === "stopping") {
    applyWatchPhase(watchPhase, { ready, watch: lastWatchSnapshot });
  }

  const tokenLabel =
    s.network === "competition-testnet" ? "TST" : "USDC";
  if (s.balances) {
    $("bankroll").textContent = `${Number(s.balances.token).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenLabel}`;
    $("ethBal").textContent = `Gas ${Number(s.balances.eth).toFixed(5)} ETH`;
  } else if (!s.balances && $("bankroll").textContent === "—") {
    $("ethBal").textContent = s.balanceError
      ? s.balanceError.slice(0, 70)
      : "Gas —";
  }

  const last = s.state?.watch?.lastResult || s.state?.lastScan;
  if (last) {
    const traded = Number(last.executed || 0);
    $("bestEdge").textContent =
      traded > 0 ? `${traded} traded` : `${last.candidates || 0} ready`;
    $("bestEdge").className = traded > 0 ? "num pos" : "";
    $("scanStats").textContent = `${last.scanned} scanned · ${last.candidates} actionable · ${traded} traded`;
  } else {
    $("scanStats").textContent = "No scan yet";
  }

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
  if (watchPhase !== "idle") return;
  autoScanStarted = true;
  if (!$("edgeBody").querySelector("tr:not(.skel-row)")) {
    $("edgeBody").innerHTML = skeletonRows(5);
  }
  setBanner("Refreshing market scan…", "transition");
  try {
    const result = await api("/api/scan");
    renderEdges(result.topIntents || []);
    $("scanStats").textContent = `${result.scanned} scanned · ${result.candidates} actionable`;
    if (watchPhase === "idle") {
      setBanner(
        result.candidates
          ? `${result.candidates} actionable edge${result.candidates === 1 ? "" : "s"} found.`
          : `${result.scanned} markets scanned. No edges cleared the floor yet.`,
        "idle",
      );
    }
  } catch (err) {
    autoScanStarted = false;
    if (watchPhase === "idle") {
      setBanner(err.message || String(err), "idle");
    }
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
    setBanner(err.message || String(err), "idle");
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
    setBanner("Running one cycle — redeem → scan → size → trade.", "transition");
  }
  try {
    await fn();
  } catch (err) {
    $("errLine").textContent = err.message || String(err);
    setBanner(err.message || String(err), "idle");
  } finally {
    btn.textContent = old;
    btn.disabled = prev;
    await refresh();
  }
}

async function runWatchTransition(nextPhase, request) {
  if (watchBusy) return;
  watchBusy = true;
  applyWatchPhase(nextPhase, {
    ready: deskReady,
    watch: lastWatchSnapshot,
  });
  try {
    const body = await request();
    lastWatchSnapshot = body.watch || lastWatchSnapshot;
    const settled = nextPhase === "starting" ? "watching" : "idle";
    applyWatchPhase(settled, {
      ready: deskReady,
      watch: lastWatchSnapshot,
    });
    await refresh({ light: true });
  } catch (err) {
    $("errLine").textContent = err.message || String(err);
    applyWatchPhase(nextPhase === "starting" ? "idle" : "watching", {
      ready: deskReady,
      watch: lastWatchSnapshot,
    });
    setBanner(err.message || String(err), "idle");
  } finally {
    watchBusy = false;
    applyWatchPhase(watchPhase, {
      ready: deskReady,
      watch: lastWatchSnapshot,
    });
  }
}

$("btnCopyWallet").onclick = () => copyWallet();
$("btnRefresh").onclick = () => refresh();
$("btnOnce").onclick = () =>
  withBusy($("btnOnce"), async () => {
    const result = await api("/api/once", { method: "POST" });
    renderEdges(result.topIntents || []);
    setBanner(
      result.candidates
        ? `${result.candidates} actionable edge${result.candidates === 1 ? "" : "s"} found.`
        : "Scan finished. No edges cleared the floor.",
      "idle",
    );
  });
$("btnWatch").onclick = () =>
  runWatchTransition("starting", () =>
    api("/api/watch/start", { method: "POST" }),
  );
$("btnStop").onclick = () =>
  runWatchTransition("stopping", () =>
    api("/api/watch/stop", { method: "POST" }),
  );

$("edgeBody").innerHTML = skeletonRows(5);
refresh();
setInterval(() => refresh({ light: true }), 12_000);
setInterval(() => refresh(), 45_000);
// Keep watch countdown / “last cycle” copy fresh while watching.
setInterval(() => {
  if (watchBusy) return;
  if (watchPhase !== "watching" || !lastWatchSnapshot) return;
  applyWatchPhase("watching", {
    ready: true,
    watch: lastWatchSnapshot,
  });
}, 1_000);

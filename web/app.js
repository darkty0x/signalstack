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

function fmtTok(n, digits = 1) {
  if (n === undefined || n === null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function renderPortfolio(portfolio, positions = [], error, fallbackCash, tokenLabel) {
  const label = portfolio?.tokenLabel || tokenLabel || "TST";
  const cash =
    portfolio?.cash ??
    (fallbackCash !== undefined ? Number(fallbackCash) : undefined);
  const mark = portfolio?.markValue;
  const equity =
    portfolio?.equity ??
    (cash !== undefined && mark !== undefined ? cash + mark : cash);
  const settle = portfolio?.settleIfWin;
  const pnl = portfolio?.pnlMark;
  const start = portfolio?.startingBankroll ?? 1000;

  if (equity !== undefined && Number.isFinite(equity)) {
    $("bankroll").textContent = `${fmtTok(equity, 1)} ${label}`;
    $("bankroll").className =
      pnl === undefined || pnl === null
        ? ""
        : pnl >= 0
          ? "num pos"
          : "num neg";
  }

  const cashBit = cash !== undefined ? `Cash ${fmtTok(cash, 1)}` : "Cash —";
  const markBit = mark !== undefined ? `Mark ${fmtTok(mark, 1)}` : "Mark —";
  if ($("ethBal")) $("ethBal").textContent = `${cashBit} · ${markBit} ${label}`;

  if ($("settleIfWin")) {
    $("settleIfWin").textContent =
      settle !== undefined ? `${fmtTok(settle, 1)} ${label}` : "—";
    $("settleIfWin").className =
      settle !== undefined && cash !== undefined && settle >= (cash || 0)
        ? "num pos"
        : "";
  }
  if ($("pnlMark")) {
    if (pnl === undefined || pnl === null || Number.isNaN(pnl)) {
      $("pnlMark").textContent = `vs start ${fmtTok(start, 0)} ${label}`;
      $("pnlMark").className = "s";
    } else {
      const sign = pnl > 0 ? "+" : "";
      $("pnlMark").textContent = `Mark P&L ${sign}${fmtTok(pnl, 1)} vs ${fmtTok(start, 0)}`;
      $("pnlMark").className = `s ${pnl >= 0 ? "num pos" : "num neg"}`;
    }
  }

  renderPositions(positions, error, portfolio);
}

function renderPositions(positions = [], error, portfolio) {
  const el = $("posList");
  const countEl = $("posCount");
  const sharesEl = $("posShares");
  const sellAllBtn = $("btnSellAll");
  const list = Array.isArray(positions) ? positions : [];
  const totalShares =
    portfolio?.sharesHeld ??
    list.reduce((sum, p) => sum + (Number(p.sharesHuman) || 0), 0);

  if (countEl) {
    countEl.textContent = String(portfolio?.positionCount ?? list.length);
    countEl.className = list.length ? "num pos" : "";
  }
  if (sharesEl) {
    sharesEl.textContent = list.length
      ? `${fmtTok(totalShares, 1)} shares held`
      : "No fills yet";
  }
  if (sellAllBtn) sellAllBtn.disabled = !list.length || sellBusy;

  if (error && !list.length) {
    el.innerHTML = `<p class="empty-inline">${escapeHtml(error)}</p>`;
    return;
  }
  if (!list.length) {
    el.innerHTML = `<p class="empty-inline">No market shares yet. Cash sits idle until an edge clears the floor and the agent buys.</p>`;
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
      const shares = fmtTok(p.sharesHuman, 1);
      const spot =
        p.spotPrice !== undefined
          ? `${(Number(p.spotPrice) * 100).toFixed(1)}¢`
          : "—";
      const mark = p.markValue !== undefined ? fmtTok(p.markValue, 1) : "—";
      const ifWin =
        p.settleIfWin !== undefined ? fmtTok(p.settleIfWin, 1) : shares;
      return `<div class="row pos-row">
        <div class="pos-main">
          <strong>${title}</strong>
          <div class="s"><span class="status-pill go">${escapeHtml(p.outcome ?? `#${p.outcomeIdx}`)}</span> · <span class="mono">${shares} sh</span> · spot ${spot} · mark ${mark} · if win ${ifWin}</div>
        </div>
        <button type="button" class="btn quiet tiny btn-sell" data-market="${escapeAttr(p.market)}" data-outcome-idx="${escapeAttr(String(p.outcomeIdx))}" ${sellBusy ? "disabled" : ""}>Sell</button>
      </div>`;
    })
    .join("");
}

let sellBusy = false;

async function sellOne(market, outcomeIdx, btn) {
  if (sellBusy || !market) return;
  sellBusy = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Selling…";
  }
  if ($("btnSellAll")) $("btnSellAll").disabled = true;
  setBanner(`Selling position…`, "transition");
  try {
    const result = await api("/api/positions/sell", {
      method: "POST",
      body: JSON.stringify({ market, outcomeIdx: Number(outcomeIdx), fraction: 1 }),
    });
    setBanner(
      result.dryRun
        ? `Dry-run sell quoted for ${escapeHtml(result.outcome || "position")}.`
        : `Sold ${fmtTok(result.sharesHuman, 1)} shares${result.tx ? ` · ${String(result.tx).slice(0, 10)}…` : ""}.`,
      "idle",
    );
  } catch (err) {
    setBanner(err.message || String(err), "idle");
    $("errLine").textContent = err.message || String(err);
  } finally {
    sellBusy = false;
    await refresh();
  }
}

async function sellAll() {
  if (sellBusy) return;
  sellBusy = true;
  const btn = $("btnSellAll");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Selling…";
  }
  setBanner("Selling all open positions…", "transition");
  try {
    const result = await api("/api/positions/sell-all", { method: "POST" });
    const ok = (result.results || []).filter((r) => r.ok).length;
    const fail = (result.results || []).length - ok;
    setBanner(
      fail
        ? `Sold ${ok} position${ok === 1 ? "" : "s"}, ${fail} failed.`
        : `Sold ${ok} position${ok === 1 ? "" : "s"}.`,
      "idle",
    );
  } catch (err) {
    setBanner(err.message || String(err), "idle");
    $("errLine").textContent = err.message || String(err);
  } finally {
    sellBusy = false;
    if (btn) btn.textContent = "Sell all";
    await refresh();
  }
}

function renderJournal(entries = []) {
  const el = $("journal");
  if (!entries.length) {
    el.innerHTML = `<p class="empty-inline">No fills yet — buys/sells from this wallet will show here.</p>`;
    return;
  }
  el.innerHTML = entries
    .slice(0, 40)
    .map((e) => {
      const event = String(e.event || "event");
      const when = e.ts ? relativeAge(e.ts) || e.ts : "";
      const title =
        e.question ||
        e.method ||
        e.market ||
        (e.tx ? String(e.tx).slice(0, 14) + "…" : "Trade");
      const bits = [
        e.outcome,
        e.side,
        e.sharesHuman !== undefined
          ? `${Number(e.sharesHuman).toLocaleString(undefined, { maximumFractionDigits: 1 })} sh`
          : null,
        e.source === "chain" ? "on-chain" : null,
        e.manual ? "manual" : null,
        e.reason && e.source === "journal" ? e.reason : null,
        e.status && e.status !== "ok" && e.status !== "success"
          ? e.status
          : null,
      ].filter(Boolean);
      const txBit = e.txUrl
        ? `<a href="${escapeAttr(e.txUrl)}" target="_blank" rel="noreferrer">${escapeHtml(String(e.tx).slice(0, 12))}…</a>`
        : e.tx
          ? escapeHtml(String(e.tx).slice(0, 12)) + "…"
          : "";
      const pill =
        /buy/i.test(event)
          ? "go"
          : /sell/i.test(event)
            ? "wait"
            : /error|fail/i.test(event)
              ? "mute"
              : "mute";
      return `<div class="row"><div class="t">${escapeHtml(when)} · <span class="status-pill ${pill}">${escapeHtml(event)}</span></div><strong>${escapeHtml(title)}</strong><div class="s">${escapeHtml(bits.join(" · "))}${txBit ? ` · ${txBit}` : ""}</div></div>`;
    })
    .join("");
}

function renderLogs(lines = []) {
  $("logs").textContent = lines.slice(0, 50).join("\n") || "No logs yet.";
}

function applyStatus(s) {
  const wallet = s.wallet || "";
  $("wallet").textContent = wallet || "—";
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
  // Cash-only placeholder until /api/positions portfolio arrives.
  if (s.balances && $("bankroll").textContent === "—") {
    $("bankroll").textContent = `${fmtTok(s.balances.token, 1)} ${tokenLabel} cash`;
    $("ethBal").textContent = `Cash ${fmtTok(s.balances.token, 1)} · Mark pending`;
  } else if (!s.balances && $("bankroll").textContent === "—") {
    $("ethBal").textContent = s.balanceError
      ? s.balanceError.slice(0, 70)
      : "Cash — · Mark —";
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
  return {
    ready,
    hasEdges: Boolean(last?.topIntents?.length),
    lastAt: s.state?.lastScanAt,
    tokenLabel,
    cash: s.balances ? Number(s.balances.token) : undefined,
  };
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
      renderPortfolio(
        positions.portfolio,
        positions.positions || [],
        positions.error,
        view.cash,
        view.tokenLabel,
      );
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
$("btnSellAll").onclick = () => sellAll();
$("posList").addEventListener("click", (ev) => {
  const btn = ev.target.closest?.(".btn-sell");
  if (!btn) return;
  sellOne(btn.dataset.market, btn.dataset.outcomeIdx, btn);
});

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

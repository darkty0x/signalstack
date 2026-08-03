/** Clamp probability into (0,1) open interval to avoid Kelly singularities. */
export function clampProb(p: number, eps = 1e-4): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(1 - eps, Math.max(eps, p));
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** Jaccard similarity over token sets. */
export function similarity(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/** Half-Kelly style sizing for binary/multi outcome buy of underpriced share. */
export function kellyFraction(
  ourProb: number,
  marketProb: number,
  fractionOfKelly: number,
): number {
  const p = clampProb(ourProb);
  const m = clampProb(marketProb);
  // Approximate edge / odds using market implied as price.
  const b = (1 - m) / m;
  const q = 1 - p;
  const f = (b * p - q) / b;
  if (!Number.isFinite(f) || f <= 0) return 0;
  return Math.min(1, f * fractionOfKelly);
}

export function hoursUntil(ms: number | null, now = Date.now()): number | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  return (ms - now) / 3_600_000;
}

/**
 * Prefer markets that settle inside the competition window.
 * Score in [0,1]; 0 means skip.
 */
export function settlementScore(
  hours: number | null,
  opts: { minHours: number; maxHours: number; deadlineMs: number; settleMs: number | null },
): number {
  if (hours === null) return 0.35; // unknown settle time — soft allow
  if (hours < opts.minHours) return 0;
  if (hours > opts.maxHours) return 0.15;
  if (opts.settleMs !== null && opts.settleMs > opts.deadlineMs) return 0.2;

  // Peak around mid-window (~3–7 days)
  const peak = 96;
  const dist = Math.abs(hours - peak);
  return clampProb(1 - dist / opts.maxHours, 0.05);
}

export function usdcFromAtomic(amount: bigint): number {
  return Number(amount) / 1e6;
}

export function sharesFromHuman(n: number): bigint {
  return BigInt(Math.max(0, Math.floor(n * 1e18)));
}

export function formatPct(p: number): string {
  return `${(p * 100).toFixed(2)}%`;
}

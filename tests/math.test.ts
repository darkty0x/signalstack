import { describe, expect, it } from "vitest";
import {
  clampProb,
  kellyFraction,
  settlementScore,
  similarity,
} from "../src/util/math.js";

describe("math", () => {
  it("clamps probabilities", () => {
    expect(clampProb(-1)).toBeGreaterThan(0);
    expect(clampProb(2)).toBeLessThan(1);
  });

  it("sizes kelly only on positive edge", () => {
    expect(kellyFraction(0.7, 0.4, 0.5)).toBeGreaterThan(0);
    expect(kellyFraction(0.3, 0.5, 0.5)).toBe(0);
  });

  it("scores settlement inside competition window", () => {
    const deadline = Date.parse("2026-08-24T23:59:59.000Z");
    const good = settlementScore(72, {
      minHours: 1,
      maxHours: 504,
      deadlineMs: deadline,
      settleMs: Date.now() + 72 * 3600_000,
    });
    const late = settlementScore(800, {
      minHours: 1,
      maxHours: 504,
      deadlineMs: deadline,
      settleMs: Date.now() + 800 * 3600_000,
    });
    expect(good).toBeGreaterThan(late);
  });

  it("matches similar market text", () => {
    expect(
      similarity(
        "Will Bitcoin be above 100k in August?",
        "Bitcoin above 100k in August?",
      ),
    ).toBeGreaterThan(0.4);
  });
});

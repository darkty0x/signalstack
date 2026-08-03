import type { AgentConfig } from "../config.js";
import type { ObservedMarket, SignalEstimate } from "../types.js";
import { log } from "../util/log.js";
import { clampProb } from "../util/math.js";

type LlmJson = {
  outcomes?: Array<{ idx: number; probability: number; rationale?: string }>;
};

/**
 * Calibrated LLM forecast for markets without a clean external match.
 * Never used alone as a hard trade — blended with weights and edge floor.
 */
export async function llmSignals(
  market: ObservedMarket,
  cfg: AgentConfig,
): Promise<SignalEstimate[]> {
  if (!cfg.llm.enabled || !cfg.llm.apiKey) return [];

  const prompt = {
    question: market.question,
    category: market.category,
    outcomes: market.outcomes.map((o) => ({
      idx: o.idx,
      label: o.label,
      marketImpliedProb: o.marketProb,
    })),
    instruction:
      "Estimate true probabilities for each outcome. Probabilities must sum to ~1. Be calibrated, not dramatic. Prefer base rates over vibes.",
  };

  try {
    const res = await fetch(`${cfg.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.llm.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a calibrated probability forecaster for prediction markets. Reply JSON only: {\"outcomes\":[{\"idx\":0,\"probability\":0.0,\"rationale\":\"...\"}]}",
          },
          { role: "user", content: JSON.stringify(prompt) },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      log("warn", "llm forecast failed", { status: res.status });
      return [];
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as LlmJson;
    const rows = parsed.outcomes ?? [];
    const sum = rows.reduce((a, r) => a + Number(r.probability || 0), 0) || 1;

    return rows
      .filter((r) => Number.isFinite(r.probability))
      .map((r) => ({
        source: "llm" as const,
        outcomeIdx: r.idx,
        probability: clampProb(Number(r.probability) / (sum > 1.5 ? sum : 1)),
        confidence: 0.45,
        note: r.rationale?.slice(0, 160) || "llm forecast",
      }));
  } catch (err) {
    log("warn", "llm forecast error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

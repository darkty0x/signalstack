export type OutcomeView = {
  idx: number;
  label: string;
  marketProb: number;
  /** Spot USDC per share when available (human float). */
  spotPrice?: number;
};

export type ObservedMarket = {
  id: `0x${string}`;
  question: string;
  category: string;
  marketUrl: string;
  resolvesAtMs: number | null;
  settlesAtMs: number | null;
  outcomes: OutcomeView[];
  hoursToSettlement: number | null;
  settlementScore: number;
};

export type PositionRow = {
  market: string;
  outcomeIdx: number;
  shares: string;
  sharesHuman: number;
  marketStatus: string;
  question?: string;
  outcome?: string;
  url?: string;
};

export type SignalSource =
  | "external"
  | "llm"
  | "antiHerd"
  | "market"
  | "blend";

export type SignalEstimate = {
  source: SignalSource;
  outcomeIdx: number;
  probability: number;
  confidence: number;
  note: string;
};

export type BlendedView = {
  outcomeIdx: number;
  label: string;
  marketProb: number;
  blendedProb: number;
  edge: number;
  confidence: number;
  signals: SignalEstimate[];
  reasons: string[];
};

export type TradeIntent = {
  market: ObservedMarket;
  view: BlendedView;
  side: "buy" | "sell";
  shares: bigint;
  maxTokensIn?: bigint;
  minTokensOut?: bigint;
  tokensEstimate: bigint;
  edgeAfterCost: number;
  sizeFraction: number;
  skipReason?: string;
};

export type CycleResult = {
  scanned: number;
  candidates: number;
  intents: TradeIntent[];
  executed: number;
  skipped: number;
  redeemed: number;
};

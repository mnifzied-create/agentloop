/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  EDIT THIS TABLE.  These are APPROXIMATE public list prices as of mid-2026.
 *  Always verify against the provider's current pricing page before trusting a
 *  number — vendors change prices, and your real bill depends on caching,
 *  batch discounts, and tier. This file is the single source of truth for the
 *  Token Profiler; change a number here and every result on the page updates.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Units: US dollars per 1,000,000 tokens (the unit every provider quotes in).
 */

export type ModelId =
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5"
  | "openrouter-llama-3.3-70b";

export interface ModelPricing {
  /** Human label shown in the UI. */
  label: string;
  /** Provider / route shown as a small tag. */
  provider: string;
  /** USD per 1M input (prompt) tokens. */
  inputPerMTok: number;
  /** USD per 1M output (completion) tokens. */
  outputPerMTok: number;
}

/**
 * Approximate public pricing, mid-2026. EDIT FREELY.
 * The OpenRouter row stands in for "a cheap capable model behind the same
 * multi-provider seam" — its price is the kind of number that makes routing
 * the easy turns elsewhere worth it.
 */
export const PRICING: Record<ModelId, ModelPricing> = {
  "claude-opus-4-6": {
    label: "Claude Opus 4.6",
    provider: "Anthropic",
    inputPerMTok: 15,
    outputPerMTok: 75,
  },
  "claude-sonnet-4-6": {
    label: "Claude Sonnet 4.6",
    provider: "Anthropic",
    inputPerMTok: 3,
    outputPerMTok: 15,
  },
  "claude-haiku-4-5": {
    label: "Claude Haiku 4.5",
    provider: "Anthropic",
    inputPerMTok: 1,
    outputPerMTok: 5,
  },
  "openrouter-llama-3.3-70b": {
    label: "Llama 3.3 70B (via OpenRouter)",
    provider: "OpenRouter",
    inputPerMTok: 0.12,
    outputPerMTok: 0.3,
  },
};

/** Selectable primary models (the comparison set is derived from these). */
export const PRIMARY_MODEL_IDS: ModelId[] = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

/**
 * Given the user's primary model, pick the two models to compare against:
 * a cheaper Claude (if one exists) and the cheap third-party route. This is
 * what illustrates the "route the easy turns elsewhere" seam.
 */
export function comparisonModels(primary: ModelId): {
  cheaperClaude: ModelId | null;
  thirdParty: ModelId;
} {
  const cheaperClaude =
    primary === "claude-opus-4-6"
      ? "claude-sonnet-4-6"
      : primary === "claude-sonnet-4-6"
        ? "claude-haiku-4-5"
        : null; // Haiku is already the cheapest Claude here.

  return { cheaperClaude, thirdParty: "openrouter-llama-3.3-70b" };
}

/** Blended cost (USD) for a given input/output token count on a model. */
export function costFor(model: ModelId, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model];
  return (inputTokens / 1_000_000) * p.inputPerMTok + (outputTokens / 1_000_000) * p.outputPerMTok;
}

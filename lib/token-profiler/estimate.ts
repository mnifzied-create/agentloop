/**
 * Pure, client-side token + cost estimation for an agent loop.
 *
 * IMPORTANT: this is an ESTIMATE. We count tokens with `gpt-tokenizer`
 * (OpenAI's o200k_base BPE). Anthropic's tokenizer is different, so absolute
 * counts will be off by a small percentage — but the *shape* of the cost
 * (which part of every turn is expensive) is what matters here, and that holds
 * across tokenizers. All the arithmetic below is intentionally explicit.
 */
import { encode } from "gpt-tokenizer";
import { type ModelId, comparisonModels, costFor, PRICING } from "./pricing";

/** Count tokens in a string. Empty/whitespace → 0. */
export function countTokens(text: string): number {
  if (!text || !text.trim()) return 0;
  try {
    return encode(text).length;
  } catch {
    // Tokenizer should never throw on plain text, but never crash the UI.
    return Math.ceil(text.length / 4); // ~4 chars/token fallback.
  }
}

/** Parse + re-serialize tool JSON so we count what's actually sent on the wire. */
export interface ToolSchemaInfo {
  name: string;
  tokens: number;
}
export interface ToolsParseResult {
  ok: boolean;
  error?: string;
  /** Per-tool token counts (serialized form, as sent to the API every turn). */
  perTool: ToolSchemaInfo[];
  /** Total tokens for ALL tool schemas serialized together. */
  totalTokens: number;
}

export function analyzeTools(toolJson: string): ToolsParseResult {
  if (!toolJson.trim()) {
    return { ok: true, perTool: [], totalTokens: 0 };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolJson);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}`, perTool: [], totalTokens: 0 };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Expected a JSON array of tool definitions.", perTool: [], totalTokens: 0 };
  }
  const perTool: ToolSchemaInfo[] = parsed.map((tool, i) => {
    const name =
      tool && typeof tool === "object" && "name" in tool && typeof (tool as { name: unknown }).name === "string"
        ? (tool as { name: string }).name
        : `tool[${i}]`;
    return { name, tokens: countTokens(JSON.stringify(tool)) };
  });
  // Count the whole array serialized together (closest to what's sent).
  const totalTokens = countTokens(JSON.stringify(parsed));
  return { ok: true, perTool, totalTokens };
}

/** Sum token counts of several sample tool-output strings. */
export function analyzeToolOutputs(outputs: string[]): { perOutput: number[]; total: number } {
  const perOutput = outputs.map(countTokens);
  return { perOutput, total: perOutput.reduce((a, b) => a + b, 0) };
}

export interface ProfilerInputs {
  systemPrompt: string;
  toolJson: string;
  /** One or more sample tool outputs (what a tool returns per call). */
  toolOutputs: string[];
  userMessage: string;
  assistantMessage: string;
  /** Average tool calls per conversation turn. */
  toolCallsPerTurn: number;
  /** Number of turns to project the cost over. */
  turns: number;
  primaryModel: ModelId;
}

/** Per-turn token breakdown, split by what each part costs. */
export interface PerTurnBreakdown {
  systemTokens: number;
  toolSchemaTokens: number;
  messageTokens: number; // user + assistant
  toolOutputTokens: number; // avgToolOutput * toolCallsPerTurn
  /** Tokens billed as INPUT each turn (system + schemas + user + tool outputs). */
  inputTokens: number;
  /** Tokens billed as OUTPUT each turn (the assistant reply). */
  outputTokens: number;
  totalTokens: number;
}

/**
 * Build the per-turn breakdown. The agent-loop insight modeled here:
 *  • system prompt + tool schemas are sent EVERY turn (fixed overhead).
 *  • each tool call adds its output back into the context as input.
 *  • the assistant message is the only OUTPUT-priced part.
 */
export function perTurnBreakdown(inp: ProfilerInputs): PerTurnBreakdown {
  const systemTokens = countTokens(inp.systemPrompt);
  const toolSchemaTokens = analyzeTools(inp.toolJson).totalTokens;
  const userTokens = countTokens(inp.userMessage);
  const assistantTokens = countTokens(inp.assistantMessage);

  const { total: outputsTotal, perOutput } = analyzeToolOutputs(inp.toolOutputs);
  const avgToolOutput = perOutput.length ? outputsTotal / perOutput.length : 0;
  const calls = Math.max(0, inp.toolCallsPerTurn);
  const toolOutputTokens = Math.round(avgToolOutput * calls);

  const messageTokens = userTokens + assistantTokens;
  const inputTokens = systemTokens + toolSchemaTokens + userTokens + toolOutputTokens;
  const outputTokens = assistantTokens;

  return {
    systemTokens,
    toolSchemaTokens,
    messageTokens,
    toolOutputTokens,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export interface ModelProjection {
  model: ModelId;
  label: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

/** Project the per-turn breakdown across N turns for one model. */
export function projectForModel(
  model: ModelId,
  perTurn: PerTurnBreakdown,
  turns: number,
): ModelProjection {
  const inputTokens = perTurn.inputTokens * turns;
  const outputTokens = perTurn.outputTokens * turns;
  return {
    model,
    label: PRICING[model].label,
    provider: PRICING[model].provider,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost: costFor(model, inputTokens, outputTokens),
  };
}

export interface FullProjection {
  perTurn: PerTurnBreakdown;
  primary: ModelProjection;
  cheaperClaude: ModelProjection | null;
  thirdParty: ModelProjection;
  /** $ saved over the window if every turn ran on the cheaper Claude. */
  savedVsCheaperClaude: number | null;
  /** $ saved over the window if every turn ran via the third-party route. */
  savedVsThirdParty: number;
}

export function project(inp: ProfilerInputs): FullProjection {
  const perTurn = perTurnBreakdown(inp);
  const { cheaperClaude, thirdParty } = comparisonModels(inp.primaryModel);

  const primary = projectForModel(inp.primaryModel, perTurn, inp.turns);
  const cheaper = cheaperClaude ? projectForModel(cheaperClaude, perTurn, inp.turns) : null;
  const third = projectForModel(thirdParty, perTurn, inp.turns);

  return {
    perTurn,
    primary,
    cheaperClaude: cheaper,
    thirdParty: third,
    savedVsCheaperClaude: cheaper ? primary.cost - cheaper.cost : null,
    savedVsThirdParty: primary.cost - third.cost,
  };
}

// ── Bloat detection ─────────────────────────────────────────────────────────

export interface BloatFlag {
  kind: "tool-schema" | "tool-output";
  name: string;
  tokens: number;
  /** USD saved over the projection window if this item were halved. */
  savingIfHalved: number;
  /** How many times per projection window this item hits the context. */
  occurrences: number;
}

const BLOAT_THRESHOLD_TOKENS = 500;

/**
 * Flag any single tool schema or tool output above the threshold. Each schema
 * is re-sent every turn; each output hits the context `toolCallsPerTurn` times
 * per turn — so halving a bloated one compounds across the whole window.
 */
export function bloatFlags(
  inp: ProfilerInputs,
  proj: FullProjection,
  threshold = BLOAT_THRESHOLD_TOKENS,
): BloatFlag[] {
  const flags: BloatFlag[] = [];
  const inputRate = PRICING[inp.primaryModel].inputPerMTok / 1_000_000;

  // Tool schemas: sent once per turn → `turns` occurrences.
  for (const t of analyzeTools(inp.toolJson).perTool) {
    if (t.tokens > threshold) {
      const occurrences = inp.turns;
      flags.push({
        kind: "tool-schema",
        name: t.name,
        tokens: t.tokens,
        occurrences,
        savingIfHalved: (t.tokens / 2) * occurrences * inputRate,
      });
    }
  }

  // Tool outputs: each appears `toolCallsPerTurn` times per turn.
  const { perOutput } = analyzeToolOutputs(inp.toolOutputs);
  perOutput.forEach((tokens, i) => {
    if (tokens > threshold) {
      const occurrences = Math.round(Math.max(0, inp.toolCallsPerTurn) * inp.turns);
      flags.push({
        kind: "tool-output",
        name: `sample output #${i + 1}`,
        tokens,
        occurrences,
        savingIfHalved: (tokens / 2) * occurrences * inputRate,
      });
    }
  });

  return flags.sort((a, b) => b.savingIfHalved - a.savingIfHalved);
}

export const BLOAT_THRESHOLD = BLOAT_THRESHOLD_TOKENS;

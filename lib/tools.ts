import type Anthropic from "@anthropic-ai/sdk";

/**
 * Tool definitions handed to Claude. Each tool needs a name, a description
 * (Claude reads this to decide when to call it), and a JSON-schema input.
 *
 * To add your own tool: append a definition here and a matching `case` in
 * `runTool()` below. That's the whole extension point.
 */
export const tools: Anthropic.Tool[] = [
  {
    name: "get_current_time",
    description: "Get the current date and time as an ISO 8601 string (UTC). Use when the user asks about the current time or date.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "calculate",
    description:
      "Evaluate a basic arithmetic expression such as '(2 + 3) * 4'. Supports + - * / parentheses and decimals. Use for any arithmetic the user asks for.",
    input_schema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "The arithmetic expression to evaluate, e.g. '(12 * 9) + 7'.",
        },
      },
      required: ["expression"],
    },
  },
];

/** Execute a tool by name and return a string result for Claude to read. */
export async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "get_current_time":
      return new Date().toISOString();
    case "calculate":
      return safeCalculate(String(input?.expression ?? ""));
    default:
      return `Unknown tool: ${name}`;
  }
}

/**
 * Evaluate arithmetic WITHOUT a general eval. The input is first hard-restricted
 * to the character class [digits, whitespace, + - * / ( ) .], so no identifiers,
 * property access, or function calls can ever reach the evaluator.
 */
function safeCalculate(expr: string): string {
  if (!expr.trim()) return "Error: empty expression.";
  if (!/^[\d\s+\-*/().]+$/.test(expr)) {
    return "Error: expression contains unsupported characters. Allowed: digits + - * / ( ) .";
  }
  try {
    const result = Function(`"use strict"; return (${expr});`)() as unknown;
    if (typeof result !== "number" || !Number.isFinite(result)) {
      return "Error: expression did not evaluate to a finite number.";
    }
    return String(result);
  } catch {
    return "Error: could not evaluate expression.";
  }
}

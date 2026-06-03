import Anthropic from "@anthropic-ai/sdk";
import { tools, runTool } from "@/lib/tools";

// Run on the Node.js runtime (the Anthropic SDK expects Node APIs).
export const runtime = "nodejs";
export const maxDuration = 30;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const SYSTEM =
  "You are AgentLoop, a concise, helpful assistant. Use the available tools when they help answer accurately. Prefer the calculate tool for any arithmetic.";

const MAX_STEPS = 5; // safety bound on the agent loop

type UIMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      "Missing ANTHROPIC_API_KEY. Copy .env.example to .env.local and add your key.",
      { status: 500 },
    );
  }

  const anthropic = new Anthropic({ apiKey });
  const { messages: uiMessages } = (await req.json()) as { messages: UIMessage[] };

  // Conversation state, growing as the agent loop runs.
  const messages: Anthropic.MessageParam[] = uiMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      try {
        // Agentic loop: stream text, run any tool calls, feed results back, repeat.
        for (let step = 0; step < MAX_STEPS; step++) {
          const runner = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 1024,
            system: SYSTEM,
            tools,
            messages,
          });

          // Forward token deltas to the client as they arrive.
          runner.on("text", (delta: string) => send(delta));

          const final = await runner.finalMessage();

          // No tool requested -> the model is done.
          if (final.stop_reason !== "tool_use") break;

          // Record the assistant turn (including its tool_use blocks).
          messages.push({ role: "assistant", content: final.content });

          // Execute each requested tool and collect results.
          const toolResults: Array<{
            type: "tool_result";
            tool_use_id: string;
            content: string;
          }> = [];

          for (const block of final.content) {
            if (block.type === "tool_use") {
              send(`\n\n_↪ ${block.name}…_\n\n`);
              const result = await runTool(block.name, block.input as Record<string, unknown>);
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result,
              });
            }
          }

          // Feed tool results back as the next user turn, then loop.
          messages.push({ role: "user", content: toolResults });
        }
      } catch (err) {
        send(`\n\n[error] ${(err as Error).message}`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

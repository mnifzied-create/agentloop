<div align="center">

# 🔁 AgentLoop

**The AI agent starter you can actually read.**
The full agent loop — streaming + tool use — in ~150 lines. No framework, no 40-file SaaS template to gut. Clone, add a key, deploy.

[Quickstart](#quickstart) · [How it works](#how-it-works) · [Add a tool](#add-your-own-tool) · [Pro](#-agentloop-pro)

</div>

---

The AI-starter shelf is crowded with two kinds of repo: black-box frameworks that hide the loop, and giant SaaS kits you spend a day deleting. **AgentLoop is neither.** It's the actual agent loop — model calls a tool, you run it, the result goes back, repeat — written plainly enough to learn from and solid enough to build on.

### What you get (free, MIT)
- ✅ **Streaming chat** — tokens render as they arrive. Plain `fetch` + `ReadableStream`, zero UI deps, no SDK lock-in.
- ✅ **Real tool use** — a working agent loop, not a single `if`.
- ✅ **Two example tools** (`get_current_time`, `calculate`) + a one-function extension point.
- ✅ **Typed & commented** — Next.js App Router + the official Anthropic SDK. Current with today's Claude models.
- ✅ **One-command deploy** to Vercel.

## Quickstart

```bash
git clone https://github.com/mnifzied-create/agentloop.git
cd agentloop
npm install
cp .env.example .env.local      # then paste your ANTHROPIC_API_KEY
npm run dev                     # http://localhost:3000
```

Get a key at [console.anthropic.com](https://console.anthropic.com/settings/keys). Ask the agent `what is (12 * 9) + 7?` and watch it call the `calculate` tool.

### Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/mnifzied-create/agentloop)

Set `ANTHROPIC_API_KEY` in your Vercel project env vars and you're live.

## How it works

The whole agent lives in [`app/api/chat/route.ts`](app/api/chat/route.ts):

1. Stream a Claude turn, forwarding text tokens to the browser as they arrive.
2. When the model emits a `tool_use` block, run the matching tool from [`lib/tools.ts`](lib/tools.ts).
3. Feed the tool result back as the next turn and loop (bounded to 5 steps).
4. Stop when the model returns a normal text answer.

That's the entire pattern behind "AI agents" — no framework required.

## Add your own tool

Two edits, one file:

```ts
// lib/tools.ts
export const tools = [
  // ...existing tools
  {
    name: "get_weather",
    description: "Get the current weather for a city.",
    input_schema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
];

export async function runTool(name, input) {
  switch (name) {
    // ...existing cases
    case "get_weather":
      return JSON.stringify(await fetchWeather(input.city));
  }
}
```

Claude reads your `description` to decide when to call it. That's the whole contract.

## Tech
Next.js (App Router) · TypeScript · [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript) · zero UI dependencies.

---

## 🔁 AgentLoop Pro

The free core is the loop. **Pro is every pattern you'll reach for next — each one as minimal and readable as the core.** Not a bloated SaaS kit; the same teach-by-reading philosophy, leveled up.

| Pattern | Free | **Pro** |
|---|:---:|:---:|
| Streaming + single-tool loop | ✅ | ✅ |
| Parallel & multi-tool orchestration | — | ✅ |
| Structured outputs (typed JSON) | — | ✅ |
| Persistent memory (SQLite threads) | — | ✅ |
| Retries, timeouts & error handling | — | ✅ |
| Human-in-the-loop approval gate | — | ✅ |
| Sub-agents / delegation | — | ✅ |
| Eval harness (catch regressions) | — | ✅ |
| Written guide explaining every pattern | — | ✅ |

**→ Get AgentLoop Pro — $29 one-time:** [ko-fi.com/aimnifzied](https://ko-fi.com/aimnifzied)

<sub>MIT core. Built in public by an indie dev shipping fast.</sub>

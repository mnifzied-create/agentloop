<div align="center">

# 🔁 AgentLoop

**The AI agent starter you can actually read.**
The full agent loop — streaming + tool use — in ~150 lines. No framework, no 40-file SaaS template to gut. Clone, add a key, deploy.

[Quickstart](#quickstart) · [How it works](#how-it-works) · [Add a tool](#add-your-own-tool) · [Pro](#-agentloop-pro)

🆓 **Free tool — [Agent Token Profiler](https://mnifzied-create.github.io/agentloop/):** see what your agent loop *really* costs per turn, which tool is bloating it, and the **serialization cruft** (`$schema`, Pydantic-added `title`) that quietly wastes ~20% — flagged automatically with the exact tokens saved. Runs in your browser — no signup, no key.

📊 **New study — [The Hidden Token Tax](https://mnifzied-create.github.io/agentloop/token-tax/):** we measured what 13 real open-source AI agents (79 tools) actually cost per turn — GitHub's MCP server re-sends 3,546 tokens *every turn*.

</div>

---

The AI-starter shelf is crowded with two kinds of repo: black-box frameworks that hide the loop, and giant SaaS kits you spend a day deleting. **AgentLoop is neither.** It's the actual agent loop — model calls a tool, you run it, the result goes back, repeat — written plainly enough to learn from and solid enough to build on.

> **Build your own agent on the Anthropic SDK — this is not a Claude Code (CLI) extension.** If you searched for a *Claude agent boilerplate*, an *Anthropic SDK agent example*, or how to *build an AI agent in Next.js* and kept landing on Claude Code (the coding CLI), AgentLoop is the other thing: a readable starter for an agent product you ship and own — the streaming tool-use loop in plain code.

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

You shipped your agent. Then real users hit it — and **eight things broke that the demo never showed**: the model wants three tools at once, a flaky API call kills the turn, it forgets everything between requests, it deletes a record with no confirmation.

**AgentLoop Pro is those eight fixes — each solved correctly and minimally**, so you drop them in instead of spending a week rediscovering them (and getting the subtle parts wrong). Same teach-by-reading philosophy as the core, leveled up to production.

> The one that quietly costs the most: **token bloat.** We [measured 13 real agents](https://mnifzied-create.github.io/agentloop/token-tax/) — GitHub's MCP server alone re-sends 3,546 tokens *every turn*, and ~20% of typical schema bytes is pure serialization cruft. Your bill balloons and you can't see *which* tool is eating the context. Pro meters tokens per run and per tool — and the same seam routes cheap turns to a cheaper model. **[→ Try the free Token Profiler](https://mnifzied-create.github.io/agentloop/)** to see (and fix) what your own loop costs.

| Pattern | Free | **Pro** |
|---|:---:|:---:|
| Streaming + single-tool loop | ✅ | ✅ |
| Parallel & multi-tool orchestration | — | ✅ |
| Structured outputs (typed JSON) | — | ✅ |
| Persistent memory (SQLite threads) | — | ✅ |
| Retries, timeouts & error-as-context | — | ✅ |
| Token-bucket rate limiting (per user/IP) | — | ✅ |
| Human-in-the-loop approval gate | — | ✅ |
| Sub-agents / delegation | — | ✅ |
| Eval harness (catch regressions in CI) | — | ✅ |
| **Token & cost metering (usage per run)** | — | ✅ |
| **Works with any model — Claude or via OpenRouter** | — | ✅ |
| **Tested — 29-test suite + CI, all green** | — | ✅ |
| Written guide for every pattern | — | ✅ |

Runs in 60 seconds: `npm install && npm run demo` runs all of it against a mock model — no API key needed, and `npm test` runs the full 29-test suite. Every module is small enough to read top to bottom: you **own** it, not a black box — and the `ModelCaller` seam means it runs on Claude or any model via OpenRouter.

**→ AgentLoop Pro — launch offer: pay what you want, from $9** _(normally $29)_ · commercial license · unlimited projects · **[get it on Ko-fi →](https://ko-fi.com/s/7306cb3140)**

*Not worth it? Reply to your receipt and I'll refund you — no questions asked. The free core stands alone forever; Pro is the shortcut for when you ship.*

---

## FAQ

### How do I build a Claude agent from scratch?

A Claude agent is just a loop: send the conversation to the model, run any tool it calls, append the result, and repeat until it replies. That's about 150 lines on the official Anthropic SDK — no framework required. AgentLoop is a free, MIT-licensed starter that does exactly this, readable top to bottom.

### Why is my AI agent so expensive?

Most agent cost is invisible. You re-send the system prompt and every tool schema on every single turn, so one verbose tool definition is billed again on turn 1, 2, 3 and on. A typical support agent quietly carries around 650 tokens of tool schemas per turn before the user even speaks.

### How do I estimate Claude agent token cost?

Count what you re-send each turn — system prompt, all tool schemas, prior messages, and tool outputs — then multiply by your number of turns and the model's per-token price. The free Agent Token Profiler does this in your browser: paste your setup and see the per-turn breakdown and projected cost.

### How do I reduce my AI agent's token cost?

Trim verbose tool schemas (the biggest hidden cost, since they are re-sent every turn), summarize chatty tool outputs before feeding them back, cap conversation history, and route the easy turns to a cheaper model like Claude Haiku. Measure first — the Token Profiler flags which tool is inflating your context.

<sub>MIT core. Built in public by an indie dev shipping fast.</sub>

// Agent Token Profiler — static, no-build twin of the Next /token-profiler route.
// All logic is a plain-JS port of:
//   lib/token-profiler/estimate.ts
//   lib/token-profiler/pricing.ts
//   lib/token-profiler/defaults.ts
//
// Tokenizer: gpt-tokenizer pinned to the exact version the repo uses (3.4.0),
// loaded from esm.sh, using the o200k_base entrypoint — the SAME encoding the
// Next version uses (its `import { encode } from "gpt-tokenizer"` resolves to
// o200k_base in gpt-tokenizer v3). Counts are an ESTIMATE.
import { encode } from "https://esm.sh/gpt-tokenizer@3.4.0/encoding/o200k_base";

// ─────────────────────────────────────────────────────────────────────────────
//  pricing.ts  (ported)
// ─────────────────────────────────────────────────────────────────────────────
const PRICING = {
  "claude-opus-4-6": { label: "Claude Opus 4.6", provider: "Anthropic", inputPerMTok: 15, outputPerMTok: 75 },
  "claude-sonnet-4-6": { label: "Claude Sonnet 4.6", provider: "Anthropic", inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { label: "Claude Haiku 4.5", provider: "Anthropic", inputPerMTok: 1, outputPerMTok: 5 },
  "openrouter-llama-3.3-70b": {
    label: "Llama 3.3 70B (via OpenRouter)",
    provider: "OpenRouter",
    inputPerMTok: 0.12,
    outputPerMTok: 0.3,
  },
};

const PRIMARY_MODEL_IDS = ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"];

function comparisonModels(primary) {
  const cheaperClaude =
    primary === "claude-opus-4-6"
      ? "claude-sonnet-4-6"
      : primary === "claude-sonnet-4-6"
        ? "claude-haiku-4-5"
        : null; // Haiku is already the cheapest Claude here.
  return { cheaperClaude, thirdParty: "openrouter-llama-3.3-70b" };
}

function costFor(model, inputTokens, outputTokens) {
  const p = PRICING[model];
  return (inputTokens / 1_000_000) * p.inputPerMTok + (outputTokens / 1_000_000) * p.outputPerMTok;
}

// ─────────────────────────────────────────────────────────────────────────────
//  estimate.ts  (ported)
// ─────────────────────────────────────────────────────────────────────────────
function countTokens(text) {
  if (!text || !text.trim()) return 0;
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 4); // ~4 chars/token fallback.
  }
}

function analyzeTools(toolJson) {
  if (!toolJson.trim()) {
    return { ok: true, perTool: [], totalTokens: 0 };
  }
  let parsed;
  try {
    parsed = JSON.parse(toolJson);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e.message}`, perTool: [], totalTokens: 0 };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Expected a JSON array of tool definitions.", perTool: [], totalTokens: 0 };
  }
  const perTool = parsed.map((tool, i) => {
    const name =
      tool && typeof tool === "object" && "name" in tool && typeof tool.name === "string"
        ? tool.name
        : `tool[${i}]`;
    return { name, tokens: countTokens(JSON.stringify(tool)) };
  });
  const totalTokens = countTokens(JSON.stringify(parsed));
  return { ok: true, perTool, totalTokens };
}

function analyzeToolOutputs(outputs) {
  const perOutput = outputs.map(countTokens);
  return { perOutput, total: perOutput.reduce((a, b) => a + b, 0) };
}

function perTurnBreakdown(inp) {
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

function projectForModel(model, perTurn, turns) {
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

function project(inp) {
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

const BLOAT_THRESHOLD_TOKENS = 500;
const BLOAT_THRESHOLD = BLOAT_THRESHOLD_TOKENS;

function bloatFlags(inp, proj, threshold = BLOAT_THRESHOLD_TOKENS) {
  const flags = [];
  const inputRate = PRICING[inp.primaryModel].inputPerMTok / 1_000_000;

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

// ─────────────────────────────────────────────────────────────────────────────
//  defaults.ts  (ported verbatim)
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_SYSTEM_PROMPT = `You are a helpful support agent for an e-commerce store.

Be concise, friendly, and accurate. Always use the available tools to look up
real order, product, and shipping data instead of guessing. Never invent an
order status, tracking number, or refund policy — if a tool returns nothing,
say so and offer to escalate to a human. When you give a final answer, keep it
to a few short sentences and avoid restating the customer's question.`;

const DEFAULT_TOOL_JSON = `[
  {
    "name": "get_weather",
    "description": "Get the current weather for a city, used when a customer asks about delivery conditions.",
    "input_schema": {
      "type": "object",
      "properties": { "city": { "type": "string", "description": "City name, e.g. 'Tunis'." } },
      "required": ["city"]
    }
  },
  {
    "name": "get_order_status",
    "description": "Look up the status of a customer order by its ID.",
    "input_schema": {
      "type": "object",
      "properties": {
        "order_id": { "type": "string", "description": "The order ID, e.g. 'ORD-10482'." }
      },
      "required": ["order_id"]
    }
  },
  {
    "name": "search_knowledge_base",
    "description": "Search the internal knowledge base of help articles, product specifications, return and refund policies, warranty terms, billing rules, account procedures, and shipping rules. Use this tool for ANY question about how the store operates: policy details, product compatibility, troubleshooting steps, fees, timelines, or region-specific rules. It performs a hybrid semantic + keyword search across all published help content and returns the most relevant articles, each with an ID, title, category, and (optionally) a text excerpt. ALWAYS prefer calling this tool over guessing or recalling policy from memory, because policies change frequently and vary by region. You can narrow the search by category, product line, and locale, request more or fewer results, and choose whether to include excerpts. Excerpts are truncated server-side to keep responses readable; if you need the full article, follow up with the article ID. Do not paraphrase warranty or refund terms without citing the article you used. If no article matches, say so plainly and offer to escalate to a human agent rather than inventing an answer.",
    "input_schema": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "Natural-language search query describing exactly what the customer needs help with. Be specific; include product names, error messages, or policy terms the customer mentioned." },
        "category": { "type": "string", "enum": ["shipping", "returns", "warranty", "products", "billing", "account", "troubleshooting"], "description": "Optional category to narrow the search to a single area of the knowledge base." },
        "product_line": { "type": "string", "description": "Optional product line to scope results, e.g. 'aurora-series', 'nimbus-series'. Leave empty to search across all product lines." },
        "locale": { "type": "string", "description": "Optional BCP-47 locale for region-specific policy, e.g. 'en-US', 'fr-FR', 'de-DE'. Defaults to the customer's account locale when omitted." },
        "max_results": { "type": "integer", "minimum": 1, "maximum": 10, "description": "How many articles to return. Defaults to 3. Increase only when the first results were not relevant, since each extra article adds to the context." },
        "include_excerpts": { "type": "boolean", "description": "Whether to include text excerpts from each matched article. Defaults to true. Set false to get only titles and IDs when you just need to confirm an article exists." },
        "min_relevance": { "type": "number", "minimum": 0, "maximum": 1, "description": "Optional minimum relevance score (0–1). Articles below this are dropped. Defaults to 0.2." }
      },
      "required": ["query"]
    }
  }
]`;

const DEFAULT_TOOL_OUTPUTS = [
  `{"city":"Tunis","temp_c":24,"conditions":"clear","wind_kph":12}`,
  `{
  "results": [
    {
      "id": "KB-2231",
      "title": "Return & Refund Policy (2026)",
      "category": "returns",
      "excerpt": "Items may be returned within 30 days of delivery for a full refund, provided they are unused and in original packaging. Opened consumables are non-refundable. Refunds are issued to the original payment method within 5–7 business days of our receiving the return. Return shipping is free for defective items; otherwise a flat 4.99 USD label fee applies and is deducted from the refund. Gift returns are issued as store credit."
    },
    {
      "id": "KB-1188",
      "title": "Aurora Series — Charging & Compatibility",
      "category": "products",
      "excerpt": "The Aurora Series ships with a USB-C PD charger and supports 5V/9V/12V profiles up to 45W. Third-party chargers must be USB-PD certified; non-certified chargers may limit charging to 15W and can void the fast-charge warranty. The Aurora Mini is not compatible with the Aurora dock; use the Mini-specific cradle (sold separately)."
    },
    {
      "id": "KB-0907",
      "title": "International Shipping & Customs",
      "category": "shipping",
      "excerpt": "We ship to 40+ countries. Duties and import taxes are calculated at checkout where possible (DDP); for DDU destinations the carrier collects on delivery. Typical transit is 5–9 business days; remote regions may add 3–5 days. Tracking updates can lag 24–48h after dispatch. We cannot redirect a parcel once it has cleared export."
    },
    {
      "id": "KB-1450",
      "title": "Warranty Coverage & Claims",
      "category": "warranty",
      "excerpt": "All Aurora and Nimbus products carry a 24-month limited warranty covering manufacturing defects. The warranty does not cover accidental damage, water ingress beyond the rated IP class, or damage from non-certified accessories. To file a claim, provide the order ID and a short description of the fault; approved claims are repaired or replaced free of charge, and we cover return shipping for warranty repairs. Battery capacity degradation below 80% within the first 12 months is covered; normal wear after that is not. Out-of-warranty repairs are quoted before any work begins."
    }
  ],
  "total_matches": 4,
  "query_echo": "what is your return policy and is the aurora mini dock compatible"
}`,
];

const DEFAULT_USER_MESSAGE =
  "Hi! I ordered the Aurora Mini last week (order ORD-10482) and I want to return it — what's your policy, and does it work with the standard dock?";

const DEFAULT_ASSISTANT_MESSAGE =
  "Thanks for reaching out! Your order ORD-10482 shipped yesterday and is in transit. You can return the Aurora Mini within 30 days of delivery for a full refund as long as it's unused and in its original packaging. One heads-up: the Aurora Mini isn't compatible with the standard dock — it needs the Mini-specific cradle. Want me to share a link to that cradle or start a return for you?";

const DEFAULT_TOOL_CALLS_PER_TURN = 3;
const DEFAULT_TURNS = 100;
const DEFAULT_PRIMARY_MODEL = "claude-sonnet-4-6";

// ─────────────────────────────────────────────────────────────────────────────
//  formatting helpers (ported from page.tsx)
// ─────────────────────────────────────────────────────────────────────────────
const fmtTok = (n) => Math.round(n).toLocaleString("en-US");
const fmtUsd = (n) =>
  n >= 1
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

// Minimal escaping for any user-entered text we put into innerHTML.
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────────────────────
//  Share / deep-link helpers (NOT part of the token/cost math)
// ─────────────────────────────────────────────────────────────────────────────
// Public URL of this live page — the canonical link we put in shared text.
const SHARE_URL = "https://mnifzied-create.github.io/agentloop/";

// The current scenario is (de)serialized to/from the URL query string so a
// copied link reloads the same inputs. Tool outputs are joined with a unit
// separator that cannot occur in JSON; malformed params on load are ignored.
const OUTPUT_SEP = "";

function encodeScenario(s) {
  const q = new URLSearchParams();
  q.set("sys", s.systemPrompt);
  q.set("tools", s.toolJson);
  q.set("out", s.toolOutputs.join(OUTPUT_SEP));
  q.set("user", s.userMessage);
  q.set("asst", s.assistantMessage);
  q.set("calls", String(s.toolCallsPerTurn));
  q.set("turns", String(s.turns));
  q.set("model", s.primaryModel);
  return q.toString();
}

function decodeScenario(search) {
  const q = new URLSearchParams(search);
  const out = {};
  if (q.has("sys")) out.systemPrompt = q.get("sys") ?? "";
  if (q.has("tools")) out.toolJson = q.get("tools") ?? "";
  if (q.has("out")) out.toolOutputs = (q.get("out") ?? "").split(OUTPUT_SEP);
  if (q.has("user")) out.userMessage = q.get("user") ?? "";
  if (q.has("asst")) out.assistantMessage = q.get("asst") ?? "";
  if (q.has("calls")) {
    const n = Number(q.get("calls"));
    if (Number.isFinite(n)) out.toolCallsPerTurn = n;
  }
  if (q.has("turns")) {
    const n = Number(q.get("turns"));
    if (Number.isFinite(n)) out.turns = n;
  }
  const model = q.get("model");
  if (model && model in PRICING) out.primaryModel = model;
  return out;
}

// Build the personalized, paste-ready text + the "money on the table" number
// from the ALREADY-computed proj/flags/perTurn — same figures the page shows.
function buildShare(inputs, proj, flags, pt) {
  const bloatSavings = flags.reduce((sum, f) => sum + f.savingIfHalved, 0);
  const usesCheaperClaude =
    proj.savedVsCheaperClaude !== null && proj.savedVsCheaperClaude > 0;
  const routingSaving = usesCheaperClaude
    ? proj.savedVsCheaperClaude
    : proj.savedVsThirdParty > 0
      ? proj.savedVsThirdParty
      : 0;
  const routeLabel = usesCheaperClaude
    ? (proj.cheaperClaude && proj.cheaperClaude.label) || "a cheaper model"
    : proj.thirdParty.label;

  const turnsN = inputs.turns || 0;
  const topFlag = flags[0] || null;
  const biggestBloat = topFlag
    ? `Biggest bloat: ${topFlag.name} (${fmtTok(topFlag.tokens)} tok).`
    : "No single item over the bloat threshold.";
  const copyText =
    `My AI agent: ~${fmtTok(pt.totalTokens)} tokens/turn, ${fmtUsd(proj.primary.cost)} over ` +
    `${fmtTok(turnsN)} turns on ${proj.primary.label}. ${biggestBloat} ` +
    `Profiled free with AgentLoop's Token Profiler → ${SHARE_URL}`;

  const shareLink = `${window.location.origin}${window.location.pathname}?${encodeScenario(inputs)}`;

  return {
    bloatSavings,
    routingSaving,
    routeLabel,
    hasMoney: bloatSavings > 0 || routingSaving > 0,
    copyText,
    shareLink,
  };
}

// Copy text to the clipboard and flash a 2s confirmation on the given button.
function copyToClipboard(text, btn, okLabel) {
  const restore = btn.dataset.label || btn.textContent;
  btn.dataset.label = restore;
  navigator.clipboard.writeText(text).then(
    () => {
      btn.textContent = okLabel;
      window.setTimeout(() => {
        btn.textContent = btn.dataset.label;
      }, 2000);
    },
    () => {
      // Clipboard blocked (insecure context / permissions) — fail quietly.
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Component state (mirrors useState in page.tsx)
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  toolJson: DEFAULT_TOOL_JSON,
  toolOutputs: [...DEFAULT_TOOL_OUTPUTS],
  userMessage: DEFAULT_USER_MESSAGE,
  assistantMessage: DEFAULT_ASSISTANT_MESSAGE,
  toolCallsPerTurn: DEFAULT_TOOL_CALLS_PER_TURN,
  turns: DEFAULT_TURNS,
  primaryModel: DEFAULT_PRIMARY_MODEL,
};

// Latest computed share payload (copy text + deep-link), refreshed every render
// so the copy buttons always emit numbers matching what's on screen.
let lastShare = { avoidable: 0, hasMoney: false, copyText: "", shareLink: SHARE_URL };

// Apply any inputs encoded in the URL on first load (deep-link), before render.
function hydrateFromUrl() {
  const parsed = decodeScenario(window.location.search);
  if (parsed.systemPrompt !== undefined) state.systemPrompt = parsed.systemPrompt;
  if (parsed.toolJson !== undefined) state.toolJson = parsed.toolJson;
  if (parsed.toolOutputs !== undefined && parsed.toolOutputs.length) state.toolOutputs = parsed.toolOutputs;
  if (parsed.userMessage !== undefined) state.userMessage = parsed.userMessage;
  if (parsed.assistantMessage !== undefined) state.assistantMessage = parsed.assistantMessage;
  if (parsed.toolCallsPerTurn !== undefined) state.toolCallsPerTurn = parsed.toolCallsPerTurn;
  if (parsed.turns !== undefined) state.turns = parsed.turns;
  if (parsed.primaryModel !== undefined) state.primaryModel = parsed.primaryModel;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DOM refs
// ─────────────────────────────────────────────────────────────────────────────
const el = {
  systemPrompt: document.getElementById("systemPrompt"),
  toolJson: document.getElementById("toolJson"),
  toolErr: document.getElementById("toolErr"),
  toolOutputs: document.getElementById("toolOutputs"),
  addOutput: document.getElementById("addOutput"),
  toolCallsPerTurn: document.getElementById("toolCallsPerTurn"),
  turns: document.getElementById("turns"),
  primaryModel: document.getElementById("primaryModel"),
  heroTurns: document.getElementById("hero-turns"),
  projTurns: document.getElementById("proj-turns"),
  perTurnSummary: document.getElementById("perTurnSummary"),
  bars: document.getElementById("bars"),
  projBody: document.getElementById("projBody"),
  savings: document.getElementById("savings"),
  money: document.getElementById("money"),
  copyResult: document.getElementById("copyResult"),
  copyLink: document.getElementById("copyLink"),
  ctaConnect: document.getElementById("ctaConnect"),
  bloat: document.getElementById("bloat"),
  mathList: document.getElementById("mathList"),
};

// ─────────────────────────────────────────────────────────────────────────────
//  Render: tool-output rows (rebuilt when count changes)
// ─────────────────────────────────────────────────────────────────────────────
function renderOutputs() {
  el.toolOutputs.replaceChildren();
  state.toolOutputs.forEach((out, i) => {
    const row = document.createElement("div");
    row.className = "tp-output-row";

    const ta = document.createElement("textarea");
    ta.className = "mono";
    ta.rows = 4;
    ta.spellcheck = false;
    ta.value = out;
    ta.addEventListener("input", () => {
      state.toolOutputs[i] = ta.value;
      recompute();
    });
    row.appendChild(ta);

    if (state.toolOutputs.length > 1) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "tp-x";
      x.setAttribute("aria-label", "Remove output");
      x.textContent = "✕";
      x.addEventListener("click", () => {
        if (state.toolOutputs.length <= 1) return;
        state.toolOutputs.splice(i, 1);
        renderOutputs();
        recompute();
      });
      row.appendChild(x);
    }
    el.toolOutputs.appendChild(row);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Render: results (per-turn bars, projection table, savings, bloat, math)
// ─────────────────────────────────────────────────────────────────────────────
function recompute() {
  const toolsParse = analyzeTools(state.toolJson);
  const inputs = {
    systemPrompt: state.systemPrompt,
    toolJson: state.toolJson,
    toolOutputs: state.toolOutputs,
    userMessage: state.userMessage,
    assistantMessage: state.assistantMessage,
    toolCallsPerTurn: Number.isFinite(state.toolCallsPerTurn) ? state.toolCallsPerTurn : 0,
    turns: Number.isFinite(state.turns) ? state.turns : 0,
    primaryModel: state.primaryModel,
  };

  const proj = project(inputs);
  const flags = bloatFlags(inputs, proj);
  const pt = proj.perTurn;
  const turnsLabel = fmtTok(inputs.turns || 0);

  // Tool JSON parse error
  if (!toolsParse.ok) {
    el.toolErr.hidden = false;
    el.toolErr.textContent = `⚠ ${toolsParse.error}`;
  } else {
    el.toolErr.hidden = true;
    el.toolErr.textContent = "";
  }

  // Turn-count labels
  el.heroTurns.textContent = turnsLabel;
  el.projTurns.textContent = turnsLabel;

  // Per-turn summary line
  el.perTurnSummary.innerHTML =
    `One turn = <strong>${fmtTok(pt.totalTokens)}</strong> tokens (` +
    `${fmtTok(pt.inputTokens)} in · ${fmtTok(pt.outputTokens)} out).`;

  // Bars
  const barMax = Math.max(pt.systemTokens, pt.toolSchemaTokens, pt.messageTokens, pt.toolOutputTokens, 1);
  const breakdownRows = [
    { label: "System prompt", tokens: pt.systemTokens, note: "sent every turn", cls: "b-sys" },
    { label: "Tool schemas", tokens: pt.toolSchemaTokens, note: "sent every turn — the hidden cost", cls: "b-tools" },
    {
      label: "Tool outputs",
      tokens: pt.toolOutputTokens,
      note: `${inputs.toolCallsPerTurn} call(s) × avg output`,
      cls: "b-out",
    },
    { label: "User + assistant msg", tokens: pt.messageTokens, note: "one exchange", cls: "b-msg" },
  ];
  el.bars.innerHTML = breakdownRows
    .map(
      (r) => `
      <div class="tp-bar-row">
        <div class="tp-bar-label">${esc(r.label)}<em>${esc(r.note)}</em></div>
        <div class="tp-bar-track">
          <div class="tp-bar ${r.cls}" style="width:${(r.tokens / barMax) * 100}%"></div>
        </div>
        <div class="tp-bar-num">${fmtTok(r.tokens)}</div>
      </div>`,
    )
    .join("");

  // Projection table
  const rowHtml = (p, tag) => `
    <tr class="tp-mrow tp-${tag}">
      <td>
        <span class="tp-mlabel">${esc(p.label)}</span>
        <span class="tp-mprovider">${esc(p.provider)}</span>
        ${tag === "primary" ? '<span class="tp-badge-primary">your pick</span>' : ""}
      </td>
      <td>${fmtTok(p.totalTokens)}</td>
      <td class="tp-cost">${fmtUsd(p.cost)}</td>
    </tr>`;
  el.projBody.innerHTML =
    rowHtml(proj.primary, "primary") +
    (proj.cheaperClaude ? rowHtml(proj.cheaperClaude, "cheaper") : "") +
    rowHtml(proj.thirdParty, "third");

  // Savings notes
  let savingsHtml = "";
  if (proj.savedVsCheaperClaude !== null && proj.savedVsCheaperClaude > 0) {
    savingsHtml += `<p>Routing every turn to <strong>${esc(
      proj.cheaperClaude.label,
    )}</strong> instead would cost <strong>${fmtUsd(
      proj.savedVsCheaperClaude,
    )} less</strong> over ${turnsLabel} turns.</p>`;
  }
  if (proj.savedVsThirdParty > 0) {
    savingsHtml += `<p>Routing the easy turns to <strong>${esc(
      proj.thirdParty.label,
    )}</strong> would save up to <strong>${fmtUsd(
      proj.savedVsThirdParty,
    )}</strong> — the value of a multi-provider seam.</p>`;
  }
  el.savings.innerHTML = savingsHtml;

  // Quantified, personalized takeaway + share text (reuses proj/flags/pt above).
  const share = buildShare(inputs, proj, flags, pt);
  lastShare = share; // captured by the copy-button click handlers
  if (share.hasMoney) {
    el.money.className = "tp-money";
    const bloatClause =
      share.bloatSavings > 0
        ? `: trim the flagged bloat to save about <strong>${fmtUsd(share.bloatSavings)}</strong>`
        : "";
    const routeClause =
      share.routingSaving > 0
        ? `${share.bloatSavings > 0 ? "; or route" : ": route"} the easy turns to <strong>${esc(
            share.routeLabel,
          )}</strong> to save about <strong>${fmtUsd(share.routingSaving)}</strong>`
        : "";
    el.money.innerHTML =
      `Two separate levers over your ${turnsLabel} turns${bloatClause}${routeClause}. ` +
      `They overlap, so don't just add them.`;
  } else {
    el.money.className = "tp-money tp-money-lean";
    el.money.innerHTML =
      `Your per-turn overhead is lean — nice. Nothing obvious to trim, and no cheaper route on the ` +
      `table for this setup.`;
  }

  // Bridge / CTA connecting line (ties the money number to the two Pro patterns).
  el.ctaConnect.innerHTML = share.hasMoney
    ? `<strong>Token metering</strong> catches that bloat; a <strong>multi-provider seam</strong> routes ` +
      `the cheap turns — capturing both savings above is exactly what they're for. 2 of AgentLoop Pro's ` +
      `8 patterns. Pay what you want, from $9.`
    : `<strong>Token metering</strong> + a <strong>multi-provider seam</strong> keep an agent lean as it ` +
      `grows — 2 of AgentLoop Pro's 8 patterns. Pay what you want, from $9.`;

  // Bloat flags
  if (flags.length === 0) {
    el.bloat.innerHTML = `<p class="tp-ok">✓ No single tool schema or output is over ~${BLOAT_THRESHOLD} tokens. Nothing is obviously inflating every turn.</p>`;
  } else {
    const items = flags
      .map(
        (f) => `
        <li>
          <span class="tp-chip ${f.kind === "tool-schema" ? "c-schema" : "c-output"}">${
            f.kind === "tool-schema" ? "schema" : "output"
          }</span>
          <span class="tp-flag-name">${esc(f.name)}</span> is
          <strong>${fmtTok(f.tokens)} tokens</strong> — it hits the context ~${fmtTok(
            f.occurrences,
          )}× over ${turnsLabel} turns. Halving it saves about
          <strong>${fmtUsd(f.savingIfHalved)}</strong> on ${esc(PRICING[inputs.primaryModel].label)}.
        </li>`,
      )
      .join("");
    el.bloat.innerHTML = `
      <p class="tp-mini">These items are large enough to weigh on every turn they appear in. Trimming or summarizing them compounds across the whole projection:</p>
      <ul class="tp-flag-list">${items}</ul>`;
  }

  // The math, in the open
  el.mathList.innerHTML = `
    <li><strong>Per turn (input):</strong> system (${fmtTok(pt.systemTokens)}) + tool schemas (${fmtTok(
      pt.toolSchemaTokens,
    )}) + user msg + tool outputs (${inputs.toolCallsPerTurn} × avg-output = ${fmtTok(
      pt.toolOutputTokens,
    )}) = <strong>${fmtTok(pt.inputTokens)}</strong> in.</li>
    <li><strong>Per turn (output):</strong> the assistant reply = ${fmtTok(pt.outputTokens)} out.</li>
    <li><strong>Over ${turnsLabel} turns:</strong> ${fmtTok(pt.inputTokens)} × ${turnsLabel} input + ${fmtTok(
      pt.outputTokens,
    )} × ${turnsLabel} output, priced per the table above.</li>
    <li>Tool schemas and the system prompt are counted <em>once per turn</em> because the API re-sends them every turn — that's the cost people forget.</li>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Wire up inputs (live recompute, matching the React onChange listeners)
// ─────────────────────────────────────────────────────────────────────────────
function init() {
  // Deep-link: hydrate state from the URL before anything renders.
  hydrateFromUrl();

  // Populate the model <select> from PRIMARY_MODEL_IDS.
  el.primaryModel.innerHTML = PRIMARY_MODEL_IDS.map(
    (id) => `<option value="${id}">${esc(PRICING[id].label)}</option>`,
  ).join("");

  // Seed values from state.
  el.systemPrompt.value = state.systemPrompt;
  el.toolJson.value = state.toolJson;
  el.toolCallsPerTurn.value = state.toolCallsPerTurn;
  el.turns.value = state.turns;
  el.primaryModel.value = state.primaryModel;

  renderOutputs();

  // Listeners.
  el.systemPrompt.addEventListener("input", () => {
    state.systemPrompt = el.systemPrompt.value;
    recompute();
  });
  el.toolJson.addEventListener("input", () => {
    state.toolJson = el.toolJson.value;
    recompute();
  });
  el.toolCallsPerTurn.addEventListener("input", () => {
    const v = el.toolCallsPerTurn.valueAsNumber;
    state.toolCallsPerTurn = Number.isFinite(v) ? v : NaN;
    recompute();
  });
  el.turns.addEventListener("input", () => {
    const v = el.turns.valueAsNumber;
    state.turns = Number.isFinite(v) ? v : NaN;
    recompute();
  });
  el.primaryModel.addEventListener("change", () => {
    state.primaryModel = el.primaryModel.value;
    recompute();
  });
  el.addOutput.addEventListener("click", () => {
    state.toolOutputs.push("");
    renderOutputs();
    recompute();
  });

  // Share buttons — emit the latest computed payload (matches what's on screen).
  el.copyResult.addEventListener("click", () => {
    copyToClipboard(lastShare.copyText, el.copyResult, "✓ copied!");
  });
  el.copyLink.addEventListener("click", () => {
    copyToClipboard(lastShare.shareLink, el.copyLink, "✓ link copied!");
  });

  recompute();
}

init();

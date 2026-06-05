"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_ASSISTANT_MESSAGE,
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TOOL_CALLS_PER_TURN,
  DEFAULT_TOOL_JSON,
  DEFAULT_TOOL_OUTPUTS,
  DEFAULT_TURNS,
  DEFAULT_USER_MESSAGE,
} from "@/lib/token-profiler/defaults";
import {
  analyzeTools,
  bloatFlags,
  BLOAT_THRESHOLD,
  project,
  type ModelProjection,
  type ProfilerInputs,
} from "@/lib/token-profiler/estimate";
import { PRICING, PRIMARY_MODEL_IDS, type ModelId } from "@/lib/token-profiler/pricing";

// Kept in sync with the README / home page.
const GITHUB_URL = "https://github.com/mnifzied-create/agentloop";
const KOFI_URL = "https://ko-fi.com/s/7306cb3140";

const fmtTok = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtUsd = (n: number) =>
  n >= 1
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

// Public URL of the live static twin — the canonical link we put in shared text.
const SHARE_URL = "https://mnifzied-create.github.io/agentloop/";

// ── FAQ content (AEO) ────────────────────────────────────────────────────────
// Single source of truth for the visible FAQ section and its FAQPage JSON-LD,
// so the structured data can never drift from what's on screen. Pure content —
// no bearing on the cost model. Mirrors docs/index.html and the README.
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "How do I build a Claude agent from scratch?",
    a: "A Claude agent is just a loop: send the conversation to the model, run any tool it calls, append the result, and repeat until it replies. That's about 150 lines on the official Anthropic SDK — no framework required. AgentLoop is a free, MIT-licensed starter that does exactly this, readable top to bottom.",
  },
  {
    q: "Why is my AI agent so expensive?",
    a: "Most agent cost is invisible. You re-send the system prompt and every tool schema on every single turn, so one verbose tool definition is billed again on turn 1, 2, 3 and on. A typical support agent quietly carries around 650 tokens of tool schemas per turn before the user even speaks.",
  },
  {
    q: "How do I estimate Claude agent token cost?",
    a: "Count what you re-send each turn — system prompt, all tool schemas, prior messages, and tool outputs — then multiply by your number of turns and the model's per-token price. The free Agent Token Profiler does this in your browser: paste your setup and see the per-turn breakdown and projected cost.",
  },
  {
    q: "How do I reduce my AI agent's token cost?",
    a: "Trim verbose tool schemas (the biggest hidden cost, since they are re-sent every turn), summarize chatty tool outputs before feeding them back, cap conversation history, and route the easy turns to a cheaper model like Claude Haiku. Measure first — the Token Profiler flags which tool is inflating your context.",
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};

// ── Deep-link (de)serialization ──────────────────────────────────────────────
// The current scenario is encoded into the URL's query string so a copied link
// reloads the same inputs. Purely client-side; touches no math. Tool outputs are
// joined with a delimiter that cannot occur in JSON. Anything malformed on load
// is ignored and the defaults stand.
const OUTPUT_SEP = "";

interface ScenarioInputs {
  systemPrompt: string;
  toolJson: string;
  toolOutputs: string[];
  userMessage: string;
  assistantMessage: string;
  toolCallsPerTurn: number;
  turns: number;
  primaryModel: ModelId;
}

function encodeScenario(s: ScenarioInputs): string {
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

/** Read a scenario from a query string. Returns only the fields actually present. */
function decodeScenario(search: string): Partial<ScenarioInputs> {
  const q = new URLSearchParams(search);
  const out: Partial<ScenarioInputs> = {};
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
  if (model && model in PRICING) out.primaryModel = model as ModelId;
  return out;
}

export default function TokenProfilerPage() {
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [toolJson, setToolJson] = useState(DEFAULT_TOOL_JSON);
  const [toolOutputs, setToolOutputs] = useState<string[]>(DEFAULT_TOOL_OUTPUTS);
  const [userMessage, setUserMessage] = useState(DEFAULT_USER_MESSAGE);
  const [assistantMessage, setAssistantMessage] = useState(DEFAULT_ASSISTANT_MESSAGE);
  const [toolCallsPerTurn, setToolCallsPerTurn] = useState(DEFAULT_TOOL_CALLS_PER_TURN);
  const [turns, setTurns] = useState(DEFAULT_TURNS);
  const [primaryModel, setPrimaryModel] = useState<ModelId>(DEFAULT_PRIMARY_MODEL);
  const [copied, setCopied] = useState<"" | "text" | "link">("");

  // Deep-link: on first load, hydrate any inputs present in the URL query string.
  // Runs once, client-side only; missing/invalid params leave the defaults intact.
  useEffect(() => {
    const parsed = decodeScenario(window.location.search);
    if (parsed.systemPrompt !== undefined) setSystemPrompt(parsed.systemPrompt);
    if (parsed.toolJson !== undefined) setToolJson(parsed.toolJson);
    if (parsed.toolOutputs !== undefined && parsed.toolOutputs.length) setToolOutputs(parsed.toolOutputs);
    if (parsed.userMessage !== undefined) setUserMessage(parsed.userMessage);
    if (parsed.assistantMessage !== undefined) setAssistantMessage(parsed.assistantMessage);
    if (parsed.toolCallsPerTurn !== undefined) setToolCallsPerTurn(parsed.toolCallsPerTurn);
    if (parsed.turns !== undefined) setTurns(parsed.turns);
    if (parsed.primaryModel !== undefined) setPrimaryModel(parsed.primaryModel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toolsParse = useMemo(() => analyzeTools(toolJson), [toolJson]);

  const inputs: ProfilerInputs = useMemo(
    () => ({
      systemPrompt,
      toolJson,
      toolOutputs,
      userMessage,
      assistantMessage,
      toolCallsPerTurn: Number.isFinite(toolCallsPerTurn) ? toolCallsPerTurn : 0,
      turns: Number.isFinite(turns) ? turns : 0,
      primaryModel,
    }),
    [systemPrompt, toolJson, toolOutputs, userMessage, assistantMessage, toolCallsPerTurn, turns, primaryModel],
  );

  const proj = useMemo(() => project(inputs), [inputs]);
  const flags = useMemo(() => bloatFlags(inputs, proj), [inputs, proj]);
  const pt = proj.perTurn;

  // ── Quantified, personalized share/CTA data ──────────────────────────────
  // Every number here is reused from the already-computed `proj`/`flags` above,
  // so the figure we surface in the CTA and the copied text is the SAME figure
  // shown in the table and the bloat list. No new arithmetic on the cost model.
  const share = useMemo(() => {
    // Money on the table = (sum of bloat-flag halving savings) + (best routing
    // saving available). Both are already tied to the user's chosen N-turn
    // window, so this stays honest — no annualized extrapolation.
    const bloatSavings = flags.reduce((sum, f) => sum + f.savingIfHalved, 0);
    const usesCheaperClaude =
      proj.savedVsCheaperClaude !== null && proj.savedVsCheaperClaude > 0;
    const routingSaving = usesCheaperClaude
      ? (proj.savedVsCheaperClaude as number)
      : proj.savedVsThirdParty > 0
        ? proj.savedVsThirdParty
        : 0;
    const routeLabel = usesCheaperClaude
      ? proj.cheaperClaude?.label ?? "a cheaper model"
      : proj.thirdParty.label;

    const turnsN = inputs.turns || 0;
    const topFlag = flags[0] ?? null;

    // Paste-ready one-liner built from the live computed result.
    const biggestBloat = topFlag
      ? `Biggest bloat: ${topFlag.name} (${fmtTok(topFlag.tokens)} tok).`
      : "No single item over the bloat threshold.";
    const copyText =
      `My AI agent: ~${fmtTok(pt.totalTokens)} tokens/turn, ${fmtUsd(proj.primary.cost)} over ` +
      `${fmtTok(turnsN)} turns on ${proj.primary.label}. ${biggestBloat} ` +
      `Profiled free with AgentLoop's Token Profiler → ${SHARE_URL}`;

    // Deep-link that reloads this exact scenario.
    const shareLink =
      typeof window !== "undefined"
        ? `${window.location.origin}${window.location.pathname}?${encodeScenario(inputs)}`
        : `${SHARE_URL}?${encodeScenario(inputs)}`;

    return {
      bloatSavings,
      routingSaving,
      routeLabel,
      hasMoney: bloatSavings > 0 || routingSaving > 0,
      copyText,
      shareLink,
    };
  }, [flags, proj, inputs, pt.totalTokens]);

  // Copy helper — writes to the clipboard and flashes a short confirmation.
  const copyToClipboard = useCallback(async (text: string, which: "text" | "link") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      // Clipboard can be blocked (insecure context / permissions). Stay silent
      // rather than throwing — the on-screen numbers are unaffected.
    }
  }, []);

  const barMax = Math.max(pt.systemTokens, pt.toolSchemaTokens, pt.messageTokens, pt.toolOutputTokens, 1);

  const breakdownRows = [
    { label: "System prompt", tokens: pt.systemTokens, note: "sent every turn", cls: "b-sys" },
    { label: "Tool schemas", tokens: pt.toolSchemaTokens, note: "sent every turn — the hidden cost", cls: "b-tools" },
    { label: "Tool outputs", tokens: pt.toolOutputTokens, note: `${inputs.toolCallsPerTurn} call(s) × avg output`, cls: "b-out" },
    { label: "User + assistant msg", tokens: pt.messageTokens, note: "one exchange", cls: "b-msg" },
  ];

  function updateOutput(i: number, value: string) {
    setToolOutputs((prev) => prev.map((o, j) => (j === i ? value : o)));
  }
  function addOutput() {
    setToolOutputs((prev) => [...prev, ""]);
  }
  function removeOutput(i: number) {
    setToolOutputs((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  }

  return (
    <main className="tp">
      <section className="tp-hero">
        <div className="badge">Free · runs entirely in your browser · no key, no upload</div>
        <h1>Agent Token Profiler</h1>
        <p className="sub">
          Your agent re-sends the system prompt and <em>every tool schema</em> on every turn — a cost
          that&apos;s invisible until the bill arrives. Paste your setup below and see the per-turn
          breakdown, a projection across {fmtTok(inputs.turns || 0)} turns, and where routing the easy
          turns to a cheaper model would save you money.
        </p>
        <p className="tp-estimate-note">
          Token counts are an <strong>estimate</strong> (computed locally with a GPT BPE tokenizer;
          Anthropic&apos;s differs by a few percent). Prices are approximate — see the note by the table.
          This projects each turn&apos;s <strong>fixed overhead</strong> (system + schemas + tool I/O) × N;
          it does not model a <em>growing</em> transcript, so a long accumulating conversation will cost
          more — the point here is to surface that per-turn overhead and find what&apos;s bloating it.
        </p>
      </section>

      <div className="tp-grid">
        {/* ── INPUTS ─────────────────────────────────────────── */}
        <section className="tp-panel">
          <h2>Your agent setup</h2>

          <label className="tp-field">
            <span>System prompt</span>
            <textarea rows={6} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
          </label>

          <label className="tp-field">
            <span>
              Tool definitions <em>(JSON array, Anthropic-style)</em>
            </span>
            <textarea
              className="mono"
              rows={10}
              value={toolJson}
              onChange={(e) => setToolJson(e.target.value)}
              spellCheck={false}
            />
            {!toolsParse.ok && <span className="tp-err">⚠ {toolsParse.error}</span>}
          </label>

          <div className="tp-field">
            <span>
              Sample tool outputs <em>(what a tool returns per call)</em>
            </span>
            {toolOutputs.map((out, i) => (
              <div key={i} className="tp-output-row">
                <textarea
                  className="mono"
                  rows={4}
                  value={out}
                  onChange={(e) => updateOutput(i, e.target.value)}
                  spellCheck={false}
                />
                {toolOutputs.length > 1 && (
                  <button type="button" className="tp-x" onClick={() => removeOutput(i)} aria-label="Remove output">
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="tp-add" onClick={addOutput}>
              + add another sample output
            </button>
          </div>

          <div className="tp-row2">
            <label className="tp-field">
              <span>Avg tool calls / turn</span>
              <input
                type="number"
                min={0}
                step={1}
                value={Number.isFinite(toolCallsPerTurn) ? toolCallsPerTurn : ""}
                onChange={(e) => setToolCallsPerTurn(e.target.valueAsNumber)}
              />
            </label>
            <label className="tp-field">
              <span>Turns to project</span>
              <input
                type="number"
                min={1}
                step={1}
                value={Number.isFinite(turns) ? turns : ""}
                onChange={(e) => setTurns(e.target.valueAsNumber)}
              />
            </label>
          </div>

          <label className="tp-field">
            <span>Primary model</span>
            <select value={primaryModel} onChange={(e) => setPrimaryModel(e.target.value as ModelId)}>
              {PRIMARY_MODEL_IDS.map((id) => (
                <option key={id} value={id}>
                  {PRICING[id].label}
                </option>
              ))}
            </select>
          </label>
        </section>

        {/* ── RESULTS ────────────────────────────────────────── */}
        <section className="tp-panel">
          <h2>Per-turn token breakdown</h2>
          <p className="tp-mini">
            One turn = <strong>{fmtTok(pt.totalTokens)}</strong> tokens (
            {fmtTok(pt.inputTokens)} in · {fmtTok(pt.outputTokens)} out).
          </p>
          <div className="tp-bars">
            {breakdownRows.map((r) => (
              <div key={r.label} className="tp-bar-row">
                <div className="tp-bar-label">
                  {r.label}
                  <em>{r.note}</em>
                </div>
                <div className="tp-bar-track">
                  <div className={`tp-bar ${r.cls}`} style={{ width: `${(r.tokens / barMax) * 100}%` }} />
                </div>
                <div className="tp-bar-num">{fmtTok(r.tokens)}</div>
              </div>
            ))}
          </div>

          <h2 className="tp-mt">Projected over {fmtTok(inputs.turns || 0)} turns</h2>
          <table className="tp-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Total tokens</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              <ModelRow p={proj.primary} tag="primary" />
              {proj.cheaperClaude && <ModelRow p={proj.cheaperClaude} tag="cheaper" />}
              <ModelRow p={proj.thirdParty} tag="third" />
            </tbody>
          </table>

          <div className="tp-savings">
            {proj.savedVsCheaperClaude !== null && proj.savedVsCheaperClaude > 0 && (
              <p>
                Routing every turn to <strong>{proj.cheaperClaude?.label}</strong> instead would cost{" "}
                <strong>{fmtUsd(proj.savedVsCheaperClaude)} less</strong> over {fmtTok(inputs.turns || 0)} turns.
              </p>
            )}
            {proj.savedVsThirdParty > 0 && (
              <p>
                Routing the easy turns to <strong>{proj.thirdParty.label}</strong> would save up to{" "}
                <strong>{fmtUsd(proj.savedVsThirdParty)}</strong> — the value of a multi-provider seam.
              </p>
            )}
          </div>

          {/* ── Quantified, personalized takeaway + share ─────────── */}
          <div className="tp-takeaway">
            {share.hasMoney ? (
              <p className="tp-money">
                Two separate levers over your {fmtTok(inputs.turns || 0)} turns
                {share.bloatSavings > 0 && (
                  <>
                    : trim the flagged bloat to save about{" "}
                    <strong>{fmtUsd(share.bloatSavings)}</strong>
                  </>
                )}
                {share.routingSaving > 0 && (
                  <>
                    {share.bloatSavings > 0 ? "; or route" : ": route"} the easy turns to{" "}
                    <strong>{share.routeLabel}</strong> to save about{" "}
                    <strong>{fmtUsd(share.routingSaving)}</strong>
                  </>
                )}
                . They overlap, so don&apos;t just add them.
              </p>
            ) : (
              <p className="tp-money tp-money-lean">
                Your per-turn overhead is lean — nice. Nothing obvious to trim, and no cheaper route on the
                table for this setup.
              </p>
            )}
            <div className="tp-share">
              <button
                type="button"
                className="tp-copy"
                onClick={() => copyToClipboard(share.copyText, "text")}
                aria-live="polite"
              >
                {copied === "text" ? "✓ copied!" : "Copy result"}
              </button>
              <button
                type="button"
                className="tp-copy ghost"
                onClick={() => copyToClipboard(share.shareLink, "link")}
                aria-live="polite"
                title="Copies a link that reloads this exact scenario"
              >
                {copied === "link" ? "✓ link copied!" : "Copy link to this scenario"}
              </button>
            </div>
          </div>

          <p className="tp-pricing-note">
            Pricing = approximate public list prices, mid-2026, blended input/output per 1M tokens.
            <strong> Verify with the provider</strong> — edit the values in{" "}
            <code>lib/token-profiler/pricing.ts</code> to match your real rates.
          </p>
        </section>
      </div>

      {/* ── BLOAT FLAGS ─────────────────────────────────────── */}
      <section className="tp-panel tp-bloat">
        <h2>Bloat flags</h2>
        {flags.length === 0 ? (
          <p className="tp-ok">
            ✓ No single tool schema or output is over ~{BLOAT_THRESHOLD} tokens. Nothing is obviously
            inflating every turn.
          </p>
        ) : (
          <>
            <p className="tp-mini">
              These items are large enough to weigh on every turn they appear in. Trimming or summarizing
              them compounds across the whole projection:
            </p>
            <ul className="tp-flag-list">
              {flags.map((f, i) => (
                <li key={i}>
                  <span className={`tp-chip ${f.kind === "tool-schema" ? "c-schema" : "c-output"}`}>
                    {f.kind === "tool-schema" ? "schema" : "output"}
                  </span>
                  <span className="tp-flag-name">{f.name}</span> is{" "}
                  <strong>{fmtTok(f.tokens)} tokens</strong> — it hits the context ~
                  {fmtTok(f.occurrences)}× over {fmtTok(inputs.turns || 0)} turns. Halving it saves about{" "}
                  <strong>{fmtUsd(f.savingIfHalved)}</strong> on {PRICING[primaryModel].label}.
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ── HOW THE MATH WORKS ──────────────────────────────── */}
      <section className="tp-panel tp-math">
        <h2>The math, in the open</h2>
        <ul>
          <li>
            <strong>Per turn (input):</strong> system ({fmtTok(pt.systemTokens)}) + tool schemas (
            {fmtTok(pt.toolSchemaTokens)}) + user msg + tool outputs ({inputs.toolCallsPerTurn} ×
            avg-output = {fmtTok(pt.toolOutputTokens)}) = <strong>{fmtTok(pt.inputTokens)}</strong> in.
          </li>
          <li>
            <strong>Per turn (output):</strong> the assistant reply = {fmtTok(pt.outputTokens)} out.
          </li>
          <li>
            <strong>Over {fmtTok(inputs.turns || 0)} turns:</strong> {fmtTok(pt.inputTokens)} ×{" "}
            {fmtTok(inputs.turns || 0)} input + {fmtTok(pt.outputTokens)} × {fmtTok(inputs.turns || 0)}{" "}
            output, priced per the table above.
          </li>
          <li>
            Tool schemas and the system prompt are counted <em>once per turn</em> because the API re-sends
            them every turn — that&apos;s the cost people forget.
          </li>
        </ul>
      </section>

      {/* ── FAQ (AEO) ───────────────────────────────────────── */}
      <section className="tp-panel tp-faq">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
        <h2>FAQ</h2>
        {FAQ_ITEMS.map(({ q, a }) => (
          <div key={q}>
            <h3>{q}</h3>
            <p>{a}</p>
          </div>
        ))}
      </section>

      {/* ── BRIDGE / CTA ────────────────────────────────────── */}
      <section className="tp-cta">
        <p className="tp-cta-connect">
          {share.hasMoney ? (
            <>
              <strong>Token metering</strong> catches that bloat; a <strong>multi-provider seam</strong>{" "}
              routes the cheap turns — capturing both savings above is exactly what they&apos;re for. 2 of
              AgentLoop Pro&apos;s 8 patterns. Pay what you want, from $9.
            </>
          ) : (
            <>
              <strong>Token metering</strong> + a <strong>multi-provider seam</strong> keep an agent lean
              as it grows — 2 of AgentLoop Pro&apos;s 8 patterns. Pay what you want, from $9.
            </>
          )}
        </p>
        <p>
          Token metering is 1 of 8 production patterns in AgentLoop. The free MIT core is the readable
          agent loop you can build on; <strong>AgentLoop Pro</strong> wires up all eight — parallel
          tools, persistent memory, retries, rate limiting, approval gates, evals, token metering, and a
          multi-provider seam (so the routing above is one config change, not a rewrite).
        </p>
        <div className="tp-cta-links">
          <a className="btn" href={GITHUB_URL}>
            ★ Free MIT core on GitHub
          </a>
          <a className="btn primary" href={KOFI_URL}>
            AgentLoop Pro — pay what you want, from $9
          </a>
        </div>
      </section>

      <footer className="tp-footer">
        <a href="/">← AgentLoop</a>
        <span>Estimates only · all computation is local to your browser</span>
      </footer>
    </main>
  );
}

function ModelRow({ p, tag }: { p: ModelProjection; tag: "primary" | "cheaper" | "third" }) {
  return (
    <tr className={`tp-mrow tp-${tag}`}>
      <td>
        <span className="tp-mlabel">{p.label}</span>
        <span className="tp-mprovider">{p.provider}</span>
        {tag === "primary" && <span className="tp-badge-primary">your pick</span>}
      </td>
      <td>{fmtTok(p.totalTokens)}</td>
      <td className="tp-cost">{fmtUsd(p.cost)}</td>
    </tr>
  );
}

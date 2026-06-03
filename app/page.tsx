"use client";

import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

// Filled at publish (kept in sync with the README).
const GITHUB_URL = "https://github.com/mnifzied-create/agentloop";
const KOFI_URL = "https://ko-fi.com/agentloop";
const DEPLOY_URL =
  "https://vercel.com/new/clone?repository-url=https://github.com/mnifzied-create/agentloop";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text().catch(() => "Request failed"));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (err) {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: `[error] ${(err as Error).message}` };
        return copy;
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <section className="hero">
        <div className="badge">MIT · ~150 lines · current with today&apos;s Claude SDK</div>
        <h1>
          The Claude agent starter
          <br />
          you can actually read.
        </h1>
        <p className="sub">
          Streaming + tool use in one readable loop. No framework, no 40-file SaaS template to gut.
          Clone, add a key, deploy.
        </p>
        <div className="cta-row">
          <a className="btn primary" href={GITHUB_URL}>★ Free core on GitHub</a>
          <a className="btn" href={DEPLOY_URL}>Deploy to Vercel</a>
          <a className="btn ghost" href="#pro">AgentLoop Pro →</a>
        </div>
      </section>

      <section className="demo-wrap">
        <div className="demo-head">
          <span className="dot" /> Live demo
          <span className="hint">
            &nbsp;— ask <code>what is (12 * 9) + 7?</code> and watch it call a tool
          </span>
        </div>
        <div className="chat">
          {messages.length === 0 && (
            <div className="empty">Type below to talk to the agent. Tools: time + calculator.</div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <span className="role">{m.role === "user" ? "You" : "Agent"}</span>
              <div className="bubble">
                {m.content || (loading && i === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form className="composer" onSubmit={send}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the agent…" />
          <button type="submit" disabled={loading || !input.trim()}>Send</button>
        </form>
        <p className="note">
          Self-hosted demo — set <code>ANTHROPIC_API_KEY</code> on deploy to make it live.
        </p>
      </section>

      <section className="why">
        <div className="card">
          <h3>Just the loop</h3>
          <p>
            Model calls a tool → you run it → result goes back → repeat. The whole pattern behind
            &quot;agents,&quot; in plain TypeScript you can read top to bottom.
          </p>
        </div>
        <div className="card">
          <h3>No lock-in</h3>
          <p>
            Streaming is plain <code>fetch</code> + <code>ReadableStream</code>. Tools are one
            function. Next.js + the official Anthropic SDK. Nothing magic to learn.
          </p>
        </div>
        <div className="card">
          <h3>Ships today</h3>
          <p>
            Typed, commented, zero UI deps, one-command deploy. Current with today&apos;s Claude
            models — not a stale boilerplate.
          </p>
        </div>
      </section>

      <section className="pro" id="pro">
        <h2>AgentLoop Pro</h2>
        <p className="pro-sub">
          The free core is the loop. Pro is every pattern you reach for next — each kept just as
          minimal and readable.
        </p>
        <div className="grid">
          {[
            "Parallel & multi-tool orchestration",
            "Persistent memory (SQLite threads)",
            "Structured outputs (typed JSON)",
            "Retries, timeouts & error handling",
            "Human-in-the-loop approval gate",
            "Sub-agents / delegation",
            "Eval harness (catch regressions)",
            "Written guide for every pattern",
          ].map((f) => (
            <div key={f} className="feat">✓ {f}</div>
          ))}
        </div>
        <a className="btn primary big" href={KOFI_URL}>Get AgentLoop Pro — $29 one-time</a>
      </section>

      <footer>
        <span>MIT core. Built in public.</span>
        <a href={GITHUB_URL}>GitHub</a>
      </footer>
    </main>
  );
}

import { ArrowRight, Loader2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { AGENTS } from "../lib/agents";
import { api } from "../lib/api";

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { method: "POST", json: { email, password } });
      onLogin();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const crew = ["PARSE", "EXTRACT", "VALIDATE", "VERIFY", "HUMAN_REVIEW", "STORE", "REMINDER"];

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-sidebar p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -left-32 -top-32 h-[520px] w-[520px] rounded-full bg-violet-600/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 right-0 h-[420px] w-[420px] rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="relative text-sm font-semibold tracking-wide text-violet-200">AGENTIC EXTRACTOR</div>
        <div className="relative">
          <h1 className="max-w-md text-4xl font-semibold leading-tight tracking-tight">
            Seven agents. Every invoice in your inbox, extracted, audited and paid on time.
          </h1>
          <div className="mt-10 grid max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
            {crew.map((n) => {
              const a = AGENTS[n];
              const Icon = a.icon;
              return (
                <div key={n} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${a.color}26`, color: a.color }}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{a.name}</span>
                    <span className="block text-xs text-white/50">{a.role}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="relative text-xs text-white/40">LangGraph.js · local LLM inference · human-in-the-loop</div>
      </div>

      <div className="flex items-center justify-center px-4 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Use the admin account created by <code className="font-mono text-xs">pnpm seed</code>.</p>
          <div className="mt-8 space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
            <button className="btn btn-primary w-full justify-center py-2.5" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ArrowRight className="h-4 w-4" /></>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

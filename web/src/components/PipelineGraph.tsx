import { AGENTS } from "../lib/agents";
import type { AgentEvent } from "../lib/live";
import { ms } from "../lib/format";

// Live view of one LangGraph run. Node and edge states are derived purely from
// the run's AgentEvents, so the same component renders history and live runs.

type NodeState = "idle" | "active" | "ok" | "bad" | "warn" | "muted";

const W = 150, H = 66;
const POS: Record<string, { x: number; y: number }> = {
  PARSE: { x: 90, y: 92 },
  EXTRACT: { x: 280, y: 92 },
  VALIDATE: { x: 470, y: 92 },
  VERIFY: { x: 660, y: 92 },
  STORE: { x: 870, y: 92 },
  HUMAN_REVIEW: { x: 660, y: 238 },
  REJECTED: { x: 870, y: 238 },
};

const L = (n: string) => POS[n].x - W / 2;
const R = (n: string) => POS[n].x + W / 2;
const T = (n: string) => POS[n].y - H / 2;
const B = (n: string) => POS[n].y + H / 2;

const EDGES: { from: string; to: string; d: string; label?: string; lx?: number; ly?: number }[] = [
  { from: "PARSE", to: "EXTRACT", d: `M${R("PARSE")},92 L${L("EXTRACT")},92` },
  { from: "EXTRACT", to: "VALIDATE", d: `M${R("EXTRACT")},92 L${L("VALIDATE")},92` },
  { from: "VALIDATE", to: "VERIFY", d: `M${R("VALIDATE")},92 L${L("VERIFY")},92` },
  { from: "VERIFY", to: "STORE", d: `M${R("VERIFY")},92 L${L("STORE")},92` },
  { from: "VALIDATE", to: "EXTRACT", d: `M450,${T("VALIDATE")} C450,6 300,6 300,${T("EXTRACT")}`, label: "retry with feedback", lx: 375, ly: 20 },
  { from: "VALIDATE", to: "HUMAN_REVIEW", d: `M470,${B("VALIDATE")} C470,238 520,238 ${L("HUMAN_REVIEW")},238`, label: "retries exhausted", lx: 470, ly: 200 },
  { from: "PARSE", to: "HUMAN_REVIEW", d: `M90,${B("PARSE")} L90,270 C90,270 90,270 120,270 L${L("HUMAN_REVIEW") + 20},270 L${L("HUMAN_REVIEW") + 20},${B("HUMAN_REVIEW")}`, label: "unreadable", lx: 200, ly: 264 },
  { from: "VERIFY", to: "HUMAN_REVIEW", d: `M648,${B("VERIFY")} L648,${T("HUMAN_REVIEW")}`, label: "unknown vendor", lx: 600, ly: 168 },
  { from: "HUMAN_REVIEW", to: "VERIFY", d: `M672,${T("HUMAN_REVIEW")} L672,${B("VERIFY")}`, label: "whitelist", lx: 706, ly: 168 },
  { from: "VERIFY", to: "REJECTED", d: `M${R("VERIFY")},108 C770,108 790,180 ${L("REJECTED") + 30},${T("REJECTED")}`, label: "duplicate", lx: 786, ly: 150 },
  { from: "HUMAN_REVIEW", to: "STORE", d: `M${R("HUMAN_REVIEW")},226 C790,226 840,180 850,${B("STORE")}`, label: "approve", lx: 812, ly: 196 },
  { from: "HUMAN_REVIEW", to: "REJECTED", d: `M${R("HUMAN_REVIEW")},250 L${L("REJECTED")},250`, label: "reject", lx: 760, ly: 266 },
];

const STATE_COLOR: Record<NodeState, string> = {
  idle: "var(--border)",
  active: "var(--accent)",
  ok: "var(--ok)",
  bad: "var(--bad)",
  warn: "var(--warn)",
  muted: "var(--faint)",
};

function outcomeState(outcome: string | null): NodeState {
  switch (outcome) {
    case "PASS": case "APPROVE": case "DECISION": return "ok";
    case "FAIL": case "REJECT": return "bad";
    case "ESCALATE": case "WAITING": return "warn";
    case "SKIP": return "muted";
    default: return "muted";
  }
}

export function derive(events: AgentEvent[], jobStatus: string) {
  const starts = events.filter((e) => e.phase === "START");
  const visits: Record<string, number> = {};
  const traversed = new Set<string>();
  starts.forEach((e, i) => {
    // A node re-entered back-to-back is LangGraph re-running an interrupted node on resume — one visit
    if (i > 0 && starts[i - 1].node === e.node) return;
    visits[e.node] = (visits[e.node] ?? 0) + 1;
    if (i > 0 && starts[i - 1].node !== e.node) traversed.add(`${starts[i - 1].node}>${e.node}`);
  });

  const nodes: Record<string, { state: NodeState; lastMs?: number | null; message?: string | null }> = {};
  for (const node of Object.keys(POS)) {
    const mine = events.filter((e) => e.node === node);
    const last = mine[mine.length - 1];
    if (!last) { nodes[node] = { state: "idle" }; continue; }
    const lastEnd = [...mine].reverse().find((e) => e.phase === "END");
    if (last.phase === "START" && jobStatus === "RUNNING") nodes[node] = { state: "active", message: "working…" };
    else nodes[node] = { state: outcomeState(lastEnd?.outcome ?? null), lastMs: lastEnd?.durationMs, message: lastEnd?.outcome };
  }
  const lastStart = starts[starts.length - 1];
  const activeEdge = jobStatus === "RUNNING" && starts.length > 1 ? `${starts[starts.length - 2].node}>${lastStart.node}` : null;
  return { nodes, visits, traversed, activeEdge };
}

export function PipelineGraph({ events, status }: { events: AgentEvent[]; status: string }) {
  const { nodes, visits, traversed, activeEdge } = derive(events, status);

  return (
    <div className="scroll-thin overflow-x-auto">
      <svg viewBox="0 0 960 300" className="block min-w-[640px] w-full" role="img" aria-label="Agent pipeline">
        <defs>
          {(["idle", "on", "active"] as const).map((k) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" style={{ fill: k === "idle" ? "var(--border)" : k === "active" ? "var(--accent)" : "var(--muted)" }} />
            </marker>
          ))}
        </defs>

        {EDGES.map((e) => {
          const key = `${e.from}>${e.to}`;
          const on = traversed.has(key);
          const active = activeEdge === key;
          return (
            <g key={key}>
              <path
                d={e.d}
                fill="none"
                className={active ? "flow" : undefined}
                style={{ stroke: active ? "var(--accent)" : on ? "var(--muted)" : "var(--border)", strokeWidth: on || active ? 2 : 1.5 }}
                markerEnd={`url(#arrow-${active ? "active" : on ? "on" : "idle"})`}
              />
              {e.label && (
                <text x={e.lx} y={e.ly} textAnchor="middle" style={{ fill: on ? "var(--muted)" : "var(--faint)", fontSize: 11 }}>
                  {e.label}
                </text>
              )}
            </g>
          );
        })}

        {Object.entries(POS).map(([node, p]) => {
          const agent = AGENTS[node];
          const n = nodes[node];
          const color = STATE_COLOR[n.state];
          const Icon = agent.icon;
          const visited = n.state !== "idle";
          return (
            <g key={node} transform={`translate(${p.x - W / 2},${p.y - H / 2})`} opacity={visited ? 1 : 0.55}>
              {n.state === "active" && (
                <rect className="pulse-ring" width={W} height={H} rx={14} fill="none" style={{ stroke: "var(--accent)", strokeWidth: 2 }} />
              )}
              <rect width={W} height={H} rx={14} style={{ fill: "var(--surface)", stroke: color, strokeWidth: visited ? 2 : 1.25 }} />
              <rect x={12} y={15} width={34} height={34} rx={10} style={{ fill: visited ? agent.color : "var(--surface-2)", opacity: visited ? 0.14 : 1 }} />
              <Icon x={20} y={23} width={18} height={18} color={visited ? agent.color : "var(--faint)"} strokeWidth={2} />
              <text x={56} y={29} style={{ fill: "var(--text)", fontSize: 13.5, fontWeight: 600 }}>{agent.name}</text>
              <text x={56} y={47} style={{ fill: n.state === "idle" ? "var(--faint)" : color, fontSize: 11, fontFamily: "var(--font-mono)" }}>
                {n.state === "idle" ? node.replace("_", " ").toLowerCase() : n.state === "active" ? "working…" : `${(n.message ?? "").toLowerCase()} ${ms(n.lastMs)}`}
              </text>
              {(visits[node] ?? 0) > 1 && (
                <g transform={`translate(${W - 14},-8)`}>
                  <rect x={-16} width={32} height={18} rx={9} style={{ fill: "var(--warn)" }} />
                  <text y={13} textAnchor="middle" style={{ fill: "white", fontSize: 11, fontWeight: 700 }}>×{visits[node]}</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

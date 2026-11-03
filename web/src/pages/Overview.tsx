import clsx from "clsx";
import { AlertTriangle, ArrowUpRight, CalendarClock, CheckCircle2, Cpu, Inbox, Mail, Wallet } from "lucide-react";
import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, CardHeader, Empty, Loading, PageHeader } from "../components/ui";
import { AGENTS, OUTCOME_TONE } from "../lib/agents";
import { useApi } from "../lib/api";
import { money, ms, pct, timeAgo } from "../lib/format";
import { useLive } from "../lib/live";

function Kpi({ label, value, sub, icon: Icon, tone, to }: { label: string; value: ReactNode; sub?: ReactNode; icon: any; tone: string; to?: string }) {
  const body = (
    <div className="card group h-full p-5 transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        <span className={clsx("flex h-8 w-8 items-center justify-center rounded-lg", tone)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight num">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function Metric({ label, value, target, good }: { label: string; value: string; target: string; good: boolean | null }) {
  return (
    <div className="rounded-xl bg-surface-2 px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-semibold num">{value}</span>
        {good !== null && <span className={clsx("text-xs", good ? "text-ok" : "text-warn")}>target {target}</span>}
      </div>
    </div>
  );
}

const AGING_COLORS = ["var(--ok)", "#f59e0b", "#f97316", "#ef4444", "#be123c"];

export function OverviewPage() {
  const stats = useApi<any>("/stats");
  const health = useApi<any>("/health");
  const feed = useApi<any[]>("/events/recent?limit=12");
  useLive((m) => m.type !== "agent-event" || m.event.phase === "END", () => {
    stats.reload();
    feed.reload();
  }, 600);

  if (!stats.data) return <Loading />;
  const s = stats.data;
  const cur = s.payables.currency;
  const review = s.jobs.byStatus.AWAITING_REVIEW ?? 0;
  const timing = Object.fromEntries(s.nodeTimings.map((n: any) => [n.node, n]));
  const llm = health.data?.llm;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Accounts payable, run by a crew of agents."
        actions={
          <>
            <Badge tone={llm?.ok && llm?.modelAvailable ? "ok" : "bad"} dot>
              <Cpu className="h-3 w-3" /> {llm ? `${llm.model} ${llm.ok && llm.modelAvailable ? "online" : "offline"}` : "LLM…"}
            </Badge>
            <Badge tone={s.queue.active + s.queue.pending > 0 ? "accent" : "muted"} dot>
              Queue {s.queue.active} running · {s.queue.pending} waiting
            </Badge>
            <Link to="/runs" className="btn btn-primary btn-sm"><Inbox className="h-4 w-4" /> Process invoices</Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Outstanding payables" value={money(s.payables.outstandingCents, cur)} sub={`${s.payables.openCount} open invoice${s.payables.openCount === 1 ? "" : "s"}${s.payables.otherCurrencies.length ? ` · +${s.payables.otherCurrencies.join(", ")}` : ""}`} icon={Wallet} tone="bg-accent-soft text-accent" to="/invoices" />
        <Kpi label="Overdue" value={money(s.payables.overdueCents, cur)} sub={`${s.payables.overdueCount} invoice${s.payables.overdueCount === 1 ? "" : "s"} past due`} icon={AlertTriangle} tone="bg-bad-soft text-bad" to="/invoices?filter=overdue" />
        <Kpi label="Due in the next 7 days" value={money(s.payables.dueSoonCents, cur)} sub={`${s.payables.dueSoonCount} invoice${s.payables.dueSoonCount === 1 ? "" : "s"}`} icon={CalendarClock} tone="bg-warn-soft text-warn" to="/reminders" />
        <Kpi label="Awaiting human review" value={review} sub={review ? "The graph is paused on these" : "Nothing waiting on you"} icon={CheckCircle2} tone={review ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"} to="/review" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="card xl:col-span-2">
          <CardHeader title="The agent crew" subtitle="Each node in the LangGraph is an agent with one job. Average time per step, all runs." right={<Link to="/runs" className="text-xs text-accent hover:underline">Watch a run →</Link>} />
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-[14px] bg-line sm:grid-cols-4">
            {["PARSE", "EXTRACT", "VALIDATE", "VERIFY", "HUMAN_REVIEW", "STORE", "REMINDER", "REJECTED"].map((node) => {
              const a = AGENTS[node];
              const Icon = a.icon;
              const t = timing[node];
              const extra = node === "REMINDER" ? `${s.metrics.remindersSent30d} sent · 30d` : t ? `${t.runs} runs · ${ms(t.avgMs)} avg` : "no runs yet";
              return (
                <div key={node} className="bg-surface p-4">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${a.color}1f`, color: a.color }}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="mt-3 text-sm font-semibold">{a.name}</div>
                  <div className="mt-0.5 text-xs leading-snug text-muted">{a.role}</div>
                  <div className="mt-2 text-xs text-faint num">{extra}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card flex flex-col">
          <CardHeader title="Live activity" subtitle="Latest agent decisions" />
          <div className="scroll-thin max-h-[360px] flex-1 overflow-y-auto px-5 py-3">
            {!feed.data?.length ? (
              <Empty icon={Inbox} title="No activity yet">Drop an invoice on the Agent runs page to wake the crew up.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {feed.data.map((e) => {
                  const a = AGENTS[e.node] ?? AGENTS.REJECTED;
                  const Icon = a.icon;
                  return (
                    <li key={e.id} className="fade-in py-2.5">
                      <Link to={`/runs/${e.jobId}`} className="flex gap-3">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: a.color }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{a.name}</span>
                            {e.outcome && <Badge tone={OUTCOME_TONE[e.outcome] ?? "muted"}>{e.outcome.toLowerCase()}</Badge>}
                            <span className="ml-auto shrink-0 text-xs text-faint">{timeAgo(e.createdAt)}</span>
                          </div>
                          <p className="truncate text-xs text-muted">{e.message ?? e.job?.fileName}</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="card">
          <CardHeader title="Payables aging" subtitle={`Unpaid amount by days past due (${cur})`} />
          <div className="h-64 px-2 py-4">
            <ResponsiveContainer>
              <BarChart data={s.aging} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} width={64} tick={{ fill: "var(--muted)", fontSize: 12 }} tickFormatter={(v) => money(v, cur, true)} />
                <Tooltip cursor={{ fill: "var(--surface-2)" }} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }} formatter={(v: any, _n, p: any) => [`${money(v, cur)} · ${p.payload.count} inv.`, "Unpaid"]} />
                <Bar dataKey="cents" radius={[6, 6, 0, 0]} maxBarSize={56}>
                  {s.aging.map((_: any, i: number) => <Cell key={i} fill={AGING_COLORS[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <CardHeader title="Pipeline health" subtitle="Last 14 days · SRS §7.2 targets" />
          <div className="grid grid-cols-2 gap-3 px-5 pt-4 sm:grid-cols-4">
            <Metric label="Extraction success" value={pct(s.metrics.successRate)} target=">90%" good={s.metrics.successRate == null ? null : s.metrics.successRate >= 0.9} />
            <Metric label="Retry rate" value={pct(s.metrics.retryRate)} target="<20%" good={s.metrics.retryRate == null ? null : s.metrics.retryRate < 0.2} />
            <Metric label="HITL escalation" value={pct(s.metrics.hitlRate)} target="<5%" good={s.metrics.hitlRate == null ? null : s.metrics.hitlRate < 0.05} />
            <Metric label="Reminders · 30d" value={String(s.metrics.remindersSent30d)} target="" good={null} />
          </div>
          <div className="h-44 px-2 pb-3 pt-2">
            <ResponsiveContainer>
              <BarChart data={s.throughput} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "var(--faint)", fontSize: 11 }} tickFormatter={(d) => d.slice(5)} interval={1} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={{ fill: "var(--faint)", fontSize: 11 }} />
                <Tooltip cursor={{ fill: "var(--surface-2)" }} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="complete" stackId="a" fill="var(--ok)" name="Completed" maxBarSize={22} />
                <Bar dataKey="review" stackId="a" fill="var(--warn)" name="Needs review" maxBarSize={22} />
                <Bar dataKey="failed" stackId="a" fill="var(--bad)" name="Rejected / failed" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {!health.data?.gmailConfigured && (
        <div className="card mt-4 flex items-center gap-3 px-5 py-4 text-sm">
          <Mail className="h-4 w-4 text-muted" />
          <span className="text-muted">Gmail is not configured on the server. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to let the Intake agent read invoices from email.</span>
          <Link to="/settings" className="ml-auto inline-flex items-center gap-1 text-accent">Settings <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </div>
      )}
    </>
  );
}

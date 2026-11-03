import clsx from "clsx";
import { BellRing, CalendarClock, ChevronDown, Mail, Play, Send } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, CardHeader, Empty, Loading, PageHeader, Spinner, useToast } from "../components/ui";
import { AGENTS } from "../lib/agents";
import { api, useApi } from "../lib/api";
import { date, money, timeAgo } from "../lib/format";
import { useLive } from "../lib/live";

const STAGE = (o: number) => (o < 0 ? `${-o}d before due` : o === 0 ? "On due date" : `${o}d overdue`);
const KIND_TONE: Record<string, "info" | "warn" | "bad"> = { UPCOMING: "info", DUE_TODAY: "warn", OVERDUE: "bad" };

const CHANNEL_COPY: Record<string, { title: string; text: string; tone: string }> = {
  GMAIL: { title: "Sending from your connected Gmail", text: "Reminders go out from the mailbox you connected in Settings.", tone: "bg-ok-soft text-ok" },
  SMTP: { title: "Sending via SMTP", text: "Reminders go out through the SMTP server configured on the API.", tone: "bg-ok-soft text-ok" },
  PREVIEW: { title: "Preview mode — nothing is emailed yet", text: "The Collections agent drafts every reminder and records it here. Connect Gmail (with send access) or set SMTP_HOST to deliver them.", tone: "bg-info-soft text-info" },
};

export function RemindersPage() {
  const data = useApi<any>("/reminders");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useLive((m) => m.type === "reminder-sent" || (m.type === "job-updated" && m.status === "COMPLETE"), () => data.reload(), 500);

  const run = async () => {
    setBusy(true);
    try {
      const r = await api("/reminders/run", { method: "POST" });
      toast(r.sent.length ? `Collections agent handled ${r.sent.length} reminder(s)` : "Nothing due — every unpaid invoice is already reminded for its current stage", r.sent.length ? "ok" : "info");
      data.reload();
    } catch (e: any) { toast(e.message, "bad"); } finally { setBusy(false); }
  };

  if (!data.data) return <Loading />;
  const d = data.data;
  const ch = CHANNEL_COPY[d.channel];
  const agent = AGENTS.REMINDER;

  return (
    <>
      <PageHeader
        title="Reminders"
        subtitle={<>The Collections agent checks unpaid invoices every hour and sends one reminder per stage: {d.offsets.map(STAGE).join(" · ")}.</>}
        actions={<button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? <Spinner className="text-white" /> : <Play className="h-4 w-4" />} Run agent now</button>}
      />

      <div className={clsx("mb-4 flex items-start gap-3 rounded-xl px-4 py-3 text-sm", ch.tone)}>
        <Mail className="mt-0.5 h-4 w-4 shrink-0" />
        <div><b className="font-semibold">{ch.title}.</b> <span className="opacity-90">{ch.text}</span> {d.channel === "PREVIEW" && <Link to="/settings" className="underline">Settings</Link>}</div>
        {!d.enabled && <Badge tone="warn" className="ml-auto">Disabled in settings</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_1fr]">
        <div className="card h-fit">
          <CardHeader title="Upcoming" subtitle="Next stage each unpaid invoice will hit" />
          {d.schedule.length === 0 ? <Empty icon={CalendarClock} title="Nothing scheduled">Unpaid invoices with a due date show up here.</Empty> : (
            <ul className="divide-y divide-line">
              {d.schedule.map((s: any) => (
                <li key={s.invoiceId}>
                  <Link to={`/invoices/${s.invoiceId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                    <div className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-surface-2 py-1 text-center">
                      <span className="text-[10px] uppercase text-muted">{new Date(s.scheduledFor).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</span>
                      <span className="text-base font-semibold leading-none num">{new Date(s.scheduledFor).getUTCDate()}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{s.vendorName}</div>
                      <div className="text-xs text-muted">{s.invoiceRef} · due {date(s.dueDate)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium num">{money(s.grandTotalCents, s.currency)}</div>
                      {s.readyNow ? <Badge tone="accent">ready now</Badge> : <span className="text-xs text-muted">{STAGE(s.offsetDays)}</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <CardHeader title="Outbox" subtitle={`${d.reminders.length} reminder(s) drafted by the Collections agent`} />
          {d.reminders.length === 0 ? (
            <Empty icon={BellRing} title="No reminders yet">Run the agent, or open an invoice and choose “Send reminder now”.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {d.reminders.map((r: any) => (
                <li key={r.id}>
                  <button className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-surface-2" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${agent.color}1f`, color: agent.color }}>
                      <Send className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{r.subject}</span>
                        <Badge tone={KIND_TONE[r.kind]}>{r.kind.replace("_", " ").toLowerCase()}</Badge>
                        <Badge tone={r.status === "SENT" ? "ok" : r.status === "FAILED" ? "bad" : "muted"}>{r.status === "DRAFTED" ? "preview only" : `${r.status.toLowerCase()} · ${r.channel.toLowerCase()}`}</Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-muted">To {r.recipients.join(", ")} · {r.invoice.vendorName} {r.invoice.invoiceRef} · {timeAgo(r.createdAt)}</div>
                    </div>
                    <ChevronDown className={clsx("mt-1 h-4 w-4 shrink-0 text-faint transition-transform", open === r.id && "rotate-180")} />
                  </button>
                  {open === r.id && (
                    <div className="fade-in mx-5 mb-4 rounded-xl border border-line bg-surface-2 p-4">
                      <div className="mb-2 text-xs text-muted">Subject: <span className="text-ink">{r.subject}</span></div>
                      <p className="whitespace-pre-line text-sm leading-relaxed">{r.body}</p>
                      {r.error && <p className="mt-2 text-xs text-bad">Delivery error: {r.error}</p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

import clsx from "clsx";
import { BellRing, CheckCircle2, FileText, Search, Undo2, Workflow } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Badge, CardHeader, Drawer, Empty, Loading, PageHeader, PaymentBadge, Spinner, useToast } from "../components/ui";
import { api, useApi } from "../lib/api";
import { amount, date, dueLabel, money, timeAgo } from "../lib/format";
import { useLive } from "../lib/live";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unpaid", label: "Unpaid" },
  { id: "overdue", label: "Overdue" },
  { id: "paid", label: "Paid" },
] as const;

function InvoiceDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const inv = useApi<any>(`/invoices/${id}`);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  useLive((m) => m.type === "reminder-sent" && m.invoiceId === id, () => inv.reload());

  const act = async (label: string, fn: () => Promise<any>, ok: string) => {
    setBusy(label);
    try {
      await fn();
      toast(ok);
      inv.reload();
      onChanged();
    } catch (e: any) { toast(e.message, "bad"); } finally { setBusy(null); }
  };

  const i = inv.data;
  return (
    <Drawer open onClose={onClose} title={i ? <span className="flex items-center gap-2">{i.vendorName} <span className="font-mono text-sm font-normal text-muted">{i.invoiceRef}</span></span> : "Invoice"}>
      {!i ? <Loading /> : (
        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-3xl font-semibold tracking-tight num">{money(i.grandTotalCents, i.currency)}</div>
            <PaymentBadge paymentStatus={i.paymentStatus} days={i.daysFromDue} />
            <span className={clsx("text-sm", i.isOverdue ? "text-bad" : "text-muted")}>{i.paymentStatus === "PAID" ? `Paid ${date(i.paidAt)}` : dueLabel(i.daysFromDue)}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {i.paymentStatus === "UNPAID" ? (
              <>
                <button className="btn btn-primary" disabled={!!busy} onClick={() => act("paid", () => api(`/invoices/${id}/payment`, { method: "POST", json: { status: "PAID" } }), "Marked as paid — reminders stop")}>
                  {busy === "paid" ? <Spinner className="text-white" /> : <CheckCircle2 className="h-4 w-4" />} Mark as paid
                </button>
                {i.dueDate && (
                  <button className="btn" disabled={!!busy} onClick={() => act("remind", () => api(`/invoices/${id}/remind`, { method: "POST" }), "Collections agent drafted a reminder")}>
                    {busy === "remind" ? <Spinner /> : <BellRing className="h-4 w-4" />} Send reminder now
                  </button>
                )}
              </>
            ) : (
              <button className="btn" disabled={!!busy} onClick={() => act("unpaid", () => api(`/invoices/${id}/payment`, { method: "POST", json: { status: "UNPAID" } }), "Marked as unpaid")}>
                <Undo2 className="h-4 w-4" /> Mark as unpaid
              </button>
            )}
            {i.job && <Link to={`/runs/${i.job.id}`} className="btn"><Workflow className="h-4 w-4" /> Agent run</Link>}
          </div>

          <div className="card grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-3">
            {[
              ["Issued", date(i.issueDate)],
              ["Due", date(i.dueDate)],
              ["Currency", i.currency],
              ["Vendor tax ID", i.vendorTaxId ?? "—"],
              ["Vendor email", i.vendorEmail ?? "—"],
              ["Source", `${i.job?.source?.toLowerCase() ?? "—"} · ${i.sourceType.replace("EMAIL_", "").toLowerCase()}`],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0"><div className="text-xs text-muted">{k}</div><div className="truncate">{v}</div></div>
            ))}
          </div>

          <div className="card">
            <CardHeader title="Line items" subtitle="Amounts stored as integer cents" />
            <table className="w-full text-sm">
              <tbody className="num">
                {(i.lineItemsJson as any[]).map((it, k) => (
                  <tr key={k} className="border-b border-line/60">
                    <td className="px-5 py-2">{it.description}</td>
                    <td className="px-2 text-right text-muted">{it.quantity} × {amount(it.unitPrice, i.currency)}</td>
                    <td className="px-5 text-right">{amount(it.total, i.currency)}</td>
                  </tr>
                ))}
                <tr><td className="px-5 pt-3 text-muted" colSpan={2}>Subtotal</td><td className="px-5 pt-3 text-right">{money(i.subtotalCents, i.currency)}</td></tr>
                <tr><td className="px-5 text-muted" colSpan={2}>Tax</td><td className="px-5 text-right">{money(i.taxCents, i.currency)}</td></tr>
                <tr className="font-semibold"><td className="px-5 pb-4 pt-1" colSpan={2}>Total</td><td className="px-5 pb-4 pt-1 text-right">{money(i.grandTotalCents, i.currency)}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <CardHeader title="Reminder history" subtitle={`${i.reminders.length} sent by the Collections agent`} />
            {i.reminders.length === 0 ? <Empty icon={BellRing} title="No reminders yet" /> : (
              <ul className="divide-y divide-line">
                {i.reminders.map((r: any) => (
                  <li key={r.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{r.subject}</span>
                      <Badge tone={r.status === "SENT" ? "ok" : r.status === "FAILED" ? "bad" : "muted"}>{r.status === "DRAFTED" ? "preview" : r.status.toLowerCase()}</Badge>
                      <span className="ml-auto text-xs text-faint">{timeAgo(r.createdAt)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-xs text-muted line-clamp-3">{r.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

export function InvoicesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("filter") ?? "all") as (typeof FILTERS)[number]["id"];
  const [q, setQ] = useState("");
  const invoices = useApi<any[]>("/invoices");
  useLive((m) => m.type === "job-updated" && m.status === "COMPLETE", () => invoices.reload(), 500);

  const rows = useMemo(() => {
    let list = invoices.data ?? [];
    if (filter === "unpaid") list = list.filter((i) => i.paymentStatus === "UNPAID");
    if (filter === "paid") list = list.filter((i) => i.paymentStatus === "PAID");
    if (filter === "overdue") list = list.filter((i) => i.isOverdue);
    if (q) list = list.filter((i) => `${i.vendorName} ${i.invoiceRef}`.toLowerCase().includes(q.toLowerCase()));
    return list;
  }, [invoices.data, filter, q]);

  const counts = useMemo(() => {
    const l = invoices.data ?? [];
    return { all: l.length, unpaid: l.filter((i) => i.paymentStatus === "UNPAID").length, overdue: l.filter((i) => i.isOverdue).length, paid: l.filter((i) => i.paymentStatus === "PAID").length };
  }, [invoices.data]);

  return (
    <>
      <PageHeader title="Payables" subtitle="Invoices the agents have validated and stored in the ledger." />
      <div className="card">
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1 overflow-x-auto">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setParams(f.id === "all" ? {} : { filter: f.id })} className={clsx("flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm", filter === f.id ? "bg-surface-2 font-medium" : "text-muted hover:text-ink")}>
                {f.label} <span className="text-xs text-faint num">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input className="input pl-9" placeholder="Search vendor or invoice #" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {!invoices.data ? <Loading /> : rows.length === 0 ? (
          <Empty icon={FileText} title="No invoices here">Invoices appear once the Ledger agent stores them.</Empty>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-5 py-2.5 font-medium">Vendor</th>
                  <th className="px-3 font-medium">Invoice #</th>
                  <th className="px-3 font-medium">Issued</th>
                  <th className="px-3 font-medium">Due</th>
                  <th className="px-3 text-right font-medium">Amount</th>
                  <th className="px-3 font-medium">Status</th>
                  <th className="px-5 text-right font-medium">Reminders</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} onClick={() => navigate(`/invoices/${i.id}${filter !== "all" ? `?filter=${filter}` : ""}`)} className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2">
                    <td className="px-5 py-3 font-medium">{i.vendorName}</td>
                    <td className="px-3 font-mono text-[13px] text-muted">{i.invoiceRef}</td>
                    <td className="px-3 text-muted">{date(i.issueDate)}</td>
                    <td className="px-3">
                      <div>{date(i.dueDate)}</div>
                      {i.paymentStatus === "UNPAID" && <div className={clsx("text-xs", i.isOverdue ? "text-bad" : "text-muted")}>{dueLabel(i.daysFromDue)}</div>}
                    </td>
                    <td className="px-3 text-right font-medium num">{money(i.grandTotalCents, i.currency)}</td>
                    <td className="px-3"><PaymentBadge paymentStatus={i.paymentStatus} days={i.daysFromDue} /></td>
                    <td className="px-5 text-right text-muted num">{i._count.reminders || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {id && <InvoiceDrawer id={id} onClose={() => navigate(`/invoices${filter !== "all" ? `?filter=${filter}` : ""}`)} onChanged={invoices.reload} />}
    </>
  );
}

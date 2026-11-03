import clsx from "clsx";
import { AlertTriangle, Check, Clock, Plus, ShieldPlus, Trash2, UserCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, CardHeader, Empty, Loading, PageHeader, Spinner, useToast } from "../components/ui";
import { REVIEW_REASON } from "../lib/agents";
import { api, useApi } from "../lib/api";
import { amount, timeAgo } from "../lib/format";
import { useLive } from "../lib/live";

// Form keeps numbers as strings while editing; converted on submit
type Item = { description: string; quantity: string; unitPrice: string; total: string };
type Form = {
  vendor: { name: string; taxId: string; address: string; email: string };
  invoiceMeta: { invoiceId: string; issueDate: string; dueDate: string; currency: string };
  items: Item[];
  totals: { subtotal: string; tax: string; grandTotal: string };
};

const s = (v: any) => (v === null || v === undefined ? "" : String(v));

function toForm(x: any): Form {
  return {
    vendor: { name: s(x?.vendor?.name), taxId: s(x?.vendor?.taxId), address: s(x?.vendor?.address), email: s(x?.vendor?.email) },
    invoiceMeta: { invoiceId: s(x?.invoiceMeta?.invoiceId), issueDate: s(x?.invoiceMeta?.issueDate), dueDate: s(x?.invoiceMeta?.dueDate), currency: s(x?.invoiceMeta?.currency) || "USD" },
    items: (x?.items?.length ? x.items : [{}]).map((i: any) => ({ description: s(i.description), quantity: s(i.quantity), unitPrice: s(i.unitPrice), total: s(i.total) })),
    totals: { subtotal: s(x?.totals?.subtotal), tax: s(x?.totals?.tax), grandTotal: s(x?.totals?.grandTotal) },
  };
}

const n = (v: string) => (v.trim() === "" ? NaN : Number(v));
const nul = (v: string) => (v.trim() === "" ? null : v.trim());

function fromForm(f: Form) {
  return {
    vendor: { name: f.vendor.name.trim(), taxId: nul(f.vendor.taxId), address: nul(f.vendor.address), email: nul(f.vendor.email) },
    invoiceMeta: { invoiceId: f.invoiceMeta.invoiceId.trim(), issueDate: f.invoiceMeta.issueDate, dueDate: nul(f.invoiceMeta.dueDate), currency: f.invoiceMeta.currency.trim().toUpperCase() },
    items: f.items.map((i) => ({ description: i.description.trim(), quantity: n(i.quantity), unitPrice: n(i.unitPrice), total: n(i.total) })),
    totals: { subtotal: n(f.totals.subtotal), tax: n(f.totals.tax), grandTotal: n(f.totals.grandTotal) },
  };
}

// Integer-cents check mirroring the server's Auditor rules, for instant feedback while editing
function checks(f: Form) {
  const c = (v: string) => Math.round(n(v) * 100);
  const lineSum = f.items.reduce((a, i) => a + c(i.total), 0);
  const out: { ok: boolean; text: string }[] = [];
  out.push({ ok: lineSum === c(f.totals.subtotal), text: `Line items sum to ${(lineSum / 100).toFixed(2)} — subtotal ${f.totals.subtotal || "?"}` });
  out.push({ ok: c(f.totals.subtotal) + c(f.totals.tax) === c(f.totals.grandTotal), text: `Subtotal + tax = ${((c(f.totals.subtotal) + c(f.totals.tax)) / 100).toFixed(2)} — total ${f.totals.grandTotal || "?"}` });
  f.items.forEach((i, idx) => {
    const exp = Math.round(n(i.quantity) * n(i.unitPrice) * 100);
    if (!Number.isNaN(exp) && exp !== c(i.total)) out.push({ ok: false, text: `Item ${idx + 1}: ${i.quantity} × ${i.unitPrice} ≠ ${i.total}` });
  });
  return out;
}

function Input({ value, onChange, mono, className, placeholder }: { value: string; onChange: (v: string) => void; mono?: boolean; className?: string; placeholder?: string }) {
  return <input className={clsx("input", mono && "font-mono text-[13px]", className)} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function ReviewDetail({ jobId }: { jobId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const review = useApi<any>(`/review/${jobId}`);
  const job = useApi<any>(`/jobs/${jobId}`);
  const [form, setForm] = useState<Form | null>(null);
  const [initial, setInitial] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  useEffect(() => {
    if (review.data && !form) {
      const f = toForm(review.data.snapshot?.extracted);
      setForm(f);
      setInitial(JSON.stringify(f));
    }
  }, [review.data, form]);

  const live = useMemo(() => (form ? checks(form) : []), [form]);
  if (review.error) return <div className="card"><Empty title="This review is no longer open" /></div>;
  if (!review.data || !form) return <div className="card"><Loading /></div>;

  const r = review.data;
  const meta = REVIEW_REASON[r.reason] ?? { title: r.reason, help: "" };
  const edited = JSON.stringify(form) !== initial;
  const hadExtraction = !!r.snapshot?.extracted;
  const set = (fn: (f: Form) => void) => setForm((prev) => { const next = structuredClone(prev!); fn(next); return next; });
  const hoursLeft = Math.max(0, Math.round((new Date(r.expiresAt).getTime() - Date.now()) / 3_600_000));

  const decide = async (action: "APPROVE" | "APPROVE_AND_WHITELIST" | "REJECT") => {
    setBusy(action);
    setIssues([]);
    try {
      await api(`/review/${jobId}/decision`, {
        method: "POST",
        json: { action, reason: reason || undefined, corrected: action !== "REJECT" && (edited || !hadExtraction) ? fromForm(form) : undefined },
      });
      toast(action === "REJECT" ? "Rejected — the graph is closing this run" : "Approved — the graph is resuming from its checkpoint");
      navigate(`/runs/${jobId}`);
    } catch (e: any) {
      setIssues(e.issues ?? [e.message]);
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-start gap-3 bg-warn-soft px-5 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-warn" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{meta.title}</div>
            <p className="text-sm text-muted">{meta.help}</p>
          </div>
          <Badge tone={hoursLeft < 12 ? "bad" : "muted"}><Clock className="h-3 w-3" /> {hoursLeft}h left to decide</Badge>
        </div>
        {r.snapshot?.errors?.length > 0 && (
          <ul className="space-y-1 border-t border-line px-5 py-3 font-mono text-xs text-muted">
            {r.snapshot.errors.map((e: string, i: number) => <li key={i}>• {e}</li>)}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_420px]">
        <div className="card">
          <CardHeader title="Extracted invoice" subtitle={edited ? "Edited — your corrections will be stored instead of the model's output" : "Edit any field the agents got wrong"} right={edited && <button className="btn btn-sm" onClick={() => setForm(JSON.parse(initial))}>Reset</button>} />
          <div className="space-y-5 p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className="label">Vendor name</label><Input value={form.vendor.name} onChange={(v) => set((f) => { f.vendor.name = v; })} /></div>
              <div><label className="label">Vendor tax ID</label><Input mono value={form.vendor.taxId} onChange={(v) => set((f) => { f.vendor.taxId = v; })} /></div>
              <div><label className="label">Invoice #</label><Input mono value={form.invoiceMeta.invoiceId} onChange={(v) => set((f) => { f.invoiceMeta.invoiceId = v; })} /></div>
              <div><label className="label">Currency</label><Input mono value={form.invoiceMeta.currency} onChange={(v) => set((f) => { f.invoiceMeta.currency = v; })} /></div>
              <div><label className="label">Issue date</label><input type="date" className="input" value={form.invoiceMeta.issueDate} onChange={(e) => set((f) => { f.invoiceMeta.issueDate = e.target.value; })} /></div>
              <div><label className="label">Due date</label><input type="date" className="input" value={form.invoiceMeta.dueDate} onChange={(e) => set((f) => { f.invoiceMeta.dueDate = e.target.value; })} /></div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="label !mb-0">Line items</span>
                <button className="btn btn-sm" onClick={() => set((f) => { f.items.push({ description: "", quantity: "1", unitPrice: "", total: "" }); })}><Plus className="h-3.5 w-3.5" /> Add line</button>
              </div>
              <div className="space-y-2">
                {form.items.map((it, i) => (
                  <div key={i} className="grid grid-cols-[1fr_70px_100px_100px_32px] gap-2">
                    <Input value={it.description} placeholder="Description" onChange={(v) => set((f) => { f.items[i].description = v; })} />
                    <Input mono className="text-right" value={it.quantity} onChange={(v) => set((f) => { f.items[i].quantity = v; })} />
                    <Input mono className="text-right" value={it.unitPrice} onChange={(v) => set((f) => { f.items[i].unitPrice = v; })} />
                    <Input mono className="text-right" value={it.total} onChange={(v) => set((f) => { f.items[i].total = v; })} />
                    <button className="btn btn-sm justify-center !px-0" disabled={form.items.length === 1} onClick={() => set((f) => { f.items.splice(i, 1); })} aria-label="Remove line"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:ml-auto sm:w-96">
              <div><label className="label">Subtotal</label><Input mono className="text-right" value={form.totals.subtotal} onChange={(v) => set((f) => { f.totals.subtotal = v; })} /></div>
              <div><label className="label">Tax</label><Input mono className="text-right" value={form.totals.tax} onChange={(v) => set((f) => { f.totals.tax = v; })} /></div>
              <div><label className="label">Total</label><Input mono className="text-right" value={form.totals.grandTotal} onChange={(v) => set((f) => { f.totals.grandTotal = v; })} /></div>
            </div>

            <ul className="space-y-1 rounded-xl bg-surface-2 px-4 py-3 text-xs">
              {live.map((c, i) => (
                <li key={i} className={clsx("flex items-center gap-2", c.ok ? "text-ok" : "text-bad")}>
                  {c.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />} <span className="num">{c.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card">
            <CardHeader title="Decision" subtitle="Resumes the paused graph from its checkpoint" />
            <div className="space-y-3 p-5">
              {(r.reason === "UNKNOWN_VENDOR" || hadExtraction || edited) && (
                <button className={clsx("btn w-full justify-center", r.reason === "UNKNOWN_VENDOR" && "btn-primary")} disabled={!!busy || !form.vendor.name.trim()} onClick={() => decide("APPROVE_AND_WHITELIST")}>
                  {busy === "APPROVE_AND_WHITELIST" ? <Spinner /> : <ShieldPlus className="h-4 w-4" />} Approve &amp; whitelist “{form.vendor.name}”
                </button>
              )}
              <button className={clsx("btn w-full justify-center", r.reason !== "UNKNOWN_VENDOR" && "btn-primary")} disabled={!!busy} onClick={() => decide("APPROVE")}>
                {busy === "APPROVE" ? <Spinner /> : <Check className="h-4 w-4" />} Approve this invoice{edited || !hadExtraction ? " with my corrections" : ""}
              </button>
              <div className="pt-2">
                <label className="label">Reason (optional, stored with a rejection)</label>
                <input className="input" placeholder="e.g. Not our vendor, suspected phishing" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <button className="btn btn-danger w-full justify-center" disabled={!!busy} onClick={() => decide("REJECT")}>
                {busy === "REJECT" ? <Spinner /> : <X className="h-4 w-4" />} Reject
              </button>
              {issues.length > 0 && (
                <ul className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">{issues.map((x, i) => <li key={i}>• {x}</li>)}</ul>
              )}
            </div>
          </div>
          <div className="card">
            <CardHeader title="Source" right={<Link to={`/runs/${jobId}`} className="text-xs text-accent hover:underline">View run</Link>} />
            {job.data?.textPreview ? (
              <pre className="scroll-thin max-h-96 overflow-auto whitespace-pre-wrap px-5 py-4 font-mono text-xs leading-relaxed text-muted">{job.data.textPreview}</pre>
            ) : job.data?.mimeType?.startsWith("image/") ? (
              <img src={`/api/jobs/${jobId}/file`} alt="Invoice" className="max-h-96 w-full object-contain p-4" />
            ) : job.data ? (
              <iframe title="Invoice" src={`/api/jobs/${jobId}/file`} className="h-96 w-full rounded-b-[14px]" />
            ) : <Loading />}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReviewPage() {
  const { jobId } = useParams();
  const queue = useApi<any[]>("/review");
  useLive((m) => m.type === "job-updated", () => queue.reload(), 400);
  const selected = jobId ?? queue.data?.[0]?.jobId;

  return (
    <>
      <PageHeader title="Review queue" subtitle="Runs the agents paused on. Your decision resumes each LangGraph thread exactly where it stopped." />
      {queue.data?.length === 0 && !jobId ? (
        <div className="card"><Empty icon={UserCheck} title="All clear">No invoices are waiting on a human. Try the “Initech” or “Umbrella” samples to see an escalation.</Empty></div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
          <div className="card h-fit">
            <CardHeader title="Waiting" subtitle={queue.data ? `${queue.data.length} open` : undefined} />
            <ul className="divide-y divide-line">
              {queue.data?.map((r) => {
                const ex = r.snapshot?.extracted;
                return (
                  <li key={r.id}>
                    <Link to={`/review/${r.jobId}`} className={clsx("block px-4 py-3", selected === r.jobId ? "bg-accent-soft/60" : "hover:bg-surface-2")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{ex?.vendor?.name ?? r.job?.fileName ?? "Unreadable document"}</span>
                        <span className="shrink-0 text-xs text-faint">{timeAgo(r.createdAt)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge tone="warn">{REVIEW_REASON[r.reason]?.title ?? r.reason}</Badge>
                        {ex?.totals && <span className="text-xs text-muted num">{amount(ex.totals.grandTotal, ex.invoiceMeta?.currency)}</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="min-w-0">{selected ? <ReviewDetail key={selected} jobId={selected} /> : <Loading />}</div>
        </div>
      )}
    </>
  );
}

import clsx from "clsx";
import { ArrowRight, ClipboardPaste, FileText, FlaskConical, Image as ImageIcon, Inbox, Mail, RefreshCw, RotateCcw, Upload, UserCheck } from "lucide-react";
import { DragEvent, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EventTimeline } from "../components/EventTimeline";
import { PipelineGraph } from "../components/PipelineGraph";
import { Badge, CardHeader, Empty, JobStatusBadge, Loading, PageHeader, Spinner, useToast } from "../components/ui";
import { REVIEW_REASON } from "../lib/agents";
import { api, useApi } from "../lib/api";
import { amount, date, timeAgo } from "../lib/format";
import { useLive } from "../lib/live";

const SOURCE_ICON: Record<string, any> = { EMAIL_PDF: FileText, EMAIL_IMAGE: ImageIcon, EMAIL_TEXT: Mail, API: FileText };

function IngestPanel({ onCreated }: { onCreated: (jobId: string) => void }) {
  const [tab, setTab] = useState<"upload" | "paste" | "samples">("samples");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const samples = useApi<any[]>(tab === "samples" ? "/samples" : null);
  const mailbox = useApi<any>("/mailbox");

  const handle = async (label: string, fn: () => Promise<any>) => {
    setBusy(label);
    try {
      const res = await fn();
      if (res?.job) {
        toast(res.duplicate ? "Already processed — opening the existing run" : "Queued — the Intake agent has it", res.duplicate ? "info" : "ok");
        onCreated(res.job.id);
      }
      return res;
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      await handle(file.name, () => api("/ingest", { method: "POST", body: form }));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    uploadFiles(e.dataTransfer.files);
  };

  const sync = () =>
    handle("gmail", async () => {
      const r = await api("/mailbox/sync", { method: "POST" });
      toast(r.connected ? `Gmail: ${r.imported} new invoice(s), ${r.skipped} already seen (${r.scanned} emails scanned)` : "Gmail is not connected", r.connected ? "ok" : "warn");
    });

  const tabs = [
    { id: "samples", label: "Samples", icon: FlaskConical },
    { id: "upload", label: "Upload", icon: Upload },
    { id: "paste", label: "Paste", icon: ClipboardPaste },
  ] as const;

  return (
    <div className="card">
      <div className="flex items-center gap-1 border-b border-line p-2">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={clsx("flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm", tab === t.id ? "bg-surface-2 font-medium" : "text-muted hover:text-ink")}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>
      <div className="p-3">
        {tab === "upload" && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={clsx("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors", drag ? "border-accent bg-accent-soft" : "border-line hover:border-faint")}
          >
            {busy ? <Spinner className="h-6 w-6" /> : <Upload className="h-6 w-6 text-faint" />}
            <p className="mt-2 text-sm font-medium">Drop invoices here</p>
            <p className="text-xs text-muted">PDF, PNG, JPG or .txt · up to 15 MB</p>
            <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.txt" className="hidden" onChange={(e) => uploadFiles(e.target.files)} />
          </div>
        )}
        {tab === "paste" && (
          <div className="space-y-2">
            <textarea className="input min-h-36 font-mono text-xs" placeholder="Paste an invoice or the body of an invoice email…" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn btn-primary w-full justify-center" disabled={text.trim().length < 10 || !!busy} onClick={() => handle("paste", () => api("/ingest", { method: "POST", json: { text } })).then((r) => r && setText(""))}>
              {busy === "paste" ? <Spinner className="text-white" /> : <ArrowRight className="h-4 w-4" />} Send to agents
            </button>
          </div>
        )}
        {tab === "samples" && (
          <div className="space-y-1.5">
            {!samples.data ? <Spinner /> : samples.data.map((s) => (
              <button key={s.id} disabled={!!busy} onClick={() => handle(s.id, () => api(`/samples/${encodeURIComponent(s.id)}/ingest`, { method: "POST" }))} className="group flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2 disabled:opacity-50">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted group-hover:bg-accent-soft group-hover:text-accent">
                  {busy === s.id ? <Spinner className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{s.title}</span>
                  <span className="block text-xs leading-snug text-muted">{s.scenario}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs">
        <span className="flex items-center gap-1.5 text-muted">
          <Mail className="h-3.5 w-3.5" />
          {mailbox.data?.connection ? <>Gmail · {mailbox.data.connection.emailAddress}</> : <Link to="/settings" className="hover:underline">Connect Gmail</Link>}
        </span>
        {mailbox.data?.connection && (
          <button className="btn btn-sm" onClick={sync} disabled={!!busy}>
            <RefreshCw className={clsx("h-3.5 w-3.5", busy === "gmail" && "animate-spin")} /> Sync now
          </button>
        )}
      </div>
    </div>
  );
}

function ExtractedSummary({ data }: { data: any }) {
  if (!data) return <Empty icon={FileText} title="Nothing extracted yet" />;
  const cur = data.invoiceMeta?.currency ?? "USD";
  return (
    <div className="space-y-4 p-5 text-sm">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Vendor" value={data.vendor?.name} />
        <Field label="Invoice #" value={data.invoiceMeta?.invoiceId} mono />
        <Field label="Issued" value={date(data.invoiceMeta?.issueDate)} />
        <Field label="Due" value={date(data.invoiceMeta?.dueDate)} />
        <Field label="Tax ID" value={data.vendor?.taxId} mono />
        <Field label="Email" value={data.vendor?.email} />
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-line"><th className="py-1.5 text-left font-medium">Item</th><th className="text-right font-medium">Qty</th><th className="text-right font-medium">Unit</th><th className="text-right font-medium">Total</th></tr>
        </thead>
        <tbody className="num">
          {data.items?.map((it: any, i: number) => (
            <tr key={i} className="border-b border-line/60">
              <td className="py-1.5 pr-2">{it.description}</td>
              <td className="text-right">{it.quantity}</td>
              <td className="text-right">{amount(it.unitPrice, cur)}</td>
              <td className="text-right">{amount(it.total, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto w-56 space-y-1 num">
        <Row label="Subtotal" value={amount(data.totals?.subtotal, cur)} />
        <Row label="Tax" value={amount(data.totals?.tax, cur)} />
        <Row label="Total" value={amount(data.totals?.grandTotal, cur)} bold />
      </div>
    </div>
  );
}

const Field = ({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) => (
  <div className="min-w-0">
    <div className="text-xs text-muted">{label}</div>
    <div className={clsx("truncate", mono && "font-mono text-[13px]")}>{value || "—"}</div>
  </div>
);
const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
  <div className={clsx("flex justify-between", bold && "border-t border-line pt-1 font-semibold")}><span className="text-muted">{label}</span><span>{value}</span></div>
);

function RunDetail({ id }: { id: string }) {
  const job = useApi<any>(`/jobs/${id}`);
  const toast = useToast();
  useLive((m) => (m.type === "agent-event" || m.type === "job-updated") && m.jobId === id, () => job.reload(), 120);

  if (job.loading && !job.data) return <div className="card"><Loading /></div>;
  if (!job.data) return <div className="card"><Empty title="Run not found" /></div>;
  const j = job.data;
  const Icon = SOURCE_ICON[j.sourceType] ?? FileText;
  const running = j.status === "RUNNING" || j.status === "QUEUED";

  const retry = async () => {
    try {
      await api(`/jobs/${id}/retry`, { method: "POST" });
      toast("Re-queued from the start");
      job.reload();
    } catch (e: any) { toast(e.message, "bad"); }
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-start gap-3 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-muted"><Icon className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold">{j.emailSubject ?? j.fileName ?? "Invoice"}</h2>
              <JobStatusBadge status={j.status} />
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {j.source.toLowerCase()} · {j.sourceType.replace("EMAIL_", "").toLowerCase()} {j.emailFrom ? `· from ${j.emailFrom}` : ""} · {timeAgo(j.createdAt)} · <span className="font-mono">{j.id.slice(0, 8)}</span>
            </p>
          </div>
          <div className="flex gap-2">
            {j.status === "FAILED" && <button className="btn btn-sm" onClick={retry}><RotateCcw className="h-3.5 w-3.5" /> Retry</button>}
            {j.invoiceId && <Link className="btn btn-sm" to={`/invoices/${j.invoiceId}`}>Open in payables <ArrowRight className="h-3.5 w-3.5" /></Link>}
          </div>
        </div>
        {j.status === "AWAITING_REVIEW" && j.checkpoint && (
          <div className="mx-5 mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-warn-soft px-4 py-3 text-sm">
            <UserCheck className="h-4 w-4 text-warn" />
            <span className="flex-1"><b className="font-semibold">{REVIEW_REASON[j.checkpoint.reason]?.title ?? j.checkpoint.reason}.</b> The graph is paused and checkpointed — it resumes from here when you decide.</span>
            <Link to={`/review/${j.id}`} className="btn btn-primary btn-sm">Review now</Link>
          </div>
        )}
        <div className="border-t border-line px-3 py-4">
          <PipelineGraph events={j.events} status={j.status} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <div className="card">
          <CardHeader title="Agent trace" subtitle={`${j.events.filter((e: any) => e.phase === "END").length} steps · ${j.retryCount} extraction attempt${j.retryCount === 1 ? "" : "s"}`} right={running && <Badge tone="accent" dot>live</Badge>} />
          <div className="px-5 py-4">
            {j.events.length ? <EventTimeline events={j.events} running={j.status === "RUNNING"} /> : <Empty icon={Inbox} title="Waiting in the queue…" />}
          </div>
        </div>
        <div className="space-y-4">
          <div className="card">
            <CardHeader title="Extracted data" subtitle="As produced by the Extractor and checked by the Auditor" />
            <ExtractedSummary data={j.extractedJson} />
          </div>
          <div className="card">
            <CardHeader title="Source document" right={j.mimeType !== "text/plain" && <a className="text-xs text-accent hover:underline" href={`/api/jobs/${id}/file`} target="_blank" rel="noreferrer">Open original</a>} />
            {j.textPreview ? (
              <pre className="scroll-thin max-h-80 overflow-auto whitespace-pre-wrap px-5 py-4 font-mono text-xs leading-relaxed text-muted">{j.textPreview}</pre>
            ) : j.mimeType?.startsWith("image/") ? (
              <img src={`/api/jobs/${id}/file`} alt="Invoice" className="max-h-96 w-full object-contain p-4" />
            ) : (
              <iframe title="Invoice PDF" src={`/api/jobs/${id}/file`} className="h-96 w-full rounded-b-[14px]" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RunsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const jobs = useApi<any[]>("/jobs?limit=100");
  useLive((m) => m.type === "job-updated", () => jobs.reload(), 300);

  const selected = id ?? jobs.data?.[0]?.id;

  return (
    <>
      <PageHeader title="Agent runs" subtitle="Every document that enters the system is one resumable LangGraph thread." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <IngestPanel onCreated={(jobId) => { navigate(`/runs/${jobId}`); jobs.reload(); }} />
          <div className="card">
            <CardHeader title="Recent runs" subtitle={jobs.data ? `${jobs.data.length} shown` : undefined} />
            <ul className="scroll-thin max-h-[560px] divide-y divide-line overflow-y-auto">
              {jobs.data?.length === 0 && <Empty icon={Inbox} title="No runs yet">Pick a sample above to see the agents work.</Empty>}
              {jobs.data?.map((j) => {
                const Icon = SOURCE_ICON[j.sourceType] ?? FileText;
                const ex = j.extractedJson;
                return (
                  <li key={j.id}>
                    <Link to={`/runs/${j.id}`} className={clsx("flex gap-3 px-4 py-3 transition-colors", selected === j.id ? "bg-accent-soft/60" : "hover:bg-surface-2")}>
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{ex?.vendor?.name ?? j.emailSubject ?? j.fileName ?? "Invoice"}</span>
                          <JobStatusBadge status={j.status} />
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                          <span className="truncate">{ex?.invoiceMeta?.invoiceId ?? j.fileName}</span>
                          {j.status === "RUNNING" && j.currentNode && <span className="text-accent">· {j.currentNode.toLowerCase()}</span>}
                          <span className="ml-auto shrink-0">{timeAgo(j.createdAt)}</span>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <div className="min-w-0">
          {selected ? <RunDetail key={selected} id={selected} /> : jobs.data && (
            <div className="card"><Empty icon={FlaskConical} title="No runs yet">Choose a sample invoice on the left. Each one exercises a different path through the graph.</Empty></div>
          )}
        </div>
      </div>
    </>
  );
}

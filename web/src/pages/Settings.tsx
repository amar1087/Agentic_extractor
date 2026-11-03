import { CheckCircle2, Mail, RefreshCw, Save, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, CardHeader, Loading, PageHeader, Spinner, Toggle, useToast } from "../components/ui";
import { api, useApi } from "../lib/api";
import { timeAgo } from "../lib/format";

const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

function Mailbox() {
  const mb = useApi<any>("/mailbox");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const status = params.get("gmail");
    if (!status) return;
    toast(status === "connected" ? "Gmail connected — the Intake agent will poll it" : `Gmail connection failed: ${params.get("message")}`, status === "connected" ? "ok" : "bad");
    setParams({}, { replace: true });
  }, [params, setParams, toast]);

  const connect = async () => {
    setBusy("connect");
    try {
      const { url } = await api("/mailbox/connect", { method: "POST" });
      window.location.href = url;
    } catch (e: any) { toast(e.message, "bad"); setBusy(null); }
  };
  const sync = async () => {
    setBusy("sync");
    try {
      const r = await api("/mailbox/sync", { method: "POST" });
      toast(`${r.imported} new invoice(s) from ${r.scanned} email(s)`);
      mb.reload();
    } catch (e: any) { toast(e.message, "bad"); } finally { setBusy(null); }
  };
  const disconnect = async () => {
    if (!confirm("Disconnect Gmail? Stored tokens are deleted.")) return;
    await api("/mailbox", { method: "DELETE" });
    mb.reload();
  };

  const c = mb.data?.connection;
  return (
    <div className="card">
      <CardHeader title="Mailbox" subtitle="Where the Intake agent finds invoices, and where reminders are sent from" />
      <div className="p-5">
        {!mb.data ? <Spinner /> : c ? (
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ok-soft text-ok"><Mail className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 font-medium">{c.emailAddress} <Badge tone={c.status === "ACTIVE" ? "ok" : "warn"}>{c.status.toLowerCase().replace("_", " ")}</Badge>{c.canSend && <Badge tone="info">can send</Badge>}</div>
              <div className="text-xs text-muted">Polled every {mb.data.pollMinutes} min · last sync {c.lastSyncedAt ? timeAgo(c.lastSyncedAt) : "never"}</div>
            </div>
            <button className="btn" onClick={sync} disabled={!!busy}>{busy === "sync" ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Sync now</button>
            {c.status !== "ACTIVE" && <button className="btn" onClick={connect}>Reconnect</button>}
            <button className="btn btn-danger" onClick={disconnect}><Unplug className="h-4 w-4" /> Disconnect</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-muted"><Mail className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">Gmail not connected</div>
              <div className="text-xs text-muted">{mb.data.configured ? "Grants read access (to find invoices) and send access (for reminders). Tokens are encrypted with AES-256-GCM." : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server first."}</div>
            </div>
            <button className="btn btn-primary" onClick={connect} disabled={!mb.data.configured || !!busy}>{busy === "connect" ? <Spinner className="text-white" /> : <Mail className="h-4 w-4" />} Connect Gmail</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const cfg = useApi<any>("/config");
  const toast = useToast();
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cfg.data) {
      setForm({
        ...cfg.data,
        reviewerEmails: cfg.data.reviewerEmails.join(", "),
        supportedCurrencies: cfg.data.supportedCurrencies.join(", "),
        reminderRecipients: cfg.data.reminderRecipients.join(", "),
        reminderOffsetsDays: cfg.data.reminderOffsetsDays.join(", "),
        reviewWebhookUrl: cfg.data.reviewWebhookUrl ?? "",
      });
    }
  }, [cfg.data]);

  if (!form) return <Loading />;
  const set = (k: string) => (v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await api("/config", {
        method: "PUT",
        json: {
          autoVerifyVendors: form.autoVerifyVendors,
          requireVendorTaxId: form.requireVendorTaxId,
          requireDueDate: form.requireDueDate,
          reviewTimeoutHours: Number(form.reviewTimeoutHours),
          reviewerEmails: list(form.reviewerEmails),
          reviewWebhookUrl: form.reviewWebhookUrl,
          maxRetries: Number(form.maxRetries),
          defaultCurrency: form.defaultCurrency || null,
          supportedCurrencies: list(form.supportedCurrencies).map((c) => c.toUpperCase()),
          remindersEnabled: form.remindersEnabled,
          reminderRecipients: list(form.reminderRecipients),
          reminderOffsetsDays: list(form.reminderOffsetsDays).map(Number),
        },
      });
      toast("Settings saved — agents pick them up on the next run");
      cfg.reload();
    } catch (e: any) {
      toast(e.issues?.join("; ") ?? e.message, "bad");
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Tenant configuration — every agent reads these per organisation."
        actions={<button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner className="text-white" /> : <Save className="h-4 w-4" />} Save changes</button>}
      />
      <div className="space-y-4">
        <Mailbox />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="card">
            <CardHeader title="Extraction & compliance" />
            <div className="divide-y divide-line px-5">
              <div className="py-3">
                <label className="label">Max extraction retries</label>
                <input type="number" min={0} max={5} className="input w-24" value={form.maxRetries} onChange={(e) => set("maxRetries")(e.target.value)} />
                <p className="mt-1 text-xs text-muted">Attempts = retries + 1. Each retry mutates the prompt with the Auditor's errors.</p>
              </div>
              <Toggle label="Auto-verify vendors" help="Skip the whitelist — not recommended" checked={form.autoVerifyVendors} onChange={set("autoVerifyVendors")} />
              <Toggle label="Require vendor tax ID" checked={form.requireVendorTaxId} onChange={set("requireVendorTaxId")} />
              <Toggle label="Require due date" checked={form.requireDueDate} onChange={set("requireDueDate")} />
              <div className="py-3">
                <label className="label">Supported currencies</label>
                <input className="input font-mono" placeholder="Any ISO 4217 (leave empty)" value={form.supportedCurrencies} onChange={(e) => set("supportedCurrencies")(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card">
            <CardHeader title="Human review" />
            <div className="space-y-4 p-5">
              <div>
                <label className="label">Review window (hours)</label>
                <input type="number" min={1} className="input w-28" value={form.reviewTimeoutHours} onChange={(e) => set("reviewTimeoutHours")(e.target.value)} />
              </div>
              <div>
                <label className="label">Reviewer emails</label>
                <input className="input" placeholder="ap-lead@company.com, cfo@company.com" value={form.reviewerEmails} onChange={(e) => set("reviewerEmails")(e.target.value)} />
                <p className="mt-1 text-xs text-muted">Notified whenever the graph pauses for a decision.</p>
              </div>
              <div>
                <label className="label">Review webhook URL</label>
                <input className="input font-mono text-xs" placeholder="https://hooks.slack.com/…" value={form.reviewWebhookUrl} onChange={(e) => set("reviewWebhookUrl")(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card">
            <CardHeader title="Payment reminders" />
            <div className="px-5">
              <Toggle label="Collections agent enabled" help="Runs hourly over unpaid invoices" checked={form.remindersEnabled} onChange={set("remindersEnabled")} />
              <div className="space-y-4 border-t border-line py-4">
                <div>
                  <label className="label">Send reminders to</label>
                  <input className="input" placeholder="ap@company.com" value={form.reminderRecipients} onChange={(e) => set("reminderRecipients")(e.target.value)} />
                  <p className="mt-1 text-xs text-muted">Your finance / AP team. Empty → the organisation's billing email.</p>
                </div>
                <div>
                  <label className="label">Stages (days relative to due date)</label>
                  <input className="input font-mono" value={form.reminderOffsetsDays} onChange={(e) => set("reminderOffsetsDays")(e.target.value)} />
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted"><CheckCircle2 className="h-3 w-3" /> e.g. -3, 0, 7, 14 → 3 days before, on the day, 1 and 2 weeks late</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

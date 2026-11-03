import { Building2, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { CardHeader, Empty, Loading, PageHeader, Spinner, useToast } from "../components/ui";
import { api, useApi } from "../lib/api";
import { date, money } from "../lib/format";

export function VendorsPage() {
  const vendors = useApi<any[]>("/vendors");
  const toast = useToast();
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/vendors", { method: "POST", json: { vendorName: name, taxId: taxId || undefined } });
      toast(`${name} added to the whitelist`);
      setName("");
      setTaxId("");
      vendors.reload();
    } catch (e: any) { toast(e.message, "bad"); } finally { setBusy(false); }
  };

  const remove = async (v: any) => {
    if (!confirm(`Remove ${v.vendorName} from the whitelist? Future invoices from them will need human review.`)) return;
    try {
      await api(`/vendors/${v.id}`, { method: "DELETE" });
      toast(`${v.vendorName} removed`);
      vendors.reload();
    } catch (e: any) { toast(e.message, "bad"); }
  };

  return (
    <>
      <PageHeader title="Vendors" subtitle="The Compliance agent only lets invoices from these vendors through without a human." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="card">
          <CardHeader title="Approved vendors" subtitle={vendors.data ? `${vendors.data.length} on the whitelist` : undefined} />
          {!vendors.data ? <Loading /> : vendors.data.length === 0 ? <Empty icon={Building2} title="No approved vendors yet" /> : (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-5 py-2.5 font-medium">Vendor</th>
                    <th className="px-3 font-medium">Tax ID</th>
                    <th className="px-3 text-right font-medium">Invoices</th>
                    <th className="px-3 text-right font-medium">Billed</th>
                    <th className="px-3 font-medium">Approved</th>
                    <th className="px-5" />
                  </tr>
                </thead>
                <tbody>
                  {vendors.data.map((v) => (
                    <tr key={v.id} className="border-b border-line/60 last:border-0">
                      <td className="px-5 py-3 font-medium">{v.vendorName}</td>
                      <td className="px-3 font-mono text-[13px] text-muted">{v.taxId ?? "—"}</td>
                      <td className="px-3 text-right num">{v.invoiceCount}</td>
                      <td className="px-3 text-right num">{v.totalCents ? money(v.totalCents) : "—"}</td>
                      <td className="px-3 text-xs text-muted">{date(v.approvedAt)} · {v.approvedBy}</td>
                      <td className="px-5 text-right">
                        <button className="btn btn-sm btn-danger" onClick={() => remove(v)} aria-label={`Remove ${v.vendorName}`}><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <form onSubmit={add} className="card h-fit">
          <CardHeader title="Add vendor" subtitle="Matched case-insensitively against the extracted vendor name" />
          <div className="space-y-3 p-5">
            <div><label className="label">Vendor name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div><label className="label">Tax ID (optional)</label><input className="input font-mono" value={taxId} onChange={(e) => setTaxId(e.target.value)} /></div>
            <button className="btn btn-primary w-full justify-center" disabled={busy || !name.trim()}>{busy ? <Spinner className="text-white" /> : <Plus className="h-4 w-4" />} Add to whitelist</button>
          </div>
        </form>
      </div>
    </>
  );
}

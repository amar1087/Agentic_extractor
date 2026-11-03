import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { JOB_STATUS } from "../lib/agents";

export type Tone = "ok" | "bad" | "warn" | "info" | "muted" | "accent";

const TONES: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  bad: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn",
  info: "bg-info-soft text-info",
  muted: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
};

export function Badge({ tone = "muted", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function JobStatusBadge({ status }: { status: string }) {
  const s = JOB_STATUS[status] ?? { label: status, tone: "muted" as Tone };
  return (
    <Badge tone={s.tone} dot>
      {status === "RUNNING" && <Loader2 className="-ml-0.5 h-3 w-3 animate-spin" />}
      {s.label}
    </Badge>
  );
}

export function PaymentBadge({ paymentStatus, days }: { paymentStatus: string; days: number | null }) {
  if (paymentStatus === "PAID") return <Badge tone="ok" dot>Paid</Badge>;
  if (days != null && days > 0) return <Badge tone="bad" dot>Overdue</Badge>;
  if (days != null && days >= -3) return <Badge tone="warn" dot>Due soon</Badge>;
  return <Badge tone="info" dot>Unpaid</Badge>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon?: any; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-faint">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("h-4 w-4 animate-spin text-muted", className)} />;
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-20">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = "max-w-2xl" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={clsx("fade-in relative flex h-full w-full flex-col bg-surface shadow-2xl", width)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="min-w-0 text-base font-semibold">{title}</div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {help && <span className="block text-xs text-muted">{help}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-line")}
      >
        <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
    </label>
  );
}

// ── Toasts ────────────────────────────────────────────────────────────────────

type Toast = { id: number; tone: Tone; text: string };
const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="fade-in card pointer-events-auto flex items-start gap-3 px-4 py-3 text-sm shadow-lg">
            <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", { ok: "bg-ok", bad: "bg-bad", warn: "bg-warn", info: "bg-info", muted: "bg-faint", accent: "bg-accent" }[t.tone])} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function money(cents: number | null | undefined, currency = "USD", compact = false) {
  if (cents == null) return "—";
  const value = cents / 100; // display only — all arithmetic happens server-side in Decimal
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact && Math.abs(value) >= 10_000 ? "compact" : "standard",
      maximumFractionDigits: compact && Math.abs(value) >= 10_000 ? 1 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function amount(value: number | null | undefined, currency = "USD") {
  if (value == null || Number.isNaN(value)) return "—";
  return money(Math.round(value * 100), currency);
}

export function date(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function dueLabel(days: number | null | undefined) {
  if (days == null) return "No due date";
  if (days === 0) return "Due today";
  if (days < 0) return `Due in ${-days}d`;
  return `${days}d overdue`;
}

export function pct(v: number | null | undefined) {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

export function ms(v: number | null | undefined) {
  if (v == null) return "";
  return v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(1)}s`;
}

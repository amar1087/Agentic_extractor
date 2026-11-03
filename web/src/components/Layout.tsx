import clsx from "clsx";
import { BellRing, Building2, FileText, LayoutDashboard, LogOut, Menu, Settings, UserCheck, Workflow, X } from "lucide-react";
import { ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api, useApi } from "../lib/api";
import { useLive, useLiveConnected } from "../lib/live";

export interface Me {
  user: { sub: string; email: string; name: string; role: string; orgId: string };
  org: { id: string; name: string } | null;
}

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/runs", label: "Agent runs", icon: Workflow },
  { to: "/review", label: "Review queue", icon: UserCheck, badge: "review" },
  { to: "/invoices", label: "Payables", icon: FileText },
  { to: "/reminders", label: "Reminders", icon: BellRing },
  { to: "/vendors", label: "Vendors", icon: Building2 },
  { to: "/settings", label: "Settings", icon: Settings },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-900/40">
        <svg viewBox="0 0 32 32" className="h-5 w-5"><path d="M9 22l7-12 7 12" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /><circle cx="16" cy="10" r="2.2" fill="white" /></svg>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-white">Agentic Extractor</div>
        <div className="text-[11px] text-sidebar-text/70">Invoice manager</div>
      </div>
    </div>
  );
}

export function Layout({ me, children }: { me: Me; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const connected = useLiveConnected();
  const review = useApi<any[]>("/review");
  useLive((m) => m.type === "job-updated", () => review.reload());

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar px-3 py-5 text-sidebar-text">
      <div className="px-2"><Logo /></div>
      <nav className="mt-8 flex-1 space-y-0.5">
        {NAV.map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              clsx(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive ? "bg-white/[0.08] text-white" : "hover:bg-white/[0.04] hover:text-white"
              )
            }
          >
            <Icon className="h-4 w-4 opacity-80" />
            <span className="flex-1">{label}</span>
            {badge === "review" && (review.data?.length ?? 0) > 0 && (
              <span className="rounded-full bg-rose-500 px-1.5 py-px text-[11px] font-semibold text-white">{review.data!.length}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className={clsx("h-2 w-2 rounded-full", connected ? "bg-emerald-400" : "bg-amber-400")} />
          <span>{connected ? "Live — agents streaming" : "Reconnecting…"}</span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-200">
            {me.user.name.split(" ").map((s) => s[0]).join("").slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-white">{me.user.name}</div>
            <div className="truncate text-[11px] text-sidebar-text/70">{me.org?.name} · {me.user.role}</div>
          </div>
          <button onClick={logout} className="rounded-md p-1.5 hover:bg-white/10" aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="fade-in absolute inset-y-0 left-0 w-64">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
          <button className="btn btn-sm" onClick={() => setOpen(true)} aria-label="Menu">{open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}</button>
          <span className="text-sm font-semibold">Agentic Extractor</span>
        </header>
        <main key={location.pathname.split("/")[1]} className="scroll-thin flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

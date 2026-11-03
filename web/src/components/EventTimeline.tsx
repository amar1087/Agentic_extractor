import clsx from "clsx";
import { AGENTS, OUTCOME_TONE } from "../lib/agents";
import { ms } from "../lib/format";
import type { AgentEvent } from "../lib/live";
import { Badge } from "./ui";

export function EventTimeline({ events, running }: { events: AgentEvent[]; running: boolean }) {
  // Show completed steps, plus the step currently in progress
  const ends = events.filter((e) => e.phase === "END");
  const last = events[events.length - 1];
  const inProgress = running && last?.phase === "START" ? last : null;
  const items = inProgress ? [...ends, inProgress] : ends;

  return (
    <ol className="relative">
      {items.map((e, i) => {
        const agent = AGENTS[e.node] ?? AGENTS.REJECTED;
        const Icon = agent.icon;
        const isLive = e === inProgress;
        const errors = e.data?.errors ?? [];
        return (
          <li key={e.id} className="fade-in relative flex gap-3 pb-5 last:pb-0">
            {i < items.length - 1 && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-line" />}
            <span
              className={clsx("relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", isLive && "animate-pulse")}
              style={{ background: `${agent.color}1f`, color: agent.color }}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{agent.name}</span>
                {isLive ? <Badge tone="accent">working…</Badge> : e.outcome && <Badge tone={OUTCOME_TONE[e.outcome] ?? "muted"}>{e.outcome.toLowerCase()}</Badge>}
                <span className="ml-auto text-xs text-faint num">
                  {ms(e.durationMs)} · {new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </div>
              {e.message && <p className="mt-0.5 text-sm text-muted break-words">{e.message}</p>}
              {errors.length > 0 && (
                <ul className="mt-2 space-y-1 rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-muted">
                  {errors.slice(0, 6).map((err, j) => <li key={j} className="break-words">• {err}</li>)}
                  {errors.length > 6 && <li>… {errors.length - 6} more</li>}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

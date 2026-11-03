import { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react";

export type LiveMessage =
  | { type: "agent-event"; jobId: string; event: AgentEvent }
  | { type: "job-updated"; jobId: string; status: string; currentNode?: string | null }
  | { type: "reminder-sent"; reminderId: string; invoiceId: string }
  | { type: "mailbox-synced"; imported: number };

export interface AgentEvent {
  id: string;
  jobId: string;
  node: string;
  phase: "START" | "END";
  outcome: string | null;
  message: string | null;
  durationMs: number | null;
  data: { errors?: string[] } | null;
  createdAt: string;
}

type Listener = (msg: LiveMessage) => void;

const LiveContext = createContext<{ subscribe: (fn: Listener) => () => void; connected: boolean }>({
  subscribe: () => () => {},
  connected: false,
});

// One SSE connection for the whole app; pages subscribe to the messages they care about
export function LiveProvider({ children }: { children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/events/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data) as LiveMessage;
      listeners.current.forEach((fn) => fn(msg));
    };
    return () => es.close();
  }, []);

  const subscribe = (fn: Listener) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  };

  return <LiveContext.Provider value={{ subscribe, connected }}>{children}</LiveContext.Provider>;
}

export function useLiveConnected() {
  return useContext(LiveContext).connected;
}

// Call `fn` whenever a matching live message arrives (debounced so bursts of node events → one refetch)
export function useLive(match: (msg: LiveMessage) => boolean, fn: (msg: LiveMessage) => void, debounceMs = 250) {
  const { subscribe } = useContext(LiveContext);
  const matchRef = useRef(match);
  const fnRef = useRef(fn);
  matchRef.current = match;
  fnRef.current = fn;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribe((msg) => {
      if (!matchRef.current(msg)) return;
      clearTimeout(timer);
      timer = setTimeout(() => fnRef.current(msg), debounceMs);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [subscribe, debounceMs]);
}

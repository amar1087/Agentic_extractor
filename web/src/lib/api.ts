import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: string[]) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("ae:unauthorized"));
    throw new ApiError(res.status, data?.error ?? res.statusText, data?.issues);
  }
  return data as T;
}

// Minimal data hook: fetch on mount / path change, reload() on demand.
// Reloads keep the previous data on screen so live updates don't flash.
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const current = useRef(path);
  current.current = path;

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const result = await api<T>(path);
      if (current.current === path) {
        setData(result);
        setError(null);
      }
    } catch (e: any) {
      if (current.current === path) setError(e);
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(!!path);
    setData(null);
    reload();
  }, [reload, path]);

  return { data, error, loading, reload, setData };
}

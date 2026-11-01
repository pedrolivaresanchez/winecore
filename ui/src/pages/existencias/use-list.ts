import { useCallback, useEffect, useState } from "react";
import { ApiError, api, isAbortError } from "@/lib/api";
import { copy } from "@/i18n";
import { useCursorPages } from "@/ui";

export type Page<T> = { items: T[]; next_cursor: string | null; total: number };

export function asApiError(error: unknown): ApiError | null {
  if (!error) return null;
  return error instanceof ApiError ? error : new ApiError(0, "WC_ERROR", copy.error.load);
}

/** One page of `path` at a time, for a list with a `Pagination` footer. `null` holds the request. */
export function usePagedList<T>(path: string | null, storageKey: string) {
  return useCursorPages<T>({
    queryKey: path ?? "",
    storageKey,
    enabled: path !== null,
    fetchPage: ({ cursor, limit, signal }) => {
      const extra = new URLSearchParams({ limit: String(limit) });
      if (cursor) extra.set("cursor", cursor);
      const join = (path ?? "").includes("?") ? "&" : "?";
      return api<Page<T>>(`${path}${join}${extra.toString()}`, { signal });
    },
  });
}

export function useList<T>(path: string | null) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(path !== null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [requestPath, setRequestPath] = useState(path);

  if (path !== requestPath) {
    setRequestPath(path);
    setItems([]);
    setCursor(null);
    setTotal(0);
    setError(null);
    setLoading(path !== null);
  }

  useEffect(() => {
    if (!path) {
      setItems([]);
      setCursor(null);
      setTotal(0);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    api<Page<T>>(path, { signal: controller.signal })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.next_cursor);
        setTotal(page.total);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return;
        setItems([]);
        setError(err instanceof ApiError ? err : new ApiError(0, "WC_ERROR", copy.error.load));
        setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [path, attempt]);

  const loadMore = useCallback(async () => {
    if (!path || !cursor) return;
    const join = path.includes("?") ? "&" : "?";
    setLoadingMore(true);
    try {
      const page = await api<Page<T>>(`${path}${join}cursor=${encodeURIComponent(cursor)}`);
      setItems((current) => [...current, ...page.items]);
      setCursor(page.next_cursor);
      setTotal(page.total);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, "WC_ERROR", copy.error.load));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, path]);

  const reload = useCallback(() => {
    setLoading(true);
    setAttempt((value) => value + 1);
  }, []);

  return { items, cursor, total, loading, loadingMore, error, loadMore, reload };
}

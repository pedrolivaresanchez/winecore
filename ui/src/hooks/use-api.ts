import { useCallback, useEffect, useState } from "react";
import { ApiError, api, isAbortError } from "@/lib/api";
import { copy } from "@/i18n";

type State<T> = {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
};

export function useApi<T>(path: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    api<T>(path, { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!active || isAbortError(error)) return;
        const next = error instanceof ApiError ? error : new ApiError(0, "WC_ERROR", copy.error.load);
        setState({ data: null, error: next, loading: false });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [path, attempt]);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    setAttempt((value) => value + 1);
  }, []);

  return { ...state, reload };
}

import { useEffect, useState, useCallback } from "react";
import { syncAppBadge } from "@/appBadge";

type Subscriber = (state: SharedState) => void;
type SharedState = { count: number; loading: boolean };

let sharedState: SharedState = { count: 0, loading: true };
let inflight: Promise<void> | null = null;
let initialized = false;
const subscribers = new Set<Subscriber>();

function publish(next: Partial<SharedState>): void {
  sharedState = { ...sharedState, ...next };
  syncAppBadge(sharedState.count);
  for (const subscriber of subscribers) {
    subscriber(sharedState);
  }
}

async function refreshShared(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/followed/unseen-count");
      if (!res.ok) {
        publish({ loading: false });
        return;
      }
      const data = (await res.json()) as { count: number };
      publish({ count: data.count ?? 0, loading: false });
    } catch {
      publish({ loading: false });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function markViewedShared(): Promise<void> {
  publish({ count: 0 });
  try {
    await fetch("/api/followed/mark-viewed", { method: "POST" });
  } catch {
    /* best-effort */
  }
}

/** Test-only helper to reset module state between tests */
export function __resetUnseenReleaseCountForTests(): void {
  sharedState = { count: 0, loading: true };
  inflight = null;
  initialized = false;
  subscribers.clear();
}

export default function useUnseenReleaseCount() {
  const [state, setState] = useState<SharedState>(sharedState);

  useEffect(() => {
    subscribers.add(setState);
    if (!initialized) {
      initialized = true;
      void refreshShared();
    }
    return () => {
      subscribers.delete(setState);
    };
  }, []);

  const refresh = useCallback(() => refreshShared(), []);
  const markViewed = useCallback(() => markViewedShared(), []);

  return {
    count: state.count,
    loading: state.loading,
    refresh,
    markViewed,
  };
}

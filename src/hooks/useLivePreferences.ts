import { useCallback } from "react";
import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { LivePreferencesData, LivePreferencesPatch } from "@/types";

async function fetchLivePreferences({
  signal,
}: FetchContext): Promise<LivePreferencesData> {
  const res = await fetch("/api/live/preferences", { signal });
  if (!res.ok) throw new Error("Failed to load live preferences");
  return res.json();
}

export default function useLivePreferences() {
  const { data, loading, error, refresh } = useAsyncData<LivePreferencesData>(
    "live-preferences",
    fetchLivePreferences
  );

  const save = useCallback(
    async (patch: LivePreferencesPatch): Promise<string | null> => {
      const res = await fetch("/api/live/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return (body as { error?: string }).error ?? "Could not save";
      }

      await refresh();
      return null;
    },
    [refresh]
  );

  return {
    preferences: data?.preferences ?? null,
    coverage: data?.coverage ?? null,
    loading,
    error,
    save,
  };
}

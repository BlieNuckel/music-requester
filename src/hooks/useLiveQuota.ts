import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { LiveQuotaStatus } from "@/types";

async function fetchLiveQuota({
  signal,
}: FetchContext): Promise<LiveQuotaStatus> {
  const res = await fetch("/api/live/quota", { signal });
  if (!res.ok) throw new Error("Failed to load quota status");
  return res.json();
}

export default function useLiveQuota(enabled: boolean) {
  const { data, loading, error } = useAsyncData<LiveQuotaStatus>(
    enabled ? "live-quota" : null,
    fetchLiveQuota
  );
  return { quota: data, loading, error };
}

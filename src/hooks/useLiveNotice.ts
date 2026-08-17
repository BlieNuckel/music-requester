import { useCallback } from "react";
import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { LiveEventResponse, LiveNoticeData } from "@/types";

async function fetchLiveNotice({
  signal,
}: FetchContext): Promise<LiveNoticeData> {
  const res = await fetch("/api/live/notice", { signal });
  if (!res.ok) throw new Error("Failed to fetch live notice");
  return res.json();
}

export default function useLiveNotice() {
  const { data, loading, error, refresh, setData } =
    useAsyncData<LiveNoticeData>("live-notice", fetchLiveNotice);

  /**
   * Clears the banner optimistically. The notice is a single item, so waiting
   * for a round trip would leave the thing you just dismissed on screen.
   */
  const respond = useCallback(
    async (eventId: number, response: LiveEventResponse) => {
      setData((prev) => ({
        notice: null,
        additionalCount: Math.max(0, prev.additionalCount - 1),
      }));

      await fetch(`/api/live/events/${eventId}/response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });

      await refresh();
    },
    [refresh, setData]
  );

  return {
    notice: data?.notice ?? null,
    additionalCount: data?.additionalCount ?? 0,
    loading,
    error,
    respond,
  };
}

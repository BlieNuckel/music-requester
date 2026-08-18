import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { LiveEventSummary, LiveTrackingState } from "@/types";

type ArtistLiveDatesResponse = {
  events: LiveEventSummary[];
  /** null when nobody follows this artist, so nothing is being watched at all. */
  liveTracking: LiveTrackingState | null;
};

async function fetchArtistLiveDates({
  key,
  signal,
}: FetchContext): Promise<ArtistLiveDatesResponse> {
  const mbid = key.replace("artist-live-dates:", "");
  const res = await fetch(`/api/live/artist/${mbid}`, { signal });
  if (!res.ok) throw new Error("Failed to fetch live dates");
  return res.json();
}

export default function useArtistLiveDates(mbid: string | undefined) {
  const { data, loading, error } = useAsyncData<ArtistLiveDatesResponse>(
    mbid ? `artist-live-dates:${mbid}` : null,
    fetchArtistLiveDates
  );
  return {
    dates: data?.events ?? [],
    tracking: data?.liveTracking ?? null,
    loading,
    error,
  };
}

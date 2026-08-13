import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { AlbumLabel } from "../types";

interface ReleaseGroupLabelResponse {
  label: AlbumLabel | null;
}

async function fetchReleaseGroupLabel({
  key,
  signal,
}: FetchContext): Promise<ReleaseGroupLabelResponse> {
  const res = await fetch(`/api/musicbrainz/release-group/${key}/label`, {
    signal,
  });
  if (!res.ok) {
    throw new Error("Failed to load label");
  }
  return res.json();
}

export default function useReleaseGroupLabel(mbid: string | undefined) {
  const { data, loading, error } = useAsyncData(
    mbid ?? null,
    fetchReleaseGroupLabel
  );

  return {
    label: data?.label ?? null,
    loading,
    error,
  };
}

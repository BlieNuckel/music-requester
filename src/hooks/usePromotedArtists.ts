import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";

export type PromotedArtist = {
  name: string;
  mbid: string;
  imageUrl: string;
  match?: number;
  inLibrary: boolean;
};

export type PromotedArtistsData = {
  artists: PromotedArtist[];
  seedArtists: string[];
};

async function fetchPromotedArtists({
  refresh,
  signal,
}: FetchContext): Promise<PromotedArtistsData | null> {
  const url = refresh
    ? "/api/promoted-artists?refresh=true"
    : "/api/promoted-artists";
  const res = await fetch(url, { signal });

  if (!res.ok) {
    throw new Error("Failed to fetch promoted artists");
  }

  return res.json();
}

export default function usePromotedArtists() {
  const { data, loading, error, refresh } = useAsyncData(
    "promoted-artists",
    fetchPromotedArtists
  );

  return { promotedArtists: data, loading, error, refresh };
}

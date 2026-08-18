import { useCallback, useState } from "react";
import type { GeocodedPlace } from "@/types";

/** Below this the geocoder answers with half the index, so it does not run. */
const MIN_QUERY_LENGTH = 2;

/**
 * On-demand place lookup for filling in coordinates. `places` is null until a
 * search has run, and an empty array means the geocoder had no match.
 */
export default function usePlaceSearch() {
  const [places, setPlaces] = useState<GeocodedPlace[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = useCallback(() => {
    setPlaces(null);
    setError(null);
  }, []);

  const search = useCallback(async (query: string) => {
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setPlaces(null);
      setError(null);
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/live/geocode?q=${encodeURIComponent(query.trim())}`
      );
      if (!res.ok) throw new Error("Lookup failed");
      const body = (await res.json()) as { places?: GeocodedPlace[] };
      setPlaces(body.places ?? []);
    } catch {
      setPlaces(null);
      setError("Could not look that place up.");
    } finally {
      setSearching(false);
    }
  }, []);

  return { places, searching, error, search, clear };
}

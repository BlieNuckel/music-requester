import { resilientFetch } from "../resilientFetch";
import type { PlexSectionsResponse } from "./types";

/**
 * Every music library on the server, not just the first. Splitting music across several
 * sections (Music + Soundtracks + Classical, say) is common, and this sits upstream of the
 * play and rating sweeps — reading one section would truncate the taste data itself.
 * `ratingKey`s are unique across sections, so callers can concatenate without deduping.
 */
export const getMusicSectionKeys = async (
  baseUrl: string,
  headers: Record<string, string>
): Promise<string[]> => {
  const res = await resilientFetch(`${baseUrl}/library/sections`, { headers });
  if (!res.ok) throw new Error(`Plex returned ${res.status}`);

  const data: PlexSectionsResponse = await res.json();
  const sections = data.MediaContainer?.Directory || [];
  const keys = sections.filter((s) => s.type === "artist").map((s) => s.key);
  if (keys.length === 0) throw new Error("No music library found in Plex");
  return keys;
};

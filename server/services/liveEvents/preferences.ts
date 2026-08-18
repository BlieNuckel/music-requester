import { getConfig } from "../../config";
import { ApiError } from "../../middleware/ApiError";
import { countryCodeError } from "../../../shared/countries";
import {
  distanceKm,
  getUserLivePreferences,
  setUserLivePreferences,
} from "../../db/liveEvents";
import type { UserLivePreferences } from "../../db/liveEvents";

export type LivePreferencesPatch = {
  radiusKm?: number | null;
  lat?: number | null;
  lon?: number | null;
  regions?: string[] | null;
  announceDays?: number | null;
  imminentDaysLocal?: number | null;
  imminentDaysRegional?: number | null;
  bannerEnabled?: boolean | null;
};

export type LiveCoverage = {
  originLat: number | null;
  originLon: number | null;
  sweepRadiusKm: number;
  regions: string[];
  configured: boolean;
};

export type LivePreferencesView = {
  preferences: UserLivePreferences;
  coverage: LiveCoverage;
};

/**
 * What this instance can see at all. Surfaced to every user because the sweep
 * origin is admin-owned but decides what everybody else is able to find: an
 * admin in Stockholm silently makes the feature useless for a user in Malmö,
 * and without this there is nothing in the UI that would ever explain why.
 */
export function getCoverage(): LiveCoverage {
  const { liveEvents } = getConfig();
  return {
    originLat: liveEvents.originLat,
    originLon: liveEvents.originLon,
    sweepRadiusKm: liveEvents.sweepRadiusKm,
    regions: liveEvents.regions,
    configured:
      liveEvents.enabled &&
      liveEvents.apiKey.length > 0 &&
      liveEvents.originLat !== null &&
      liveEvents.originLon !== null,
  };
}

function validateRegions(regions: string[]): void {
  for (const code of regions) {
    const error = countryCodeError(code);
    if (error) throw new ApiError(400, error);
  }
}

function validateDays(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new ApiError(400, `${name} must be a positive whole number of days`);
  }
}

/**
 * A home point outside the swept area would return nothing forever with no
 * error to explain it, so it is rejected rather than silently accepted.
 */
function validateHome(
  lat: number | null,
  lon: number | null,
  coverage: LiveCoverage
): void {
  if (lat === null || lon === null) return;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new ApiError(400, "That is not a valid coordinate");
  }
  if (coverage.originLat === null || coverage.originLon === null) return;

  const distance = distanceKm(coverage.originLat, coverage.originLon, lat, lon);
  if (distance > coverage.sweepRadiusKm) {
    throw new ApiError(
      400,
      `That location is ${Math.round(distance)} km from what this instance covers (${coverage.sweepRadiusKm} km). Nothing would ever show up there.`
    );
  }
}

export async function readLivePreferences(
  userId: number
): Promise<LivePreferencesView> {
  const preferences = await getUserLivePreferences(userId);
  if (!preferences) throw new ApiError(404, "User not found");
  return { preferences, coverage: getCoverage() };
}

/**
 * Per-user filters over already-swept data. Nothing here widens what gets
 * fetched, which is why it needs no admin permission; the radius is clamped to
 * what the instance actually sweeps rather than rejected, since a user asking
 * for more than exists is not an error, just optimistic.
 */
export async function writeLivePreferences(
  userId: number,
  patch: LivePreferencesPatch
): Promise<LivePreferencesView> {
  const coverage = getCoverage();

  if (patch.regions != null) validateRegions(patch.regions);
  for (const [name, value] of [
    ["announceDays", patch.announceDays],
    ["imminentDaysLocal", patch.imminentDaysLocal],
    ["imminentDaysRegional", patch.imminentDaysRegional],
  ] as const) {
    if (value != null) validateDays(value, name);
  }
  validateHome(patch.lat ?? null, patch.lon ?? null, coverage);

  const radius =
    patch.radiusKm == null
      ? patch.radiusKm
      : Math.min(Math.max(1, patch.radiusKm), coverage.sweepRadiusKm);

  await setUserLivePreferences(userId, {
    ...(patch.radiusKm !== undefined ? { live_radius_km: radius } : {}),
    ...(patch.lat !== undefined ? { live_lat: patch.lat } : {}),
    ...(patch.lon !== undefined ? { live_lon: patch.lon } : {}),
    ...(patch.regions !== undefined ? { live_regions: patch.regions } : {}),
    ...(patch.announceDays !== undefined
      ? { live_announce_days: patch.announceDays }
      : {}),
    ...(patch.imminentDaysLocal !== undefined
      ? { live_imminent_days_local: patch.imminentDaysLocal }
      : {}),
    ...(patch.imminentDaysRegional !== undefined
      ? { live_imminent_days_regional: patch.imminentDaysRegional }
      : {}),
    ...(patch.bannerEnabled !== undefined
      ? { live_banner_enabled: patch.bannerEnabled }
      : {}),
  });

  return readLivePreferences(userId);
}

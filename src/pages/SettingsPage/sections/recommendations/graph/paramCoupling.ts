import type { PromotedAlbumSettings } from "@/context/settingsContextDef";
import type { ParamKey, ParamValue } from "./paramsContext";
import type { ParamDef } from "@shared/recommenderGraph";

/**
 * A knob's ceiling, which for some knobs is another knob's current value: drawing more
 * artists per recommendation than the profile covers is not a setting, it is a typo.
 */
export function effectiveMax(
  param: ParamDef,
  config: PromotedAlbumSettings
): number | undefined {
  if (param.maxFrom) {
    const bound = config[param.maxFrom];
    if (typeof bound === "number") {
      return param.max === undefined ? bound : Math.min(param.max, bound);
    }
  }
  return param.max;
}

/**
 * Apply one change, keeping the pairs that only make sense together consistent. The page
 * pattern is one flat update per knob, so without this the invalid intermediate state
 * (a minimum above its maximum) is reachable simply by typing the higher number first.
 */
export function applyParamChange(
  config: PromotedAlbumSettings,
  key: ParamKey,
  value: ParamValue
): PromotedAlbumSettings {
  // The one cast in the flow: `ParamDef.kind` is what says which shape a knob takes, and
  // the control for that kind is what produced this value.
  const next: PromotedAlbumSettings = {
    ...config,
    [key]: value,
  } as PromotedAlbumSettings;

  if (key === "deepPageMin" && next.deepPageMin > next.deepPageMax) {
    next.deepPageMax = next.deepPageMin;
  }
  if (key === "deepPageMax" && next.deepPageMax < next.deepPageMin) {
    next.deepPageMin = next.deepPageMax;
  }
  if (
    key === "topArtistsCount" &&
    next.pickedArtistsCount > next.topArtistsCount
  ) {
    next.pickedArtistsCount = next.topArtistsCount;
  }
  return next;
}

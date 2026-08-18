import { useState } from "react";
import CountryPicker from "@/components/CountryPicker";
import useLivePreferences from "@/hooks/useLivePreferences";

const INPUT_CLASSES =
  "w-full sm:w-xs px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-200 dark:placeholder-gray-600 focus:outline-none focus:border-amber-400 shadow-cartoon-md";

const LABEL_CLASSES =
  "block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1";

function coverageText(
  originLat: number | null,
  originLon: number | null,
  radiusKm: number
): string {
  if (originLat === null || originLon === null) {
    return "No location has been set for this instance yet, so nothing can be found.";
  }
  return `This instance covers ${radiusKm} km around ${originLat.toFixed(2)}, ${originLon.toFixed(2)}. Nothing outside that is fetched for anyone.`;
}

export default function LivePreferencesSection() {
  const { preferences, coverage, loading, error, save } = useLivePreferences();
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Held locally so adding two countries in a row does not race the refresh. */
  const [regions, setRegions] = useState<string[] | null>(null);

  if (loading || !preferences || !coverage) return null;

  const submit = async (patch: Parameters<typeof save>[0]) => {
    setSaveError(await save(patch));
  };

  const handleRegions = (codes: string[]) => {
    setRegions(codes);
    void submit({ regions: codes.length > 0 ? codes : null });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
        Live dates
      </h2>

      <p className="text-gray-400 dark:text-gray-500 text-xs">
        {coverageText(
          coverage.originLat,
          coverage.originLon,
          coverage.sweepRadiusKm
        )}
      </p>

      {error && (
        <p className="text-rose-500 text-xs">Could not load your preferences</p>
      )}
      {saveError && <p className="text-rose-500 text-xs">{saveError}</p>}

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={preferences.live_banner_enabled ?? true}
          onChange={(e) => void submit({ bannerEnabled: e.target.checked })}
          className="w-4 h-4 border-2 border-black rounded"
        />
        <span className="text-sm text-gray-900 dark:text-gray-100">
          Show the announcement banner on Discover
        </span>
      </label>

      <div>
        <label className={LABEL_CLASSES}>How far counts as local (km)</label>
        <input
          type="number"
          min={1}
          max={coverage.sweepRadiusKm}
          defaultValue={preferences.live_radius_km ?? coverage.sweepRadiusKm}
          onBlur={(e) =>
            void submit({ radiusKm: Number(e.target.value) || null })
          }
          className={INPUT_CLASSES}
        />
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          Capped at the {coverage.sweepRadiusKm} km this instance fetches.
        </p>
      </div>

      <div>
        <label className={LABEL_CLASSES}>Countries you would travel to</label>
        <CountryPicker
          value={regions ?? preferences.live_regions ?? coverage.regions}
          onChange={handleRegions}
        />
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          Remove them all to follow the instance default.
        </p>
      </div>

      <div>
        <label className={LABEL_CLASSES}>
          Tell me about new dates for (days)
        </label>
        <input
          type="number"
          min={1}
          defaultValue={preferences.live_announce_days ?? ""}
          placeholder="Instance default"
          onBlur={(e) =>
            void submit({ announceDays: Number(e.target.value) || null })
          }
          className={INPUT_CLASSES}
        />
      </div>
    </div>
  );
}

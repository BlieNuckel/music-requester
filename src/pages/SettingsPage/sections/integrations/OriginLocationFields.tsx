import useCurrentPosition from "@/hooks/useCurrentPosition";
import PlaceSearchField from "./PlaceSearchField";

interface OriginLocationFieldsProps {
  originLat: number | null;
  originLon: number | null;
  onChange: (patch: {
    originLat?: number | null;
    originLon?: number | null;
  }) => void;
}

const INPUT_CLASSES =
  "w-full sm:w-sm px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-200 dark:placeholder-gray-600 focus:outline-none focus:border-amber-400 shadow-cartoon-md";

const LABEL_CLASSES =
  "block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1";

const BUTTON_CLASSES =
  "px-3 py-2 text-sm font-bold bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-2 border-black rounded-lg shadow-cartoon-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

function parseCoordinate(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export default function OriginLocationFields({
  originLat,
  originLon,
  onChange,
}: OriginLocationFieldsProps) {
  const { locate, locating, error } = useCurrentPosition();

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-4">
        <div>
          <label className={LABEL_CLASSES} htmlFor="origin-lat">
            Origin latitude
          </label>
          <input
            id="origin-lat"
            type="number"
            step="0.0001"
            value={originLat ?? ""}
            onChange={(e) =>
              onChange({ originLat: parseCoordinate(e.target.value) })
            }
            className={INPUT_CLASSES}
          />
        </div>
        <div>
          <label className={LABEL_CLASSES} htmlFor="origin-lon">
            Origin longitude
          </label>
          <input
            id="origin-lon"
            type="number"
            step="0.0001"
            value={originLon ?? ""}
            onChange={(e) =>
              onChange({ originLon: parseCoordinate(e.target.value) })
            }
            className={INPUT_CLASSES}
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <button
          type="button"
          onClick={() =>
            locate((latitude, longitude) =>
              onChange({ originLat: latitude, originLon: longitude })
            )
          }
          disabled={locating}
          className={BUTTON_CLASSES}
        >
          {locating ? "Locating…" : "Use my location"}
        </button>

        <PlaceSearchField
          onPick={(latitude, longitude) =>
            onChange({ originLat: latitude, originLon: longitude })
          }
        />
      </div>

      {error && <p className="text-rose-500 text-xs">{error}</p>}
    </div>
  );
}

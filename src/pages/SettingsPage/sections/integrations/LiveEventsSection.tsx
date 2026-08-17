import type { LiveEventsSettings } from "@/context/settingsContextDef";
import LiveQuotaStatus from "./LiveQuotaStatus";

interface LiveEventsSectionProps {
  settings: LiveEventsSettings;
  onChange: (patch: Partial<LiveEventsSettings>) => void;
}

const INPUT_CLASSES =
  "w-full sm:w-sm px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-200 dark:placeholder-gray-600 focus:outline-none focus:border-amber-400 shadow-cartoon-md";

const LABEL_CLASSES =
  "block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1";

const HINT_CLASSES = "text-gray-400 dark:text-gray-500 text-xs mt-1";

const ISO2 = /^[A-Z]{2}$/;

function parseRegions(raw: string): string[] {
  return raw
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code.length > 0);
}

function regionsError(codes: string[]): string | null {
  if (codes.includes("UK")) {
    return "Use GB rather than UK — that is what the events API expects.";
  }
  const invalid = codes.find((code) => !ISO2.test(code));
  return invalid
    ? `"${invalid}" is not a two-letter country code (ISO 3166-1 alpha-2).`
    : null;
}

function parseCoordinate(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export default function LiveEventsSection({
  settings,
  onChange,
}: LiveEventsSectionProps) {
  const regionError = regionsError(settings.regions);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
        Live events
      </h2>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="w-4 h-4 border-2 border-black rounded"
        />
        <span className="text-sm text-gray-900 dark:text-gray-100">
          Fetch tour dates for followed artists
        </span>
      </label>

      <LiveQuotaStatus enabled={settings.enabled} />

      <div>
        <label className={LABEL_CLASSES}>JamBase API key</label>
        <input
          type="password"
          value={settings.apiKey}
          onChange={(e) => onChange({ apiKey: e.target.value })}
          placeholder="jbd_..."
          className={INPUT_CLASSES}
        />
        <p className={HINT_CLASSES}>
          Free Developer tier at data.jambase.com: 1,000 calls a month,
          non-commercial use, attribution required. Calls past the quota are
          billed rather than refused.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div>
          <label className={LABEL_CLASSES}>Origin latitude</label>
          <input
            type="number"
            step="0.0001"
            value={settings.originLat ?? ""}
            onChange={(e) =>
              onChange({ originLat: parseCoordinate(e.target.value) })
            }
            className={INPUT_CLASSES}
          />
        </div>
        <div>
          <label className={LABEL_CLASSES}>Origin longitude</label>
          <input
            type="number"
            step="0.0001"
            value={settings.originLon ?? ""}
            onChange={(e) =>
              onChange({ originLon: parseCoordinate(e.target.value) })
            }
            className={INPUT_CLASSES}
          />
        </div>
      </div>

      <div>
        <label className={LABEL_CLASSES}>Sweep radius (km)</label>
        <input
          type="number"
          min={1}
          value={settings.sweepRadiusKm}
          onChange={(e) =>
            onChange({ sweepRadiusKm: Number(e.target.value) || 1 })
          }
          className={INPUT_CLASSES}
        />
        <p className={HINT_CLASSES}>
          The furthest anything is fetched from. Everyone on this instance is
          limited to it, and nobody can see shows beyond it.
        </p>
      </div>

      <div>
        <label className={LABEL_CLASSES}>Countries</label>
        <input
          type="text"
          value={settings.regions.join(", ")}
          onChange={(e) => onChange({ regions: parseRegions(e.target.value) })}
          placeholder="SE, DK, DE"
          className={INPUT_CLASSES}
        />
        {regionError ? (
          <p className="text-rose-500 text-xs mt-1">{regionError}</p>
        ) : (
          <p className={HINT_CLASSES}>
            Default for people who have not picked their own. Each extra country
            widens the shared sweep for everyone.
          </p>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div>
          <label className={LABEL_CLASSES}>Announce window (days)</label>
          <input
            type="number"
            min={1}
            value={settings.announceDays}
            onChange={(e) =>
              onChange({ announceDays: Number(e.target.value) || 1 })
            }
            className={INPUT_CLASSES}
          />
          <p className={HINT_CLASSES}>
            How long a newly announced date stays on the banner.
          </p>
        </div>
        <div>
          <label className={LABEL_CLASSES}>Reminder, local (days)</label>
          <input
            type="number"
            min={1}
            value={settings.imminentDaysLocal}
            onChange={(e) =>
              onChange({ imminentDaysLocal: Number(e.target.value) || 1 })
            }
            className={INPUT_CLASSES}
          />
        </div>
        <div>
          <label className={LABEL_CLASSES}>Reminder, further away (days)</label>
          <input
            type="number"
            min={1}
            value={settings.imminentDaysRegional}
            onChange={(e) =>
              onChange({ imminentDaysRegional: Number(e.target.value) || 1 })
            }
            className={INPUT_CLASSES}
          />
          <p className={HINT_CLASSES}>
            Longer than local on purpose: a trip needs booking.
          </p>
        </div>
      </div>
    </div>
  );
}

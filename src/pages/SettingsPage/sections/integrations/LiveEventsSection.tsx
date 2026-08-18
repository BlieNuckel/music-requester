import type { LiveEventsSettings } from "@/context/settingsContextDef";
import CountryPicker from "@/components/CountryPicker";
import LiveQuotaStatus from "./LiveQuotaStatus";
import LiveRosterStatus from "./LiveRosterStatus";
import OriginLocationFields from "./OriginLocationFields";

interface LiveEventsSectionProps {
  settings: LiveEventsSettings;
  onChange: (patch: Partial<LiveEventsSettings>) => void;
}

const INPUT_CLASSES =
  "w-full sm:w-sm px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-200 dark:placeholder-gray-600 focus:outline-none focus:border-amber-400 shadow-cartoon-md";

const LABEL_CLASSES =
  "block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1";

const HINT_CLASSES = "text-gray-400 dark:text-gray-500 text-xs mt-1";

export default function LiveEventsSection({
  settings,
  onChange,
}: LiveEventsSectionProps) {
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

      <LiveRosterStatus enabled={settings.enabled} />

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

      <OriginLocationFields
        originLat={settings.originLat}
        originLon={settings.originLon}
        onChange={onChange}
      />

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
        <CountryPicker
          value={settings.regions}
          onChange={(regions) => onChange({ regions })}
        />
        <p className={HINT_CLASSES}>
          Default for people who have not picked their own. Each extra country
          widens the shared sweep for everyone.
        </p>
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

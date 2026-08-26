import type { PurchaseDecisionSettings } from "@/context/settingsContextDef";
import { DEFAULT_PURCHASE_DECISION } from "@/context/purchaseDecisionDefaults";
import TagListEditor from "@/components/TagListEditor";

interface PurchaseDecisionSectionProps {
  config: PurchaseDecisionSettings;
  onConfigChange: (config: PurchaseDecisionSettings) => void;
}

export default function PurchaseDecisionSection({
  config,
  onConfigChange,
}: PurchaseDecisionSectionProps) {
  const handleReset = () => {
    onConfigChange({ ...DEFAULT_PURCHASE_DECISION });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Purchase Decision
        </h2>
        <button
          type="button"
          onClick={handleReset}
          className="px-3 py-1.5 text-xs font-bold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-2 border-black rounded-lg shadow-cartoon-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          Reset to Defaults
        </button>
      </div>

      <p className="text-gray-500 dark:text-gray-400 text-sm">
        Configure factors that influence whether the purchase modal recommends
        buying or requesting an album.
      </p>

      <div>
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
          Label Blocklist
        </label>
        <TagListEditor
          tags={config.labelBlocklist}
          onTagsChange={(tags) =>
            onConfigChange({ ...config, labelBlocklist: tags })
          }
        />
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          Labels added here will trigger a recommendation to request rather than
          purchase. Matching is case-insensitive and partial — e.g. "Universal"
          matches "Universal Music Group".
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
          Old Release Threshold (years)
        </label>
        <input
          type="number"
          value={config.oldReleaseThresholdYears}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            if (!Number.isNaN(parsed)) {
              onConfigChange({
                ...config,
                oldReleaseThresholdYears: Math.max(0, parsed),
              });
            }
          }}
          min={0}
          max={200}
          step={1}
          className="w-full sm:w-xs px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:border-amber-400 shadow-cartoon-md text-[16px]"
        />
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          Albums older than this many years will get a recommendation to request
          instead of purchase — the artist may no longer benefit from sales. Set
          to 0 to disable the age factor.
        </p>
      </div>
    </div>
  );
}

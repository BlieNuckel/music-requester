import { useState } from "react";
import BottomSheet from "../BottomSheet";
import { RemovableChip, SelectableChip } from "./chips";
import { FilterIcon } from "./icons";
import { getActiveChips, toggleValue } from "./helpers";
import type { FilterBarProps } from "./types";

/** How many active filters are named inline before collapsing to a "+N more" count. */
const INLINE_CHIP_LIMIT = 2;

export default function MobileFilterBar({
  filters,
  values,
  onChange,
}: Omit<FilterBarProps, "search">) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeChips = getActiveChips(filters, values);

  const handleReset = () => {
    for (const group of filters) {
      onChange(group.key, []);
    }
  };

  return (
    <div className="flex items-center gap-2 md:hidden">
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className={`flex items-center justify-center w-9 h-9 rounded-lg border-2 border-black shadow-cartoon-sm transition-all hover:translate-y-[-1px] hover:shadow-cartoon-md active:translate-y-[1px] active:shadow-cartoon-pressed flex-shrink-0 ${
          activeChips.length > 0
            ? "bg-amber-400 text-black"
            : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        }`}
      >
        <FilterIcon className="w-4 h-4" />
      </button>

      {activeChips.length > 0 && (
        <div className="flex items-center gap-1.5 min-w-0">
          {activeChips.slice(0, INLINE_CHIP_LIMIT).map((chip) => (
            <RemovableChip
              key={`${chip.key}-${chip.value}`}
              label={chip.label}
              onRemove={() =>
                onChange(
                  chip.key,
                  toggleValue(values[chip.key] ?? [], chip.value)
                )
              }
            />
          ))}
          {activeChips.length > INLINE_CHIP_LIMIT && (
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
              +{activeChips.length - INLINE_CHIP_LIMIT} more
            </span>
          )}
        </div>
      )}

      <BottomSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Filters"
      >
        <div className="space-y-6">
          {filters.map((group) => (
            <div key={group.key}>
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
                {group.label}
              </h3>
              <div className="flex flex-wrap gap-2">
                {group.options.map((option) => (
                  <SelectableChip
                    key={option.value}
                    label={option.label}
                    selected={(values[group.key] ?? []).includes(option.value)}
                    onToggle={() =>
                      onChange(
                        group.key,
                        toggleValue(values[group.key] ?? [], option.value)
                      )
                    }
                  />
                ))}
              </div>
            </div>
          ))}

          {activeChips.length > 0 && (
            <button
              type="button"
              onClick={handleReset}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              Reset all filters
            </button>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}

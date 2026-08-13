import { useState } from "react";
import FilterDropdown from "./FilterDropdown";
import type { FilterBarProps } from "./types";

export default function DesktopFilterBar({
  filters,
  values,
  onChange,
}: Omit<FilterBarProps, "search">) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const hasActiveFilters = filters.some(
    (group) => (values[group.key] ?? []).length > 0
  );

  const handleReset = () => {
    for (const group of filters) {
      onChange(group.key, []);
    }
    setExpandedKey(null);
  };

  return (
    <div className="hidden md:flex md:flex-wrap md:items-center md:gap-2">
      {filters.map((group) => (
        <FilterDropdown
          key={group.key}
          group={group}
          selected={values[group.key] ?? []}
          isOpen={expandedKey === group.key}
          onToggleOpen={() =>
            setExpandedKey((prev) => (prev === group.key ? null : group.key))
          }
          onChange={(newValues) => onChange(group.key, newValues)}
        />
      ))}

      {hasActiveFilters && (
        <button
          type="button"
          onClick={handleReset}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          Reset filters
        </button>
      )}
    </div>
  );
}

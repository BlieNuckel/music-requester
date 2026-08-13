import type { ActiveChip, FilterGroup } from "./types";

export function toggleValue(current: string[], value: string): string[] {
  return current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
}

export function getActiveChips(
  filters: FilterGroup[],
  values: Record<string, string[]>
): ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const group of filters) {
    const selected = values[group.key] ?? [];
    for (const opt of group.options) {
      if (selected.includes(opt.value)) {
        chips.push({
          key: group.key,
          groupLabel: group.label,
          value: opt.value,
          label: opt.label,
        });
      }
    }
  }
  return chips;
}

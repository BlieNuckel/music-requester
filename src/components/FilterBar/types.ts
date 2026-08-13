export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  key: string;
  label: string;
  options: FilterOption[];
  /** How selected values within this group combine. "or" = match any, "and" = match all. Default: "or" */
  combineMode?: "and" | "or";
}

export interface SearchConfig {
  placeholder: string;
  onSearch: (query: string) => void;
}

export interface FilterBarProps {
  filters: FilterGroup[];
  values: Record<string, string[]>;
  onChange: (key: string, values: string[]) => void;
  search?: SearchConfig;
}

/** One selected option, flattened across groups for the active-filter summary. */
export type ActiveChip = {
  key: string;
  groupLabel: string;
  value: string;
  label: string;
};

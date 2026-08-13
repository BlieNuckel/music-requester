import SearchForm from "./SearchForm";
import MobileFilterBar from "./MobileFilterBar";
import DesktopFilterBar from "./DesktopFilterBar";
import type { FilterBarProps } from "./types";

/** Renders both layouts; CSS decides which one is visible at the md breakpoint. */
export default function FilterBar({
  filters,
  values,
  onChange,
  search,
}: FilterBarProps) {
  return (
    <div className="space-y-2">
      {search && <SearchForm {...search} />}
      <MobileFilterBar filters={filters} values={values} onChange={onChange} />
      <DesktopFilterBar filters={filters} values={values} onChange={onChange} />
    </div>
  );
}

export type {
  FilterOption,
  FilterGroup,
  FilterBarProps,
  SearchConfig,
} from "./types";

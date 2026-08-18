import type { Country } from "@shared/countries";

interface CountrySuggestionsProps {
  countries: Country[];
  highlighted: number;
  listboxId: string;
  onSelect: (code: string) => void;
  onHighlight: (index: number) => void;
}

const OPTION_CLASSES =
  "w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100";

export default function CountrySuggestions({
  countries,
  highlighted,
  listboxId,
  onSelect,
  onHighlight,
}: CountrySuggestionsProps) {
  return (
    <ul
      id={listboxId}
      role="listbox"
      className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white dark:bg-gray-800 border-2 border-black rounded-lg shadow-cartoon-md"
    >
      {countries.map((country, index) => (
        <li key={country.code} role="none">
          <button
            type="button"
            role="option"
            aria-selected={index === highlighted}
            /* Keep focus on the input so choosing an option does not close the list first. */
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHighlight(index)}
            onClick={() => onSelect(country.code)}
            className={`${OPTION_CLASSES} ${
              index === highlighted ? "bg-amber-100 dark:bg-amber-900/30" : ""
            }`}
          >
            <span className="font-bold w-6">{country.code}</span>
            <span>{country.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

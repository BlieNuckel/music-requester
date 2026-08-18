import { useId, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  countryCodeError,
  countryName,
  parseCountryCodes,
  searchCountries,
} from "@shared/countries";
import type { ParsedCountryCodes } from "@shared/countries";
import CountryPills from "./CountryPills";
import CountrySuggestions from "./CountrySuggestions";

interface CountryPickerProps {
  value: string[];
  onChange: (codes: string[]) => void;
  placeholder?: string;
}

/** Enough to scan without the list covering the rest of the form. */
const MAX_SUGGESTIONS = 6;

const INPUT_CLASSES =
  "w-full px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:border-amber-400 shadow-cartoon-md text-[16px]";

/**
 * What to say about the parts of a typed list that were not plain valid codes.
 * An alias is a success worth mentioning rather than an error: UK is what people
 * type for the United Kingdom and the events API only knows GB.
 */
function parseMessage(parsed: ParsedCountryCodes): string | null {
  const [alias] = parsed.aliased;
  if (alias) {
    return `${alias.from} is not a country code — added ${alias.to} (${countryName(alias.to)}) instead.`;
  }
  const [unknown] = parsed.unknown;
  return unknown ? countryCodeError(unknown) : null;
}

function withoutDuplicates(value: string[], added: string[]): string[] {
  const next = [...value];
  for (const code of added) {
    if (!next.includes(code)) next.push(code);
  }
  return next;
}

export default function CountryPicker({
  value,
  onChange,
  placeholder = "Search a country or type a code",
}: CountryPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  /** null means "no deliberate choice yet", which is what lets Enter prefer a typed code. */
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const listboxId = useId();

  const suggestions = useMemo(
    () => searchCountries(query, value).slice(0, MAX_SUGGESTIONS),
    [query, value]
  );

  /** Already-saved codes can be wrong too, from an older release or the API. */
  const valueError = useMemo(
    () => value.map((code) => countryCodeError(code)).find(Boolean) ?? null,
    [value]
  );

  const highlighted = activeIndex ?? 0;

  const add = (codes: string[]) => {
    const next = withoutDuplicates(value, codes);
    if (next.length !== value.length) onChange(next);
    setQuery("");
    setActiveIndex(null);
  };

  /**
   * What Enter and a comma mean: a code the user typed outright wins, because
   * they said it exactly. Otherwise fall through to the first suggestion, which
   * is how "swed" or "denm" turns into a country. Only a query that is neither
   * gets an error.
   */
  const commit = (raw: string) => {
    if (raw.trim() === "") return;

    const parsed = parseCountryCodes(raw);
    if (parsed.codes.length > 0) {
      setMessage(parseMessage(parsed));
      add(parsed.codes);
      return;
    }

    const [first] = searchCountries(raw, value);
    if (first) {
      setMessage(null);
      add([first.code]);
      return;
    }
    setMessage(parseMessage(parsed));
  };

  const handleChange = (raw: string) => {
    setMessage(null);
    setOpen(true);
    setActiveIndex(null);
    // A comma is how someone signals "that one is done", not part of a code.
    if (raw.includes(",")) {
      commit(raw);
      return;
    }
    setQuery(raw);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (suggestions.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        ((activeIndex ?? 0) + step + suggestions.length) % suggestions.length
      );
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const chosen =
        activeIndex === null ? undefined : suggestions[activeIndex];
      if (chosen) {
        setMessage(null);
        add([chosen.code]);
      } else {
        commit(query);
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Backspace" && query === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="space-y-2">
      <CountryPills
        codes={value}
        onRemove={(code) => onChange(value.filter((c) => c !== code))}
      />

      <div className="relative w-full sm:w-sm">
        <input
          type="text"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder={placeholder}
          className={INPUT_CLASSES}
        />

        {open && suggestions.length > 0 && (
          <CountrySuggestions
            countries={suggestions}
            highlighted={highlighted}
            listboxId={listboxId}
            onSelect={(code) => {
              setMessage(null);
              add([code]);
            }}
            onHighlight={setActiveIndex}
          />
        )}
      </div>

      {(message ?? valueError) && (
        <p className="text-rose-500 text-xs">{message ?? valueError}</p>
      )}
    </div>
  );
}

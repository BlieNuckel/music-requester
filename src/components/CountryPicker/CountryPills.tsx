import { countryCodeError, countryName } from "@shared/countries";

interface CountryPillsProps {
  codes: string[];
  onRemove: (code: string) => void;
}

const BASE_PILL_CLASSES =
  "inline-flex items-center gap-1.5 px-2 py-1 text-sm rounded-lg border";

const VALID_PILL_CLASSES =
  "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700";

/** A code already saved can be one the events API will reject, so it says so. */
const INVALID_PILL_CLASSES =
  "bg-rose-100 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-700";

export default function CountryPills({ codes, onRemove }: CountryPillsProps) {
  if (codes.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {codes.map((code) => {
        const invalid = countryCodeError(code) !== null;
        const name = countryName(code);

        return (
          <span
            key={code}
            className={`${BASE_PILL_CLASSES} ${
              invalid ? INVALID_PILL_CLASSES : VALID_PILL_CLASSES
            }`}
          >
            <span className="font-bold">{code}</span>
            {!invalid && name !== code && (
              <span className="text-xs">{name}</span>
            )}
            <button
              type="button"
              onClick={() => onRemove(code)}
              aria-label={`Remove ${invalid ? code : name}`}
              className="font-bold opacity-60 hover:opacity-100"
            >
              &times;
            </button>
          </span>
        );
      })}
    </div>
  );
}

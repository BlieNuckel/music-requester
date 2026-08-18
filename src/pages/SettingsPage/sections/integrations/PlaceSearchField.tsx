import { useState } from "react";
import type { KeyboardEvent } from "react";
import usePlaceSearch from "@/hooks/usePlaceSearch";
import type { GeocodedPlace } from "@/types";

interface PlaceSearchFieldProps {
  onPick: (latitude: number, longitude: number) => void;
}

const INPUT_CLASSES =
  "flex-1 px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:border-amber-400 shadow-cartoon-md text-[16px]";

const BUTTON_CLASSES =
  "px-3 py-2 text-sm font-bold bg-amber-300 text-black border-2 border-black rounded-lg shadow-cartoon-sm hover:bg-amber-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const RESULT_CLASSES =
  "w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-amber-100 dark:hover:bg-amber-900/30";

function describe(place: GeocodedPlace): string {
  return [place.name, place.region, place.country].filter(Boolean).join(", ");
}

export default function PlaceSearchField({ onPick }: PlaceSearchFieldProps) {
  const { places, searching, error, search, clear } = usePlaceSearch();
  const [query, setQuery] = useState("");

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void search(query);
  };

  const handlePick = (place: GeocodedPlace) => {
    onPick(place.latitude, place.longitude);
    setQuery(describe(place));
    clear();
  };

  return (
    <div className="w-full sm:w-sm space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search a city"
          aria-label="Search a city"
          className={INPUT_CLASSES}
        />
        <button
          type="button"
          onClick={() => void search(query)}
          disabled={searching}
          className={BUTTON_CLASSES}
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <p className="text-rose-500 text-xs">{error}</p>}

      {places?.length === 0 && (
        <p className="text-gray-400 dark:text-gray-500 text-xs">
          No place matched that.
        </p>
      )}

      {places && places.length > 0 && (
        <ul className="border-2 border-black rounded-lg overflow-hidden bg-white dark:bg-gray-800 shadow-cartoon-md">
          {places.map((place) => (
            <li key={`${place.latitude},${place.longitude}`}>
              <button
                type="button"
                onClick={() => handlePick(place)}
                className={RESULT_CLASSES}
              >
                {describe(place)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

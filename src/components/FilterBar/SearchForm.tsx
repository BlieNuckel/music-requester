import { useState } from "react";
import type { SearchConfig } from "./types";

export default function SearchForm({ placeholder, onSearch }: SearchConfig) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(input.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-amber-400 shadow-cartoon-md text-[16px]"
      />
      <button
        type="submit"
        className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-black font-bold rounded-lg border-2 border-black shadow-cartoon-md hover:translate-y-[-1px] hover:shadow-cartoon-lg active:translate-y-[1px] active:shadow-cartoon-pressed transition-all"
      >
        Search
      </button>
    </form>
  );
}

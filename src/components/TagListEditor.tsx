import { useState } from "react";

interface TagListEditorProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
}

function isDuplicate(tags: string[], newTag: string): boolean {
  const lower = newTag.toLowerCase();
  return tags.some((t) => t.toLowerCase() === lower);
}

export default function TagListEditor({
  tags,
  onTagsChange,
}: TagListEditorProps) {
  const [input, setInput] = useState("");

  const handleAdd = () => {
    const trimmed = input.trim();
    if (!trimmed || isDuplicate(tags, trimmed)) return;
    onTagsChange([...tags, trimmed]);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleRemove = (index: number) => {
    onTagsChange(tags.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 rounded-lg border border-amber-300 dark:border-amber-700"
          >
            {tag}
            <button
              type="button"
              onClick={() => handleRemove(i)}
              className="ml-0.5 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 font-bold"
              aria-label={`Remove ${tag}`}
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a tag..."
          className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-200 dark:placeholder-gray-600 focus:outline-none focus:border-amber-400 shadow-cartoon-md text-[16px]"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="px-3 py-2 text-sm font-bold bg-amber-300 text-black border-2 border-black rounded-lg shadow-cartoon-sm hover:bg-amber-200 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

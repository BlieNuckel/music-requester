import type { LayoutMode } from "./autoLayout";

export type RecommenderView = "graph" | "list";

type RecommenderToolbarProps = {
  view: RecommenderView;
  onViewChange: (view: RecommenderView) => void;
  layout: LayoutMode;
  onLayoutChange: (layout: LayoutMode) => void;
  onReset: () => void;
};

type Choice<T extends string> = { value: T; label: string };

const VIEWS: Choice<RecommenderView>[] = [
  { value: "graph", label: "Graph" },
  { value: "list", label: "List" },
];

const LAYOUTS: Choice<LayoutMode>[] = [
  { value: "authored", label: "Authored" },
  { value: "auto", label: "Auto" },
];

function Switch<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </span>
      <div
        role="group"
        aria-label={label}
        className="flex rounded-lg border-2 border-black overflow-hidden shadow-cartoon-sm"
      >
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            aria-pressed={value === choice.value}
            onClick={() => onChange(choice.value)}
            className={`px-3 py-1 text-xs font-bold transition-colors ${
              value === choice.value
                ? "bg-amber-300 text-black"
                : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-gray-700"
            }`}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function RecommenderToolbar({
  view,
  onViewChange,
  layout,
  onLayoutChange,
  onReset,
}: RecommenderToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Switch
        label="View"
        choices={VIEWS}
        value={view}
        onChange={onViewChange}
      />
      {view === "graph" && (
        <Switch
          label="Layout"
          choices={LAYOUTS}
          value={layout}
          onChange={onLayoutChange}
        />
      )}
      <button
        type="button"
        onClick={onReset}
        className="ml-auto px-3 py-1.5 text-xs font-bold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-2 border-black rounded-lg shadow-cartoon-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
      >
        Reset to defaults
      </button>
    </div>
  );
}

import { FLOWS } from "@shared/recommenderGraph";
import type { LayoutDirection, LayoutOptions, Spacing } from "./autoLayout";
import type { FlowId } from "@shared/recommenderGraph";

export type RecommenderView = "graph" | "list";

type RecommenderToolbarProps = {
  view: RecommenderView;
  onViewChange: (view: RecommenderView) => void;
  flow: FlowId;
  onFlowChange: (flow: FlowId) => void;
  layout: LayoutOptions;
  onLayoutChange: (layout: LayoutOptions) => void;
  onReset: () => void;
};

type Choice<T extends string> = { value: T; label: string };

const VIEWS: Choice<RecommenderView>[] = [
  { value: "graph", label: "Graph" },
  { value: "list", label: "List" },
];

const FLOW_CHOICES: Choice<FlowId>[] = FLOWS.map((flow) => ({
  value: flow.id,
  label: flow.label,
}));

const DIRECTIONS: Choice<LayoutDirection>[] = [
  { value: "LR", label: "Across" },
  { value: "TB", label: "Down" },
];

const SPACINGS: Choice<Spacing>[] = [
  { value: "compact", label: "Tight" },
  { value: "comfortable", label: "Normal" },
  { value: "roomy", label: "Loose" },
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
        className="flex flex-wrap rounded-lg border-2 border-black overflow-hidden shadow-cartoon-sm"
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
  flow,
  onFlowChange,
  layout,
  onLayoutChange,
  onReset,
}: RecommenderToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Switch
        label="Flow"
        choices={FLOW_CHOICES}
        value={flow}
        onChange={onFlowChange}
      />
      <Switch
        label="View"
        choices={VIEWS}
        value={view}
        onChange={onViewChange}
      />
      {view === "graph" && (
        <>
          <Switch
            label="Direction"
            choices={DIRECTIONS}
            value={layout.direction}
            onChange={(direction) => onLayoutChange({ ...layout, direction })}
          />
          <Switch
            label="Spacing"
            choices={SPACINGS}
            value={layout.spacing}
            onChange={(spacing) => onLayoutChange({ ...layout, spacing })}
          />
        </>
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

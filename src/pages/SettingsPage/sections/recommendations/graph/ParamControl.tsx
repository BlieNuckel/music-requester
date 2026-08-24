import { effectiveMax } from "./paramCoupling";
import { useRecommenderParams } from "./paramsContext";
import TagListEditor from "../TagListEditor";
import type { LibraryPreference } from "@/context/settingsContextDef";
import type { ParamDef } from "@shared/recommenderGraph";

type ParamControlProps = {
  param: ParamDef;
  /** `inline` sits inside a node's sentence; `block` is a labelled field in the list view. */
  variant?: "inline" | "block";
  disabled?: boolean;
};

const NUMBER_CLASS =
  "px-2 py-1 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:border-amber-400 text-[16px] font-bold disabled:opacity-50";

const clamp = (value: number, min?: number, max?: number): number => {
  const lower = min === undefined ? value : Math.max(min, value);
  return max === undefined ? lower : Math.min(max, lower);
};

function BooleanControl({ param, disabled }: ParamControlProps) {
  const { config, update } = useRecommenderParams();
  const checked = Boolean(config[param.key]);

  return (
    <label className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => update(param.key, e.target.checked)}
        className="h-4 w-4 rounded border-2 border-black"
      />
      {param.label}
    </label>
  );
}

function EnumControl({ param, disabled }: ParamControlProps) {
  const { config, update } = useRecommenderParams();
  const current = config[param.key] as LibraryPreference;

  return (
    <div className="flex rounded-lg border-2 border-black overflow-hidden shadow-cartoon-sm">
      {(param.options ?? []).map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => update(param.key, option.value)}
          className={`flex-1 px-2 py-1 text-xs font-bold transition-colors ${
            current === option.value
              ? "bg-amber-300 text-black"
              : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-gray-700"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function TagsControl({ param, disabled }: ParamControlProps) {
  const { config, update } = useRecommenderParams();
  const tags = (config[param.key] as string[]) ?? [];

  if (disabled) {
    return (
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {tags.length} tags
      </span>
    );
  }
  return (
    <TagListEditor
      tags={tags}
      onTagsChange={(next) => update(param.key, next)}
    />
  );
}

function NumberControl({ param, variant, disabled }: ParamControlProps) {
  const { config, update } = useRecommenderParams();
  const value = Number(config[param.key] ?? 0);
  const max = effectiveMax(param, config);

  return (
    <input
      type="number"
      aria-label={param.label}
      value={value}
      min={param.min}
      max={max}
      step={param.step ?? 1}
      disabled={disabled}
      onChange={(e) => {
        const parsed = Number(e.target.value);
        if (Number.isNaN(parsed)) return;
        update(param.key, clamp(parsed, param.min, max));
      }}
      className={`${NUMBER_CLASS} ${variant === "inline" ? "w-20" : "w-full sm:w-xs"}`}
    />
  );
}

/**
 * One knob, rendered by kind. The same control serves the canvas and the list, so a knob
 * cannot behave differently depending on which view someone happened to open.
 */
export default function ParamControl(props: ParamControlProps) {
  switch (props.param.kind) {
    case "boolean":
      return <BooleanControl {...props} />;
    case "enum":
      return <EnumControl {...props} />;
    case "tags":
      return <TagsControl {...props} />;
    default:
      return <NumberControl {...props} />;
  }
}

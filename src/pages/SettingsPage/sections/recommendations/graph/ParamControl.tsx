import { effectiveMax } from "./paramCoupling";
import { useRecommenderParams } from "./paramsContext";
import { durationUnit, humanizeDuration } from "./duration";
import TagListEditor from "../TagListEditor";
import type { DurationKind } from "./duration";
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

const SLIDER_CLASS =
  "h-2 cursor-pointer appearance-none rounded-full border-2 border-black bg-gray-200 dark:bg-gray-700 accent-amber-400 disabled:opacity-50 disabled:cursor-not-allowed";

const ASIDE_CLASS = "text-xs text-gray-500 dark:text-gray-400";

const PERCENT_CLASS =
  "shrink-0 text-xs font-bold tabular-nums text-gray-700 dark:text-gray-300";

const END_NAME_CLASS =
  "text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400";

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
 * A share of one, set and read as a percentage. The stored value stays the fraction the
 * pipeline actually multiplies by: asking an admin to type 0.4 for "40% of the slots" is
 * making them do the conversion the control exists to do.
 */
function RatioControl({ param, variant, disabled }: ParamControlProps) {
  const { config, update } = useRecommenderParams();
  const value = Number(config[param.key] ?? 0);
  const min = param.min ?? 0;
  const max = effectiveMax(param, config) ?? 1;

  return (
    <span
      className={
        variant === "inline"
          ? "inline-flex items-center gap-2"
          : "flex w-full items-center gap-2 sm:max-w-xs"
      }
    >
      <input
        type="range"
        aria-label={param.label}
        value={value}
        min={min}
        max={max}
        step={param.step ?? 0.05}
        disabled={disabled}
        onChange={(e) =>
          update(param.key, clamp(Number(e.target.value), min, max))
        }
        className={`${SLIDER_CLASS} ${variant === "inline" ? "w-20" : "flex-1"}`}
      />
      <span className={`w-9 text-right ${PERCENT_CLASS}`}>
        {Math.round(value * 100)}%
      </span>
    </span>
  );
}

/**
 * One value read from both ends. A knob that divides a quantity between two named things is
 * still one setting, so it gets one control: a second slider for the other side would have
 * to fight the first, and a lone fraction leaves the reader working out what it was taken
 * from. Naming both ends is what makes the number mean something without the formula.
 */
function SplitControl({ param, variant, disabled }: ParamControlProps) {
  const { config, update } = useRecommenderParams();
  const value = Number(config[param.key] ?? 0);
  const min = param.min ?? 0;
  const max = effectiveMax(param, config) ?? 1;
  const ends = param.ends;
  const high = Math.round(value * 100);

  return (
    <span
      className={`flex w-full flex-col gap-0.5 ${variant === "block" ? "sm:max-w-xs" : ""}`}
    >
      <span className={`flex justify-between gap-2 ${END_NAME_CLASS}`}>
        <span>{ends?.low}</span>
        <span>{ends?.high}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className={`w-9 text-right ${PERCENT_CLASS}`}>{100 - high}%</span>
        <input
          type="range"
          aria-label={param.label}
          aria-valuetext={`${100 - high}% ${ends?.low}, ${high}% ${ends?.high}`}
          value={value}
          min={min}
          max={max}
          step={param.step ?? 0.05}
          disabled={disabled}
          onChange={(e) =>
            update(param.key, clamp(Number(e.target.value), min, max))
          }
          className={`${SLIDER_CLASS} flex-1`}
        />
        <span className={`w-9 ${PERCENT_CLASS}`}>{high}%</span>
      </span>
    </span>
  );
}

/**
 * A count of minutes or days, with the unit named and, past the point where the raw number
 * stops being readable, the same span said in units someone can picture.
 */
function DurationControl(props: ParamControlProps & { kind: DurationKind }) {
  const { config } = useRecommenderParams();
  const { kind } = props;
  const value = Number(config[props.param.key] ?? 0);
  const humanized = humanizeDuration(value, kind);

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <NumberControl {...props} />
      {props.variant === "block" && (
        <span className={ASIDE_CLASS}>{durationUnit(value, kind)}</span>
      )}
      {humanized && <span className={ASIDE_CLASS}>({humanized})</span>}
    </span>
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
    case "ratio":
      return <RatioControl {...props} />;
    case "split":
      return <SplitControl {...props} />;
    case "days":
    case "minutes":
      return <DurationControl {...props} kind={props.param.kind} />;
    default:
      return <NumberControl {...props} />;
  }
}

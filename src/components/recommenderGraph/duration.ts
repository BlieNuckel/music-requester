import type { ParamKind } from "@shared/recommenderGraph";

export type DurationKind = Extract<ParamKind, "days" | "minutes">;

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
const DAYS_PER_YEAR = 365;
const DAYS_PER_MONTH = 30.44;

/** Below these a raw count is already the clearest reading of itself. */
const MINUTES_HINT_FLOOR = 120;
const DAYS_HINT_FLOOR = 60;

const plural = (count: number, unit: string): string =>
  `${count} ${unit}${count === 1 ? "" : "s"}`;

function humanizeMinutes(total: number): string | null {
  if (total < MINUTES_HINT_FLOOR) return null;

  const days = Math.floor(total / MINUTES_PER_DAY);
  const hours = Math.floor((total % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const minutes = total % MINUTES_PER_HOUR;

  const parts: string[] = [];
  if (days > 0) parts.push(plural(days, "day"));
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  return parts.join(" ");
}

/**
 * Months are approximate and say so. A year is only claimed when the number divides into
 * whole ones, because "1 year" for 360 days is the kind of rounding that makes someone
 * distrust every other number on the page.
 */
function humanizeDays(total: number): string | null {
  if (total < DAYS_HINT_FLOOR) return null;
  if (total % DAYS_PER_YEAR === 0) {
    return plural(total / DAYS_PER_YEAR, "year");
  }
  return `≈ ${plural(Math.round(total / DAYS_PER_MONTH), "month")}`;
}

/**
 * The same quantity in units a person reads at a glance, or null when the raw number
 * already is one. Knobs measured in minutes run to five figures, and 43200 is not a number
 * anyone reads as thirty days — naming the unit does not fix that on its own.
 */
export function humanizeDuration(
  value: number,
  kind: DurationKind
): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return kind === "minutes" ? humanizeMinutes(value) : humanizeDays(value);
}

/** The unit word for a labelled field, agreeing with the number in front of it. */
export function durationUnit(value: number, kind: DurationKind): string {
  const unit = kind === "minutes" ? "minute" : "day";
  return `${unit}${value === 1 ? "" : "s"}`;
}

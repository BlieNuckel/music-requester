import type {
  SectionDefinition,
  SectionSpan,
  SectionStatus,
  SectionStatusMap,
} from "./types";

export type ResolvedSection = {
  definition: SectionDefinition;
  hidden: boolean;
};

const COL_SPAN_CLASSES: Record<SectionSpan["cols"], string> = {
  2: "lg:col-span-2",
  4: "lg:col-span-4",
  6: "lg:col-span-6",
};

const ROW_SPAN_CLASSES: Record<SectionSpan["rows"], string> = {
  1: "lg:row-span-1",
  2: "lg:row-span-2",
};

const MOBILE_ORDER_CLASS = "max-lg:[order:var(--order-mobile)]";

/**
 * A slot is a hard boundary at desktop sizes. Tiles are given a fixed height by
 * the grid, so anything taller has to be contained rather than allowed to spill
 * over the tile next to it.
 */
const SLOT_BOUNDS_CLASS = "lg:min-h-0 lg:overflow-hidden";

function isSectionHidden(
  definition: SectionDefinition,
  status: SectionStatus
): boolean {
  return (
    definition.whenEmpty === "hide" &&
    (status === "empty" || status === "error")
  );
}

/**
 * Resolve the section registry against reported statuses into an ordered,
 * visibility-resolved list. DOM order follows desktopOrder; mobile order is
 * applied separately via CSS (see sectionSlotClasses).
 */
export function resolveLayout(
  definitions: readonly SectionDefinition[],
  statuses: SectionStatusMap
): ResolvedSection[] {
  return [...definitions]
    .sort((a, b) => a.desktopOrder - b.desktopOrder)
    .map((definition) => ({
      definition,
      hidden: isSectionHidden(definition, statuses[definition.id] ?? "loading"),
    }));
}

/**
 * Grid classes for a section slot. Hidden tiles stay mounted (so their data
 * hooks survive and can recover) but are removed from the visual grid.
 */
export function sectionSlotClasses(
  definition: SectionDefinition,
  hidden: boolean
): string {
  if (hidden) return "hidden";
  return [
    COL_SPAN_CLASSES[definition.span.cols],
    ROW_SPAN_CLASSES[definition.span.rows],
    MOBILE_ORDER_CLASS,
    SLOT_BOUNDS_CLASS,
  ].join(" ");
}

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
  3: "lg:row-span-3",
  4: "lg:row-span-4",
  5: "lg:row-span-5",
  6: "lg:row-span-6",
};

const MOBILE_ORDER_CLASS = "max-lg:[order:var(--order-mobile)]";

/**
 * A slot is a hard boundary at desktop sizes. Tiles are given a fixed height by
 * the grid, so anything taller has to be contained rather than allowed to spill
 * over the tile next to it.
 *
 * Clipping happens at the padding box, so the slot insets its widget on the two
 * shadowed sides by the shadow's reach. Without that inset the widget's box ends
 * exactly where the clip does and the drop shadow is shaved off.
 */
const SLOT_BOUNDS_CLASS =
  "lg:min-h-0 lg:overflow-hidden lg:pr-[var(--bento-shadow-reach)] lg:pb-[var(--bento-shadow-reach)]";

function isSectionHidden(
  definition: SectionDefinition,
  status: SectionStatus
): boolean {
  if (status === "error") {
    return (definition.whenError ?? definition.whenEmpty) === "hide";
  }
  return definition.whenEmpty === "hide" && status === "empty";
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

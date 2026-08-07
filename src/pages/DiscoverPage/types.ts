import type { ComponentType } from "react";

/** Unique key for a Discover section. Extend this union when adding a section. */
export type SectionId = "spotlight" | "artists" | "newReleases";

/** Data lifecycle a section reports to the grid. */
export type SectionStatus = "loading" | "ready" | "empty" | "error";

/** Statuses by section id; sections that have not reported yet are treated as "loading". */
export type SectionStatusMap = Partial<Record<SectionId, SectionStatus>>;

/** Tile size on the 6-column desktop grid. Mobile is always a single column. */
export type SectionSpan = {
  cols: 2 | 4 | 6;
  rows: 1 | 2;
};

/** Props every section component receives from its grid slot. */
export type SectionComponentProps = {
  /** Report the section's data lifecycle so the grid can resolve tile visibility. */
  onStatusChange: (status: SectionStatus) => void;
};

/**
 * One entry in the Discover section registry. Adding a section means adding
 * its id to {@link SectionId}, writing a component that fulfils
 * {@link SectionComponentProps}, and appending one of these to
 * `SECTION_DEFINITIONS`.
 */
export type SectionDefinition = {
  id: SectionId;
  span: SectionSpan;
  /** Position in the desktop grid flow (lower renders earlier). */
  desktopOrder: number;
  /** Position in the mobile stack, independent of desktop order. */
  mobileOrder: number;
  /**
   * "hide" removes the tile when the section reports empty or error;
   * "keep" leaves the tile visible so the section renders its own fallback.
   */
  whenEmpty: "hide" | "keep";
  Component: ComponentType<SectionComponentProps>;
};

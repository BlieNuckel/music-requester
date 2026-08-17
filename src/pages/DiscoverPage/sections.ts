import ArtistsSection from "./components/sections/ArtistsSection";
import LiveBannerSection from "./components/sections/LiveBannerSection";
import NearbyShowsSection from "./components/sections/NearbyShowsSection";
import SpotlightSection from "./components/sections/SpotlightSection";
import NewReleasesSection from "./components/sections/NewReleasesSection";
import type { SectionDefinition } from "./types";

/**
 * The Discover page section registry — the single place to add, remove,
 * resize, or reorder sections. Spans target the 6-column desktop grid;
 * mobileOrder controls the single-column stack independently.
 *
 * Grid rows are a fixed height, so a span is a contract: a tile gets exactly the
 * rows it asks for and no more. The unit is small on purpose, so a one-line
 * widget can be one row while a shelf takes three. See {@link SectionSpan}.
 */
export const SECTION_DEFINITIONS: readonly SectionDefinition[] = [
  {
    id: "liveBanner",
    span: { cols: 6, rows: 1 },
    desktopOrder: 1,
    mobileOrder: 1,
    whenEmpty: "hide",
    Component: LiveBannerSection,
  },
  {
    id: "spotlight",
    span: { cols: 4, rows: 5 },
    desktopOrder: 2,
    mobileOrder: 2,
    whenEmpty: "hide",
    Component: SpotlightSection,
  },
  {
    id: "artists",
    span: { cols: 2, rows: 5 },
    desktopOrder: 3,
    mobileOrder: 4,
    whenEmpty: "hide",
    Component: ArtistsSection,
  },
  {
    id: "newReleases",
    span: { cols: 4, rows: 2 },
    desktopOrder: 4,
    mobileOrder: 3,
    whenEmpty: "hide",
    Component: NewReleasesSection,
  },
  {
    id: "nearbyShows",
    span: { cols: 2, rows: 4 },
    desktopOrder: 5,
    mobileOrder: 5,
    whenEmpty: "hide",
    Component: NearbyShowsSection,
  },
];

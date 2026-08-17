/**
 * JamBase v3 returns Schema.org-flavoured JSON. These types cover the subset the
 * app reads; everything downstream consumes the normalized shapes instead.
 */

export type JambasePagination = {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages?: number;
};

export type JambaseGeo = {
  latitude?: number | string | null;
  longitude?: number | string | null;
};

export type JambaseAddress = {
  addressLocality?: string | null;
  addressCountry?: string | { identifier?: string; name?: string } | null;
};

export type JambaseVenue = {
  "@type"?: string;
  name?: string | null;
  identifier?: string | null;
  address?: JambaseAddress | null;
  geo?: JambaseGeo | null;
};

export type JambasePerformer = {
  "@type"?: string;
  name?: string | null;
  identifier?: string | null;
  genre?: string[] | null;
  "x-numUpcomingEvents"?: number | null;
  "x-isHeadliner"?: boolean | null;
  "x-performanceRank"?: number | null;
};

export type JambaseOffer = {
  url?: string | null;
  availability?: string | null;
};

/**
 * `deletionStatus` marks a tombstone row rather than an event. Tombstones only
 * appear on `dateModifiedFrom` responses and carry almost no other fields.
 */
export type JambaseEvent = {
  "@type"?: string;
  name?: string | null;
  identifier?: string | null;
  url?: string | null;
  image?: string | null;
  eventStatus?: string | null;
  startDate?: string | null;
  previousStartDate?: string | null;
  location?: JambaseVenue | null;
  performer?: JambasePerformer[] | JambasePerformer | null;
  offers?: JambaseOffer[] | JambaseOffer | null;
  deletionStatus?: string | null;
  deletedAt?: string | null;
  mergedInto?: string | null;
};

export type JambaseEventsResponse = {
  success?: boolean;
  pagination?: JambasePagination;
  events?: JambaseEvent[];
};

export type JambaseArtist = {
  "@type"?: string;
  name?: string | null;
  identifier?: string | null;
  genre?: string[] | null;
  "x-numUpcomingEvents"?: number | null;
  events?: JambaseEvent[] | null;
};

export type JambaseArtistResponse = {
  success?: boolean;
  artist?: JambaseArtist | null;
};

export type EventSearchParams = {
  page?: number;
  perPage?: number;
  artistIds?: readonly string[];
  countries?: readonly string[];
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  dateFrom?: string;
  dateTo?: string;
  dateModifiedFrom?: string;
};

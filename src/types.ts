export interface ReleaseGroup {
  id: string;
  score: number;
  title: string;
  "primary-type": string;
  "first-release-date": string;
  "artist-credit": Array<{
    name: string;
    artist: { id: string; name: string };
  }>;
  "secondary-types"?: string[];
}

export interface ArtistDetails {
  mbid: string;
  name: string;
  disambiguation?: string;
  type?: string;
  country?: string;
  imageUrl?: string;
}

export interface ArtistSearchResult {
  mbid: string;
  name: string;
  disambiguation?: string;
  type?: string;
  country?: string;
  imageUrl?: string;
}

export interface AlbumLabel {
  name: string;
  mbid: string;
}

export interface AlbumDetails {
  mbid: string;
  title: string;
  artistName: string;
  artistMbid: string | null;
  firstReleaseDate: string | null;
  primaryType: string | null;
  secondaryTypes: string[];
}

export interface Track {
  position: number;
  title: string;
  length: number | null;
  previewUrl?: string;
}

export interface Medium {
  position: number;
  format: string;
  title: string;
  tracks: Track[];
}

export type RequestStatus = "pending" | "approved" | "declined";

export interface RequestUser {
  id: number;
  username: string;
  thumb: string | null;
}

export type LidarrLifecycleStatus =
  "downloading" | "wanted" | "imported" | "failed";

export interface LidarrLifecycle {
  status: LidarrLifecycleStatus | null;
  downloadProgress: number | null;
  quality: string | null;
  sourceIndexer: string | null;
  lastEvent: { eventType: number; date: string } | null;
  lidarrAlbumId: number | null;
}

export interface RequestItem {
  id: number;
  albumMbid: string;
  artistName: string | null;
  albumTitle: string | null;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  user: RequestUser | null;
  lidarr: LidarrLifecycle | null;
}

export interface WantedItem {
  id: number;
  albumMbid: string;
  artistName: string;
  albumTitle: string;
  createdAt: string;
}

export interface PurchaseItem {
  id: number;
  albumMbid: string;
  artistName: string;
  albumTitle: string;
  price: number;
  currency: string;
  purchasedAt: string;
}

export interface SpendingSummary {
  month: number;
  allTime: number;
  albumCount: number;
}

export type MonitorState =
  "idle" | "adding" | "success" | "already_monitored" | "error";

export interface FollowedArtistItem {
  id: number;
  artistMbid: string;
  artistName: string;
  lastCheckedAt: string | null;
  createdAt: string;
}

export type NewReleaseSource = "followed" | "library" | "similar";

export type NewReleaseLidarrStatus = "downloading" | "wanted" | "imported";

export interface NewReleaseItem {
  releaseGroupMbid: string | null;
  title: string;
  artistName: string;
  artistMbid: string | null;
  releaseDate: string | null;
  source: NewReleaseSource;
  coverUrl: string | null;
  lidarrStatus: NewReleaseLidarrStatus | null;
  followedReleaseId: number | null;
}

export interface NewReleasesData {
  items: NewReleaseItem[];
  windowDays: number;
}

export interface FollowedReleaseItem {
  id: number;
  followedArtistId: number;
  artistMbid: string;
  artistName: string;
  releaseKey: string;
  albumTitle: string;
  releaseDate: string | null;
  releaseGroupMbid: string | null;
  coverUrl: string | null;
  viewedAt: string | null;
  notifiedAt: string;
}

export type LiveEventStatus =
  "scheduled" | "rescheduled" | "postponed" | "cancelled";

export type LiveEventResponse = "going" | "dismissed";

export type LiveDistanceTier = "local" | "regional" | "out-of-scope";

export type LiveNoticeReason =
  "status-changed" | "just-announced" | "coming-up";

export interface LiveEventPerformerSummary {
  jambaseId: string;
  name: string;
  isHeadliner: boolean;
}

export interface LiveEventSummary {
  id: number;
  eventKey: string;
  name: string;
  eventDate: string;
  previousStartDate: string | null;
  status: LiveEventStatus;
  statusChangedAt: string | null;
  venueName: string | null;
  venueCity: string | null;
  venueCountry: string | null;
  ticketUrl: string | null;
  imageUrl: string | null;
  distanceKm: number | null;
  performers: LiveEventPerformerSummary[];
  response: LiveEventResponse | null;
  viewedAt: string | null;
}

export interface LiveNotice extends LiveEventSummary {
  tier: LiveDistanceTier;
  reason: LiveNoticeReason;
}

export interface LiveNoticeData {
  notice: LiveNotice | null;
  additionalCount: number;
}

export const LISTENBRAINZ_LABS_BASE = "https://labs.api.listenbrainz.org";

export const LISTENBRAINZ_API_BASE = "https://api.listenbrainz.org";

/**
 * Session-based collaborative similarity: artists frequently played in the same
 * listening sessions. Crosses genres while preserving "vibe", unlike tag-based
 * similarity.
 */
export const DEFAULT_SIMILAR_ARTISTS_ALGORITHM =
  "session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30";

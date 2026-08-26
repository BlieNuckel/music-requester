import type { ParamDef } from "../../shared/recommenderGraph";
import type { PromotedAlbumSettings } from "../../shared/settingsDefaults";

export type ParamKey = keyof PromotedAlbumSettings;

/**
 * Every recommender knob, declared once: what it is called, what it may be set to, the
 * sentence it appears in, and what it does at length.
 *
 * This is the single source the settings UI renders from. Before it existed, a knob meant
 * five hand-synced declarations (type, default, validator, config hash, form field), and
 * the config-hash one silently decided whether stored profiles regenerate.
 */
export const PARAMS: Record<ParamKey, ParamDef> = {
  ratingsBackupEnabled: {
    key: "ratingsBackupEnabled",
    kind: "boolean",
    label: "Back up Plex ratings and play counts daily",
    description:
      "Once a day, tunearr records each user's Plex star ratings and per-artist play counts into its own database, so your taste data survives a Plex history clear, re-import, or server migration. Single-instance only.",
  },

  playTrendWindowDays: {
    key: "playTrendWindowDays",
    kind: "days",
    label: "Play trend window",
    min: 1,
    max: 365,
    step: 1,
    formula: "listening in the last {playTrendWindowDays} days",
    description:
      "Recommendations weight artists by listening within this many recent days, taken from the episode log where it reaches and from snapshot diffs before that. Until either series is this deep, all-time totals are used.",
  },
  listeningWeight: {
    key: "listeningWeight",
    kind: "split",
    label: "Listening time vs plays",
    min: 0,
    max: 1,
    step: 0.05,
    ends: { low: "plays", high: "listening time" },
    description:
      "What counts as listening to an artist more. All the way to listening time it ranks by time spent, so an hour-long DJ set outweighs a three-minute single played once. All the way to plays it ranks by play count, so twenty plays of one short track outweigh one long set. Plays measure how often you chose it again; time measures how much of your listening it filled.",
  },
  maxTrackMinutesForWeight: {
    key: "maxTrackMinutesForWeight",
    kind: "int",
    label: "Maximum minutes per play",
    min: 0,
    max: 240,
    step: 5,
    formula: "one play is worth at most {maxTrackMinutesForWeight} min",
    description:
      "Ceiling on how much listening time a single play can be worth. 0 is uncapped and is usually right: a low cap re-creates the under-counting of long tracks it is meant to fix. Raise it off 0 only if skipping through long mixes is inflating an artist.",
  },

  distributionWeight: {
    key: "distributionWeight",
    kind: "ratio",
    label: "One-hit discount",
    min: 0,
    max: 1,
    step: 0.05,
    formula:
      "weight x (1 - {distributionWeight} x top track share x (1 - rating breadth))",
    description:
      "How much to discount an artist whose listening all sits on one track, so a single song on repeat doesn't count as liking the whole artist. 0% ignores how listening is spread; 50% halves the weight of an artist you only play one track by. Ratings spread across the catalogue push the discount back down.",
  },
  minPlaysForDistribution: {
    key: "minPlaysForDistribution",
    kind: "int",
    label: "Minimum plays for the discount",
    min: 1,
    max: 100,
    step: 1,
    formula: "only below {minPlaysForDistribution} plays is it left alone",
    description:
      "Artists below this many plays in the trend window keep their full weight. At a handful of plays, how they are spread is noise rather than a preference.",
  },
  minAvailableTracksForDistribution: {
    key: "minAvailableTracksForDistribution",
    kind: "int",
    label: "Small catalogue exemption",
    min: 0,
    max: 50,
    step: 1,
    formula: "exempt at {minAvailableTracksForDistribution} tracks or fewer",
    description:
      "Artists with this many tracks or fewer in your library keep their full weight. Playing one of their two tracks isn't a one-hit habit, there was nothing else to play. 0 turns the exemption off.",
  },

  ratingWeight: {
    key: "ratingWeight",
    kind: "factor",
    label: "Rating weight",
    min: 0,
    max: 3,
    step: 0.1,
    formula: "weight x (1 + {ratingWeight} x stars/10)",
    description:
      "How much your Plex star ratings boost an artist's weight. At 0 ratings are ignored; at 0.5 a five-star artist gets +50% weight. The rating is a play-weighted mean, so a star on the track carrying the listening outweighs one on a deep cut.",
  },

  seriesBucketDays: {
    key: "seriesBucketDays",
    kind: "days",
    label: "Series bucket width",
    min: 1,
    max: 31,
    step: 1,
    formula: "one bucket = {seriesBucketDays} days",
    description:
      "How wide one point on an artist's listening-over-time series is. 7 smooths day-to-day noise into a weekly rhythm; 1 shows every day but makes a quiet week look like a collapse.",
  },
  seriesSpanDays: {
    key: "seriesSpanDays",
    kind: "days",
    label: "Series span",
    min: 7,
    max: 730,
    step: 7,
    formula: "over the last {seriesSpanDays} days",
    description:
      "How far back that series runs. It can only show listening tunearr has a record of, so a span longer than your Plex history simply starts empty rather than being wrong.",
  },
  momentumRecentBuckets: {
    key: "momentumRecentBuckets",
    kind: "int",
    label: "Momentum window",
    min: 1,
    max: 26,
    step: 1,
    formula: "last {momentumRecentBuckets} buckets vs the ones before",
    description:
      "How many recent buckets count as 'now' when deciding an artist is rising or fading. Each artist is compared against its own earlier buckets, so a small artist doubling registers as strongly as a big one. Fewer buckets reacts faster and mistakes a busy week for a trend.",
  },

  topArtistsCount: {
    key: "topArtistsCount",
    kind: "int",
    label: "Top artists",
    min: 1,
    max: 50,
    step: 1,
    formula: "keep the top {topArtistsCount} artists",
    description:
      "How many of your most-played artists the profile covers. Tags are fetched for all of them, and every recommendation draws from the whole set.",
  },
  tagsPerArtist: {
    key: "tagsPerArtist",
    kind: "int",
    label: "Tags kept",
    min: 1,
    max: 20,
    step: 1,
    formula: "keep {tagsPerArtist} tags each",
    description:
      "Maximum number of genre tags kept per artist and per album, after generic tags are filtered out.",
  },
  genericTags: {
    key: "genericTags",
    kind: "tags",
    label: "Generic tags",
    description:
      "Tags that describe the listener rather than the music ('seen live', 'favorites'). They are dropped wherever tags are read: artist tags, album tags, and the genre sets the explore and personal bands are compared on.",
  },
  albumTagsPerArtist: {
    key: "albumTagsPerArtist",
    kind: "int",
    label: "Album tag lookups per artist",
    min: 0,
    max: 20,
    step: 1,
    formula: "{albumTagsPerArtist} albums per artist get a Last.fm lookup",
    description:
      "Genre is read from the album rather than the artist, so an acoustic or live record stops dragging a whole artist into the wrong tag. This is how many of each artist's albums get the richer Last.fm tags, most-listened first; the rest use the genres Plex already has. Set to 0 to use Plex genres only.",
  },

  exploreCandidateCount: {
    key: "exploreCandidateCount",
    kind: "int",
    label: "Candidates per seed",
    min: 1,
    max: 50,
    step: 1,
    formula: "{exploreCandidateCount} similar artists per seed",
    description:
      "How many similar artists are stored per seed artist when the graph is built. Both the explore and the personal band draw from these, so a larger number widens both.",
  },

  profileTtlMinutes: {
    key: "profileTtlMinutes",
    kind: "minutes",
    label: "Taste profile lifetime",
    min: 0,
    max: 10080,
    step: 60,
    formula: "reuse for {profileTtlMinutes} min",
    description:
      "How long your derived taste profile is reused before the expensive Plex and Last.fm rebuild runs again. Longer is cheaper; shorter tracks taste changes faster.",
  },
  backgroundRegenEnabled: {
    key: "backgroundRegenEnabled",
    kind: "boolean",
    label: "Keep taste profiles warm in the background",
    description:
      "Periodically rebuilds stale profiles for recently-active users so no request waits on the rate-limited rebuild. Single-instance only.",
  },
  backgroundRegenIntervalMinutes: {
    key: "backgroundRegenIntervalMinutes",
    kind: "minutes",
    label: "Refresh interval",
    min: 5,
    max: 1440,
    step: 5,
    formula: "check every {backgroundRegenIntervalMinutes} min",
    description: "How often the background refresh checks for stale profiles.",
  },
  backgroundRegenActiveWithinMinutes: {
    key: "backgroundRegenActiveWithinMinutes",
    kind: "minutes",
    label: "Active user window",
    min: 60,
    max: 43200,
    step: 60,
    formula: "seen in the last {backgroundRegenActiveWithinMinutes} min",
    description:
      "Only refresh profiles for users who viewed recommendations within this window, so dormant accounts don't burn Plex and Last.fm quota.",
  },

  explorationRate: {
    key: "explorationRate",
    kind: "ratio",
    label: "Exploration mix",
    min: 0,
    max: 1,
    step: 0.05,
    formula: "{explorationRate} of the slots try a genre jump",
    description:
      "What share of each set of recommendations breaks out of your usual genres rather than staying next to what you already play. This is a quota over the whole set, not a coin flip per album: 40% of five recommendations means two genre jumps every time. 0% never explores; 100% always tries.",
  },
  genreOverlapThreshold: {
    key: "genreOverlapThreshold",
    kind: "ratio",
    label: "Genre difference threshold",
    min: 0,
    max: 1,
    step: 0.05,
    formula: "overlap at or below {genreOverlapThreshold} is a genre jump",
    description:
      "Where the line between the two bands falls. A similar artist sharing less genre overlap than this counts as a genre jump and belongs to explore; one sharing more is treated as next to your taste and belongs to the personal band. Nothing is discarded either way: the same line splits the graph in two.",
  },
  pickedArtistsCount: {
    key: "pickedArtistsCount",
    kind: "int",
    label: "Artists per recommendation",
    min: 1,
    max: 50,
    maxFrom: "topArtistsCount",
    step: 1,
    formula: "draw {pickedArtistsCount} artists",
    description:
      "How many artists shape a single recommendation, drawn fresh each time and weighted by play count. Lower is more focused per recommendation; higher blends more of your taste into each one.",
  },
  deepPageMin: {
    key: "deepPageMin",
    kind: "int",
    label: "Deep page min",
    min: 1,
    max: 50,
    step: 1,
    formula: "page 1 plus a random page {deepPageMin}",
    description:
      "Lowest chart page the second album pool may come from. Page 1 is the famous records of a tag; deeper pages are where anything unfamiliar lives.",
  },
  deepPageMax: {
    key: "deepPageMax",
    kind: "int",
    label: "Deep page max",
    min: 1,
    max: 50,
    step: 1,
    formula: "to {deepPageMax}",
    description:
      "Highest chart page the second album pool may come from. Too deep and the tag stops describing the albums on it.",
  },
  libraryPreference: {
    key: "libraryPreference",
    kind: "enum",
    label: "Library preference",
    options: [
      { value: "prefer_new", label: "Prefer new" },
      { value: "prefer_library", label: "Prefer library" },
      { value: "no_preference", label: "No preference" },
    ],
    description:
      "Whether to favour albums by artists you don't have yet, artists already in your library, or neither. Nothing is excluded: the preferred side is simply tried first, and a recommendation you already own beats no recommendation.",
  },

  cacheDurationMinutes: {
    key: "cacheDurationMinutes",
    kind: "minutes",
    label: "Carousel lifetime",
    min: 0,
    max: 120,
    step: 5,
    formula: "hold for {cacheDurationMinutes} min",
    description:
      "How long a built set of recommendations is served before a new one is picked. The background warmer rebuilds on the same clock, so an active user rarely waits for a build. 0 disables caching.",
  },
};

export const PARAM_KEYS = Object.keys(PARAMS) as ParamKey[];

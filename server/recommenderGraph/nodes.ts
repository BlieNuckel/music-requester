import type {
  EdgeKind,
  FlowId,
  NodeKind,
  NodeScope,
  NodeStatus,
  RetiredParam,
} from "../../shared/recommenderGraph";
import { PARAMS } from "./params";
import type { ParamKey } from "./params";

export type NodeInput = {
  from: string;
  kind: EdgeKind;
  label?: string;
  /** Priority among the fallback inputs of one node, lowest first. */
  order?: number;
};

export type NodeRegistration = {
  id: string;
  title: string;
  scope: NodeScope;
  kind: NodeKind;
  summary: string;
  flow: FlowId;
  /** Omitted for a node the recommender already runs; see {@link NodeStatus}. */
  status?: NodeStatus;
  /** Repo-relative file holding this node's body, where one has been written. */
  module?: string;
  inputs: NodeInput[];
  /** Knobs this node owns. Every knob is owned exactly once; see `graph.test.ts`. */
  params?: ParamKey[];
  /** Knobs owned elsewhere that also change what this node does. */
  usesParams?: ParamKey[];
  spendsBudget?: boolean;
  /**
   * The aside a card carries under its summary. Required on repeat, fallback and quota
   * nodes, where the structure is the meaning; optional elsewhere.
   */
  note?: string;
};

const data = (from: string, label?: string): NodeInput => ({
  from,
  kind: "data",
  label,
});

const control = (from: string, label?: string): NodeInput => ({
  from,
  kind: "control",
  label,
});

const fallback = (from: string, order: number, label?: string): NodeInput => ({
  from,
  kind: "fallback",
  order,
  label,
});

/**
 * The recommender, declared. Nodes carry no coordinates: the canvas lays each flow out from
 * the edges, which was decided in phase 1 by drawing it both ways. Authored positions lost,
 * and drawing all four flows on one canvas lost with them.
 *
 * Nothing here executes anything yet. Phase 2 gives these nodes bodies, at which point the
 * picture and the code stop being able to drift.
 */
export const NODE_REGISTRY: NodeRegistration[] = [
  {
    id: "plexCapture",
    title: "Daily Plex sweep",
    scope: "ingest",
    kind: "source",
    summary:
      "Reads ratings, per-track play counts, the album catalogue and Plex's own play history, and appends whatever changed.",
    flow: "ingestion",
    inputs: [],
    params: ["ratingsBackupEnabled"],
  },
  {
    id: "plexSessions",
    title: "Session poller",
    scope: "ingest",
    kind: "source",
    summary:
      "Watches live playback every few seconds to measure listening that was never committed as a play, such as a long set abandoned halfway.",
    flow: "ingestion",
    inputs: [],
    usesParams: ["ratingsBackupEnabled"],
  },
  {
    id: "signalLog",
    title: "Signal log",
    scope: "ingest",
    kind: "store",
    summary:
      "The append-only record of everything Plex has told us. Nothing is updated in place, so every series can be replayed as it stood at any past moment.",
    flow: "ingestion",
    inputs: [data("plexCapture"), data("plexSessions")],
  },

  {
    id: "loadSignals",
    title: "Load the series",
    scope: "profile",
    kind: "step",
    summary:
      "Reads the four series one rebuild needs, concurrently, and ingests on demand for a user who has never been captured. Raw rather than folded: the window and the listening series fold at cutoffs of their own and cannot work from current state.",
    flow: "profile",
    status: "ported",
    module: "server/services/profile/profileSignals.ts",
    inputs: [data("signalLog")],
  },
  {
    id: "foldToNow",
    title: "Fold to now",
    scope: "profile",
    kind: "step",
    summary:
      "Replays those series into current state — listening per track, the latest rating per item, Plex's own album genres — once, for everything that reads the log as it stands.",
    note: "The fold used to happen inside each consumer, so the play series alone was replayed about five times per rebuild and read from the database three times. One fold is the whole point of the node.",
    flow: "profile",
    status: "ported",
    module: "server/services/profile/profileSignals.ts",
    inputs: [data("loadSignals")],
    usesParams: ["maxTrackMinutesForWeight"],
  },
  {
    id: "listeningWindow",
    title: "Choose the window",
    scope: "profile",
    kind: "step",
    summary:
      "Settles the recent span, and measures the listening inside it as one row per track. The episode log answers where it reaches back that far, the difference of two folds answers before that, and all-time answers when neither reaches or nothing was played inside it.",
    note: "One decision and one measurement, read by everything downstream. Both series normalize into the same row here, so a rollup can no longer disagree with the weight it scales about which series the window came from.",
    flow: "profile",
    status: "ported",
    module: "server/services/profile/listeningWindow.ts",
    inputs: [
      data("loadSignals", "plays + episodes"),
      data("foldToNow", "all-time fallback"),
    ],
    params: ["playTrendWindowDays", "maxTrackMinutesForWeight"],
  },
  {
    id: "artistListening",
    title: "Listening per artist",
    scope: "profile",
    kind: "step",
    summary:
      "How much each artist was listened to over the window, and how that listening spread across their tracks — one rollup, so the spread necessarily describes the listening it will scale.",
    flow: "profile",
    status: "ported",
    module: "server/services/profile/artistWeighting.ts",
    inputs: [data("listeningWindow")],
    params: ["listeningWeight"],
  },
  {
    id: "artistRatings",
    title: "Ratings per artist",
    scope: "profile",
    kind: "step",
    summary:
      "Stars joined onto the listening they cover, as a play-weighted mean plus how many separate things the artist has rated. Counting what was rated rather than which track it was leaves the ratings independent of the spread.",
    flow: "profile",
    status: "ported",
    module: "server/services/profile/artistWeighting.ts",
    inputs: [data("foldToNow", "latest ratings"), data("listeningWindow")],
  },
  {
    id: "weightAdjust",
    title: "Adjust the weight",
    scope: "profile",
    kind: "step",
    summary:
      "Discounts an artist whose listening concentrates on one track, then boosts by how highly they are rated. Concentration is measured against spreading the same listening evenly, so one track played scores nothing and needs no catalogue lookup to be exempted.",
    note: "One node because the two terms are coupled: the discount is scaled by rating breadth so that starring an artist argues against the one-hit read. Drawn apart they read as independent, which is the thing people get wrong about them.",
    flow: "profile",
    status: "ported",
    module: "server/services/profile/artistWeighting.ts",
    inputs: [data("artistListening"), data("artistRatings")],
    params: ["distributionWeight", "minPlaysForDistribution", "ratingWeight"],
  },
  {
    id: "artistSeries",
    title: "Listening over time",
    scope: "profile",
    kind: "step",
    summary:
      "Per-artist listening bucketed into a series, and what its shape says: momentum, emergence, decay. Reads the raw series because it folds once per bucket boundary rather than once.",
    flow: "profile",
    inputs: [data("loadSignals")],
    params: ["seriesBucketDays", "seriesSpanDays", "momentumRecentBuckets"],
    usesParams: ["listeningWeight", "maxTrackMinutesForWeight"],
  },
  {
    id: "attachSeries",
    title: "Attach series signals",
    scope: "profile",
    kind: "step",
    summary:
      "Copies momentum, emergence and decay onto the weights. Deliberately does not fold them into the ranking: they are exposed for a picker to read.",
    flow: "profile",
    inputs: [data("weightAdjust"), data("artistSeries")],
  },
  {
    id: "topArtists",
    title: "Top artists",
    scope: "profile",
    kind: "step",
    summary: "The ranked head of the weight set, which the profile covers.",
    flow: "profile",
    inputs: [data("attachSeries")],
    params: ["topArtistsCount"],
  },
  {
    id: "artistTags",
    title: "Artist tags",
    scope: "profile",
    kind: "step",
    summary:
      "Last.fm tags for every top artist, generic ones dropped. Fetched for all of them rather than a sample, so the sample can be re-drawn per recommendation instead of being frozen into the profile.",
    flow: "profile",
    inputs: [data("topArtists")],
    params: ["tagsPerArtist", "genericTags"],
  },
  {
    id: "albumListening",
    title: "Listening per album",
    scope: "profile",
    kind: "step",
    summary:
      "The same window rolled up by album instead of by artist, off the same rows, carrying how many of the record's tracks were played.",
    flow: "profile",
    status: "ported",
    module: "server/services/profile/listeningWindow.ts",
    inputs: [data("listeningWindow")],
  },
  {
    id: "albumsByArtist",
    title: "Split weight across albums",
    scope: "profile",
    kind: "step",
    summary:
      "Each artist's weight divided across their records by how much each was listened to. The shares sum to the artist's weight, so moving genre down to the album divides influence rather than adding it.",
    flow: "profile",
    inputs: [data("topArtists"), data("albumListening")],
    usesParams: ["listeningWeight"],
  },
  {
    id: "albumTagLookups",
    title: "Album tag budget",
    scope: "profile",
    kind: "quota",
    summary:
      "Decides which albums are worth spending a Last.fm call on: the most-listened first, bounded per artist.",
    note: "A quota per artist, not a global top-N. One dominant artist would otherwise spend the whole allowance and leave every other artist's records resolving on Plex genres alone.",
    flow: "profile",
    inputs: [data("albumsByArtist")],
    params: ["albumTagsPerArtist"],
  },
  {
    id: "albumTags",
    title: "Resolve album genres",
    scope: "profile",
    kind: "step",
    summary:
      "Last.fm album tags first, then the Plex agent genre, then the artist's own tags. A source that yields no genre is skipped rather than accepted, and tags that are regions or eras are kept aside rather than counted as genres.",
    flow: "profile",
    inputs: [
      data("albumsByArtist"),
      data("albumTagLookups"),
      data("artistTags", "fallback source"),
      data("foldToNow", "Plex genres"),
    ],
    usesParams: ["genericTags", "tagsPerArtist"],
  },
  {
    id: "genreVector",
    title: "Genre vector",
    scope: "profile",
    kind: "step",
    summary:
      "Every album's tags summed into one weighted vector, each album contributing exactly its share. This is what the tag path draws from.",
    flow: "profile",
    inputs: [data("albumTags")],
  },
  {
    id: "similarGraph",
    title: "Similar-artist graph",
    scope: "profile",
    kind: "step",
    summary:
      "Each top artist resolved to MusicBrainz, its ListenBrainz neighbours fetched, and every neighbour genre-tagged. The expensive fan-out, done once per rebuild instead of per recommendation.",
    flow: "profile",
    inputs: [data("topArtists")],
    params: ["exploreCandidateCount"],
    usesParams: ["genericTags"],
  },
  {
    id: "knownAlbums",
    title: "Albums you already play",
    scope: "profile",
    kind: "step",
    summary:
      "Records played enough, across enough of their tracks, to count as ones the user knows — so recommendations stay off them. Plays alone marked a record known off one hit on repeat, which is the case most worth recommending.",
    flow: "profile",
    status: "ported",
    module: "server/services/profile/listeningWindow.ts",
    inputs: [data("foldToNow", "all-time plays")],
  },
  {
    id: "profileDocument",
    title: "Taste profile",
    scope: "profile",
    kind: "store",
    summary:
      "One persisted document per user. Every recommender reads this rather than Plex, and a change to any knob above invalidates it.",
    flow: "profile",
    inputs: [
      data("genreVector"),
      data("artistTags"),
      data("albumTags"),
      data("similarGraph"),
      data("attachSeries"),
      data("artistSeries", "stored buckets"),
      data("knownAlbums"),
    ],
  },

  {
    id: "profileFreshness",
    title: "Fresh enough?",
    scope: "serve",
    kind: "step",
    summary:
      "Serves the stored profile when it is fresh, and a stale one while a rebuild runs behind it. Only a user with nothing stored waits.",
    flow: "profile",
    inputs: [data("profileDocument")],
    params: ["profileTtlMinutes"],
  },
  {
    id: "regenPoller",
    title: "Background rebuild",
    scope: "serve",
    kind: "step",
    summary:
      "Rebuilds stale profiles off-request for users who have looked at recommendations recently, so nobody's page load pays for a rebuild.",
    flow: "profile",
    inputs: [control("profileFreshness", "stale + active")],
    params: [
      "backgroundRegenEnabled",
      "backgroundRegenIntervalMinutes",
      "backgroundRegenActiveWithinMinutes",
    ],
  },

  {
    id: "pickLoop",
    title: "Fill the carousel",
    scope: "pick",
    kind: "repeat",
    summary:
      "Builds five recommendations, adding each pick to an exclusion set so the next one differs.",
    note: "Runs up to 5 + 3 attempts. The three spares exist so a dead tag or a duplicate pick shortens the carousel by nothing.",
    flow: "spotlight",
    inputs: [data("profileFreshness")],
  },
  {
    id: "exploreQuota",
    title: "Explore slots",
    scope: "pick",
    kind: "quota",
    summary:
      "Decides up front how many of this set's slots attempt a genre jump.",
    note: "A quota over the whole build, not a coin flip per album. The fractional remainder stays a coin so the dial still means something for a single pick.",
    flow: "spotlight",
    inputs: [control("pickLoop")],
    params: ["explorationRate"],
  },

  {
    id: "exploreSeed",
    title: "Draw a seed",
    scope: "pick",
    kind: "step",
    summary:
      "Picks one of your artists from the graph, weighted by how much you play them.",
    flow: "spotlight",
    inputs: [control("exploreQuota", "explore slot"), data("similarGraph")],
  },
  {
    id: "exploreBand",
    title: "Genre-distant neighbours",
    scope: "pick",
    kind: "step",
    summary:
      "Keeps only the seed's neighbours in a genre it doesn't share, ranked by similarity.",
    flow: "spotlight",
    inputs: [data("exploreSeed")],
    params: ["genreOverlapThreshold"],
  },
  {
    id: "exploreAlbum",
    title: "Album from a distant artist",
    scope: "pick",
    kind: "step",
    summary:
      "Walks the ranked neighbours until one has an album worth recommending.",
    flow: "spotlight",
    inputs: [data("exploreBand")],
    spendsBudget: true,
  },

  {
    id: "personalCandidates",
    title: "Every neighbour",
    scope: "pick",
    kind: "step",
    summary:
      "Collapses the graph into one candidate set, each neighbour weighted by how much you play the seeds it came from times how strongly they are tied. Reachable from several seeds means stronger evidence.",
    flow: "spotlight",
    inputs: [control("pickLoop"), data("similarGraph")],
  },
  {
    id: "personalBand",
    title: "Close enough to your taste",
    scope: "pick",
    kind: "step",
    summary:
      "Keeps the neighbours on the near side of the same line explore reads from the far side, so the two modes partition the graph instead of competing for it. Widens to the whole graph when nothing is close enough.",
    flow: "spotlight",
    inputs: [data("personalCandidates")],
    usesParams: ["genreOverlapThreshold"],
  },
  {
    id: "personalPreference",
    title: "Library side",
    scope: "pick",
    kind: "step",
    summary:
      "Filters to the preferred side of the library line before the draw, so for someone who owns most of their graph an unowned neighbour can still surface. Relaxes when that side is empty.",
    flow: "spotlight",
    inputs: [data("personalBand")],
    params: ["libraryPreference"],
  },
  {
    id: "personalAlbum",
    title: "Album from a neighbour",
    scope: "pick",
    kind: "step",
    summary:
      "Draws up to three candidate artists and takes the first album that is a real album, dated, and not one you already play.",
    flow: "spotlight",
    inputs: [data("personalPreference"), data("knownAlbums")],
    spendsBudget: true,
  },

  {
    id: "artistSample",
    title: "Sample your artists",
    scope: "pick",
    kind: "step",
    summary:
      "Draws a few of your top artists, weighted by listening, re-rolled for every recommendation rather than fixed when the profile was built.",
    flow: "spotlight",
    inputs: [control("pickLoop"), data("artistTags")],
    params: ["pickedArtistsCount"],
  },
  {
    id: "pickVector",
    title: "This pick's genre vector",
    scope: "pick",
    kind: "step",
    summary:
      "Builds a vector from just the sampled artists' albums, so two picks in one set can come from different corners of your taste.",
    flow: "spotlight",
    inputs: [
      data("artistSample"),
      data("albumTags"),
      fallback("genreVector", 0, "no genres sampled"),
    ],
  },
  {
    id: "tagDraw",
    title: "Draw a genre",
    scope: "pick",
    kind: "step",
    summary: "Picks one tag from that vector, weighted by its weight.",
    flow: "spotlight",
    inputs: [data("pickVector")],
  },
  {
    id: "albumPool",
    title: "Tag album chart",
    scope: "pick",
    kind: "step",
    summary:
      "Fetches the tag's global chart: page one plus a random deeper page, so the pool is not only the famous records of that genre.",
    flow: "spotlight",
    inputs: [data("tagDraw")],
    params: ["deepPageMin", "deepPageMax"],
  },
  {
    id: "candidateWalk",
    title: "Walk the pool",
    scope: "pick",
    kind: "step",
    summary:
      "Visits candidates in library-preference order and takes the first that resolves, is a release type worth recommending, and hasn't been shown recently.",
    note: "When every qualifying candidate was shown recently, the walk repeats with the memory switched off: a repeat beats an empty slot, and the second pass is served from cache.",
    flow: "spotlight",
    inputs: [data("albumPool")],
    usesParams: ["libraryPreference"],
    spendsBudget: true,
  },

  {
    id: "sourceChain",
    title: "First source that answers",
    scope: "pick",
    kind: "fallback",
    summary:
      "Takes the first of the three sources to produce an album. The tag chart is last because it knows nothing about you past one tag string, and first only when no graph exists yet.",
    note: "Ordered, not parallel. Explore is tried only in an explore slot; personal is the default; the tag chart is the fallback.",
    flow: "spotlight",
    inputs: [
      fallback("exploreAlbum", 0, "explore slots"),
      fallback("personalAlbum", 1),
      fallback("candidateWalk", 2),
    ],
  },
  {
    id: "antiRepeat",
    title: "Remember what was shown",
    scope: "pick",
    kind: "step",
    summary:
      "Records the picks so the next builds avoid them, keeping the last 25 albums.",
    flow: "spotlight",
    inputs: [data("sourceChain")],
  },
  {
    id: "carouselCache",
    title: "Spotlight carousel",
    scope: "serve",
    kind: "output",
    summary:
      "The built set, held in memory and mirrored to the database so a restart doesn't make the next visitor pay for a rebuild. A build that came up short lapses sooner.",
    flow: "spotlight",
    inputs: [data("antiRepeat")],
    params: ["cacheDurationMinutes"],
  },

  {
    id: "promotedArtistSeeds",
    title: "Seed artists",
    scope: "pick",
    kind: "step",
    summary:
      "Draws seeds from the same weighted artist set the profile ranks, for the promoted-artists grid.",
    flow: "artists",
    inputs: [data("attachSeries")],
    usesParams: ["topArtistsCount", "pickedArtistsCount"],
  },
  {
    id: "promotedArtistSimilar",
    title: "Similar artists",
    scope: "pick",
    kind: "step",
    summary:
      "Asks Last.fm for each seed's similar artists and merges them, keeping the best match per name and dropping artists you already play.",
    flow: "artists",
    inputs: [data("promotedArtistSeeds")],
  },
  {
    id: "promotedArtistGrid",
    title: "Promoted artists",
    scope: "serve",
    kind: "output",
    summary:
      "Six artists, shuffled to decide which appear and then sorted by match so the grid reads strongest first.",
    flow: "artists",
    inputs: [data("promotedArtistSimilar")],
    usesParams: ["cacheDurationMinutes"],
  },
];

/**
 * Knobs the settings still carry, and a stored profile's config hash still covers, that no
 * node reads any more. They leave both when the nodes that replaced their work go live.
 */
export const RETIRED_PARAMS: RetiredParam[] = [
  {
    ...PARAMS.minAvailableTracksForDistribution,
    reason:
      "The one-hit discount now measures concentration against spreading the same listening evenly across the tracks actually played, so an artist with one played track scores nothing on its own. The exemption this knob bought falls out of that arithmetic, and the library catalogue no longer has to be captured to grant it.",
  },
];

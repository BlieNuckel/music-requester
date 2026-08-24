import type {
  EdgeKind,
  NodeKind,
  NodeScope,
} from "../../shared/recommenderGraph";
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
  position: { x: number; y: number };
  inputs: NodeInput[];
  /** Knobs this node owns. Every knob is owned exactly once; see `graph.test.ts`. */
  params?: ParamKey[];
  /** Knobs owned elsewhere that also change what this node does. */
  usesParams?: ParamKey[];
  spendsBudget?: boolean;
  /** For repeat, fallback and quota nodes: what the structure means. */
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
 * The recommender, declared. Positions are authored rather than computed: the canvas can
 * lay the graph out automatically instead, and phase 1 exists partly to decide which reads
 * better at this node count.
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
    position: { x: 0, y: 0 },
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
    position: { x: 0, y: 170 },
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
    position: { x: 0, y: 340 },
    inputs: [data("plexCapture"), data("plexSessions")],
  },

  {
    id: "signalBundle",
    title: "Fold the log",
    scope: "profile",
    kind: "step",
    summary:
      "Replays the log into current state: play counts, ratings, album catalogue, and one merged episode series where measured listening replaces inferred.",
    position: { x: 330, y: 0 },
    inputs: [data("signalLog")],
  },
  {
    id: "playWeights",
    title: "Listening per artist",
    scope: "profile",
    kind: "step",
    summary:
      "How much each artist was listened to in the recent window, from the episode log where it reaches and from snapshot differences before that. Never both, or every play in the covered span would count twice.",
    position: { x: 660, y: 0 },
    inputs: [data("signalBundle")],
    params: [
      "playTrendWindowDays",
      "listeningWeight",
      "maxTrackMinutesForWeight",
    ],
  },
  {
    id: "windowedTrackPlays",
    title: "Per-track plays in the window",
    scope: "profile",
    kind: "step",
    summary:
      "The same window, per track. Everything downstream reads this one map, so the discount and the rating join necessarily describe the span the weight was measured over.",
    position: { x: 660, y: 160 },
    inputs: [data("signalBundle"), data("playWeights", "window")],
  },
  {
    id: "artistDistributions",
    title: "Spread across tracks",
    scope: "profile",
    kind: "step",
    summary:
      "What share of an artist's listening sits on their single most-listened track.",
    position: { x: 660, y: 320 },
    inputs: [data("windowedTrackPlays")],
  },
  {
    id: "artistRatings",
    title: "Ratings per artist",
    scope: "profile",
    kind: "step",
    summary:
      "Star ratings joined onto the tracks they actually cover, as a play-weighted mean plus the breadth of where those stars sit.",
    position: { x: 660, y: 480 },
    inputs: [
      data("signalBundle"),
      data("windowedTrackPlays"),
      data("artistDistributions"),
    ],
  },
  {
    id: "trackAvailability",
    title: "Catalogue size",
    scope: "profile",
    kind: "step",
    summary:
      "How many tracks the library holds per artist, floored by every track ever seen played or rated so it works before the first catalogue sweep.",
    position: { x: 660, y: 640 },
    inputs: [data("signalBundle"), data("windowedTrackPlays")],
  },
  {
    id: "distributionFactor",
    title: "One-hit discount",
    scope: "profile",
    kind: "step",
    summary:
      "Discounts an artist whose listening is concentrated on one track, unless their ratings are spread widely enough to refute it or their catalogue is too small to have spread at all.",
    position: { x: 1000, y: 240 },
    inputs: [
      data("playWeights"),
      data("artistDistributions"),
      data("artistRatings"),
      data("trackAvailability"),
    ],
    params: [
      "distributionWeight",
      "minPlaysForDistribution",
      "minAvailableTracksForDistribution",
    ],
  },
  {
    id: "ratingMultiplier",
    title: "Rating boost",
    scope: "profile",
    kind: "step",
    summary: "Scales each artist's weight by how highly you rate them.",
    position: { x: 1000, y: 420 },
    inputs: [data("distributionFactor"), data("artistRatings")],
    params: ["ratingWeight"],
  },
  {
    id: "artistSeries",
    title: "Listening over time",
    scope: "profile",
    kind: "step",
    summary:
      "Per-artist listening bucketed into a series, and what its shape says: momentum, emergence, decay.",
    position: { x: 330, y: 200 },
    inputs: [data("signalLog")],
    params: ["seriesBucketDays", "seriesSpanDays", "momentumRecentBuckets"],
  },
  {
    id: "attachSeries",
    title: "Attach series signals",
    scope: "profile",
    kind: "step",
    summary:
      "Copies momentum, emergence and decay onto the weights. Deliberately does not fold them into the ranking: they are exposed for a picker to read.",
    position: { x: 1000, y: 580 },
    inputs: [data("ratingMultiplier"), data("artistSeries")],
  },
  {
    id: "topArtists",
    title: "Top artists",
    scope: "profile",
    kind: "step",
    summary: "The ranked head of the weight set, which the profile covers.",
    position: { x: 1330, y: 0 },
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
    position: { x: 1330, y: 160 },
    inputs: [data("topArtists")],
    params: ["tagsPerArtist", "genericTags"],
  },
  {
    id: "albumWeights",
    title: "Listening per album",
    scope: "profile",
    kind: "step",
    summary:
      "The same window split by album, measured from the same source the artist weights came from.",
    position: { x: 330, y: 360 },
    inputs: [data("signalBundle"), data("playWeights", "window")],
    usesParams: ["listeningWeight", "maxTrackMinutesForWeight"],
  },
  {
    id: "albumsByArtist",
    title: "Split weight across albums",
    scope: "profile",
    kind: "step",
    summary:
      "Each artist's weight divided across their records by how much each was listened to. The shares sum to the artist's weight, so moving genre down to the album divides influence rather than adding it.",
    position: { x: 1330, y: 320 },
    inputs: [data("topArtists"), data("albumWeights")],
    usesParams: ["listeningWeight"],
  },
  {
    id: "albumTagLookups",
    title: "Album tag lookups",
    scope: "profile",
    kind: "step",
    summary:
      "Spends Last.fm calls on the most-listened albums per artist. Bounded per artist so one dominant artist can't eat the whole budget.",
    position: { x: 1330, y: 480 },
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
    position: { x: 1660, y: 320 },
    inputs: [
      data("albumsByArtist"),
      data("albumTagLookups"),
      data("artistTags", "fallback source"),
      data("signalBundle", "Plex genres"),
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
    position: { x: 1660, y: 480 },
    inputs: [data("albumTags")],
  },
  {
    id: "similarGraph",
    title: "Similar-artist graph",
    scope: "profile",
    kind: "step",
    summary:
      "Each top artist resolved to MusicBrainz, its ListenBrainz neighbours fetched, and every neighbour genre-tagged. The expensive fan-out, done once per rebuild instead of per recommendation.",
    position: { x: 1330, y: 640 },
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
      "Records with enough plays to count as known, so recommendations stay off things you already have.",
    position: { x: 330, y: 520 },
    inputs: [data("signalLog")],
  },
  {
    id: "profileDocument",
    title: "Taste profile",
    scope: "profile",
    kind: "store",
    summary:
      "One persisted document per user. Every recommender reads this rather than Plex, and a change to any knob above invalidates it.",
    position: { x: 1990, y: 240 },
    inputs: [
      data("genreVector"),
      data("artistTags"),
      data("albumTags"),
      data("similarGraph"),
      data("attachSeries"),
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
    position: { x: 2320, y: 240 },
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
    position: { x: 2320, y: 400 },
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
    position: { x: 2650, y: 240 },
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
    position: { x: 2650, y: 400 },
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
    position: { x: 2980, y: 0 },
    inputs: [control("exploreQuota", "explore slot"), data("similarGraph")],
  },
  {
    id: "exploreBand",
    title: "Genre-distant neighbours",
    scope: "pick",
    kind: "step",
    summary:
      "Keeps only the seed's neighbours in a genre it doesn't share, ranked by similarity.",
    position: { x: 3310, y: 0 },
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
    position: { x: 3640, y: 0 },
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
    position: { x: 2980, y: 240 },
    inputs: [control("pickLoop"), data("similarGraph")],
  },
  {
    id: "personalBand",
    title: "Close enough to your taste",
    scope: "pick",
    kind: "step",
    summary:
      "Keeps the neighbours on the near side of the same line explore reads from the far side, so the two modes partition the graph instead of competing for it. Widens to the whole graph when nothing is close enough.",
    position: { x: 3310, y: 240 },
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
    position: { x: 3640, y: 240 },
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
    position: { x: 3970, y: 240 },
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
    position: { x: 2980, y: 500 },
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
    position: { x: 3310, y: 500 },
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
    position: { x: 3640, y: 500 },
    inputs: [data("pickVector")],
  },
  {
    id: "albumPool",
    title: "Tag album chart",
    scope: "pick",
    kind: "step",
    summary:
      "Fetches the tag's global chart: page one plus a random deeper page, so the pool is not only the famous records of that genre.",
    position: { x: 3970, y: 500 },
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
    position: { x: 4300, y: 500 },
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
    position: { x: 4630, y: 240 },
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
    position: { x: 4960, y: 240 },
    inputs: [data("sourceChain")],
  },
  {
    id: "carouselCache",
    title: "Spotlight carousel",
    scope: "serve",
    kind: "output",
    summary:
      "The built set, held in memory and mirrored to the database so a restart doesn't make the next visitor pay for a rebuild. A build that came up short lapses sooner.",
    position: { x: 5290, y: 240 },
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
    position: { x: 1330, y: 840 },
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
    position: { x: 1660, y: 840 },
    inputs: [data("promotedArtistSeeds")],
  },
  {
    id: "promotedArtistGrid",
    title: "Promoted artists",
    scope: "serve",
    kind: "output",
    summary:
      "Six artists, shuffled to decide which appear and then sorted by match so the grid reads strongest first.",
    position: { x: 1990, y: 840 },
    inputs: [data("promotedArtistSimilar")],
    usesParams: ["cacheDurationMinutes"],
  },
];

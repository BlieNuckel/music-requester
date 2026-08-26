import {
  loadProfileSignals,
  foldSignalsToNow,
} from "../services/profile/profileSignals";
import {
  listeningRows,
  resolveListeningWindow,
  rollupWindowToAlbums,
  deriveKnownAlbums,
} from "../services/profile/listeningWindow";
import {
  deriveArtistListening,
  deriveArtistRatings,
  adjustArtistWeights,
} from "../services/profile/artistWeighting";
import {
  albumsByArtist,
  buildAlbumTags,
  fetchAlbumTags,
  selectTagTargets,
} from "./albumGenres";
import { attachSeriesSignals, loadArtistSeries } from "./artistSeries";
import { buildSimilarGraph } from "./explore";
import {
  buildArtistTags,
  buildGenreVector,
  fetchTagResults,
} from "./profileService";
import { isPlaceholderArtist } from "../utils/artistFilter";
import type {
  NodeBody,
  NodeInputs,
} from "../recommenderGraph/runtime/executor";
import type { PromotedAlbumConfig } from "../config";
import type { ProfileSignals } from "../services/profile/profileSignals";
import type { FoldedSignals } from "../services/profile/profileSignals";
import type {
  AlbumListening,
  ListeningWindow,
} from "../services/profile/listeningWindow";
import type {
  ArtistListening,
  ArtistRating,
  ArtistWeight as AdjustedWeight,
} from "../services/profile/artistWeighting";
import type { ArtistSeries } from "./artistSeries";
import type { ArtistWeight } from "./artistWeights";
import type { AlbumPlayRollup } from "../services/profile/signalIngestion";
import type { DerivedProfile } from "../db/entity/UserProfile";

export type ProfileCtx = {
  userId: number;
  plexToken: string;
  config: PromotedAlbumConfig;
  now: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;

const capMsOf = (config: PromotedAlbumConfig): number =>
  Math.max(0, config.maxTrackMinutesForWeight) * MINUTE_MS;

/**
 * The seam between the two vocabularies this build currently speaks.
 *
 * The listening half is ported and calls an artist's weight `weight`; the tagging half is
 * not, and calls the same number `viewCount` because it once counted Plex views. Renaming
 * either side reaches into the stored profile and everything that reads it, so the translation
 * sits here, in one place, and goes when the tail is ported too.
 */
const toLegacyWeights = (weights: AdjustedWeight[]): ArtistWeight[] =>
  weights.map((artist) => ({
    name: artist.name,
    viewCount: artist.weight,
    ...(artist.ratingMultiplier === undefined
      ? {}
      : { ratingMultiplier: artist.ratingMultiplier }),
  }));

/** Same seam, album side: `plays` there, `playCount` here. */
const toLegacyAlbums = (albums: AlbumListening[]): AlbumPlayRollup[] =>
  albums.map((album) => ({
    albumKey: album.albumKey,
    title: album.title,
    artistKey: album.artistKey,
    artistName: album.artistName,
    playCount: album.plays,
    listenedMs: album.listenedMs,
  }));

const asSignals = (inputs: NodeInputs): ProfileSignals =>
  inputs.loadSignals as ProfileSignals;
const asFolded = (inputs: NodeInputs): FoldedSignals =>
  inputs.foldToNow as FoldedSignals;
const asWindow = (inputs: NodeInputs): ListeningWindow =>
  inputs.listeningWindow as ListeningWindow;

/**
 * One body per node in the profile build. Each is the wiring plus a call: the logic stays in
 * the functions the unit tests already drive, and what changes here is only which of them
 * feeds which. That is the whole point — the sequence lived in `regenerateProfile`'s body and
 * in a drawing, and the two could disagree without anything noticing.
 */
export const PROFILE_BODIES: ReadonlyMap<
  string,
  NodeBody<ProfileCtx>
> = new Map<string, NodeBody<ProfileCtx>>([
  ["loadSignals", (_i, ctx) => loadProfileSignals(ctx.userId, ctx.plexToken)],

  ["foldToNow", (inputs) => foldSignalsToNow(asSignals(inputs))],

  [
    "listeningWindow",
    (inputs, ctx) =>
      resolveListeningWindow(
        asSignals(inputs).trackEvents,
        asSignals(inputs).episodes,
        asFolded(inputs).tracks,
        {
          now: ctx.now,
          windowMs: ctx.config.playTrendWindowDays * DAY_MS,
          capMs: capMsOf(ctx.config),
        }
      ),
  ],

  [
    "artistListening",
    (inputs, ctx) =>
      deriveArtistListening(asWindow(inputs), ctx.config.listeningWeight),
  ],

  [
    "artistRatings",
    (inputs) => deriveArtistRatings(asFolded(inputs).ratings, asWindow(inputs)),
  ],

  [
    "weightAdjust",
    (inputs, ctx) =>
      adjustArtistWeights(
        inputs.artistListening as ArtistListening[],
        inputs.artistRatings as Map<string, ArtistRating>,
        { ratingWeight: ctx.config.ratingWeight }
      ),
  ],

  [
    "artistSeries",
    (_i, ctx) =>
      loadArtistSeries(ctx.userId, {
        now: ctx.now,
        bucketMs: ctx.config.seriesBucketDays * DAY_MS,
        spanMs: ctx.config.seriesSpanDays * DAY_MS,
        recentBuckets: ctx.config.momentumRecentBuckets,
        capMs: capMsOf(ctx.config),
        listeningWeight: ctx.config.listeningWeight,
      }),
  ],

  [
    "attachSeries",
    (inputs) =>
      attachSeriesSignals(
        toLegacyWeights(inputs.weightAdjust as AdjustedWeight[]).filter(
          (weight) => !isPlaceholderArtist(weight.name)
        ),
        inputs.artistSeries as ArtistSeries[]
      ),
  ],

  [
    "topArtists",
    (inputs, ctx) =>
      [...(inputs.attachSeries as ArtistWeight[])]
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, ctx.config.topArtistsCount),
  ],

  [
    "artistTags",
    async (inputs, ctx) =>
      buildArtistTags(
        await fetchTagResults(inputs.topArtists as ArtistWeight[]),
        new Set(ctx.config.genericTags.map((tag) => tag.toLowerCase())),
        ctx.config.tagsPerArtist
      ),
  ],

  ["albumListening", (inputs) => rollupWindowToAlbums(asWindow(inputs).plays)],

  [
    "albumsByArtist",
    (inputs, ctx) =>
      albumsByArtist(
        inputs.topArtists as ArtistWeight[],
        toLegacyAlbums(inputs.albumListening as AlbumListening[]),
        ctx.config.listeningWeight
      ),
  ],

  [
    "albumTagLookups",
    (inputs, ctx) =>
      fetchAlbumTags(
        selectTagTargets(
          inputs.albumsByArtist as ReturnType<typeof albumsByArtist>,
          ctx.config.albumTagsPerArtist
        )
      ),
  ],

  [
    "albumTags",
    (inputs, ctx) =>
      buildAlbumTags(
        inputs.albumsByArtist as ReturnType<typeof albumsByArtist>,
        inputs.artistTags as DerivedProfile["artistTags"],
        inputs.albumTagLookups as Awaited<ReturnType<typeof fetchAlbumTags>>,
        // Already folded: `foldToNow` collected Plex's genres per album on its one pass.
        asFolded(inputs).albumGenres,
        {
          tagsPerAlbum: ctx.config.tagsPerArtist,
          genericTags: new Set(
            ctx.config.genericTags.map((tag) => tag.toLowerCase())
          ),
          listeningWeight: ctx.config.listeningWeight,
        }
      ),
  ],

  [
    "genreVector",
    (inputs) =>
      buildGenreVector(inputs.albumTags as DerivedProfile["albumTags"]),
  ],

  [
    "similarGraph",
    (inputs, ctx) =>
      buildSimilarGraph(inputs.topArtists as ArtistWeight[], ctx.config),
  ],

  [
    "knownAlbums",
    (inputs, ctx) =>
      deriveKnownAlbums(
        listeningRows(asFolded(inputs).tracks, capMsOf(ctx.config))
      ),
  ],
]);

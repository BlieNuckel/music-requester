import { NODE_REGISTRY } from "../recommenderGraph/nodes";
import type { NodeExplain } from "../recommenderGraph/runtime/executor";
import { cappedItems } from "../../shared/recommendationTrace";
import type { TraceFact, TraceItem } from "../../shared/recommendationTrace";
import type { DerivedProfile } from "../db/entity/UserProfile";
import type { SimilarGraphSeed } from "../db/entity/UserProfile";
import type { ExploreBand } from "./explore";
import type { PersonalBand, PersonalCandidate } from "./personal";
import { profileOf, ruleOf, SOURCE_NODES, type PickCtx } from "./pickGraph";
import { preferenceNote } from "./preference";
import type { DrawnTag, SampledVector, TagAlbumPool } from "./tagChart";
import type { BuiltAlbum, ExploreResult, PersonalResult } from "./types";

type Band = { pool: PersonalCandidate[]; widened: boolean };

const TITLES = new Map(NODE_REGISTRY.map((node) => [node.id, node.title]));

const share = (value: number): string => `${Math.round(value * 100)}%`;

const round = (value: number): string =>
  value >= 10 ? String(Math.round(value)) : value.toFixed(2);

const list = (values: string[]): string =>
  values.length > 0 ? values.join(", ") : "none";

/** A fact that says only that the step had nothing to work with. */
const nothing = (label: string, why: string): TraceFact[] => [
  { label, value: why },
];

/**
 * What the library line says about a pick, in the words of the preference that set it. Read
 * off the chosen artist rather than stored on the result, so the sources no longer carry a
 * field whose only reader was the explanation.
 */
function libraryFact(ctx: PickCtx, artistMbid: string): TraceFact {
  return { label: "Library", value: preferenceNote(ruleOf(ctx), artistMbid) };
}

function albumFacts(built: BuiltAlbum, ctx: PickCtx): TraceFact[] {
  const { album } = built.result;
  return [
    { label: "Artist", value: album.artistName },
    {
      label: "Album",
      value: album.year ? `${album.name} (${album.year})` : album.name,
    },
    libraryFact(ctx, album.artistMbid),
  ];
}

function neighbourItems(band: ExploreBand, chosenName?: string): TraceItem[] {
  return band.evaluated.map((entry) => ({
    name: entry.candidate.name,
    detail: `${share(entry.overlap)} genre overlap, ${
      entry.isDifferentGenre
        ? "far enough for a jump"
        : "too close to be a jump"
    }`,
    ...(entry.candidate.name === chosenName ? { chosen: true } : {}),
  }));
}

function personalItems(
  pool: PersonalCandidate[],
  chosenName?: string
): TraceItem[] {
  return [...pool]
    .sort((a, b) => b.weight - a.weight)
    .map((entry) => ({
      name: entry.candidate.name,
      detail: `next to ${entry.seedArtist}, ${share(entry.overlap)} genre overlap`,
      ...(entry.candidate.name === chosenName ? { chosen: true } : {}),
    }));
}

/**
 * What each node has to say about its own turn, for the reader asking why they were shown a
 * particular record.
 *
 * Kept apart from the bodies on purpose. An explainer runs after the body, on the values the
 * body already produced, so nothing here can reach the recommendation — which is what makes
 * it safe for the runtime to swallow one that throws.
 */
export const PICK_EXPLAINERS: ReadonlyMap<
  string,
  NodeExplain<PickCtx>
> = new Map<string, NodeExplain<PickCtx>>([
  [
    "exploreQuota",
    (_inputs, output, ctx) => [
      {
        label: "Slots that explore",
        value: `${output as number} of ${ctx.count}`,
      },
    ],
  ],

  [
    "exploreSeed",
    (_inputs, output, ctx) => {
      if (!ctx.exploring) {
        return nothing("Genre jump", "not granted to this slot");
      }
      const seed = output as SimilarGraphSeed | null;
      if (!seed) return nothing("Seed", "nothing in your similar-artist graph");
      return [
        { label: "Jumping away from", value: seed.seedArtist },
        { label: "Which you play as", value: list(seed.seedGenres) },
      ];
    },
  ],

  [
    "exploreBand",
    (_inputs, output) => {
      const band = output as ExploreBand | null;
      if (!band) return [];
      return [
        {
          label: "Far enough to be a jump",
          value: `${band.ranked.length} of ${band.evaluated.length} neighbours`,
        },
        cappedItems("Neighbours weighed up", neighbourItems(band)),
      ];
    },
  ],

  [
    "exploreAlbum",
    (inputs, output, ctx) => {
      const built = output as BuiltAlbum | null;
      const band = inputs.exploreBand as ExploreBand | null;
      if (!built) {
        return nothing("Result", "no distant neighbour had a record to show");
      }
      const result = built.result as ExploreResult;
      return [
        ...albumFacts(built, ctx),
        { label: "Genres you do not play", value: list(result.newGenres) },
        ...(band
          ? [
              cappedItems(
                "Neighbours weighed up",
                neighbourItems(band, result.album.artistName)
              ),
            ]
          : []),
      ];
    },
  ],

  [
    "personalCandidates",
    (_inputs, output) => [
      {
        label: "Neighbours in your graph",
        value: `${(output as PersonalCandidate[]).length}`,
      },
    ],
  ],

  [
    "personalBand",
    (inputs, output) => {
      const band = output as Band;
      const all = (inputs.personalCandidates as PersonalCandidate[]).length;
      return [
        {
          label: "Close enough to your taste",
          value: band.widened
            ? "none were, so the whole graph was used"
            : `${band.pool.length} of ${all} neighbours`,
        },
      ];
    },
  ],

  [
    "personalPreference",
    (_inputs, output) => {
      const band = output as PersonalBand;
      return [
        {
          label: "Library side",
          value: band.relaxed
            ? "every neighbour was on the wrong side, so all of them stayed"
            : `${band.pool.length} kept`,
        },
      ];
    },
  ],

  [
    "personalAlbum",
    (inputs, output, ctx) => {
      const built = output as BuiltAlbum | null;
      const band = inputs.personalPreference as PersonalBand | null;
      if (!built) {
        return nothing("Result", "no neighbour drawn had a record to show");
      }
      const result = built.result as PersonalResult;
      return [
        { label: "Next to", value: result.seedArtist },
        ...albumFacts(built, ctx),
        { label: "Genres you share", value: list(result.sharedGenres) },
        ...(band
          ? [
              cappedItems(
                "Neighbours drawn from",
                personalItems(band.pool, result.album.artistName)
              ),
            ]
          : []),
      ];
    },
  ],

  [
    "artistSample",
    (_inputs, output) =>
      [
        cappedItems(
          "Artists this pick speaks for",
          (output as DerivedProfile["artistTags"]).map((artist) => ({
            name: artist.name,
            detail: `weight ${round(artist.viewCount)}`,
          }))
        ),
      ] satisfies TraceFact[],
  ],

  [
    "pickVector",
    (inputs, output) => {
      const { vector } = output as SampledVector;
      const sampled = inputs.artistSample as DerivedProfile["artistTags"];
      const total = vector.reduce((sum, entry) => sum + entry.weight, 0) || 1;
      return [
        ...(sampled.length > 0 && vector === profileOf(inputs).genreVector
          ? nothing(
              "Sample",
              "carried no genres, so the whole profile's vector was used"
            )
          : []),
        cappedItems(
          "Genres they add up to",
          vector.map((entry) => ({
            name: entry.tag,
            detail: `${share(entry.weight / total)}, from ${list(entry.fromArtists)}`,
          }))
        ),
      ];
    },
  ],

  [
    "tagDraw",
    (inputs, output) => {
      const drawn = output as DrawnTag | null;
      if (!drawn) return nothing("Genre", "the vector was empty");
      const { vector } = inputs.pickVector as SampledVector;
      const total = vector.reduce((sum, entry) => sum + entry.weight, 0) || 1;
      return [
        {
          label: "Genre drawn",
          value: `${drawn.tag.name}, ${share(drawn.tag.weight / total)} of the vector`,
        },
      ];
    },
  ],

  [
    "albumPool",
    (_inputs, output) => {
      const pool = output as TagAlbumPool | null;
      if (!pool) return nothing("Pool", "the genre's chart was empty");
      return [
        { label: "Page one", value: `${pool.poolInfo.page1Count} records` },
        {
          label: "Deeper page",
          value: `page ${pool.poolInfo.deepPage}, ${pool.poolInfo.deepPageCount} records`,
        },
        {
          label: "Once deduplicated",
          value: `${pool.poolInfo.totalAfterDedup} to walk`,
        },
      ];
    },
  ],

  [
    "candidateWalk",
    (_inputs, output, ctx) => {
      const built = output as BuiltAlbum | null;
      if (!built) {
        return nothing("Result", "nothing in the pool was worth showing");
      }
      return albumFacts(built, ctx);
    },
  ],

  [
    "sourceChain",
    (_inputs, output) => {
      const built = output as BuiltAlbum | null;
      if (!built) return nothing("Answered by", "no source, this attempt");
      const node = SOURCE_NODES[built.result.mode];
      return [{ label: "Answered by", value: TITLES.get(node) ?? node }];
    },
  ],
]);

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAlbumTopTags = vi.fn();

vi.mock("../api/lastfm/albums", () => ({
  getAlbumTopTags: (...args: unknown[]) => mockGetAlbumTopTags(...args),
}));

import {
  albumsByArtist,
  buildAlbumTags,
  fetchAlbumTags,
  plexAlbumGenres,
  resolveAlbumTags,
  selectTagTargets,
  type AlbumTag,
  type AlbumTagOptions,
} from "./albumGenres";
import { buildGenreVector, artistGenreUnits } from "./profileService";
import type { AlbumPlayRollup } from "../services/profile/signalIngestion";
import type { DerivedProfile } from "../db/entity/UserProfile";
import type { UserSignalEvent } from "../db/entity/UserSignalEvent";

function album(
  albumKey: string,
  artistName: string,
  playCount: number,
  overrides: Partial<AlbumPlayRollup> = {}
): AlbumPlayRollup {
  return {
    albumKey,
    title: albumKey,
    artistKey: `ak-${artistName}`,
    artistName,
    playCount,
    listenedMs: playCount * 210_000,
    ...overrides,
  };
}

function albumEvent(
  albums: { ratingKey: string; genres?: string[] }[]
): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind: "plex_album_tracks",
    payload: JSON.stringify({
      albums: albums.map((a) => ({
        ratingKey: a.ratingKey,
        title: a.ratingKey,
        artistKey: "ak-A",
        artistName: "A",
        trackCount: 10,
        genres: a.genres,
      })),
    }),
    recorded_at: "2026-01-01T00:00:00.000Z",
  } as UserSignalEvent;
}

function options(overrides: Partial<AlbumTagOptions> = {}): AlbumTagOptions {
  return {
    tagsPerAlbum: 5,
    genericTags: new Set<string>(),
    listeningWeight: 1,
    ...overrides,
  };
}

const artistTags = (
  name: string,
  viewCount: number,
  tags: AlbumTag[]
): DerivedProfile["artistTags"][number] => ({ name, viewCount, tags });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAlbumTopTags.mockResolvedValue([]);
});

describe("plexAlbumGenres", () => {
  it("folds the catalogue series down to genres per album key", () => {
    const genres = plexAlbumGenres([
      albumEvent([
        { ratingKey: "alb1", genres: ["Drum & Bass"] },
        { ratingKey: "alb2", genres: ["Folk", "Acoustic"] },
      ]),
    ]);

    expect(genres.get("alb1")).toEqual(["Drum & Bass"]);
    expect(genres.get("alb2")).toEqual(["Folk", "Acoustic"]);
  });

  it("leaves out an album with no genres rather than storing an empty list", () => {
    const genres = plexAlbumGenres([
      albumEvent([{ ratingKey: "alb1", genres: [] }, { ratingKey: "alb2" }]),
    ]);

    expect(genres.has("alb1")).toBe(false);
    expect(genres.has("alb2")).toBe(false);
  });

  it("takes the latest capture of an album that was re-tagged", () => {
    const genres = plexAlbumGenres([
      albumEvent([{ ratingKey: "alb1", genres: ["Rock"] }]),
      albumEvent([{ ratingKey: "alb1", genres: ["Post-Rock"] }]),
    ]);

    expect(genres.get("alb1")).toEqual(["Post-Rock"]);
  });
});

describe("albumsByArtist", () => {
  it("keeps only the artists asked for, most-listened album first", () => {
    const byArtist = albumsByArtist(
      [{ name: "A", viewCount: 100 }],
      [album("quiet", "A", 2), album("loud", "A", 8), album("other", "B", 9)],
      1
    );

    expect(byArtist).toHaveLength(1);
    expect(byArtist[0].albums.map((a) => a.albumKey)).toEqual([
      "loud",
      "quiet",
    ]);
  });

  it("keeps an artist with no albums so their weight can still reach the vector", () => {
    const byArtist = albumsByArtist([{ name: "A", viewCount: 100 }], [], 1);

    expect(byArtist[0]).toEqual({ name: "A", viewCount: 100, albums: [] });
  });

  it("drops an album carrying no listening in the window", () => {
    const byArtist = albumsByArtist(
      [{ name: "A", viewCount: 100 }],
      [album("unplayed", "A", 0, { listenedMs: 0 })],
      1
    );

    expect(byArtist[0].albums).toEqual([]);
  });

  it("orders by plays rather than time when the weighting says plays", () => {
    const byArtist = albumsByArtist(
      [{ name: "A", viewCount: 100 }],
      [
        album("many-short", "A", 20, { listenedMs: 1_000 }),
        album("one-long", "A", 1, { listenedMs: 5_400_000 }),
      ],
      0
    );

    expect(byArtist[0].albums[0].albumKey).toBe("many-short");
  });
});

describe("selectTagTargets", () => {
  it("takes the most-listened albums per artist, not globally", () => {
    const byArtist = albumsByArtist(
      [
        { name: "A", viewCount: 100 },
        { name: "B", viewCount: 1 },
      ],
      [
        album("a1", "A", 30),
        album("a2", "A", 20),
        album("a3", "A", 10),
        album("b1", "B", 1),
      ],
      1
    );

    expect(selectTagTargets(byArtist, 2).map((a) => a.albumKey)).toEqual([
      "a1",
      "a2",
      "b1",
    ]);
  });

  it("spends nothing when the knob is zero", () => {
    const byArtist = albumsByArtist(
      [{ name: "A", viewCount: 100 }],
      [album("a1", "A", 30)],
      1
    );

    expect(selectTagTargets(byArtist, 0)).toEqual([]);
  });
});

describe("fetchAlbumTags", () => {
  it("looks each album up by artist and title", async () => {
    mockGetAlbumTopTags.mockResolvedValue([{ name: "shoegaze", count: 100 }]);

    const tags = await fetchAlbumTags([album("alb1", "Slowdive", 4)]);

    expect(mockGetAlbumTopTags).toHaveBeenCalledWith("Slowdive", "alb1");
    expect(tags.get("alb1")).toEqual([{ name: "shoegaze", count: 100 }]);
  });

  it("leaves out an album whose lookup failed", async () => {
    mockGetAlbumTopTags.mockRejectedValue(new Error("429"));

    const tags = await fetchAlbumTags([album("alb1", "A", 4)]);

    expect(tags.size).toBe(0);
  });

  it("leaves out an album Last.fm has no tags for", async () => {
    mockGetAlbumTopTags.mockResolvedValue([]);

    expect((await fetchAlbumTags([album("alb1", "A", 4)])).size).toBe(0);
  });

  it("does not spend a call on an album with no title to look up", async () => {
    await fetchAlbumTags([album("alb1", "A", 4, { title: "" })]);

    expect(mockGetAlbumTopTags).not.toHaveBeenCalled();
  });
});

describe("resolveAlbumTags", () => {
  const target = album("alb1", "A", 4);
  const fallback: AlbumTag[] = [{ name: "artist tag", count: 100 }];

  it("prefers the Last.fm album tags", () => {
    const resolved = resolveAlbumTags(
      target,
      new Map([["alb1", [{ name: "post-rock", count: 100 }]]]),
      new Map([["alb1", ["Rock"]]]),
      fallback,
      options()
    );

    expect(resolved).toEqual({
      source: "lastfm-album",
      tags: [{ name: "post-rock", count: 100 }],
    });
  });

  it("falls back to the Plex album genre, weighting each genre equally", () => {
    const resolved = resolveAlbumTags(
      target,
      new Map(),
      new Map([["alb1", ["Folk", "Acoustic"]]]),
      fallback,
      options()
    );

    expect(resolved).toEqual({
      source: "plex-album",
      tags: [
        { name: "Folk", count: 1 },
        { name: "Acoustic", count: 1 },
      ],
    });
  });

  it("falls back to the artist's tags when the album has none of its own", () => {
    const resolved = resolveAlbumTags(
      target,
      new Map(),
      new Map(),
      fallback,
      options()
    );

    expect(resolved).toEqual({ source: "artist", tags: fallback });
  });

  it("skips a source that survives generic filtering with nothing left", () => {
    const resolved = resolveAlbumTags(
      target,
      new Map([["alb1", [{ name: "seen live", count: 100 }]]]),
      new Map([["alb1", ["Rock"]]]),
      fallback,
      options({ genericTags: new Set(["seen live"]) })
    );

    expect(resolved.source).toBe("plex-album");
  });

  it("keeps at most tagsPerAlbum tags", () => {
    const resolved = resolveAlbumTags(
      target,
      new Map([
        [
          "alb1",
          [
            { name: "shoegaze", count: 100 },
            { name: "dream pop", count: 90 },
            { name: "noise", count: 80 },
          ],
        ],
      ]),
      new Map(),
      fallback,
      options({ tagsPerAlbum: 2 })
    );

    expect(resolved.tags.map((t) => t.name)).toEqual(["shoegaze", "dream pop"]);
  });

  it("drops a tag carrying a year, which is a release date rather than a genre", () => {
    const resolved = resolveAlbumTags(
      target,
      new Map([
        [
          "alb1",
          [
            { name: "2024", count: 100 },
            { name: "best of 2011", count: 90 },
            { name: "post-rock", count: 80 },
          ],
        ],
      ]),
      new Map(),
      fallback,
      options()
    );

    expect(resolved.tags.map((t) => t.name)).toEqual(["post-rock"]);
  });

  it("drops a tag that is just the artist's own name", () => {
    const resolved = resolveAlbumTags(
      album("alb1", "Mac Miller", 4),
      new Map([
        [
          "alb1",
          [
            { name: "Mac Miller", count: 100 },
            { name: "jazz rap", count: 90 },
          ],
        ],
      ]),
      new Map(),
      fallback,
      options()
    );

    expect(resolved.tags.map((t) => t.name)).toEqual(["jazz rap"]);
  });

  it("falls through to the next source when only dated tags survive", () => {
    const resolved = resolveAlbumTags(
      target,
      new Map([["alb1", [{ name: "2024", count: 100 }]]]),
      new Map([["alb1", ["Folk"]]]),
      fallback,
      options()
    );

    expect(resolved.source).toBe("plex-album");
  });

  it("keeps a real genre that merely looks numeric-adjacent", () => {
    const resolved = resolveAlbumTags(
      target,
      new Map([["alb1", [{ name: "trip-hop", count: 100 }]]]),
      new Map(),
      fallback,
      options()
    );

    expect(resolved.tags.map((t) => t.name)).toEqual(["trip-hop"]);
  });

  it("leaves the artist fallback untouched by the album-only filters", () => {
    const resolved = resolveAlbumTags(
      album("alb1", "Mac Miller", 4),
      new Map(),
      new Map(),
      [
        { name: "2024", count: 100 },
        { name: "Mac Miller", count: 90 },
      ],
      options()
    );

    expect(resolved).toEqual({
      source: "artist",
      tags: [
        { name: "2024", count: 100 },
        { name: "Mac Miller", count: 90 },
      ],
    });
  });
});

describe("buildAlbumTags", () => {
  it("divides an artist's weight across their albums by listening", () => {
    const byArtist = albumsByArtist(
      [{ name: "A", viewCount: 100 }],
      [album("loud", "A", 8), album("quiet", "A", 2)],
      1
    );

    const built = buildAlbumTags(
      byArtist,
      [artistTags("A", 100, [{ name: "rock", count: 100 }])],
      new Map(),
      new Map(),
      options()
    );

    expect(built.map((a) => [a.albumKey, a.weight])).toEqual([
      ["loud", 80],
      ["quiet", 20],
    ]);
  });

  it("holds an artist's whole weight on one entry when they have no albums", () => {
    const built = buildAlbumTags(
      albumsByArtist([{ name: "A", viewCount: 100 }], [], 1),
      [artistTags("A", 100, [{ name: "rock", count: 100 }])],
      new Map(),
      new Map(),
      options()
    );

    expect(built).toEqual([
      {
        albumKey: "",
        title: "",
        artistName: "A",
        weight: 100,
        source: "artist",
        tags: [{ name: "rock", count: 100 }],
      },
    ]);
  });

  it("drops an album whose tags are all generic", () => {
    const byArtist = albumsByArtist(
      [{ name: "A", viewCount: 100 }],
      [album("alb1", "A", 4)],
      1
    );

    const built = buildAlbumTags(
      byArtist,
      [artistTags("A", 100, [{ name: "seen live", count: 100 }])],
      new Map(),
      new Map(),
      options({ genericTags: new Set(["seen live"]) })
    );

    expect(built).toEqual([]);
  });

  it("lets one record carry a genre the rest of the artist does not", () => {
    const byArtist = albumsByArtist(
      [{ name: "A", viewCount: 100 }],
      [album("loud", "A", 9), album("acoustic", "A", 1)],
      1
    );

    const built = buildAlbumTags(
      byArtist,
      [artistTags("A", 100, [{ name: "metal", count: 100 }])],
      new Map(),
      new Map([["acoustic", ["Folk"]]]),
      options()
    );

    const vector = buildGenreVector(built);
    expect(vector).toEqual([
      { tag: "metal", weight: 90, fromArtists: ["A"] },
      { tag: "Folk", weight: 10, fromArtists: ["A"] },
    ]);
  });

  it("produces the artist-level vector exactly when no album has a genre", () => {
    const artists = [
      artistTags("A", 100, [
        { name: "shoegaze", count: 100 },
        { name: "dream pop", count: 50 },
      ]),
      artistTags("B", 40, [{ name: "techno", count: 100 }]),
    ];
    const byArtist = albumsByArtist(
      artists,
      [album("a1", "A", 7), album("a2", "A", 3), album("b1", "B", 5)],
      1
    );

    const built = buildAlbumTags(
      byArtist,
      artists,
      new Map(),
      new Map(),
      options()
    );

    const fromAlbums = buildGenreVector(built);
    const fromArtists = buildGenreVector(artistGenreUnits(artists));
    expect(fromAlbums.map((g) => g.tag)).toEqual(fromArtists.map((g) => g.tag));
    for (const [index, entry] of fromAlbums.entries()) {
      expect(entry.weight).toBeCloseTo(fromArtists[index].weight);
      expect(entry.fromArtists).toEqual(fromArtists[index].fromArtists);
    }
  });
});

import type { Request, Response } from "express";
import express from "express";
import {
  searchReleaseGroups,
  fetchReleaseGroupsForArtist,
  getReleaseGroupById,
  getReleaseGroupLabel,
  getReleaseGroupDate,
  getAlbumDetails,
} from "../api/musicbrainz/releaseGroups";
import {
  getArtistById,
  searchArtists,
  getArtistMbidByName,
} from "../api/musicbrainz/artists";
import { getArtistImage, getArtistsImages } from "../api/deezer/artists";
import type { ArtistInfo } from "../api/musicbrainz/types";
import { getLabelAncestors } from "../api/musicbrainz/labels";
import { getReleaseTracks } from "../api/musicbrainz/tracks";
import { enrichTracksWithPreviews } from "../services/musicbrainz";
import { getConfigValue } from "../config";
import { evaluatePurchaseDecision } from "../services/purchaseDecision/evaluatePurchaseDecision";

const router = express.Router();

const ARTIST_SCORE_THRESHOLD = 85;
const ARTIST_RESULT_LIMIT = 5;

/** Keep only the strongest artist matches so they don't bury album results */
function topArtists(artists: ArtistInfo[]): ArtistInfo[] {
  return artists
    .filter((a) => (a.score ?? 0) >= ARTIST_SCORE_THRESHOLD)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, ARTIST_RESULT_LIMIT);
}

async function enrichArtistsWithImages(artists: ArtistInfo[]) {
  const images = await getArtistsImages(artists.map((a) => a.name));
  return artists.map((a) => ({
    ...a,
    imageUrl: images.get(a.name.toLowerCase()) || undefined,
  }));
}

router.get("/search/all", async (req: Request, res: Response) => {
  const { q } = req.query;
  if (typeof q !== "string") {
    return res.status(400).json({ error: "Query parameter q is required" });
  }

  const [releaseGroups, artists] = await Promise.all([
    searchReleaseGroups(q),
    searchArtists(q),
  ]);

  const enrichedArtists = await enrichArtistsWithImages(topArtists(artists));

  res.json({
    "release-groups": releaseGroups["release-groups"],
    count: releaseGroups.count,
    artists: enrichedArtists,
  });
});

router.get("/search", async (req: Request, res: Response) => {
  const { q } = req.query;
  if (typeof q !== "string") {
    return res.status(400).json({ error: "Query parameter q is required" });
  }

  res.json(await searchReleaseGroups(q));
});

router.get("/artist/search", async (req: Request, res: Response) => {
  const { q } = req.query;
  if (typeof q !== "string") {
    return res.status(400).json({ error: "Query parameter q is required" });
  }

  const artists = await searchArtists(q);
  res.json({ artists: await enrichArtistsWithImages(artists) });
});

router.get("/artist/id", async (req: Request, res: Response) => {
  const { name } = req.query;
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Query parameter name is required" });
  }

  res.json({ mbid: await getArtistMbidByName(name) });
});

router.get(
  "/artist/:mbid/release-groups",
  async (req: Request, res: Response) => {
    const { mbid } = req.params;
    const releaseGroups = await fetchReleaseGroupsForArtist(mbid as string);
    res.json({ releaseGroups });
  }
);

router.get("/artist/:mbid", async (req: Request, res: Response) => {
  const { mbid } = req.params;
  const artist = await getArtistById(mbid as string);

  if (!artist) {
    return res.status(404).json({ error: "Artist not found" });
  }

  const imageUrl = await getArtistImage(artist.name);

  res.json({ artist: { ...artist, imageUrl: imageUrl || undefined } });
});

router.get("/tracks/:releaseGroupId", async (req: Request, res: Response) => {
  const { releaseGroupId } = req.params;
  const artistName =
    typeof req.query.artistName === "string" ? req.query.artistName : "";
  const media = await getReleaseTracks(releaseGroupId as string);

  const enrichedMedia = artistName
    ? await enrichTracksWithPreviews(media, artistName)
    : media;

  res.json({ media: enrichedMedia });
});

router.get(
  "/release-group/:mbid/label",
  async (req: Request, res: Response) => {
    const { mbid } = req.params;
    res.json({ label: await getReleaseGroupLabel(mbid as string) });
  }
);

router.get("/release-group/:mbid", async (req: Request, res: Response) => {
  const { mbid } = req.params;
  const result = await getReleaseGroupById(mbid as string);

  if (!result) {
    return res.status(404).json({ error: "Release group not found" });
  }

  res.json(result);
});

router.get("/album/:mbid", async (req: Request, res: Response) => {
  const { mbid } = req.params;
  const album = await getAlbumDetails(mbid as string);

  if (!album) {
    return res.status(404).json({ error: "Album not found" });
  }

  res.json({ album });
});

function sendSSE(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.get(
  "/purchase-context/:releaseGroupId",
  async (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      const { releaseGroupId } = req.params;

      sendSSE(res, "progress", { step: "Looking up album details" });
      const [label, firstReleaseDate] = await Promise.all([
        getReleaseGroupLabel(releaseGroupId as string),
        getReleaseGroupDate(releaseGroupId as string),
      ]);

      const config = getConfigValue("purchaseDecision");
      const blocklist = config.labelBlocklist;

      let labelAncestors: { name: string; mbid: string }[] = [];
      if (label) {
        sendSSE(res, "progress", {
          step: "Resolving label ownership",
          detail: label.name,
        });
        labelAncestors = await getLabelAncestors(label.mbid, {
          onAncestorFound: (ancestor) => {
            sendSSE(res, "progress", {
              step: "Resolving label ownership",
              detail: ancestor.name,
            });
          },
          shouldStop: (ancestors) =>
            ancestors.some((a) =>
              blocklist.some((b) =>
                a.name.toLowerCase().includes(b.toLowerCase())
              )
            ),
        });
      }
      const result = evaluatePurchaseDecision(
        { label, labelAncestors, firstReleaseDate },
        config
      );
      sendSSE(res, "result", result);
    } catch {
      sendSSE(res, "result", {
        recommendation: "neutral",
        signals: [],
        label: null,
      });
    } finally {
      res.end();
    }
  }
);

export default router;

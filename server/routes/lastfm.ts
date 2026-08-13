import type { Request, Response } from "express";
import express from "express";
import {
  getSimilarArtists,
  getArtistTopTags,
  getTopArtistsByTag,
} from "../api/lastfm/artists";
import { getTopAlbumsByTag, getAlbumTopTags } from "../api/lastfm/albums";
import {
  enrichArtistsWithImages,
  enrichArtistSectionsWithImages,
  enrichAlbumsWithArtwork,
} from "../services/lastfm";

const router = express.Router();

router.get("/similar", async (req: Request, res: Response) => {
  const { artist } = req.query;
  if (typeof artist !== "string") {
    return res
      .status(400)
      .json({ error: "artist query parameter is required" });
  }

  const artists = await getSimilarArtists(artist);
  const enrichedArtists = await enrichArtistsWithImages(artists);

  res.json({ artists: enrichedArtists });
});

router.get("/artist/tags", async (req: Request, res: Response) => {
  const { artist } = req.query;
  if (typeof artist !== "string") {
    return res
      .status(400)
      .json({ error: "artist query parameter is required" });
  }

  const tags = await getArtistTopTags(artist);
  res.json({ tags });
});

router.get("/album/tags", async (req: Request, res: Response) => {
  const { artist, album } = req.query;
  if (typeof artist !== "string" || typeof album !== "string") {
    return res
      .status(400)
      .json({ error: "artist and album query parameters are required" });
  }

  const tags = await getAlbumTopTags(artist, album);
  res.json({ tags });
});

router.get("/tag/artists", async (req: Request, res: Response) => {
  const { tags, page } = req.query;
  if (typeof tags !== "string") {
    return res.status(400).json({ error: "tags query parameter is required" });
  }

  const tagList = decodeURIComponent(tags)
    .split(",")
    .map((t) => t.trim());
  const result = await getTopArtistsByTag(
    tagList,
    typeof page === "string" ? page : "1"
  );

  if (result.sections.length > 0) {
    const enrichedSections = await enrichArtistSectionsWithImages(
      result.sections
    );
    res.json({ ...result, sections: enrichedSections });
  } else {
    const enrichedArtists = await enrichArtistsWithImages(result.artists);
    res.json({ ...result, artists: enrichedArtists });
  }
});

router.get("/tag/albums", async (req: Request, res: Response) => {
  const { tag, page } = req.query;
  if (typeof tag !== "string") {
    return res.status(400).json({ error: "tag query parameter is required" });
  }

  const result = await getTopAlbumsByTag(
    tag,
    typeof page === "string" ? page : "1"
  );

  const enrichedAlbums = await enrichAlbumsWithArtwork(result.albums);
  res.json({ ...result, albums: enrichedAlbums });
});

export default router;

# Similar albums

Shown on the album page. Deliberately impersonal: nothing here depends on who is asking,
which is what lets one 6 hour cache entry serve every user and keeps the page describing the
album rather than the viewer. In-library state is applied by the client, which already
holds it.

Code: `server/services/similarAlbums/`.

```mermaid
flowchart TB
  seed["loadSeed: getAlbumDetails(mbid)<br/>title, artistName, artistMbid"]

  subgraph tagleg["tag leg: albums sharing this record's fingerprint"]
    t1["album.getTopTags, drop generic tags"]
    t2["top 3 tags, strongest first"]
    t3["tag.getTopAlbums page 1, top 25 each"]
    t4["score = tag strength x rank within the chart"]
    t1 --> t2 --> t3 --> t4
  end

  subgraph artleg["artist leg: albums by artists like this one"]
    a1["ListenBrainz similar artists for artistMbid"]
    a2["top 12, scores normalized against the strongest"]
    a3["Last.fm artist.getTopAlbums, 3 each"]
    a4["score = neighbour weight x rank"]
    a1 --> a2 --> a3 --> a4
  end

  rank["rankCandidates<br/>key = normalized artist + title"]
  merged["0.5 x tagScore + 0.5 x artistScore<br/>x1.25 when both legs proposed it"]
  resolve["takeResolved<br/>up to 12 results, 5 MusicBrainz searches spare<br/>for candidates Last.fm gave no mbid"]
  out["SimilarAlbum[] with reasons"]

  seed --> tagleg
  seed --> artleg
  t4 --> rank
  a4 --> rank
  rank --> merged --> resolve --> out
```

Notes on the choices:

- **Keyed on normalized artist + title, not mbid.** Last.fm supplies an mbid only sometimes,
  so keying on it would file the same album twice whenever one leg carried one and the other
  did not.
- **The both-legs boost is the only corroboration available.** Album similarity here is
  synthesized rather than measured, so two independent recipes agreeing is worth more than
  either leg scoring something highly alone.
- **The seed's own artist is excluded**, along with the seed album itself.
- **Resolution is budgeted.** A candidate without a release-group mbid cannot be rendered at
  all (route and cover art are both keyed by it), so five searches are spent on the ranked
  head and the rest are dropped. Each search takes a paced interactive slot that preempts
  the pollers.

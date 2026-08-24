# Profile derivation

`regenerateProfile()` turns the event log into one persisted document, `DerivedProfile`,
stored as `profile_json` on `user_profiles`. Every personal recommender reads that document.
The expensive fan-out (Plex fold, Last.fm tags, MusicBrainz ids, ListenBrainz similarity)
happens here, once, and never on a request path.

Code: `server/promotedAlbum/profileService.ts`, `artistWeights.ts`, `artistSeries.ts`,
`albumGenres.ts`, `explore.ts`, `knownAlbums.ts`, `server/genres/classify.ts`.

## The whole build

```mermaid
flowchart TB
  ev[("user_signal_events")]

  bundle["loadSignalBundle<br/>track + legacy + rating + album events,<br/>plus the merged episode series"]

  weights["deriveArtistWeights"]
  series["loadArtistSeries<br/>deriveArtistSeries"]
  attach["attachSeriesSignals<br/>momentum, emerging, decaying, firstSeenMs"]
  top["top N by viewCount<br/>topArtistsCount"]

  lfArtist["Last.fm artist.getTopTags<br/>every top artist"]
  artistTags["buildArtistTags<br/>generic tags dropped"]

  albumW["deriveAlbumWeights<br/>album share of its artist's weight"]
  byArtist["albumsByArtist<br/>most listened first"]
  targets["selectTagTargets<br/>albumTagsPerArtist"]
  lfAlbum["Last.fm album.getTopTags"]
  plexGenres["plexAlbumGenres<br/>from the catalogue capture"]
  albumTags["buildAlbumTags<br/>resolveAlbumTags per album"]
  vector["buildGenreVector<br/>normalizedTagWeights"]

  simgraph["buildSimilarGraph<br/>MusicBrainz mbid, ListenBrainz similar,<br/>Last.fm tags per candidate"]
  known["loadKnownAlbums<br/>5+ plays, max 500 keys"]

  doc[("UserProfile row<br/>profile_json + config_hash + schema_version")]

  ev --> bundle
  bundle --> weights --> attach
  ev --> series --> attach
  attach --> top
  top --> lfArtist --> artistTags
  bundle --> albumW --> byArtist --> targets --> lfAlbum --> albumTags
  top --> byArtist
  bundle --> plexGenres --> albumTags
  artistTags --> albumTags
  albumTags --> vector
  top --> simgraph
  ev --> known

  vector --> doc
  artistTags --> doc
  albumTags --> doc
  simgraph --> doc
  attach --> doc
  known --> doc
```

Exploration history (`explorationHistory`) is carried forward across a regenerate rather
than rebuilt: it is anti-repeat memory, not derived taste.

## How an artist's weight is built

```mermaid
flowchart LR
  subgraph src["window source, one or the other"]
    epi["episodeTotals<br/>used when history covers the window"]
    cnt["countDeltaTotals<br/>difference of two cumulative snapshots"]
  end

  pw["derivePlayWeights<br/>viewCount in play-equivalents<br/>falls back to all-time if the series is too shallow"]
  wt["deriveWindowedTrackPlays<br/>same windowStart, so every later step<br/>is measured over one span"]
  dist["deriveArtistDistributions<br/>topTrackShare"]
  rat["aggregateArtistRatings<br/>play-weighted mean + breadth"]
  avail["deriveTrackAvailability<br/>catalogue floored by played + rated tracks"]

  df["applyDistributionFactor<br/>1 - distributionWeight x topTrackShare x (1 - breadth)"]
  rm["applyRatingMultiplier<br/>1 + ratingWeight x rating/10"]
  out["ArtistWeight[]<br/>placeholder artists filtered out"]

  epi --> pw
  cnt --> pw
  pw --> wt
  wt --> dist
  wt --> rat
  dist --> rat
  wt --> avail
  pw --> df
  dist --> df
  rat --> df
  avail --> df
  df --> rm --> out
```

The two corrections are deliberately in tension. The distribution factor discounts an artist
whose listening sits on one track; rating breadth refutes that read, because stars spread
across the catalogue are direct evidence against a one-hit artist. Artists whose library
catalogue is at or below `minAvailableTracksForDistribution` are exempt outright: played-only
data cannot tell "the library holds one track by them" from "eleven tracks never played".

## Where genre attaches

Genre hangs off the album, not the artist. An artist still contributes exactly its play
weight to the vector; that weight is divided across its records by how much each was
actually listened to, so an acoustic side-record pulls only its own share into the wrong tag.

```mermaid
flowchart TB
  album["one album, weight = artistWeight x albumShare"]
  s1{"Last.fm album tags?"}
  s2{"Plex agent genres?"}
  s3["artist tags"]
  cls["classifyTag against server/genres/vocabulary.json"]
  gen["genres, canonicalized and deduped"]
  other["otherTags: region / era / unknown<br/>stored, but carry no weight"]
  vec["genreVector entry"]

  album --> s1
  s1 -->|"no genre found"| s2
  s2 -->|"no genre found"| s3
  s1 --> cls
  s2 --> cls
  s3 --> cls
  cls --> gen --> vec
  cls --> other
```

A source that yields no _genre_ is skipped rather than accepted, so an album Last.fm only
knows as "nigerian" still inherits its artist's genres, and the region is kept separately.
Recommending by nationality while believing you are recommending by genre is the failure
this split exists to prevent. A genre-less album falls back rather than emptying the vector.

## Freshness and who triggers a rebuild

```mermaid
flowchart TB
  req["request: loadProfileForRequest"]
  fresh{"row fresh?<br/>config_hash + schema_version match,<br/>vector non-empty, within profileTtlMinutes"}
  serve["serve it, touch last_used_at"]
  stale{"anything usable stored?"}
  bg["startProfileBuild<br/>off-request, per-user in-flight guard"]
  building["status: building"]
  served["serve the stale profile while the rebuild runs"]

  poller["regenPoller<br/>hourly, first run after 1 min"]
  cand["getProfileRegenCandidates<br/>stale AND used within<br/>backgroundRegenActiveWithinMinutes"]
  regen["loadFreshProfile -> regenerateProfile"]

  req --> fresh
  fresh -->|yes| serve
  fresh -->|no| bg
  bg --> stale
  stale -->|no| building
  stale -->|yes| served
  poller --> cand --> regen
  regen --> lock["AsyncLock per user id<br/>shared with the request path"]
```

A profile build walks every played track and resolves seeds against MusicBrainz at roughly
one request per second, which is minutes on a cold start. That is why nothing awaits it on
a request, and why `config_hash` exists: changing a weighting knob in settings invalidates
every stored profile without a migration.

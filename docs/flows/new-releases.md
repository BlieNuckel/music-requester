# New releases shelf

Four cards on Discover blending three tiers: releases by artists the user follows, releases
by artists in the Lidarr library, and releases by artists adjacent to the user's taste. Two
different pipelines feed it, one persisted and one cached in memory.

Code: `server/services/discover/newReleases.ts`, `feedCache.ts`,
`server/services/followed/`.

## The followed pipeline (persisted, poller-driven)

```mermaid
flowchart TB
  poll["followed-artist poller<br/>every 6h, first run after 30s"]
  each["for each row in followed_artists"]
  mb["MusicBrainz: fetchReleaseGroupsForArtist<br/>background lane"]
  dz["Deezer: getArtistAlbumsByName"]
  agg["aggregateArtistReleases<br/>dedup on normalized title + release year-month,<br/>MusicBrainz preferred"]
  known{"release_key already stored?"}
  rec["recordFollowedRelease"]
  back["backfillReleaseMetadata<br/>mbid, cover, types"]
  notify{"first poll after following,<br/>or older than 30 days?"}
  push["notifyFollowedRelease"]
  db[("followed_releases")]

  poll --> each --> mb --> agg
  each --> dz --> agg
  agg --> known
  known -->|no| rec --> db
  known -->|"yes, missing mbid"| back --> db
  rec --> notify
  notify -->|no| push
```

The first poll after following records the entire back catalogue, and none of it is news to
the person who just chose to follow that artist, so notifications are suppressed for it.

## The blend (per request)

```mermaid
flowchart TB
  subgraph inputs["fetched concurrently"]
    f["getFollowedReleasesForUser<br/>up to 200 rows"]
    lb["getCachedFreshReleases<br/>ListenBrainz sitewide feed, 6h global cache"]
    lib["Lidarr artist list -> mbid set"]
    sim["profile.similarGraph -> candidate mbid set"]
  end

  filter["isAllowedReleaseType + placeholder-artist filter"]
  m1["feed releases matching a library artist -> source: library"]
  m2["feed releases matching a similar artist -> source: similar"]
  dedup["dedupeCandidates<br/>keys: release-group mbid and artist-scoped title+month<br/>precedence followed > library > similar"]
  win["widen the window 30 -> 60 -> 90 days<br/>until 4 candidates exist"]
  sort["unseen followed first, then newest"]
  enrich["enrichRequestsWithLidarr<br/>downloading / wanted / imported"]
  out["4 items + the window used"]

  f --> filter
  lb --> filter
  filter --> m1
  filter --> m2
  lib --> m1
  sim --> m2
  filter --> dedup
  m1 --> dedup
  m2 --> dedup
  dedup --> win --> sort --> enrich --> out
```

The artist-scoped title key exists so a followed row written before its mbid backfill still
suppresses its twin from the ListenBrainz feed, without colliding across artists. The window
widens rather than the count shrinking, because a half-empty shelf reads as broken while a
90 day window reads as quiet.

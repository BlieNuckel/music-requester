# Promoted artists

Six artists on the Discover page, similar to what the user is playing right now. The only
personal recommender that does not read the persisted profile document for its candidates:
it derives artist weights live off the event log and asks Last.fm for neighbours.

Code: `server/promotedArtists/getPromotedArtists.ts`.

```mermaid
flowchart TB
  cache{"per-user result cache<br/>cacheDurationMinutes"}
  token{"user has a Plex token?"}
  w["loadArtistWeights<br/>same weighting as the profile build"]
  top["top N by viewCount, topArtistsCount"]
  seeds["weighted draw of pickedArtistsCount seeds"]
  lf["Last.fm artist.getSimilar per seed"]
  merge["mergeSimilar<br/>best match per name wins,<br/>the user's own top artists excluded"]
  recent["exclude explorationHistory.artists"]
  pickf["shuffle, take 6, then sort by match descending"]
  img["enrichArtistsWithImages"]
  lib["Lidarr /artist<br/>inLibrary by mbid or name"]
  hist["updateExplorationHistory<br/>last 18 names"]
  out["PromotedArtistsResult<br/>artists + seedArtists"]

  cache -->|hit| out
  cache -->|miss| token
  token -->|no| none["null"]
  token -->|yes| w --> top --> seeds --> lf --> merge --> recent --> pickf --> img --> lib --> out
  pickf --> hist
```

Two details worth keeping straight:

- The **shuffle decides which** artists appear, so repeat visits vary. The **sort only
  decides the order** they are shown in, strongest match first, so the grid reads best to
  worst from where the eye starts.
- Anti-repeat is a soft filter. If fewer than six fresh artists remain, the full merged pool
  is used instead: a repeat beats an empty grid.

Failures degrade rather than propagate. A failed `artist.getSimilar` for one seed returns an
empty list, and an unreachable Lidarr means everything reads as not in library.

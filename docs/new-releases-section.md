# Discover "New releases" section — design decisions (issue #193)

Working agreement doc for the New releases bento tile. Decisions here are settled unless
reopened; open points are listed at the bottom and get resolved one at a time.

## Verified facts (2026-07-09)

- **ListenBrainz sitewide fresh releases endpoint**: `GET https://api.listenbrainz.org/1/explore/fresh-releases/?days=N`
  (hyphen, trailing slash required — `fresh_releases` 404s). `days` up to 90.
  - 90 days ≈ 32k releases, ~14 MB JSON, single request.
  - Rate limit: 30 requests per window (`X-RateLimit-Limit: 30`, resets in seconds). We need 1 request per cache TTL — no rate-limit concern.
  - Item fields: `artist_mbids[]`, `release_group_mbid` (present on 100% of sampled items), `release_group_primary_type`, `release_group_secondary_type`, `release_name`, `artist_credit_name`, `release_date`, `caa_id` / `caa_release_mbid` (~81% have cover art), `listen_count`, `release_tags`.
  - Primary type distribution over 90 days: ~15k Single, ~11.5k Album, ~4k EP, rest Broadcast/Other/null.
- **Cover art pattern in codebase**: direct Cover Art Archive URLs by release-group MBID —
  `https://coverartarchive.org/release-group/{mbid}/front-500` (see `src/components/ReleaseGroupCard.tsx`, `server/promotedAlbum/getPromotedAlbum.ts`). No server-side art fetching.
- **Deezer**: album _detail_ endpoint exposes `upc` (barcode); artist album lists do not. Our `DeezerAlbum` type doesn't currently include it. **Apple** (iTunes Search API): no UPC/barcode exposed.
- **Grab status**: `enrichRequestsWithLidarr(albumMbids)` (`server/services/requests/lidarrEnrichment.ts`) maps release-group MBIDs → `downloading | wanted | imported | null` via 4 local Lidarr calls (queue, wanted, history×2). Requires MB release-group MBIDs.
- **Similar artists**: `UserProfile.profile_json` contains a precomputed `SimilarGraphSeed[]` graph, regenerated with the profile. ListenBrainz labs similar-artists client also exists (`server/api/listenbrainz/`).

## Decisions

### 1. Architecture: invert the lookup, no per-artist polling for library/similar tiers

- **Followed tier**: reuse the existing poller + `SeenRelease` pipeline unchanged. The
  "extend `FollowedArtist` with a source flag" idea from the issue is **dropped** — it
  reintroduces per-artist polling and collides with `FollowedArtist` being per-user while
  the Lidarr library is global.
- **Library + similar tiers**: fetch the ListenBrainz fresh-releases feed once, intersect
  locally against (a) Lidarr library artist MBIDs (`getArtistList()`, `foreignArtistId`)
  and (b) the similar-artist MBID set from the user's `UserProfile` graph.
- **Caching** (D5 resolved): global in-memory cache of the trimmed feed, **6h TTL**
  (aligned with the followed poller). Trim on ingest: drop unused fields so we hold a few
  MB, not 14 (type filtering itself happens at read time per decision 3). Per-user
  intersection is Set lookups over ~30k items — computed per request, no per-user cache
  needed.
- **No persistence needed**: nothing stored alongside `UserProfile`. The similar-artist set
  is already persisted there; the feed is global and cheap to refetch (one request after a
  restart). Revisit only if cold-start cost ever matters.
- **Request-time external calls**: at most one (the LB feed on cache miss). Lidarr calls
  are local. MusicBrainz is never hit at request time.

### 2. Apple/Deezer freshness and MBIDs (partially open — see D2, D4)

Blend keeps all three followed-tier sources; Apple/Deezer exist precisely because MB lags
community data entry, so we don't drop their releases.

- **MBID backfill**: when a later poll returns the MB version of a release whose
  `release_key` already exists as a row with `release_group_mbid IS NULL`, fill in the
  MBID, cover URL, and type fields instead of skipping it as seen. Items acquire MBIDs as
  soon as MB catches up — no extra requests. (No provider enum in storage; see decision
  10.)
- **Until an MBID exists**: item still shows in the tile with Deezer/Apple cover art;
  click falls back to the search page; no grab-status badge (can't enrich without an MBID).
- **Barcode lookup rejected** (D2 resolved): Deezer `upc` → MB `barcode:` search would
  only help title-normalization misses, which the fuzzy `release_key` match already covers
  in practice. Not worth the extra poll-time requests. MBID backfill is the only
  resolution mechanism.

### 3. Release type filter

- **Keep**: Album, EP, **Single** (singles are wanted, contrary to the issue text).
- **Exclude** (D3 resolved): releases with any MB secondary type **except** `Soundtrack`
  and `Mixtape/Street`, which stay in. Blocklist: Compilation, Live, Remix, DJ-mix, Demo,
  Spokenword, Interview, Audiobook, Audio drama, Field recording.
- **Future**: build the filter as data (a set of allowed/blocked types), not hardcoded
  conditionals — it should become **user-configurable** eventually. Type taste is
  per-user (one user listens to soundtracks, another doesn't), so the natural home is a
  per-user setting once the section proves out. Not in scope for the first version.
- **Where**: filter at **read time**, everywhere. `aggregateArtistReleases` stores all
  releases with their type; the new-releases endpoint (and any other reader) applies the
  blocklist when serving. Library/similar tiers filter when intersecting the LB feed
  (`release_group_secondary_type` is in the payload). Rationale: write-time filtering
  would bake today's global blocklist into storage and make the future per-user
  configurability impossible for already-polled releases.
- **Old rows**: type columns (see decision 10) are populated going forward; existing
  `NULL` rows pass through unfiltered (agreed: honest pass-through beats rate-limited
  re-lookup).
- **Deezer/Apple items** (D4 resolved): store what the source gives. Deezer `record_type`
  maps to album/ep/single/compilation, so Deezer compilations get blocked at read time.
  Apple exposes no type info → `release_type` stays NULL → passes through; MBID backfill
  reclassifies once MusicBrainz catches up. No title heuristics.

### 4. Item provenance = a `source` state, not a badge

Two distinct concepts on each item:

- **Source** = _why this release is in your feed_: the **artist** is followed / in your
  library / similar to your taste. The album itself is brand new and typically not
  grabbed yet.
- **Grabbed state** = _the state of this specific album_: already requested / downloading /
  imported by Lidarr.

Decided: provenance is carried as a `source` field
(`"followed" | "library" | "similar"`) on each item and rendered **subtly** — not in the
cartoon-pill style of `InLibraryBadge`. That badge style stays exclusive to album grab
state. Rendering of source: small muted label (colored dot + text, e.g. "Artist you
follow" / "Artist in library" / "Similar artist") under the title/artist lines —
exact styling settled during implementation (D1 narrowed to visual detail only).

### 5. Branch strategy

Stack `feat/discover-new-releases` on top of `feat/discover-section-grid` (PR #192, open).
Rebase after #192 merges.

### 6. Similar-artist source

Use the `UserProfile` precomputed similar graph (`SimilarGraphSeed[]`) — that cache exists
exactly so we have an on-demand taste profile without hitting external sources. No live
ListenBrainz labs or Last.fm calls for this tier. If the profile is missing, skip the
similar tier (the other two tiers still fill the shelf).

### 7. Cover art

Follow the existing pattern: direct CAA URL by release-group MBID with client-side `<img>`
fallback handling. Non-MB items (followed tier, pre-backfill) use Deezer/Apple artwork
URLs. No server-side art proxying.

### 8. Mobile shelf

Inline `overflow-x-auto snap-x` in `NewReleasesSection`. No `ShelfOrGrid` shared primitive
yet — extract when a second consumer appears.

### 9. Per-entry viewed state replaces the `followed_last_viewed_at` watermark

Add a nullable `viewed_at` column to the followed-releases table (part of the decision 10
migration). Semantics:

- **Dashboard impression ≠ viewed.** The dashboard is the landing page; marking on render
  would clear everything on every visit and the user may not have noticed the tile.
- **Dashboard click = that entry viewed** (per-entry, conscious signal).
- **Following-page visit = all listed entries viewed** (inbox-open pattern, parity with
  today's behavior).
- Unseen count becomes `COUNT(viewed_at IS NULL)` instead of watermark comparison.
- No impression-based priority decay: an unclicked unseen followed release staying on top
  of the shelf is correct behavior.
- Migration backfill: `viewed_at = followed_last_viewed_at` for rows with
  `notified_at <= watermark`; the `User.followed_last_viewed_at` column is dead afterwards
  (mark-viewed endpoint and unseen-count query move to per-entry).
- **Scope**: viewed state exists for the followed tier only. Library/similar shelf items
  are computed live from the LB feed and have no per-user rows; tracking "viewed" for them
  would need a separate `(user_id, release_group_mbid)` table — skipped, no use case.

### 10. Contract: entity rename, schema, endpoint, modules (D6 resolved)

#### Entity rename + provider-agnostic schema

`SeenRelease` → **`FollowedRelease`** (table `seen_releases` → `followed_releases`,
frontend `SeenReleaseItem` → `FollowedReleaseItem`). "Seen" was ambiguous (poller-seen vs
user-seen) and becomes actively misleading next to `viewed_at`.

Verified before deciding (2026-07-09): `source` and `external_id` have **zero consumers**
— the frontend never reads either, and the only server-side use of `source` is the
in-memory dedup ranking inside `releaseAggregator.ts` (which keeps its internal `source`
field on `AggregatedRelease`; provider knowledge stays in the `server/api/*` adapters).
Storing a provider enum was pure lock-in, so:

One migration:

- Rename table.
- **Drop** `source`, `external_id`.
- **Add** `release_group_mbid: string | null` — backfill from
  `external_id WHERE source = 'musicbrainz'`; Deezer/Apple ids are discarded (nothing
  referenced them).
- **Add** `cover_url: string | null` — resolved at poll time (MB → CAA URL, Deezer →
  `api.deezer.com/album/{id}/image`, Apple → `artworkUrl100`).
- **Add** `release_type: string | null` (normalized primary type: Album/EP/Single/…) and
  `secondary_types: string | null` (JSON array — SQLite has no arrays). Both needed for
  read-time filtering: primary allowlist + secondary blocklist. Deezer `record_type` maps
  in ("compilation" → `["Compilation"]`); Apple → NULL until MBID backfill.
- **Add** `viewed_at: string | null` (decision 9) — backfill
  `viewed_at = followed_last_viewed_at WHERE notified_at <= watermark`;
  `User.followed_last_viewed_at` is dead afterwards.
- Delete the `ReleaseNotificationSource` frontend type.

`AggregatedRelease` gains `cover_url` + type fields so the poller can store them.

#### Endpoint: `GET /api/discover/new-releases` (requireAuth)

```ts
type NewReleaseSource = "followed" | "library" | "similar";

type NewReleaseItem = {
  /** MB release-group MBID; null only for pre-backfill Deezer/Apple followed items */
  releaseGroupMbid: string | null;
  title: string;
  artistName: string;
  artistMbid: string | null;
  releaseDate: string | null;
  source: NewReleaseSource;
  coverUrl: string | null;
  lidarrStatus: "downloading" | "wanted" | "imported" | null;
  /** followed-tier only — enables click-to-mark-viewed */
  followedReleaseId: number | null;
};

type NewReleasesResponse = {
  items: NewReleaseItem[]; // ≤6
  windowDays: 30 | 60 | 90; // final widened window, drives honest relative dates
};
```

- `NewReleaseItem` is **mapped, never shared**: the discover service maps
  `FollowedRelease` rows (followed tier) and LB feed entries (library/similar tiers) into
  this shape. The following tab keeps consuming `FollowedReleaseItem` independently.
- `NewReleaseItem.source` (tier) is unambiguous now that the stored provider enum is gone.
- Tier precedence when an artist qualifies for several: followed > library > similar.
  Dedup across tiers by release-group MBID (fallback `release_key`).
- Selection per D7; Lidarr enrichment on the final ≤6 only, after selection.
- `items: []` after widening to 90d → section reports `empty` → tile hides. 1–5 items
  render as-is, no filler.

#### Viewed endpoints

- New `POST /api/followed/releases/:id/viewed` — per-entry (dashboard click).
- Existing `POST /api/followed/mark-viewed` — rewritten to set `viewed_at = now()` on all
  NULL rows for the user.

#### Module layout

```
server/api/listenbrainz/freshReleases.ts        LB client: getFreshReleases(days) + types
server/services/discover/feedCache.ts           global trimmed feed cache, 6h TTL
server/services/discover/typeFilter.ts          blocklist as data (config-ready)
server/services/discover/newReleases.ts         tiers → window → dedup → select → enrich
server/routes/discover.ts                       GET /new-releases, mounted at /api/discover
server/db/migration/<ts>-FollowedReleases.ts    rename + drop 2 + add 5 + backfills

src/hooks/useNewReleases.ts                     plain useAsyncData fetch
src/pages/DiscoverPage/components/sections/NewReleasesSection.tsx
```

Registry entry:
`{ id: "newReleases", span: { cols: 4, rows: 1 }, desktopOrder: 3, mobileOrder: 2, whenEmpty: "hide" }`
— the artists section's `mobileOrder` bumps to 3 (news above artists on mobile).

## Open discussion points

- **D1 — Source rendering (narrowed)**: decided that provenance is a `source` state
  rendered subtly, not an `InLibraryBadge`-style pill (see decision 4). Remaining: exact
  visual (dot + muted text proposed) and whether grabbed state reuses the small
  check-overlay-on-cover pattern from `ArtistCard`. Settle during implementation.
- ~~**D2 — Barcode MBID resolution**~~: resolved — not doing it (see decision 2).
- ~~**D3 — Exact secondary-type blocklist**~~: resolved — allow Soundtrack +
  Mixtape/Street, block the rest; structure for future per-user configurability (see
  decision 3).
- ~~**D4 — Noise detection for Deezer/Apple-sourced items**~~: resolved — store source
  type info (Deezer `record_type`), Apple stays NULL until backfill (see decision 3).
- ~~**D5 — Feed cache TTL**~~: resolved — 6h (see decision 1).
- ~~**D6 — Endpoint contract**~~: resolved — see decision 10.
- ~~**D7 — Window widening + selection**~~: resolved — one shared window across all
  tiers, widened 30 → 60 → 90 days on the blended pool until ≥6 items. Followed releases
  outside the current window are excluded from the shelf (they remain on
  `/library/following`) — no stale-followed filler. When the pool exceeds 6: **unseen
  followed releases first** (unseen = `viewed_at IS NULL`, see decision 9), newest first
  within that group; remaining slots fill newest-first from the rest of the pool.

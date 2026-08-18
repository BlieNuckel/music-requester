# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `pnpm dev` — Run both Vite client (port 3002) and Express server (port 3001) concurrently
- `pnpm start:client` — Vite dev server only
- `pnpm start:server` — Express server only (via tsx)
- `pnpm build` — Vite production build to `/build`
- `pnpm lint` — ESLint (flat config, TypeScript + React)
- `pnpm format` — Prettier format all files
- `pnpm format:check` — Prettier check formatting
- `pnpm typecheck` — TypeScript type checking for both frontend and server
- `pnpm typecheck:client` — TypeScript type checking for frontend only
- `pnpm typecheck:server` — TypeScript type checking for server code only (`cd server && tsc --noEmit`)
- `pnpm test` — Run frontend tests (Vitest + jsdom + testing-library, config: `vitest.config.ts`)
- `pnpm test:server` — Run server tests (Vitest + node, config: `server/vitest.config.ts`)
- `pnpm vitest run src/components/__tests__/Modal.test.tsx` — Run a single frontend test file
- `pnpm vitest run --config server/vitest.config.ts server/config.test.ts` — Run a single server test file
- `pnpm migration:generate server/db/migration/<Name>` — Generate a TypeORM migration
- `pnpm migration:run` — Run pending TypeORM migrations
- `pnpm seed` — Run dev seed script
- `pnpm dev:mock` — Dev mode with `MOCK_LIDARR=true`

## Architecture

Full-stack TypeScript app: React 19 frontend + Express 5 backend. Vite proxies `/api/*` to the Express server in development. In production, Express serves the built frontend as static files from `/build`.

**Frontend (`/src`):** React with React Router DOM, Tailwind CSS v4 for styling. Path aliases: `@/*` maps to `./src/*`, `@shared/*` maps to `./shared/*`. Pages live under `src/pages/` with co-located sub-components and `__tests__/` directories:

- `/` — DiscoverPage (definition-driven bento grid: sections registered in `sections.ts`, arranged by `layout.ts`; includes the promoted album spotlight carousel, promoted artists, and the new releases shelf)
- `/search` — SearchPage (MusicBrainz album search)
- `/artist/:mbid` — ArtistPage (artist details, discography, similar artists, collapsible sections)
- `/album/:mbid` — AlbumPage (release group details, tracks, purchase/request actions)
- `/library` — LibraryPage (subroutes: `/library/purchases`, `/library/wanted`, `/library/requests`, `/library/following`)
- `/library/upload` — UploadPage (manual import)
- `/settings` — SettingsLayout (subroutes: general, integrations with per-service group pages (lidarr, soulseek, plex, lastfm, live-events), recommendations, purchase-decision, users, logs, notifications with email/webhook sub-pages; settings search via `settingsSearchConfig.ts`). The integrations parent owns the shared auto-save state and connection-test results and passes them to the active group through the router outlet.
- `/onboarding` — OnboardingPage (first-run setup wizard)

SetupPage (create first admin) and LoginPage are not routed — the `RequireAuth` component wraps all app routes and renders them based on auth status (`needs-setup` / `unauthenticated`).

Shared components in `src/components/`. Frontend uses plain `fetch()` to relative `/api/...` paths — no shared HTTP client.

**Tailwind CSS v4:** Uses `@tailwindcss/postcss` — the legacy `tailwind.config.cjs` is ignored. All custom theme values, keyframes, and animations are defined in `src/index.css` using `@theme` blocks and plain CSS.

**State management:** Contexts live in `src/context/`. `SettingsContext` holds global settings, connection status, and Lidarr options (profiles, root paths). `AuthProvider` holds auth status and the current user. `ThemeContext` manages light/dark/system theme. All other state is page-local via custom hooks in `src/hooks/` — most data-fetching hooks build on `useAsyncData`, which owns the loading/error/data lifecycle.

**Backend (`/server`):** Express, layered as routes → services → API clients:

- **Route layer** (`/server/routes/`) — thin Express routers that delegate to services. Routes mount at `/api/settings`, `/api/lidarr`, `/api/musicbrainz`, `/api/lastfm`, `/api/plex`, `/api/promoted-album`, `/api/promoted-artists`, `/api/torznab`, `/api/sabnzbd`, `/api/auth`, `/api/users`, `/api/requests`, `/api/purchases`, `/api/wanted`, `/api/followed`, `/api/discover`, `/api/logs`. The Lidarr router is an aggregator that mounts sub-routers (add, albums, artists, history, import, queue, search, wanted, qualityProfile, rootPath, metadataProfile, autoSetup).
- **Service layer** (`/server/services/`) — business logic between routes and API clients/DB: `lidarr/`, `requests/` (request CRUD, fulfillment, Lidarr enrichment, status polling/sync), `wanted/`, `purchases/`, `purchaseDecision/` (buy-vs-download evaluation: label blocklist, release age), `followed/` (followed artists, new-release aggregation, poller), `discover/` (blended new releases across followed artists, library artists, and similar artists), `profile/` (user taste profile: signal ingestion + pollers for regen), `torznab/` (search, XML, release titles), `sabnzbd/` (queue, history, addFile, transfers), plus single-file services (`musicbrainz.ts`, `lastfm.ts`, `plex.ts`, `settings.ts`, `pathValidation.ts`).
- **MusicBrainz pacing and caching** (`/server/api/musicbrainz/`) — MusicBrainz allows ~1 req/sec, so every call goes through `mbJson()` (`config.ts`), which takes a slot from the serial queue in `queue.ts`. The queue has two lanes: `interactive` (searches, page loads) preempts `background` (pollers, profile regeneration, cache revalidation), with an anti-starvation cap so background work still progresses under sustained interactive load. Every client function wraps its loader in `mbCached()` (`cache.ts`), which adds a TTL cache keyed per function, in-flight dedup so identical concurrent calls spend one slot, and an optional `revalidate` strategy that serves stale data while refreshing on the background lane. TTLs come from `MB_TTL` and are chosen by volatility: `immutable` for facts about one MBID, `slow` for entities that only get corrected, `volatile` (plus `revalidate`) for searches and discographies, which gain entries when an artist releases something. Two rules keep this correct: never call MusicBrainz outside `mbJson` (one unpaced call turns the whole queue back into a burst), and never widen `NOT_FOUND_STATUSES` (only 400/404 are statements about the entity — a 429 or 5xx cached as a miss would persist for the whole TTL). `mbFetch` retries retryable statuses and timeouts itself, taking a **fresh queue slot per attempt** — retrying inside `resilientFetch` would fire the retry without pacing. A 429/503 also trips a breaker (`reportMbThrottled`) that pauses both lanes with a doubling backoff, honoring `Retry-After`; any normal response clears it.
- **API client layer** (`/server/api/`) — each external API has a `<name>/` directory (`lidarr/`, `lastfm/`, `musicbrainz/`, `plex/`, `deezer/`, `listenbrainz/`, `slskd/`) containing `types.ts`, usually `config.ts`, and function files. Clients are built with `createExternalApi()` (`server/api/externalApi.ts`), which provides caching (node-cache), rate limiting, timeouts, retry (`retry.ts`), in-flight request dedup, and resilient fetch over undici (`resilientFetch.ts`). `resilientFetch` retries thrown errors (network faults, timeouts) by default; retrying _responses_ that carry a 429/5xx is opt-in via `retryOnStatus`, since `fetch` resolves rather than throws on those and enabling it everywhere would multiply load during an outage. Service configs read from `getConfig()` lazily at request time (no restart needed after settings change).
- **Middleware** (`/server/middleware/`) — `errorHandler.ts` (global Express error handler), `requireAuth.ts` (session cookie authentication), `requirePermission.ts` (bitfield permission checks), `ApiError.ts` (typed error class with HTTP status).
- **Auth layer** (`/server/auth/`) — session management (`sessions.ts`), password hashing (`password.ts`), user CRUD (`users.ts`). Sessions stored in SQLite alongside users.

**Recommendations (`/server/promotedAlbum/`, `/server/promotedArtists/`):** Promoted-album picker (artist weighting, exploration of adjacent artists, profile-driven candidate selection via `profileService.ts`) and promoted-artists list. Backed by the persisted user taste profile (`UserProfile` entity, derived from Plex plays/ratings snapshots and signal events) maintained by `/server/services/profile/`.

**Background pollers:** started in `server/index.ts` at boot — followed-artist release poller, request status poller, profile regen poller, signal ingestion poller. Intervals come from config.

**Logging (`server/logger.ts`):** Winston with daily-rotate-file, writing to `APP_CONFIG_DIR/logs`. Create scoped loggers via `createLogger("Scope")`. Logs are exposed at `/api/logs` and in the Logs settings page.

**Database (`/server/db/`):** SQLite via better-sqlite3 + TypeORM. Entities in `/server/db/entity/`: `User`, `Session`, `Request`, `Config`, `WantedItem`, `FollowedArtist`, `FollowedRelease`, `Purchase`, `UserProfile`, `UserSignalEvent`. Migrations in `/server/db/migration/` run automatically on startup (`migrationsRun: true`). WAL mode enabled. Access the singleton DataSource via `getDataSource()` after `initializeDatabase()`.

Query construction lives in per-entity modules alongside the entities — `wantedItems.ts`, `purchases.ts`, `requests.ts`, `followed.ts`, `notificationPreferences.ts`, `pushSubscriptions.ts`, `userProfile.ts`. **Services compose those functions; they do not build queries.** Nothing under `/server/services/` should import `getDataSource` or call `getRepository`. Multi-row writes that must land together belong in a `getDataSource().transaction()` inside the db module, not spread across service-level awaits. `/server/auth/` and `/server/config.ts` own their own storage and are the deliberate exceptions.

**Auth & permissions:** Bitfield-based permission system in `shared/permissions.ts` (shared between frontend and backend). Permissions: `ADMIN`, `MANAGE_USERS`, `MANAGE_REQUESTS`, `REQUEST`, `AUTO_APPROVE`, `REQUEST_VIEW`. `ADMIN` bypasses all checks. Auth uses HTTP-only session cookies (`tunearr_session`). Most routes require `requireAuth`. `/api/auth` is public. `/api/logs` requires `ADMIN`. `/api/torznab` and `/api/sabnzbd` cannot use session cookies because Lidarr calls them, so they go through `requireIndexerKey` instead, which checks an `apikey` request parameter against the `torznabApiKey` config value — and passes everything through while that value is unset, so upgrades don't break a running Lidarr. Each user's Plex OAuth token is stored on the `User` entity (`plex_token` column) and used for per-user Plex media server queries. The server config only stores `plexUrl` (shared), not the token. `AuthUser` includes `hasPlexToken` (sent to frontend) and `plexToken` (server-side only). The `/api/auth/store-plex-token` endpoint updates a user's stored Plex token.

**Soulseek integration via torznab/SABnzbd emulation:** The app integrates Soulseek (via an external slskd daemon) into Lidarr's standard indexer+download-client workflow by emulating two services. The slskd client lives in `/server/api/slskd/`; the emulation logic lives in `/server/services/torznab/` and `/server/services/sabnzbd/`:

- **Torznab indexer** (`/api/torznab`) — Newznab-compatible endpoint that Lidarr queries for music searches. Translates search requests into slskd queries, groups results by user+directory into logical releases (`slskd/groupResults.ts`), and returns RSS/XML. Results are cached for 30 minutes. Download URLs point back to `/api/torznab/download/{guid}`, which returns a fake NZB containing base64-encoded slskd metadata (username + file list) via `slskd/nzb.ts`.
- **SABnzbd emulator** (`/api/sabnzbd`) — Lidarr sends the NZB here as a "download client". The router decodes the embedded metadata, enqueues P2P downloads with slskd (`slskd/transfer.ts`), and tracks progress in-memory (`slskd/downloadTracker.ts`). Lidarr polls queue/history endpoints; the emulator maps slskd transfer states to SABnzbd format (`slskd/statusMap.ts`).

The result: Lidarr sees a normal indexer and download client, but downloads actually come from Soulseek P2P via slskd.

**Shared code (`/shared/`):** Code shared between frontend and backend: `permissions.ts` (Permission enum, `hasPermission()` helper) and `currency.ts`. Importable from both sides via `@shared/*`.

**Config system** (`server/config.ts`): Persisted as JSON at `APP_CONFIG_DIR/config.json`. `getConfig()` reads from disk and merges with defaults on every call (nested config objects like `promotedAlbum`, `purchaseDecision`, `spending` are deep-merged). `setConfig()` validates and writes. `getConfigValue<K>(key)` provides typed single-field access.

**Key patterns:**

- External API clients created via `createExternalApi()` — don't hand-roll fetch/caching/rate-limiting per service
- `withCache()` (`server/cache.ts`) for memoizing arbitrary async functions with a TTL
- All external API calls routed through the backend
- Functional components with custom hooks — no class components
- Tailwind utility classes only — no custom CSS files
- `Promise.all()` for concurrent independent requests
- Prettier enforced by `pnpm format:check` in CI and applied to staged files by the pre-commit hook (`pnpm-lock.yaml` is prettier-ignored — it stays in pnpm's own format)
- `ApiError` class for throwing HTTP errors in routes/services — caught by `errorHandler`
- `undici` used for server-side HTTP requests (not node-fetch)

## Environment Variables

- `APP_DATA_DIR` — Host path for persistent data
- `APP_CONFIG_DIR` — Host path for runtime config JSON and logs (default: `./config`)
- `PORT` — Server port (default: 3001)

## Testing

**Every feature MUST have full test coverage — both frontend and backend — before it is considered complete.** No feature is done until its tests are written and passing.

- **Frontend tests** (`pnpm test`): Use Vitest + jsdom + React Testing Library. Test files go in `__tests__/` directories co-located with the code they test. Cover component rendering, user interactions, loading/error states, and hook behavior.
- **Backend tests** (`pnpm test:server`): Use Vitest in node mode. Test files go alongside the code they test (e.g., `server/config.test.ts`). Cover service functions, route handlers, middleware, and edge cases. Mock external API calls — never make real network requests in tests.
- **When modifying existing features**, update or add tests to cover the changes. Never leave existing tests broken.
- **Run both test suites** (`pnpm test` and `pnpm test:server`) before considering any work complete. All tests must pass.

## Code Style

- JSDoc comments for type annotations are encouraged
- No other comments unless logic has non-obvious outliers
- TypeScript strict mode enabled with `noUnusedLocals` and `noUnusedParameters`
- ESLint flat config with separate rules for client (`src/`), server (`server/`), and CJS files
- Separate tsconfig for server (`server/tsconfig.json`) using Node module resolution vs root tsconfig using bundler resolution for frontend
- **Types at top of file**: All `type` and `interface` declarations must appear before any function/const declarations at the module level
- **No nested function definitions**: Extract functions to module level with explicit parameters instead of closures. Exceptions: React event handlers and hook functions that genuinely need closure over state/props, and inline callbacks to array methods (`.map()`, `.filter()`, etc.)
- **Function length ~50 lines**: Break down functions exceeding ~50 lines of logic. Use judgement — JSX length in React components doesn't count the same as logic, but 100+ line components should still be split into sub-components

## Deployment

Multi-stage Dockerfile: builds frontend with Vite, then runs the server with tsx (`node_modules/.bin/tsx server/index.ts`) in a `node:22-alpine` image as the non-root `node` user. `APP_CONFIG_DIR=/config` is intended to be bind-mounted for persistence.

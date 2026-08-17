import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { initializeConfig } from "./config";
import { initializeDatabase } from "./db/index";
import { createLogger } from "./logger";
import { errorHandler } from "./middleware/errorHandler";
import { requireAuth } from "./middleware/requireAuth";
import { requireIndexerKey } from "./middleware/requireIndexerKey";
import { requirePermission } from "./middleware/requirePermission";
import { Permission } from "../shared/permissions";
import authRoutes from "./routes/auth";
import lastfmRoutes from "./routes/lastfm";
import lidarrRoutes from "./routes/lidarr";
import logsRoutes from "./routes/logs";
import musicbrainzRoutes from "./routes/musicbrainz";
import plexRoutes from "./routes/plex";
import promotedAlbumRoutes from "./routes/promotedAlbum";
import promotedArtistsRoutes from "./routes/promotedArtists";
import requestsRoutes from "./routes/requests";
import sabnzbdRoutes from "./routes/sabnzbd";
import settingsRoutes from "./routes/settings";
import torznabRoutes from "./routes/torznab";
import usersRoutes from "./routes/users";
import purchasesRoutes from "./routes/purchases";
import wantedRoutes from "./routes/wanted";
import followedRoutes from "./routes/followed";
import discoverRoutes from "./routes/discover";
import liveRoutes from "./routes/live";
import similarAlbumsRoutes from "./routes/similarAlbums";
import notificationsRoutes from "./routes/notifications";
import { initializeNotifications } from "./services/notifications";
import { startFollowedArtistPoller } from "./services/followed/poller";
import { startLiveEventsPoller } from "./services/liveEvents/poller";
import { installQuotaTracking } from "./services/liveEvents/quota";
import { startRequestStatusPoller } from "./services/requests/statusPoller";
import { startProfileRegenPoller } from "./services/profile/regenPoller";
import { startSignalIngestionPoller } from "./services/profile/signalPoller";
import { startSpotlightWarmer } from "./promotedAlbum/warmer";
import { getConfig } from "./config";

const log = createLogger("Server");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Honor X-Forwarded-Proto from a reverse proxy so req.secure reflects the
// client-facing protocol, which decides whether the session cookie is Secure.
app.set("trust proxy", true);

app.use(express.json());

app.use("/api/auth", authRoutes);

// Lidarr talks to these two without a session, so they authenticate by apikey instead.
app.use("/api/torznab", requireIndexerKey, torznabRoutes);
app.use("/api/sabnzbd", requireIndexerKey, sabnzbdRoutes);
app.use(
  "/api/logs",
  requireAuth,
  requirePermission(Permission.ADMIN),
  logsRoutes
);

app.use("/api/settings", settingsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/musicbrainz", requireAuth, musicbrainzRoutes);
app.use("/api/lidarr", requireAuth, lidarrRoutes);
app.use("/api/lastfm", requireAuth, lastfmRoutes);
app.use("/api/plex", requireAuth, plexRoutes);
app.use("/api/promoted-album", requireAuth, promotedAlbumRoutes);
app.use("/api/promoted-artists", requireAuth, promotedArtistsRoutes);
app.use("/api/requests", requestsRoutes);
app.use("/api/purchases", purchasesRoutes);
app.use("/api/wanted", wantedRoutes);
app.use("/api/followed", followedRoutes);
app.use("/api/discover", requireAuth, discoverRoutes);
app.use("/api/live", liveRoutes);
app.use("/api/similar-albums", requireAuth, similarAlbumsRoutes);
app.use("/api/notifications", notificationsRoutes);

if (process.env.NODE_ENV === "production") {
  app.use(
    express.static(path.join(__dirname, "..", "build"), {
      setHeaders: (res, filePath) => {
        // The worker must revalidate on every load, or a deploy can leave the
        // previous one in control for as long as the browser caches it.
        if (path.basename(filePath) === "sw.js") {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "build", "index.html"));
  });
}

app.use(errorHandler);

await initializeDatabase();
initializeConfig();
initializeNotifications();

const followedPollIntervalMs =
  getConfig().followedArtistPollIntervalMs ?? 6 * 60 * 60 * 1000;
startFollowedArtistPoller(followedPollIntervalMs);

const requestStatusPollIntervalMs =
  getConfig().requestStatusPollIntervalMs ?? 2 * 60 * 1000;
startRequestStatusPoller(requestStatusPollIntervalMs);

const profileRegenIntervalMs =
  getConfig().promotedAlbum.backgroundRegenIntervalMinutes * 60 * 1000;
startProfileRegenPoller(profileRegenIntervalMs);

startSignalIngestionPoller();

installQuotaTracking();
startLiveEventsPoller();

const spotlightWarmIntervalMs =
  getConfig().promotedAlbum.cacheDurationMinutes * 60 * 1000;
startSpotlightWarmer(spotlightWarmIntervalMs);

app.listen(PORT, () => {
  log.info(`Listening on port ${PORT}`);
});

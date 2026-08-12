<p align="center">
  <img src="public/favicon.svg" alt="Tunearr" width="80" />
</p>

<h1 align="center">Tunearr</h1>

<p align="center">
  A self-hosted web app for discovering, requesting, and managing music through Lidarr — with multi-user requests, taste-based recommendations, and optional Soulseek integration.
</p>

<p align="center">
  <img src="docs/screenshots/discover.png" alt="Tunearr — Discover page" width="700" />
</p>

---

## Features

- **Discover** — Personalized recommendations built from your Plex listening history, plus new releases and genre exploration beyond your usual taste.
- **Search & browse** — Search MusicBrainz for artists and albums, then request them or add them straight to Lidarr.
- **Requests** — Multi-user request workflow with approvals, tracked until the music lands in your library.
- **Users & permissions** — Multiple accounts with granular permissions; each user can link their own Plex account.
- **Soulseek integration** — Hook up [slskd](https://github.com/slskd/slskd) and Lidarr downloads from Soulseek like from any normal indexer.
- **Buy or download** — Get suggestions for when an album is better bought than downloaded, with spending tracking and an optional budget.
- **Library** — Keep tabs on purchases, wanted albums, and requests, and follow artists to catch new releases.
- **Manual import** — Upload purchased music through the web interface and import it into Lidarr.

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/artist.png" alt="Artist page with discography" width="100%" />
      <p align="center"><sub>Artist page — discography, follow, and what's already in your library</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/library.png" alt="Requests tab in the library" width="100%" />
      <p align="center"><sub>Library — requests tracked through to import, with spending totals</sub></p>
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <img src="docs/screenshots/settings.png" alt="Settings" width="100%" />
      <p align="center"><sub>Settings — integrations, recommendations, users, and logs</sub></p>
    </td>
  </tr>
</table>

## Getting started

However you deploy (Docker or NixOS), first run works the same:

1. Open Tunearr in your browser (default port `3001`).
2. Create the first admin account.
3. Follow the onboarding wizard: connect Lidarr (URL + API key), pick quality/metadata profiles and a root folder, and optionally set up Last.fm, Plex, and the manual import directory.

Everything in the wizard can be changed later under **Settings**.

## Running with Docker Compose

### Prerequisites

- Docker and Docker Compose
- A running Lidarr instance

### Setup

1. Create a `docker-compose.yml`:

```yaml
services:
  tunearr:
    image: ghcr.io/blienuckel/tunearr:latest
    user: "1000:1000"
    ports:
      - "3001:3001"
    volumes:
      - ./config:/config
    restart: unless-stopped
```

If you want to use the manual import feature, also mount the directory your music files will be uploaded to:

```yaml
volumes:
  - ./config:/config
  - /path/to/your/music/imports:/imports
```

2. Start the container:

```sh
docker compose up -d
```

3. Open `http://localhost:3001` and follow [Getting started](#getting-started).

All persistent state (settings, database, logs) lives in the `/config` volume.

For a complete stack — Tunearr, Lidarr, and slskd with the shared volumes wired up — see the [Docker setup guide](docs/setup-docker.md).

### Building from source

```sh
git clone git@github.com:BlieNuckel/tunearr.git
cd tunearr
docker build -t tunearr .
docker run -d -p 3001:3001 -v ./config:/config tunearr
```

## Running on NixOS

The repository is a flake that ships a package and a NixOS module.

1. Add the flake input:

```nix
{
  inputs.tunearr.url = "github:BlieNuckel/tunearr";
}
```

2. Import the module and enable the service:

```nix
{
  imports = [ inputs.tunearr.nixosModules.tunearr ];

  services.tunearr = {
    enable = true;
    port = 3001;
    openFirewall = true;
  };
}
```

3. Rebuild, open `http://<host>:3001`, and follow [Getting started](#getting-started).

### Module options

| Option                          | Default              | Description                                                      |
| ------------------------------- | -------------------- | ---------------------------------------------------------------- |
| `services.tunearr.enable`       | `false`              | Enable the service                                               |
| `services.tunearr.port`         | `3001`               | TCP port the server listens on                                   |
| `services.tunearr.dataDir`      | `"/var/lib/tunearr"` | Persistent state: SQLite database, config JSON, logs             |
| `services.tunearr.user`         | `"tunearr"`          | User to run as (set to an existing user, e.g. `media`, to share) |
| `services.tunearr.group`        | `"tunearr"`          | Group to run as                                                  |
| `services.tunearr.openFirewall` | `false`              | Open the port in the firewall                                    |
| `services.tunearr.environment`  | `{ }`                | Extra environment variables for the service                      |

An overlay is also available as `inputs.tunearr.overlays.default` if you prefer managing the package yourself.

For a complete configuration — Tunearr, Lidarr, and slskd on one host with permissions sorted out — see the [NixOS setup guide](docs/setup-nixos.md).

## Integrations

| Service | Required | Purpose                                                      |
| ------- | -------- | ------------------------------------------------------------ |
| Lidarr  | Yes      | Music library management; requests and imports go through it |
| Last.fm | No       | Similar artists and genre tags for discovery                 |
| Plex    | No       | Listening history and ratings that power recommendations     |
| slskd   | No       | Soulseek downloads via Lidarr (see below)                    |

MusicBrainz, Deezer (album artwork), and ListenBrainz are used automatically and need no configuration.

Setup details for each integration are in the [integrations guide](docs/integrations.md).

### Soulseek via slskd

Tunearr can bridge Soulseek into Lidarr's normal workflow. Point Tunearr at your slskd instance under **Settings → Integrations**, then click **Set Up in Lidarr** — Tunearr creates the indexer and download client in Lidarr for you. (You can also add them manually: a Newznab indexer at `http(s)://<tunearr>/api/torznab` and a SABnzbd download client at `http(s)://<tunearr>/api/sabnzbd`.)

Lidarr then searches, grabs, and imports Soulseek releases exactly like it would from any indexer — Tunearr handles the translation to and from slskd behind the scenes. The [Soulseek guide](docs/soulseek.md) explains how the bridge works, how to configure slskd, and how to get the download path right.

> **Note:** the `/api/torznab` and `/api/sabnzbd` endpoints are unauthenticated so Lidarr can reach them. Don't expose Tunearr directly to the internet without a reverse proxy handling access control.

## Notifications

Each user chooses what they want to hear about under **Settings → Notifications → Mine**, and turns push on per device. Tunearr generates its own VAPID keypair on first boot, so there is no account to create and nothing to pay for.

Push notifications need Tunearr to be reachable over **HTTPS**. Browsers disable service workers on plain HTTP, and no service worker means no push — a LAN address like `http://192.168.1.10:3001` cannot deliver notifications no matter how it is configured. Put Tunearr behind a reverse proxy with a certificate, a Tailscale `serve`, or a tunnel, and the settings page will pick it up.

On iPhone and iPad there is one extra step: Apple only allows web notifications for installed web apps. Open Tunearr in Safari, tap **Share → Add to Home Screen**, then open it from the icon and turn notifications on there. Android and desktop browsers work without installing.

## Environment variables

| Variable         | Default    | Purpose                                        |
| ---------------- | ---------- | ---------------------------------------------- |
| `APP_CONFIG_DIR` | `./config` | Runtime config JSON, SQLite database, and logs |
| `PORT`           | `3001`     | Server port                                    |

## Development

You'll need Node.js 22 and [pnpm](https://pnpm.io). If you use Nix, `nix develop` drops you into a shell with both.

```sh
pnpm install
pnpm dev
```

This starts the Vite dev server on port `3002` and the Express API on port `3001`; the client proxies `/api/*` to the server. Open `http://localhost:3002`.

Useful commands:

```sh
pnpm test          # frontend tests (Vitest + Testing Library)
pnpm test:server   # server tests
pnpm lint          # ESLint
pnpm typecheck     # TypeScript, client + server
pnpm dev:mock      # dev mode with a mocked Lidarr (MOCK_LIDARR=true)
```

The stack is React 19 + Tailwind CSS v4 on the frontend and Express 5 + SQLite (TypeORM) on the backend, all TypeScript. See [CLAUDE.md](CLAUDE.md) for a full architecture overview.

# Docker setup guide

This guide covers running Tunearr with Docker Compose, from a minimal single container to a full stack with Lidarr and Soulseek (slskd).

Tunearr only strictly needs one thing to be useful: a reachable Lidarr instance. Everything else is optional and can be added later.

## Minimal: Tunearr only

Use this if Lidarr already runs elsewhere:

```yaml
services:
  tunearr:
    image: ghcr.io/blienuckel/tunearr:latest
    user: "1000:1000"
    ports:
      - "3001:3001"
    volumes:
      - ./tunearr/config:/config
    restart: unless-stopped
```

```sh
docker compose up -d
```

Open `http://localhost:3001`, create the admin account, and point the onboarding wizard at your Lidarr URL and API key.

All persistent state (settings, SQLite database, logs) lives in the `/config` volume.

## Full stack: Tunearr + Lidarr + slskd

This is the complete setup with Soulseek downloads. The volume layout is the important part — three directories are shared between containers:

| Host path           | Mounted in                                            | Purpose                                                         |
| ------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `./music`           | Lidarr (`/music`)                                     | Your music library (Lidarr root folder)                         |
| `./slskd/downloads` | slskd (`/app/downloads`), Lidarr (`/slskd-downloads`) | slskd writes completed downloads here; Lidarr imports from here |
| `./imports`         | Tunearr (`/imports`), Lidarr (`/imports`)             | Optional: manual upload/import feature                          |

```yaml
services:
  tunearr:
    image: ghcr.io/blienuckel/tunearr:latest
    user: "1000:1000"
    ports:
      - "3001:3001"
    volumes:
      - ./tunearr/config:/config
      - ./imports:/imports
    restart: unless-stopped

  lidarr:
    image: lscr.io/linuxserver/lidarr:latest
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Etc/UTC
    ports:
      - "8686:8686"
    volumes:
      - ./lidarr/config:/config
      - ./music:/music
      - ./slskd/downloads:/slskd-downloads
      - ./imports:/imports
    restart: unless-stopped

  slskd:
    image: slskd/slskd:latest
    ports:
      - "5030:5030"
      - "50300:50300"
    volumes:
      - ./slskd:/app
      - ./music:/music:ro
    restart: unless-stopped
```

Containers in the same Compose project share a network and reach each other by service name: Tunearr talks to `http://lidarr:8686` and `http://slskd:5030`, and Lidarr talks to Tunearr at `http://tunearr:3001`. Use these names in the settings, not `localhost` — inside a container, `localhost` is the container itself.

### Configure slskd

Start the stack once so slskd generates its config, then edit `./slskd/slskd.yml` on the host:

```yaml
soulseek:
  username: <your soulseek username> # account is created on first connect
  password: <your soulseek password>

shares:
  directories:
    - /music # share your library back — peers ban users who share nothing

web:
  authentication:
    api_keys:
      tunearr:
        key: <random string, 16-255 characters>
        role: readwrite
```

Restart slskd (`docker compose restart slskd`) and check its web UI at `http://localhost:5030` to confirm it's connected. Port `50300` is slskd's Soulseek listen port — forward it on your router if you can, it significantly improves how many peers you can download from.

### Configure Tunearr

1. Open `http://localhost:3001` and run the onboarding wizard: Lidarr URL `http://lidarr:8686` plus its API key (Lidarr → Settings → General), pick profiles and a root folder (`/music`), and optionally set the import directory to `/imports`.
2. Under **Settings → Integrations → slskd**, enter:
   - URL: `http://slskd:5030`
   - API Key: the key from `slskd.yml`
   - Download Path: `/slskd-downloads` — this is where _Lidarr_ sees slskd's completed downloads (the shared volume above), not a path in the Tunearr container. Details in the [Soulseek guide](soulseek.md#the-download-path).
3. Click **Test Connection**, then **Set Up in Lidarr**. Accept the defaults (`tunearr` / `3001`) and Tunearr creates the indexer and download client in Lidarr automatically.

That's it — search for an album in Lidarr (or request one in Tunearr) and it should grab from Soulseek.

## Permissions

The examples run everything as UID/GID `1000`. If you use different IDs, keep them consistent: the slskd container must be able to write `./slskd/downloads`, and the Lidarr container must be able to read it and write `./music`. Mismatched ownership between these shared directories is the most common cause of failed imports.

## Building the image from source

```sh
git clone git@github.com:BlieNuckel/tunearr.git
cd tunearr
docker build -t tunearr .
docker run -d -p 3001:3001 -v ./config:/config tunearr
```

## Next steps

- [Integrations](integrations.md) — Plex, Last.fm, and manual import in depth
- [Soulseek guide](soulseek.md) — how the Lidarr bridge works and troubleshooting

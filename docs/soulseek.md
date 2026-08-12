# Soulseek integration (slskd)

Tunearr can bridge Soulseek into Lidarr's normal indexer + download client workflow. Lidarr searches, grabs, and imports Soulseek releases exactly like it would from Usenet — Tunearr translates in both directions behind the scenes.

This guide covers how the bridge works, how to set up slskd, and how to wire everything together.

## How it works

Tunearr emulates two services that Lidarr already knows how to talk to:

- **A Newznab indexer** at `/api/torznab`. When Lidarr searches, Tunearr forwards the query to slskd, groups the Soulseek results by user and directory into logical "releases", and returns them as an indexer feed. Search results are cached for about 30 minutes.
- **A SABnzbd download client** at `/api/sabnzbd`. When Lidarr grabs a release, it downloads a small placeholder NZB from Tunearr (containing the Soulseek username and file list) and hands it to the "SABnzbd" client — which is Tunearr again. Tunearr enqueues the actual peer-to-peer downloads with slskd and reports queue progress back to Lidarr in SABnzbd's format.

When a download finishes, Tunearr tells Lidarr the files are at `<Download Path>/<release title>`. Lidarr then imports them from disk like any completed download. **This is the one place where filesystems must line up** — see [The download path](#the-download-path) below.

```
Lidarr ──search──▶ Tunearr /api/torznab ──▶ slskd ──▶ Soulseek network
Lidarr ──grab────▶ Tunearr /api/sabnzbd ──▶ slskd downloads the files
Lidarr ◀─import── slskd's completed downloads directory (shared with Lidarr)
```

## Setting up slskd

[slskd](https://github.com/slskd/slskd) is a headless Soulseek client with a web UI and API. You need:

1. **A Soulseek account.** Just pick a username and password — the account is created when slskd first connects.
2. **An API key for Tunearr.** In `slskd.yml`, add a key with the `readwrite` role (Tunearr needs to run searches and enqueue downloads):

   ```yaml
   soulseek:
     username: <your soulseek username>
     password: <your soulseek password>

   web:
     authentication:
       api_keys:
         tunearr:
           key: <random string, 16-255 characters>
           role: readwrite
   ```

3. **Shared files.** Soulseek is a community: users who share nothing get banned from many peers, which means empty search results. Configure `shares.directories` in `slskd.yml` to share your music library (read-only is fine).

For deployment specifics (ports, volumes, the NixOS module), see the [Docker guide](setup-docker.md) or the [NixOS guide](setup-nixos.md).

## Connecting Tunearr to slskd

Under **Settings → Integrations → slskd**, fill in:

| Field         | Value                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| slskd URL     | Where **Tunearr** can reach slskd, e.g. `http://slskd:5030` (Docker) or `http://localhost:5030` (same host) |
| API Key       | The `readwrite` key from `slskd.yml`                                                                        |
| Download Path | Where **Lidarr** sees slskd's completed downloads — see below                                               |

Use **Test Connection** to verify the URL and key.

### The download path

This field trips most people up, so to be clear about what it is:

- It is **not** where Tunearr reads files — Tunearr never touches the downloaded files.
- It is the path to slskd's **completed downloads directory, as seen from Lidarr's filesystem**. Tunearr passes it verbatim to Lidarr when a download completes, and Lidarr imports from there.

That means Lidarr must be able to read slskd's completed downloads directory, and this field must contain the path _Lidarr_ uses for it:

- **Docker:** mount slskd's downloads directory into the Lidarr container, and enter the path inside the Lidarr container here. Example: slskd writes to `./slskd/downloads` on the host, Lidarr mounts that as `/slskd-downloads`, so the Download Path is `/slskd-downloads`. Full compose file in the [Docker guide](setup-docker.md).
- **Same host (NixOS, bare metal):** it's simply slskd's real downloads directory, e.g. `/var/lib/slskd/downloads`. Make sure the Lidarr user can read it.

Tunearr deliberately does not validate this path, because it usually doesn't exist on Tunearr's own filesystem.

## Wiring up Lidarr

### Automatic (recommended)

Once the slskd connection test passes, click **Set Up in Lidarr** in the same settings section. Tunearr asks for the host and port **Lidarr** should use to reach Tunearr (in Docker Compose that's the service name, e.g. `tunearr` and `3001`), then creates both the indexer and the download client in Lidarr for you.

### Manual

If you prefer to set it up yourself, add in Lidarr:

1. **Indexer** — _Settings → Indexers → Add → Newznab_:
   - URL: `http://<tunearr host>:<port>/api/torznab`
   - API Path: leave empty
   - API Key: any non-empty value (the endpoint is unauthenticated, but Lidarr requires the field)
2. **Download client** — _Settings → Download Clients → Add → SABnzbd_:
   - Host / Port: how Lidarr reaches Tunearr
   - URL Base: `/api/sabnzbd`
   - API Key: any non-empty value

## Security note

The `/api/torznab` and `/api/sabnzbd` endpoints are unauthenticated so Lidarr can reach them. Don't expose Tunearr directly to the internet without a reverse proxy handling access control. You can also restrict the slskd API key to your internal network with its `cidr` option.

## Troubleshooting

- **No search results in Lidarr.** Test the slskd connection in Tunearr settings, then try the same search in slskd's own web UI. If slskd finds nothing either, the query is too narrow or your account is being ignored for not sharing files.
- **Grabs fail with a download client error.** The download client's Host/Port/URL Base must point at Tunearr, not at slskd. Re-run **Set Up in Lidarr** or check the values against the manual steps above.
- **Grabs fail a long time after the search.** Search results (and their download links) expire after about 30 minutes, and queued grabs don't survive a Tunearr restart. Search again in Lidarr.
- **Downloads complete but Lidarr never imports.** Almost always the download path. Check Lidarr's queue for an error on the completed item — if it says the path doesn't exist, the Download Path in Tunearr doesn't match where Lidarr sees the files (wrong path, missing volume mount, or missing read permission).
- **Downloads stall forever.** Soulseek is peer-to-peer: the uploader may be offline or have you queued behind other users. Check the transfer in slskd's web UI. Lidarr will treat long-stalled downloads according to its own stalled-download handling.

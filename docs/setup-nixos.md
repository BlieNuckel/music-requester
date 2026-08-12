# NixOS setup guide

The repository is a flake that ships a package and a NixOS module. This guide covers enabling the service and wiring it up with Lidarr and slskd from nixpkgs on the same host.

## Minimal: Tunearr only

Add the flake input and enable the service:

```nix
{
  inputs.tunearr.url = "github:BlieNuckel/tunearr";
}
```

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

Rebuild, open `http://<host>:3001`, create the admin account, and point the onboarding wizard at your Lidarr URL and API key.

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

An overlay is available as `inputs.tunearr.overlays.default` if you prefer managing the package yourself.

## Full stack: Tunearr + Lidarr + slskd

Everything on one host is simpler than Docker: there are no volume mappings, so paths in Tunearr's settings are just the real paths on disk. What you do need to line up is **file permissions** between the three services.

```nix
{
  imports = [ inputs.tunearr.nixosModules.tunearr ];

  services.tunearr = {
    enable = true;
    openFirewall = true;
  };

  services.lidarr = {
    enable = true;
    openFirewall = true;
  };

  services.slskd = {
    enable = true;
    openFirewall = true;  # opens the Soulseek listen port (P2P), not the web UI
    # Soulseek credentials stay out of the nix store; the file must define
    # SLSKD_SLSK_USERNAME and SLSKD_SLSK_PASSWORD.
    environmentFile = "/var/lib/secrets/slskd.env";
    settings = {
      shares.directories = [ "/srv/music" ];
      web.authentication.api_keys.tunearr = {
        key = "<random string, 16-255 characters>";
        role = "readwrite";
      };
    };
  };

  # Lidarr must be able to read slskd's completed downloads for import.
  users.users.lidarr.extraGroups = [ "slskd" ];
}
```

`/var/lib/secrets/slskd.env`:

```sh
SLSKD_SLSK_USERNAME=<your soulseek username>
SLSKD_SLSK_PASSWORD=<your soulseek password>
```

The Soulseek account is created when slskd first connects, so any unused username works.

> **Note:** the slskd API key in `settings` ends up world-readable in the nix store. On a trusted LAN that's usually acceptable (the key only grants access to slskd's API); if not, restrict it with the key's `cidr` option or manage the config outside the store.

### Configure Tunearr

Open `http://<host>:3001` and run the onboarding wizard (Lidarr URL `http://localhost:8686` plus its API key, profiles, root folder). Then under **Settings → Integrations → slskd**:

| Field         | Value                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| URL           | `http://localhost:5030`                                                    |
| API Key       | the `readwrite` key from the config above                                  |
| Download Path | `/var/lib/slskd/downloads` (slskd's default completed-downloads directory) |

Because everything shares one filesystem, the Download Path is simply slskd's real downloads directory — this is the path Lidarr imports from. Details in the [Soulseek guide](soulseek.md#the-download-path).

Click **Test Connection**, then **Set Up in Lidarr** with host `localhost` and port `3001` — Tunearr creates the Lidarr indexer and download client for you.

### Manual import directory

To use the manual upload/import feature, Tunearr needs a directory it can write and Lidarr can read:

```nix
{
  systemd.tmpfiles.rules = [
    "d /srv/imports 0775 tunearr media -"
  ];
  users.users.tunearr.extraGroups = [ "media" ];
  users.users.lidarr.extraGroups = [ "media" ];
}
```

Adjust to your own user/group scheme (many setups run all media services under one `media` group instead). Set the import path in Tunearr's onboarding wizard or under **Settings → Integrations**.

## Next steps

- [Integrations](integrations.md) — Plex, Last.fm, and manual import in depth
- [Soulseek guide](soulseek.md) — how the Lidarr bridge works and troubleshooting

# Anthology

A self-hosted, Docker-deployable tool that merges the libraries of multiple media servers into one searchable, browsable collection.

## Problem

Media lives in several places: Plex, Jellyfin, maybe Kodi, Navidrome for music, and possibly a ROM collection. Each has its own UI, its own search, and no awareness of the others. Finding out "do I own this, and where?" means checking every server by hand.

## Goals (v1)

- Pull library metadata from every configured source into one local index
- One unified browse and search UI across all sources
- Each item deep-links back to the source server so playback happens there
- Single container, one `docker compose up`, config via env vars and a small settings UI
- Personal/household use with a single admin

## Non-goals (v1)

- No playback proxying or transcoding
- No watch-state sync between servers
- No multi-user accounts or per-user permissions
- No file management, downloading, or request workflows

## Supported sources

| Source | Media type | Integration | v1 |
|---|---|---|---|
| Plex | Movies, TV, music | Plex API + token | Yes |
| Jellyfin | Movies, TV, music | Jellyfin API + API key | Yes |
| Navidrome | Music | Subsonic API | Yes (music) |
| Kodi | Movies, TV | JSON-RPC | Stretch |
| Game ROMs | Games | Filesystem scan (NAS mount) or Nextcloud via WebDAV | Stretch |

Every source is an **adapter** that implements one interface, so adding a new one does not touch core code.

```ts
interface SourceAdapter {
  id: string;
  type: 'plex' | 'jellyfin' | 'navidrome' | 'kodi' | 'roms';
  testConnection(): Promise<boolean>;
  listLibraries(): Promise<Library[]>;
  fetchItems(library: Library, since?: Date): AsyncIterable<RawItem>;
  buildLink(item: RawItem): string; // deep link to the source server
}
```

## Core concepts

- **Source**: a configured server (URL + credentials)
- **Library**: a section within a source (Movies, Anime, Music)
- **Item**: one source's copy of a title
- **Work**: the unified entity. Multiple items from different sources that are the same title collapse into one work
- **Media kind**: movie, show, season, episode, album, track, artist, game

## Matching and dedupe

Matching decides whether two items are the same work. Priority order:

1. External IDs (TMDB, IMDb, TVDB, MusicBrainz, IGDB) when both sides have them
2. Normalized title + year (+ season/episode numbers for TV)
3. Manual override in the UI (merge or split a work)

The UI shows one card per work with badges for every source that has it.

## Architecture

```
[Plex] [Jellyfin] [Navidrome] [Kodi] [ROMs]
   \       |          |         |      /
          Source adapters (poll + sync jobs)
                      |
              Normalizer + matcher
                      |
                 SQLite (FTS5)
                      |
               SvelteKit app (SSR + API routes)
                      |
                    Browser
```

- **Stack:** SvelteKit, SQLite via better-sqlite3 or Drizzle, FTS5 for search
- **Sync:** scheduled background job per source plus a manual "sync now" button, incremental where the source supports it
- **Artwork:** posters are cached locally by default (downloaded on sync, stored in the `/data/cache` volume, served by the app), so the UI is fast and still works if a source is offline. Cache size can be capped, and the source URL is kept as a fallback
- **Auth:** single admin password set at first run (or env var), session cookie

## Data model (sketch)

```
sources(id, type, name, base_url, credentials_enc, enabled, last_sync_at)
libraries(id, source_id, remote_id, name, kind)
items(id, library_id, remote_id, work_id, title, year, kind, external_ids_json, link_url, poster_url, added_at, updated_at)
works(id, title, year, kind, canonical_poster, external_ids_json)
overrides(id, item_id, work_id)   -- manual merges/splits
```

Search index is an FTS5 virtual table over work titles, alternate titles, people, and genres.

## Features by milestone

**M1: Foundation**
- Project scaffold, Dockerfile, compose example
- Poster cache with size cap
- Admin login, settings page to add and test sources
- Plex and Jellyfin adapters (movies and TV)
- Raw item ingest and basic browse list

**M2: Unification**
- External-ID and title+year matching into works
- Work detail page showing every source and deep links
- Full-text search and filters (kind, source, year, genre)

**M3: Music and more**
- Navidrome adapter, plus music from Plex and Jellyfin
- Artist, album, and track browsing
- Manual merge/split UI
- "Missing from X" views (for example, on Plex but not Jellyfin), filterable by kind

**M4: Stretch**
- Kodi adapter
- ROM/game adapter (folder scan and Nextcloud WebDAV) with IGDB matching
- Webhook-triggered syncs

## Deployment

Target: a personal server running Dokploy (Traefik under the hood), though any Docker host works.

```yaml
services:
  anthology:
    image: ghcr.io/<you>/anthology:latest
    expose:
      - "3000"
    volumes:
      - anthology-data:/data            # SQLite DB and poster cache
      - /mnt/nas/roms:/roms:ro          # optional, only for the ROM adapter
    environment:
      - ADMIN_PASSWORD=change-me
      - SECRET_KEY=change-me
      - ORIGIN=https://anthology.example.com
      - TZ=America/New_York
    restart: unless-stopped

volumes:
  anthology-data:
```

- **Dokploy:** deploy as a Compose app or from the image, attach a domain in Dokploy and let Traefik handle TLS. Set `ORIGIN` to the public URL (SvelteKit needs it behind a proxy)
- **Persistence:** back up the `anthology-data` volume, since it holds the DB and the manual merge/split overrides
- **NAS:** mount the share on the host and bind it read-only into the container. Nextcloud ROMs use WebDAV credentials in the source settings instead
- **Network:** Dokploy runs Anthology, while Plex, Jellyfin and the rest run as separate containers managed through Portainer on the same host. Two ways to connect them:
  - Simplest: point each source at the host's LAN IP and published port (for example `http://192.168.1.10:8096` for Jellyfin). No shared networking needed
  - Cleaner: put the containers on a shared external Docker network and use container names as hostnames. Dokploy's own network can be declared `external: true` in the Portainer stacks, or you can create a dedicated `media` network and attach both sides
  - Start with LAN URLs and move to a shared network later if you want to stop publishing ports
- Credentials are encrypted at rest with `SECRET_KEY`
- Multi-arch image (amd64 and arm64)

## Current state and dev environment

Nothing is set up yet: no media servers, no NAS share, and no Anthology deployment. That is fine for early development.

- **Develop against test servers:** run a throwaway Jellyfin container with a few sample files, and add Plex when you are ready (Plex needs an account and a claim token, so Jellyfin comes first)
- **Mock adapter:** include a fake adapter that serves seeded sample data, so the matcher, search and UI can be built and tested without any real server
- **Order of setup:** Jellyfin test container, then Anthology on Dokploy, then Plex, then Navidrome and the NAS/ROM pieces as you get to them
- **Config:** sources are added in the settings UI, so Anthology can be deployed before any server exists and pointed at them later

## Risks and open questions

- **Metadata quality:** poor matching creates duplicate or wrongly merged works, so the manual override path matters from day one
- **API rate limits and large libraries:** needs paged, incremental sync
- **Music matching** is harder than video (compilations, remasters), so consider MusicBrainz IDs only in v1
- **ROMs:** two storage paths to support, a plain folder (usually a NAS share mounted into the container) and Nextcloud over WebDAV. Filenames drive matching, so a naming convention or No-Intro style parsing plus IGDB lookup is needed
- **Naming:** Anthology is a common word, so confirm the repo, Docker Hub image, and domain are available

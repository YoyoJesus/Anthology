# Anthology

A self-hosted catalogue that pulls the libraries of your media servers into one searchable collection. Each title links back to the server that has it, so playback still happens there.

![Library view](docs/screenshots/library.png)

## What works today

- Plex and Jellyfin sources (movies and TV shows), added and tested from the settings page
- A sample-data source for trying the app without a server (dev only, unless `ENABLE_MOCK_SOURCES=true`)
- Full sync per source, on a schedule or with **Sync now**. Items removed from a source leave the library on the next sync
- Matching across sources by external ID (TMDB, IMDb, TVDB), then by normalized title and year
- Library browse with search, kind filter and source filter
- Title pages listing every source that has the title, with a link to open it there
- Poster cache on disk with a size cap, falling back to the source when a poster is not cached
- Single admin password, set at first run or with `ADMIN_PASSWORD`
- Source credentials encrypted at rest with `SECRET_KEY`
- Digital collections: paste a list of titles you own on a store such as Apple TV, and they join the library like any other source
- Optional streaming availability for Netflix, Prime Video, Hulu, Disney+ and Apple TV+, looked up through TMDB for titles already in your library

See [PROJECT.md](PROJECT.md) for the full plan, including music, manual merge and split, and the stretch adapters.

## Run locally

```sh
npm install
npm run dev
```

Open the app, create the admin password, then add a **Sample data** source in Settings (pick Alpha for one and Beta for another to see matching) and press **Sync now**.

Data is stored in `./data` by default. Copy `.env.example` to `.env` to change settings.

## Deploy with Docker

```sh
cp compose.example.yaml compose.yaml   # then edit the environment values
docker compose up -d --build
```

| Variable                | Default                  | Purpose                                                                     |
| ----------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `ORIGIN`                | none                     | Public URL. Required behind a reverse proxy so form posts are accepted      |
| `ADMIN_PASSWORD`        | none                     | Admin password. If unset, the first visit asks you to create one            |
| `SECRET_KEY`            | generated in `DATA_DIR`  | Encrypts source credentials. Changing it makes saved credentials unreadable |
| `DATA_DIR`              | `./data` (`/data` image) | SQLite database, poster cache and generated key                             |
| `POSTER_CACHE_MAX_MB`   | `500`                    | Poster cache size cap                                                       |
| `SYNC_INTERVAL_MINUTES` | `360`                    | How often enabled sources sync automatically                                |
| `TMDB_READ_TOKEN`       | none                     | TMDB read access token. Turns on streaming availability lookups             |
| `STREAMING_REGION`      | `US`                     | Country used for streaming availability                                     |
| `ENABLE_MOCK_SOURCES`   | `false` in production    | Allow the sample-data source type                                           |

Back up the data volume. It holds the database and the generated secret key if you did not set one.

### Connecting to your servers

Point each source at an address the container can reach, for example `http://192.168.1.10:8096` for Jellyfin or `http://192.168.1.10:32400` for Plex. Jellyfin needs an API key from its dashboard. Plex needs an `X-Plex-Token`.

### Digital collections

Store purchases (Apple TV, Amazon, Google and similar) have no API Anthology can read, so add them as a **Digital collection** source and paste your titles, one per line:

```text
The Glass Orchard (2019)
Northbound
TV: Low Tide Club (2018)
```

Years are optional but make matching more reliable. A title without a year joins an existing title only when exactly one matches. Use **Edit list** on the source to change it later.

### Streaming availability

Create a free TMDB account, copy the API read access token from its API settings, and set it as `TMDB_READ_TOKEN`. Then tick the services you subscribe to under Settings. Availability is checked after each sync and refreshed weekly, for titles with a TMDB ID. It reflects what each service offers in your region, not what is in your account. Streaming data comes from JustWatch via TMDB.

## Development

| Task        | Command          |
| ----------- | ---------------- |
| Dev server  | `npm run dev`    |
| Type check  | `npm run check`  |
| Lint        | `npm run lint`   |
| Format      | `npm run format` |
| Unit tests  | `npm test`       |
| Build       | `npm run build`  |
| Regen icons | `npm run icons`  |

## License

See [LICENSE](LICENSE).

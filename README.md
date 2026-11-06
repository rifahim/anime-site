# AniStream 🎴

A minimal anime streaming site: **HTML + CSS + custom HLS player**, powered by
the unofficial [HiAnime](https://hianime.mintlify.app/quickstart) API with the
provided AniWatch API as a fallback.

## Run locally

```bash
cd anime-site
npm install
npm start          # → http://localhost:3000
```

Requirements: Node.js 18+. One server handles both the static frontend and the JSON API.
If HiAnime is unavailable, catalog, search, and playback requests fall back to
AniWatch. IDs returned by the providers are kept separate, and watch requests
can switch providers by matching the anime title and episode number.

The fallback base URL can be changed with `ANIWATCH_API_BASE_URL` (defaults to
`https://api-anime-rouge.vercel.app/aniwatch`; include `/aniwatch` in custom
URLs). Its request timeout can be changed with `ANIWATCH_API_TIMEOUT_MS`
(defaults to 12000). HiAnime requests time out after 8000 ms by default; change
this with `HIANIME_API_TIMEOUT_MS`.

## How the watch chain works (per the hianime docs)

```
getTopAiring() / search()      → results[].dataId   (anime)
getEpisodes(dataId)            → episode id
getEpisodeServers(episodeId)   → { sub:[{id,name}], dub:[{id,name}] }
getEpisodeSources(serverId)    → { sources:[{file (m3u8)}], tracks:[VTT], intro/outro }
```

- The m3u8 is played with **HLS.js** (custom controls, quality switch, CC menu).
- Subtitle VTT tracks and Skip-Intro timings come straight from the API response.

## Pages

| Page | What it does |
|---|---|
| `index.html` | Home rows (Top Airing / Popular / Movies / TV) + live search |
| `browse.html` | Full grid + pagination for all 9 categories |
| `watch.html` | Player: Sub/Dub toggle, server switcher, quality, CC, Skip Intro, episode list |

## API (same origin)

```
GET /api/home                      4 lists in one call
GET /api/list/:category?page=      top-airing | most-popular | movies | tv | subbed | dubbed | ona | ova | special
GET /api/search?q=&page=
GET /api/episodes/:dataId
GET /api/servers/:episodeId
GET /api/sources/:serverId
```

## Deploy

Deployment is intentional deferred until after local testing — add the config
for your chosen platform (Render / Vercel / Railway / Fly.io) later. Any host
that runs Node and supports `npm start` + `PORT` env var will work as-is.

## Disclaimer

Unofficial scraper API — behavior can break without notice, and this project is
not affiliated with or endorsed by HiAnime.

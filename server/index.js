import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import hianimePkg from 'hianime';
import { createProviderService } from './providers.js';
import { initRssTorrentIngestion } from './indexer.js';

/* Support both ESM ({ Hianime }) and CJS ({ default: Hianime } / module.exports = Hianime) */
const Hianime = hianimePkg.Hianime || hianimePkg.default || hianimePkg;
const hianime = new Hianime();
const providers = createProviderService(hianime);

/* Upstream (hianime.to) is an unofficial site that can go down or be geo-blocked.
   Point at a working mirror without touching code:  HIANIME_BASE_URL=https://… npm start */
if (process.env.HIANIME_BASE_URL) {
  hianime.BASE_URL = process.env.HIANIME_BASE_URL.replace(/\/+$/, '');
}

// Initialize automated RSS / Torrent ingestion for local media
initRssTorrentIngestion();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));

/* Category -> candidate method names.
   Docs mix names (getONAList / getONAAnime / getONA…), so we try each until
   one exists on the client instance. */
const wrap = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    const status = err?.response?.status;
    let message = err.message || 'Upstream request failed';
    if (status === 522 || status === 521 || status === 503) {
      message =
        `hianime.to is unreachable right now (HTTP ${status} from Cloudflare) — the upstream site appears to be down. ` +
        'Try again later, or restart with a mirror: HIANIME_BASE_URL=https://<mirror> npm start';
    } else if (status === 403) {
      message = 'hianime.to refused the request (HTTP 403) — it may be blocking this network. Try a VPN or a mirror via HIANIME_BASE_URL.';
    }
    console.error(`[api] ${req.originalUrl} -> ${message}`);
    res.status(502).json({ error: true, message });
  }
};

app.get('/api/health', wrap(async (_req, res) => res.json({ ok: true })));

/* 4 category lists in one call for the home page */
app.get('/api/home', wrap(async (_req, res) => {
  res.json(await providers.fetchHome());
}));

app.get('/api/list/:category', wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  res.json(await providers.fetchList(req.params.category, page));
}));

app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ page: 1, totalPage: 0, hasNextPage: false, results: [] });
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  res.json(await providers.search(q, page));
}));

/* Watch chain: dataId -> episodes -> servers -> sources */
app.get('/api/local-media', (req, res) => {
  const mediaDir = path.join(__dirname, '..', 'public', 'media');
  try {
    if (!fs.existsSync(mediaDir)) {
      return res.json({ items: [] });
    }
    const files = fs.readdirSync(mediaDir).filter(f => /\.(mp4|m3u8|webm|ogv|mov)$/i.test(f));
    const items = files.map((file, idx) => ({
      id: `local_${idx}`,
      number: idx + 1,
      title: file,
      sources: [{ file: `/media/${file}` }]
    }));
    res.json({ title: 'Local Library', episodes: items });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

app.get('/api/episodes/:dataId', wrap(async (req, res) => {
  if (req.params.dataId.startsWith('local_')) {
    const mediaDir = path.join(__dirname, '..', 'public', 'media');
    const files = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir).filter(f => /\.(mp4|m3u8|webm|ogv|mov)$/i.test(f)) : [];
    return res.json(files.map((file, idx) => ({
      id: `local_ep_${idx}`,
      number: idx + 1,
      title: file,
      isFiller: false
    })));
  }
  res.json(await providers.fetchEpisodes(req.params.dataId, String(req.query.title || '')));
}));

app.get('/api/servers/:episodeId', wrap(async (req, res) => {
  if (req.params.episodeId.startsWith('local_ep_') || req.params.episodeId.startsWith('local_')) {
    return res.json({
      sub: [{ id: `local_srv_${req.params.episodeId}`, name: 'Local Playback', type: 'sub' }],
      dub: []
    });
  }
  res.json(await providers.fetchServers(
    req.params.episodeId,
    String(req.query.title || ''),
    String(req.query.number || ''),
  ));
}));

app.get('/api/sources/:serverId', wrap(async (req, res) => {
  if (req.params.serverId.startsWith('local_srv_') || req.params.serverId.startsWith('local_')) {
    const parts = req.params.serverId.split('_');
    // Extract file name if encoded or fallback to listing
    const mediaDir = path.join(__dirname, '..', 'public', 'media');
    const files = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir).filter(f => /\.(mp4|m3u8|webm|ogv|mov)$/i.test(f)) : [];
    // pick file index from last part or default to 0
    const idx = parseInt(parts[parts.length - 1], 10) || 0;
    const file = files[idx] || files[0] || 'sample.mp4';
    return res.json({
      sources: [{ file: `/media/${file}`, type: file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/mp4' }],
      tracks: [],
      intro: null
    });
  }
  res.json(await providers.fetchSources(
    req.params.serverId,
    String(req.query.title || ''),
    String(req.query.number || ''),
  ));
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Anime site running at http://localhost:${PORT}`);
});

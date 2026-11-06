import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createProviderService } from './providers.js';

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.ANIWATCH_API_BASE_URL;
const originalHianimeTimeout = process.env.HIANIME_API_TIMEOUT_MS;
process.env.ANIWATCH_API_BASE_URL = 'https://fixture.invalid/aniwatch';
process.env.HIANIME_API_TIMEOUT_MS = '250';

globalThis.fetch = async (input) => {
  const url = new URL(input);
  let data;

  if (url.pathname === '/aniwatch/top-airing') {
    data = {
      animes: [{ id: 'demo-anime', name: 'Demo Anime', img: 'poster.jpg' }],
      currentPage: 1,
      hasNextPage: false,
      totalPages: 1,
    };
  } else if (url.pathname === '/aniwatch/episodes/demo-anime') {
    data = {
      episodes: [{ name: 'Episode 1', episodeNo: 1, episodeId: 'demo-anime?ep=101' }],
    };
  } else if (url.pathname === '/aniwatch/servers') {
    assert.equal(url.searchParams.get('id'), 'demo-anime?ep=101');
    data = { sub: [{ serverName: 'vidstreaming', serverId: 1 }], dub: [] };
  } else if (url.pathname === '/aniwatch/episode-srcs') {
    assert.equal(url.searchParams.get('id'), 'demo-anime?ep=101');
    data = {
      sources: [{ url: 'https://media.invalid/demo.m3u8', isM3U8: true }],
      subtitles: [{ lang: 'English', url: 'https://media.invalid/demo.vtt' }],
    };
  } else {
    throw new Error(`Unexpected AniWatch request: ${url}`);
  }

  return { ok: true, status: 200, json: async () => data };
};

after(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.ANIWATCH_API_BASE_URL;
  else process.env.ANIWATCH_API_BASE_URL = originalBaseUrl;
  if (originalHianimeTimeout === undefined) delete process.env.HIANIME_API_TIMEOUT_MS;
  else process.env.HIANIME_API_TIMEOUT_MS = originalHianimeTimeout;
});

test('falls back to AniWatch for catalog and the complete watch chain', async () => {
  const hianime = {
    getTopAiring: async () => { throw new Error('HiAnime unavailable'); },
  };
  const providers = createProviderService(hianime);

  const listing = await providers.fetchList('top-airing');
  assert.equal(listing.results[0].title, 'Demo Anime');
  assert.match(listing.results[0].dataId, /^anime_/);

  const episodes = await providers.fetchEpisodes(listing.results[0].dataId, 'Demo Anime');
  assert.equal(episodes[0].number, 1);

  const servers = await providers.fetchServers(episodes[0].id, 'Demo Anime', '1');
  assert.equal(servers.sub[0].name, 'vidstreaming');

  const sources = await providers.fetchSources(servers.sub[0].id, 'Demo Anime', '1');
  assert.equal(sources.sources[0].file, 'https://media.invalid/demo.m3u8');
  assert.equal(sources.tracks[0].kind, 'captions');
});

test('times out a stalled HiAnime request and falls back', async () => {
  const providers = createProviderService({
    getTopAiring: () => new Promise(() => {}),
  });
  const startedAt = Date.now();
  const listing = await providers.fetchList('top-airing');

  assert.equal(listing.results[0].title, 'Demo Anime');
  assert.ok(Date.now() - startedAt < 2000);
});

import process from 'node:process';

const LIST_METHODS = {
  'top-airing': ['getTopAiring'],
  'most-popular': ['getMostPopular'],
  movies: ['getMovies'],
  tv: ['getTVShows'],
  subbed: ['getSubbedAnime'],
  dubbed: ['getDubbedAnime'],
  ona: ['getONAList', 'getONAAnime', 'getONA'],
  ova: ['getOVAList', 'getOVAAnime', 'getOVA'],
  special: ['getSpecialList', 'getSpecialAnime', 'getSpecial'],
};

const ANIWATCH_CATEGORIES = {
  'top-airing': 'top-airing',
  'most-popular': 'most-popular',
  movies: 'movie',
  tv: 'tv',
  subbed: 'subbed-anime',
  dubbed: 'dubbed-anime',
  ona: 'ona',
  ova: 'ova',
  special: 'special',
};

const otherProvider = (provider) => provider === 'hianime' ? 'aniwatch' : 'hianime';
const messageOf = (error) => error?.message || String(error);
const makeRef = (kind, data) =>
  `${kind}_${Buffer.from(JSON.stringify(data)).toString('base64url')}`;

function readRef(value, kind) {
  const prefix = `${kind}_`;
  if (!value.startsWith(prefix)) return null;
  try {
    return JSON.parse(Buffer.from(value.slice(prefix.length), 'base64url').toString());
  } catch (error) {
    throw new Error(`Invalid ${kind} reference`, { cause: error });
  }
}

function ensureItems(items, provider) {
  return (items || []).filter((item) => item?.id || item?.dataId).map((item) => {
    if (provider === 'hianime') {
      return {
        ...item,
        dataId: makeRef('anime', { provider, id: item.dataId }),
      };
    }

    return {
      id: item.id,
      dataId: makeRef('anime', { provider, id: item.id }),
      title: item.name || item.title || 'Untitled',
      image: item.img || item.image || '',
      type: item.category || item.type || '',
      language: {
        sub: item.episodes?.sub ? String(item.episodes.sub) : null,
        dub: item.episodes?.dub ? String(item.episodes.dub) : null,
      },
    };
  });
}

function normalizeHianimePage(data, page) {
  return {
    ...data,
    page: data?.page || page,
    totalPage: data?.totalPage || 0,
    hasNextPage: Boolean(data?.hasNextPage),
    results: ensureItems(data?.results, 'hianime'),
  };
}

function normalizeAniwatchPage(data, page) {
  return {
    page: data?.currentPage || page,
    totalPage: data?.totalPages || 0,
    hasNextPage: Boolean(data?.hasNextPage),
    results: ensureItems(data?.animes || data?.results, 'aniwatch'),
  };
}

function normalizeEpisodes(data, provider, animeId) {
  const episodes = provider === 'hianime' ? data : data?.episodes;
  if (!Array.isArray(episodes)) throw new Error(`${provider} returned an invalid episode list`);

  return episodes.map((episode) => {
    const episodeId = provider === 'hianime' ? episode.id : episode.episodeId;
    const number = provider === 'hianime' ? episode.number : episode.episodeNo;
    return {
      id: makeRef('episode', { provider, animeId, episodeId, number }),
      number,
      title: episode.title || episode.name || `Episode ${number}`,
      isFiller: Boolean(episode.isFiller || episode.filler),
    };
  });
}

function normalizeServers(data, episode) {
  const normalize = (servers, language) => (servers || []).map((server) => ({
    id: makeRef('server', {
      ...episode,
      language,
      serverId: server.id || server.serverId,
      serverName: server.name || server.serverName,
    }),
    name: server.name || server.serverName || 'Server',
    type: language,
  }));
  return {
    sub: normalize(data?.sub, 'sub'),
    dub: normalize(data?.dub, 'dub'),
  };
}

function normalizeAniwatchSources(data) {
  return {
    ...data,
    sources: (data?.sources || []).map((source) => ({
      ...source,
      file: source.file || source.url,
      type: source.type || (source.isM3U8 ? 'application/x-mpegURL' : undefined),
    })),
    tracks: (data?.tracks || data?.subtitles || []).map((track) => ({
      ...track,
      file: track.file || track.url,
      label: track.label || track.lang || 'Subtitle',
      kind: track.kind || 'captions',
    })),
  };
}

export function createProviderService(hianime) {
  const baseUrl = (process.env.ANIWATCH_API_BASE_URL
    || 'https://api-anime-rouge.vercel.app/aniwatch').replace(/\/+$/, '');
  const timeoutMs = Math.max(1000, Number(process.env.ANIWATCH_API_TIMEOUT_MS) || 12000);
  const hianimeTimeoutMs = Math.max(250, Number(process.env.HIANIME_API_TIMEOUT_MS) || 8000);

  function requestHianime(operation, request) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`HiAnime ${operation} timed out after ${hianimeTimeoutMs}ms`)),
        hianimeTimeoutMs,
      );
    });
    return Promise.race([Promise.resolve().then(request), timeout])
      .finally(() => clearTimeout(timer));
  }

  async function requestAniwatch(path) {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.error) {
      throw new Error(data?.message || `AniWatch API request failed (${response.status})`);
    }
    return data;
  }

  async function withFallback(operation, primaryName, primary, secondaryName, secondary) {
    try {
      return await primary();
    } catch (primaryError) {
      console.warn(`[providers] ${operation}: ${primaryName} failed: ${messageOf(primaryError)}`);
      try {
        return await secondary();
      } catch (secondaryError) {
        throw new Error(
          `${operation} failed on both providers. ${primaryName}: ${messageOf(primaryError)}; ` +
          `${secondaryName}: ${messageOf(secondaryError)}`,
          { cause: new AggregateError([primaryError, secondaryError]) },
        );
      }
    }
  }

  async function getHianimeList(category, page) {
    const methods = LIST_METHODS[category];
    if (!methods) throw new Error(`Unknown category: ${category}`);
    const method = methods.find((name) => typeof hianime[name] === 'function');
    if (!method) throw new Error(`No HiAnime method available for "${category}"`);
    return normalizeHianimePage(
      await requestHianime(`list "${category}"`, () => hianime[method](page)),
      page,
    );
  }

  async function getAniwatchList(category, page) {
    const aniwatchCategory = ANIWATCH_CATEGORIES[category];
    if (!aniwatchCategory) throw new Error(`Unknown category: ${category}`);
    return normalizeAniwatchPage(
      await requestAniwatch(`/${encodeURIComponent(aniwatchCategory)}?page=${page}`),
      page,
    );
  }

  async function fetchList(category, page = 1) {
    return withFallback(
      `List "${category}"`,
      'HiAnime',
      () => getHianimeList(category, page),
      'AniWatch',
      () => getAniwatchList(category, page),
    );
  }

  async function getAniwatchHome() {
    const home = await requestAniwatch('/');
    const [movies, tv] = await Promise.all([
      getAniwatchList('movies', 1),
      getAniwatchList('tv', 1),
    ]);
    return {
      topAiring: normalizeAniwatchPage({
        animes: home.topAiringAnimes || home.spotlightAnimes,
      }, 1),
      popular: normalizeAniwatchPage({
        animes: home.trendingAnimes || home.latestEpisodes,
      }, 1),
      movies,
      tv,
    };
  }

  async function fetchHome() {
    return withFallback(
      'Home lists',
      'HiAnime',
      async () => {
        const [topAiring, popular, movies, tv] = await Promise.all([
          getHianimeList('top-airing', 1),
          getHianimeList('most-popular', 1),
          getHianimeList('movies', 1),
          getHianimeList('tv', 1),
        ]);
        return { topAiring, popular, movies, tv };
      },
      'AniWatch',
      getAniwatchHome,
    );
  }

  async function searchHianime(query, page) {
    return normalizeHianimePage(
      await requestHianime('search', () => hianime.search(query, page)),
      page,
    );
  }

  async function searchAniwatch(query, page) {
    const params = new URLSearchParams({ keyword: query, page: String(page) });
    return normalizeAniwatchPage(await requestAniwatch(`/search?${params}`), page);
  }

  async function search(query, page = 1) {
    return withFallback(
      'Anime search',
      'HiAnime',
      () => searchHianime(query, page),
      'AniWatch',
      () => searchAniwatch(query, page),
    );
  }

  async function getEpisodesFor(provider, animeId) {
    const data = provider === 'hianime'
      ? await requestHianime('episodes', () => hianime.getEpisodes(animeId))
      : await requestAniwatch(`/episodes/${encodeURIComponent(animeId)}`);
    return normalizeEpisodes(data, provider, animeId);
  }

  async function findAnime(provider, title) {
    if (!title) throw new Error('Anime title is required to switch providers');
    const results = provider === 'hianime'
      ? (await requestHianime('search', () => hianime.search(title, 1)))?.results || []
      : (await requestAniwatch(`/search?${new URLSearchParams({ keyword: title, page: '1' })}`))?.animes || [];
    if (!results.length) throw new Error(`No ${provider} match found for "${title}"`);

    const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const match = results.find((item) =>
      (item.title || item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedTitle
    ) || results[0];
    const id = provider === 'hianime' ? match.dataId : match.id;
    if (!id) throw new Error(`${provider} search result has no anime ID`);
    return String(id);
  }

  async function findAlternateEpisode(provider, title, number) {
    if (number == null || number === '') {
      throw new Error('Episode number is required to switch providers');
    }
    const alternate = otherProvider(provider);
    const animeId = await findAnime(alternate, title);
    const episodes = await getEpisodesFor(alternate, animeId);
    const episode = episodes.find((item) => String(item.number) === String(number));
    if (!episode) throw new Error(`${alternate} has no episode ${number} for "${title}"`);
    return readRef(episode.id, 'episode');
  }

  async function fetchEpisodes(dataId, title = '') {
    const reference = readRef(dataId, 'anime') || { provider: 'hianime', id: dataId };
    return withFallback(
      'Episode list',
      reference.provider,
      () => getEpisodesFor(reference.provider, reference.id),
      otherProvider(reference.provider),
      async () => {
        const alternate = otherProvider(reference.provider);
        const animeId = await findAnime(alternate, title);
        return getEpisodesFor(alternate, animeId);
      },
    );
  }

  async function getServersForEpisode(episode) {
    if (episode.provider === 'hianime') {
      return normalizeServers(
        await requestHianime('episode servers', () => hianime.getEpisodeServers(episode.episodeId)),
        episode,
      );
    }

    const externalEpisodeId = String(episode.episodeId).includes('?ep=')
      ? episode.episodeId
      : `${episode.animeId}?ep=${episode.episodeId}`;
    const data = await requestAniwatch(`/servers?id=${encodeURIComponent(externalEpisodeId)}`);
    return normalizeServers(data, episode);
  }

  async function fetchServers(episodeId, title = '', number = '') {
    const reference = readRef(episodeId, 'episode') || {
      provider: 'hianime',
      episodeId,
      number,
    };
    return withFallback(
      'Episode servers',
      reference.provider,
      () => getServersForEpisode(reference),
      otherProvider(reference.provider),
      async () => getServersForEpisode(
        await findAlternateEpisode(reference.provider, title, reference.number || number),
      ),
    );
  }

  async function getSourcesForServer(server) {
    if (server.provider === 'hianime') {
      const data = await requestHianime('episode source', () => hianime.getEpisodeSources(server.serverId));
      if (!data?.sources?.length) throw new Error('HiAnime returned no stream sources');
      return data;
    }

    const episode = server.episodeId.includes('?ep=')
      ? server.episodeId
      : `${server.animeId}?ep=${server.episodeId}`;
    const params = new URLSearchParams({
      id: episode,
      server: server.serverName || 'vidstreaming',
      category: server.language || 'sub',
    });
    const data = normalizeAniwatchSources(await requestAniwatch(`/episode-srcs?${params}`));
    if (!data.sources.length) throw new Error('AniWatch returned no stream sources');
    return data;
  }

  async function fallbackSources(provider, title, number, language) {
    const alternate = otherProvider(provider);
    const episode = await findAlternateEpisode(provider, title, number);
    const servers = await getServersForEpisode(episode);
    const candidates = [
      ...(servers[language] || []),
      ...(servers[language === 'sub' ? 'dub' : 'sub'] || []),
    ];
    if (!candidates.length) throw new Error(`${alternate} returned no episode servers`);

    const failures = [];
    for (const candidate of candidates) {
      try {
        return await getSourcesForServer(readRef(candidate.id, 'server'));
      } catch (error) {
        failures.push(messageOf(error));
      }
    }
    throw new Error(`${alternate} stream servers failed: ${failures.join('; ')}`);
  }

  async function fetchSources(serverId, title = '', number = '') {
    const reference = readRef(serverId, 'server') || {
      provider: 'hianime',
      serverId,
    };
    return withFallback(
      'Episode source',
      reference.provider,
      () => getSourcesForServer(reference),
      otherProvider(reference.provider),
      () => fallbackSources(reference.provider, title, number, reference.language || 'sub'),
    );
  }

  return { fetchHome, fetchList, search, fetchEpisodes, fetchServers, fetchSources };
}

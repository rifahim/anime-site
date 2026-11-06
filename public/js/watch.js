/* ================= AniStream — watch page & custom HLS player ================= */
const $  = (s, el = document) => (el || document).querySelector(s);
const $$ = (s, el = document) => [...(el || document).querySelectorAll(s)];

const esc = (v) => {
  const d = document.createElement('div');
  d.textContent = v == null ? '' : String(v);
  return d.innerHTML;
};

async function api(path) {
  const res = await fetch(path);
  let body = {};
  try { body = await res.json(); } catch { /* non-JSON error */ }
  if (!res.ok || body.error) throw new Error(body.message || `Request failed (${res.status})`);
  return body;
}

const params  = new URLSearchParams(location.search);
const DATA_ID = params.get('dataId');

/* ---- elements ---- */
const video = $('#video'), shell = $('#player-shell');
const playBtn = $('#play-btn'), muteBtn = $('#mute-btn'), volume = $('#volume');
const progress = $('#progress');
const played   = $('.progress-played', progress);
const buffered = $('.progress-buffered', progress);
const knob     = $('.progress-knob', progress);
const timeNow  = $('#time-now'), timeTotal = $('#time-total');
const skipBtn  = $('#skip-intro');
const loadingEl = $('#loading');
const errorEl   = $('#player-error');
const ccBtn = $('#cc-btn'), ccMenu = $('#cc-menu');
const qualityBtn = $('#quality-btn'), qualityMenu = $('#quality-menu');
const fullscreenBtn = $('#fullscreen-btn');
const nextEpBtn = $('#next-ep'), prevEpBtn = $('#prev-ep');
const epList = $('#ep-list'), epCount = $('#ep-count');
const animeTitle = $('#anime-title');
const langToggle = $('#lang-toggle'), serverSelect = $('#server-select');

const state = {
  episodes: [], currentEp: null,
  servers: { sub: [], dub: [] }, lang: 'sub', serverId: null,
  hls: null, tracks: [], intro: null, ccIdx: -1,
};

/* ---------------- boot ---------------- */
init();

async function init() {
  if (!DATA_ID) return fatal('No anime selected.', '<a href="index.html">← Go back home</a>');
  $('#back-btn').addEventListener('click', () =>
    history.length > 1 ? history.back() : (location.href = 'index.html'));

  animeTitle.textContent = params.get('title') || 'Now playing';

  try {
    const eps = await api(
      `/api/episodes/${encodeURIComponent(DATA_ID)}?title=${encodeURIComponent(animeTitle.textContent)}`,
    );
    if (!Array.isArray(eps) || !eps.length) throw new Error('No episodes found for this anime.');
    state.episodes = eps;
    renderEpisodes();
    const wanted = params.get('ep');
    const ep = eps.find(e => String(e.number) === String(wanted)) || eps[0];
    await setEpisode(ep);
  } catch (err) {
    fatal('Could not load episodes.', esc(err.message));
  }
}

/* ---------------- episode list ---------------- */
function renderEpisodes() {
  epCount.textContent = `(${state.episodes.length})`;
  epList.innerHTML = state.episodes.map(ep => `
    <button class="ep-item" data-number="${esc(ep.number)}">
      <span class="ep-num">EP ${esc(ep.number)}</span>
      <span class="ep-title">${esc(ep.title || `Episode ${ep.number}`)}</span>
    </button>`).join('');
  $$('.ep-item', epList).forEach(btn => btn.addEventListener('click', () => {
    const ep = state.episodes.find(x => String(x.number) === btn.dataset.number);
    if (ep) setEpisode(ep);
  }));
}

function highlightEpisode() {
  $$('.ep-item', epList).forEach(btn => {
    const active = String(btn.dataset.number) === String(state.currentEp?.number);
    btn.classList.toggle('active', active);
    if (active) btn.scrollIntoView({ block: 'nearest' });
  });
}

/* ---------------- episode -> servers -> sources ---------------- */
async function setEpisode(ep) {
  state.currentEp = ep;
  highlightEpisode();
  hideError();

  history.replaceState(null, '',
    `watch.html?dataId=${encodeURIComponent(DATA_ID)}` +
    `&ep=${encodeURIComponent(ep.number)}` +
    `&title=${encodeURIComponent(animeTitle.textContent)}`);

  epList.classList.add('busy');
  try {
    const servers = await api(
      `/api/servers/${encodeURIComponent(ep.id)}` +
      `?title=${encodeURIComponent(animeTitle.textContent)}&number=${encodeURIComponent(ep.number)}`,
    );
    state.servers = { sub: servers.sub || [], dub: servers.dub || [] };
    renderLangToggle();
    setLang(state.servers.sub.length ? 'sub' : 'dub');
  } catch (err) {
    playerError(`Could not load servers.<br><small>${esc(err.message)}</small>`);
  } finally {
    epList.classList.remove('busy');
  }
}

function renderLangToggle() {
  const has = (l) => state.servers[l].length > 0;
  langToggle.innerHTML = ['sub', 'dub'].map(l => `
    <button class="lang-btn" data-lang="${l}" ${has(l) ? '' : 'disabled'}>${l.toUpperCase()}</button>`).join('');
  $$('.lang-btn', langToggle).forEach(btn =>
    btn.addEventListener('click', () => setLang(btn.dataset.lang)));
}

function renderServers() {
  const servers = (state.servers[state.lang] || []).filter(s => s.type === state.lang);
  serverSelect.innerHTML = servers
    .map((s, i) => `<option value="${esc(s.id)}">${esc(s.name || `Server ${i + 1}`)}</option>`)
    .join('');
  if (state.serverId) serverSelect.value = state.serverId;
}

function setLang(lang) {
  if (!state.servers[lang]?.length) return;
  state.lang = lang;
  $$('.lang-btn', langToggle).forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  state.serverId = state.servers[lang][0].id;
  renderServers();
  loadSource(state.serverId);
}

serverSelect.addEventListener('change', () => loadSource(serverSelect.value));

async function loadSource(serverId) {
  destroyPlayback();
  showLoading('Loading stream…');
  try {
    const data = await api(
      `/api/sources/${encodeURIComponent(serverId)}` +
      `?title=${encodeURIComponent(animeTitle.textContent)}` +
      `&number=${encodeURIComponent(state.currentEp?.number || '')}`,
    );
    state.intro = data.intro || null;
    attachSubtitles(data.tracks || []);
    const file = (data.sources || []).map(s => s.file).find(Boolean);
    if (!file) throw new Error('No stream URL returned for this server.');
    playHls(file);
  } catch (err) {
    hideLoading();
    playerError(`Stream failed to load.<br><small>${esc(err.message)} — try another server or language.</small>`);
  }
}

/* ---------------- playback ---------------- */
function playHls(url) {
  const native = video.canPlayType('application/vnd.apple.mpegurl');

  if (window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({ capLevelToPlayerSize: true });
    state.hls = hls;
    hls.on(window.Hls.Events.MANIFEST_PARSED, (_e, data) => {
      hideLoading();
      buildQualityMenu(data.levels || hls.levels || []);
      ensureFirstSubtitle();
      video.play().catch(() => {});
    });
    hls.on(window.Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      hideLoading();
      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else playerError('Stream failed to load.<br><small>Try another server or language.</small>');
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  } else if (native) {
    video.src = url;
    video.addEventListener('loadedmetadata', () => {
      hideLoading();
      ensureFirstSubtitle();
      video.play().catch(() => {});
    }, { once: true });
  } else {
    playerError('This browser cannot play HLS streams.<br><small>Try Chrome, Edge or Safari.</small>');
  }
}

function destroyPlayback() {
  if (state.hls) { try { state.hls.destroy(); } catch { /* already gone */ } state.hls = null; }
  video.removeAttribute('src');
  try { video.load(); } catch { /* noop */ }
  $$('track', video).forEach(t => t.remove());
  state.tracks = [];
  state.intro = null;
  state.ccIdx = -1;
  resetTimeUI();
}

/* ---------------- subtitles ---------------- */
function attachSubtitles(tracks) {
  state.tracks = tracks.filter(t => (t.kind || '') === 'captions');
  state.tracks.forEach((t, i) => {
    const el = document.createElement('track');
    el.kind = 'captions';
    el.label = t.label || `Subtitle ${i + 1}`;
    el.src = t.file;
    el.srclang = (t.label || '').slice(0, 2).toLowerCase() || 'en';
    video.appendChild(el);
  });
  buildCcMenu();
}

function ensureFirstSubtitle() {
  const tts = video.textTracks;
  for (let i = 0; i < tts.length; i++) tts[i].mode = i === 0 ? 'showing' : 'disabled';
  if (tts.length) state.ccIdx = 0;
  markCcSelection();
}

function buildCcMenu() {
  if (!state.tracks.length) {
    ccMenu.innerHTML = '<div class="menu-empty">No subtitles on this server</div>';
    return;
  }
  ccMenu.innerHTML =
    `<button data-cc="-1">Off</button>` +
    state.tracks.map((t, i) => `<button data-cc="${i}">${esc(t.label)}</button>`).join('');
  $$('button[data-cc]', ccMenu).forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.ccIdx = Number(btn.dataset.cc);
    const tts = video.textTracks;
    for (let i = 0; i < tts.length; i++) tts[i].mode = i === state.ccIdx ? 'showing' : 'disabled';
    markCcSelection();
    ccMenu.classList.add('hidden');
  }));
  markCcSelection();
}

function markCcSelection() {
  $$('button[data-cc]', ccMenu).forEach(b =>
    b.classList.toggle('selected', Number(b.dataset.cc) === state.ccIdx));
}

/* ---------------- quality menu ---------------- */
function buildQualityMenu(levels) {
  const usable = levels.filter(l => l.height);
  if (!usable.length) {
    qualityMenu.innerHTML = '<div class="menu-empty">Auto only</div>';
    return;
  }
  qualityMenu.innerHTML =
    `<button data-level="-1" class="selected">Auto</button>` +
    usable.map(l => `<button data-level="${levels.indexOf(l)}">${l.height}p</button>`).join('');
  $$('button[data-level]', qualityMenu).forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.hls) state.hls.currentLevel = Number(btn.dataset.level);
    $$('button[data-level]', qualityMenu).forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    qualityMenu.classList.add('hidden');
  }));
}

/* ---------------- menu open/close ---------------- */
function toggleMenu(menu) {
  $$('.menu').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
  menu.classList.toggle('hidden');
}
ccBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(ccMenu); });
qualityBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(qualityMenu); });
document.addEventListener('click', () => { $$('.menu').forEach(m => m.classList.add('hidden')); });
$$('.menu').forEach(m => m.addEventListener('click', e => e.stopPropagation()));

/* ---------------- transport controls ---------------- */
const togglePlay = () => (video.paused ? video.play().catch(() => {}) : video.pause());
playBtn.addEventListener('click', togglePlay);
video.addEventListener('click', togglePlay);
video.addEventListener('play',  () => { playBtn.textContent = '❚❚'; wake(); });
video.addEventListener('pause', () => { playBtn.textContent = '▶'; wake(); });

const fmt = (s) => {
  if (!Number.isFinite(s)) return '0:00';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(sec).padStart(2, '0');
};

function renderProgress() {
  const dur = video.duration || 0;
  const p = dur ? (video.currentTime / dur) * 100 : 0;
  played.style.width = p + '%';
  knob.style.left = p + '%';
  timeNow.textContent = fmt(video.currentTime);
  let bufEnd = 0;
  if (video.buffered.length) bufEnd = video.buffered.end(video.buffered.length - 1);
  buffered.style.width = (dur ? (bufEnd / dur) * 100 : 0) + '%';
}

video.addEventListener('timeupdate', () => { renderProgress(); checkIntro(); });
video.addEventListener('progress', renderProgress);
video.addEventListener('loadedmetadata', () => { timeTotal.textContent = fmt(video.duration); renderProgress(); });
video.addEventListener('durationchange', () => { timeTotal.textContent = fmt(video.duration); });

function resetTimeUI() {
  played.style.width = '0%';
  buffered.style.width = '0%';
  knob.style.left = '0%';
  timeNow.textContent = '0:00';
  timeTotal.textContent = '0:00';
}

/* seek bar (click + drag) */
let scrubbing = false;
const seekFromEvent = (e) => {
  const r = progress.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  if (video.duration) video.currentTime = ratio * video.duration;
};
progress.addEventListener('pointerdown', (e) => { scrubbing = true; progress.setPointerCapture(e.pointerId); seekFromEvent(e); });
progress.addEventListener('pointermove', (e) => { if (scrubbing) seekFromEvent(e); });
progress.addEventListener('pointerup', () => { scrubbing = false; });
progress.addEventListener('pointercancel', () => { scrubbing = false; });

/* volume */
volume.addEventListener('input', () => {
  video.volume = Number(volume.value);
  video.muted = video.volume === 0;
});
muteBtn.addEventListener('click', () => { video.muted = !video.muted; });
video.addEventListener('volumechange', () => {
  volume.value = video.muted ? 0 : video.volume;
  muteBtn.textContent = (video.muted || video.volume === 0) ? '🔇' : (video.volume < 0.5 ? '🔉' : '🔊');
});

/* fullscreen */
const toggleFullscreen = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    const fn = shell.requestFullscreen || shell.webkitRequestFullscreen;
    if (fn) fn.call(shell);
  }
};
fullscreenBtn.addEventListener('click', toggleFullscreen);

/* prev / next episode */
function epOffset(delta) {
  const i = state.episodes.indexOf(state.currentEp);
  const target = state.episodes[i + delta];
  if (target) setEpisode(target);
}
nextEpBtn.addEventListener('click', () => epOffset(1));
prevEpBtn.addEventListener('click', () => epOffset(-1));

/* ---------------- skip intro ---------------- */
function checkIntro() {
  const i = state.intro;
  const show = !!(i && video.duration
    && video.currentTime >= i.start
    && video.currentTime < Math.min(i.end, video.duration) - 4);
  skipBtn.classList.toggle('hidden', !show);
}
skipBtn.addEventListener('click', () => {
  if (state.intro) video.currentTime = state.intro.end;
  skipBtn.classList.add('hidden');
});

/* ---------------- auto-hide controls ---------------- */
let hideTimer = null;
function wake() {
  shell.classList.add('controls-on');
  shell.classList.remove('cursor-hidden');
  clearTimeout(hideTimer);
  if (!video.paused) {
    hideTimer = setTimeout(() => {
      shell.classList.remove('controls-on');
      shell.classList.add('cursor-hidden');
    }, 3000);
  }
}
shell.addEventListener('pointermove', wake);
shell.addEventListener('pointerleave', () => {
  if (!video.paused) shell.classList.remove('controls-on');
});

/* ---------------- keyboard ---------------- */
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  switch (e.key.toLowerCase()) {
    case ' ': case 'k': e.preventDefault(); togglePlay(); break;
    case 'arrowright': video.currentTime += 5; break;
    case 'arrowleft':  video.currentTime -= 5; break;
    case 'f': toggleFullscreen(); break;
    case 'm': video.muted = !video.muted; break;
  }
});

/* ---------------- overlays ---------------- */
function showLoading(text) {
  loadingEl.classList.remove('hidden');
  const t = loadingEl.querySelector('.loading-text');
  if (t) t.textContent = text || 'Loading…';
}
function hideLoading() { loadingEl.classList.add('hidden'); }

function playerError(html) {
  errorEl.innerHTML = `${html}<button class="btn-ghost" onclick="location.reload()">Reload</button>`;
  errorEl.classList.remove('hidden');
}
function hideError() { errorEl.classList.add('hidden'); }

function fatal(title, sub) {
  const layout = $('.watch-layout') || document.body;
  layout.innerHTML = `<div class="fatal"><h2>${esc(title)}</h2><p>${sub || ''}</p></div>`;
}

wake();

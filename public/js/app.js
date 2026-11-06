/* ================= AniStream — shared helpers + home + browse ================= */
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

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

/* ---------------- anime card ---------------- */
function cardHTML(item) {
  const badges = [];
  if (item.language?.sub) badges.push('SUB');
  if (item.language?.dub) badges.push('DUB');
  const href = `watch.html?dataId=${encodeURIComponent(item.dataId)}&title=${encodeURIComponent(item.title)}`;
  return `
    <a class="card" href="${href}" title="${esc(item.title)}">
      <div class="card-poster">
        <img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy" onerror="this.style.opacity='0'">
        ${item.type ? `<span class="pill pill-type">${esc(item.type)}</span>` : ''}
        ${badges.length ? `<span class="pills">${badges.map(b => `<span class="pill pill-lang">${b}</span>`).join('')}</span>` : ''}
      </div>
      <span class="card-title">${esc(item.title)}</span>
    </a>`;
}

const fillGrid = (el, items) => { el.innerHTML = (items || []).map(cardHTML).join(''); };
const spinnerHTML = '<div class="spinner"></div>';

function pagerHTML(page, hasNext) {
  return `
    <button class="btn-ghost" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Prev</button>
    <span class="pager-info">Page ${page}</span>
    <button class="btn-ghost" data-page="${page + 1}" ${hasNext ? '' : 'disabled'}>Next →</button>`;
}

/* ================= Home ================= */
async function initHome() {
  const rows = {
    'local':     $('#row-local'),
    'top-airing': $('#row-top-airing'),
    popular: $('#row-popular'),
    movies:  $('#row-movies'),
    tv:      $('#row-tv'),
  };
  Object.values(rows).forEach(el => { if (el) el.innerHTML = spinnerHTML; });

  try {
    const localRes = await api('/api/local-media');
    if (localRes && localRes.episodes && localRes.episodes.length) {
      rows['local'].innerHTML = localRes.episodes.map(ep => `
        <a class="card" href="watch.html?dataId=local_lib&ep=${esc(ep.number)}&title=${esc(ep.title)}" title="${esc(ep.title)}">
          <div class="card-poster" style="background:#1a1a2e;display:flex;align-items:center;justify-content:center;color:#e94560;font-size:2rem;">
            ▶
            <span class="pill pill-type">LOCAL</span>
          </div>
          <span class="card-title">${esc(ep.title)}</span>
        </a>`).join('');
    } else {
      rows['local'].innerHTML = `<div class="empty">No local media found. Add files to <code>public/media/</code></div>`;
    }
  } catch {
    rows['local'].innerHTML = `<div class="empty">No local media library detected.</div>`;
  }

  api('/api/home').then(data => {
    fillGrid(rows['top-airing'], data.topAiring?.results);
    fillGrid(rows.popular,       data.popular?.results);
    fillGrid(rows.movies,        data.movies?.results);
    fillGrid(rows.tv,            data.tv?.results);
  }).catch(err => {
    Object.values(rows).forEach(el => {
      if (el) el.innerHTML =
        `<div class="empty">Failed to load: ${esc(err.message)}<br><button class="btn-ghost" onclick="location.reload()">Retry</button></div>`;
    });
  });

  /* ---- live search (home only) ---- */
  const input = $('#search-input');
  const section = $('#search-results');
  const rowsWrap = $('#rows');
  const grid = $('#search-grid');
  const pager = $('#search-pager');
  const titleEl = $('#search-title');
  if (!input || !section) return;

  let q = new URLSearchParams(location.search).get('q') || '';
  let page = 1;
  let timer = null;

  async function runSearch() {
    section.classList.remove('hidden');
    rowsWrap.classList.add('hidden');
    titleEl.textContent = `Results for “${q}”`;
    grid.innerHTML = spinnerHTML;
    pager.innerHTML = '';
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(q)}&page=${page}`);
      if (!(data.results || []).length) {
        grid.innerHTML = '';
        pager.innerHTML = `<div class="empty">No results found for “${esc(q)}”.</div>`;
        return;
      }
      fillGrid(grid, data.results);
      pager.innerHTML = pagerHTML(page, data.hasNextPage);
      $$('button[data-page]', pager).forEach(btn =>
        btn.addEventListener('click', () => { page = Number(btn.dataset.page); runSearch(); window.scrollTo({ top: 0 }); }));
    } catch (err) {
      grid.innerHTML = '';
      pager.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  if (q) { input.value = q; runSearch(); }

  input.addEventListener('input', () => {
    q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 2) {                 // restore home rows
      section.classList.add('hidden');
      rowsWrap.classList.remove('hidden');
      return;
    }
    timer = setTimeout(() => { page = 1; runSearch(); }, 400);
  });
}

/* ================= Browse ================= */
const CATEGORY_LABELS = {
  'top-airing': 'Top Airing', 'most-popular': 'Most Popular',
  movies: 'Movies', tv: 'TV Shows', subbed: 'Subbed Anime',
  dubbed: 'Dubbed Anime', ona: 'ONA', ova: 'OVA', special: 'Specials',
};

async function initBrowse() {
  const params = new URLSearchParams(location.search);
  const cat = params.get('cat') || 'top-airing';
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);

  document.title = `${CATEGORY_LABELS[cat] || cat} — AniStream`;
  const titleEl = $('#browse-title');
  if (titleEl) titleEl.textContent = CATEGORY_LABELS[cat] || cat;

  const sel = $('#category-select');
  if (sel) {
    sel.value = cat;
    sel.addEventListener('change', () => { location.href = `browse.html?cat=${encodeURIComponent(sel.value)}`; });
  }

  const grid = $('#browse-grid');
  const pager = $('#browse-pager');
  grid.innerHTML = spinnerHTML;
  pager.innerHTML = '';

  try {
    const data = await api(`/api/list/${encodeURIComponent(cat)}?page=${page}`);
    if (!(data.results || []).length) {
      grid.innerHTML = '';
      pager.innerHTML = `<div class="empty">Nothing here (or the upstream site changed). Try another category.</div>`;
      return;
    }
    fillGrid(grid, data.results);
    pager.innerHTML = pagerHTML(page, data.hasNextPage);
    $$('button[data-page]', pager).forEach(btn =>
      btn.addEventListener('click', () => {
        location.href = `browse.html?cat=${encodeURIComponent(cat)}&page=${btn.dataset.page}`;
      }));
  } catch (err) {
    grid.innerHTML = '';
    pager.innerHTML = `<div class="empty">Failed to load: ${esc(err.message)}</div>`;
  }
}

/* ================= boot ================= */
document.addEventListener('DOMContentLoaded', () => {
  /* Pressing Enter anywhere with text jumps to the home search results */
  const input = $('#search-input');
  if (input) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim().length >= 2)
      location.href = `index.html?q=${encodeURIComponent(input.value.trim())}`;
  });

  if ($('#row-top-airing')) initHome();
  if ($('#browse-grid')) initBrowse();
});

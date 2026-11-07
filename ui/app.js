const $ = selector => document.querySelector(selector);
const state = { mode: 'drama', category: 'discover', genre: '', keyword: '', page: 0, hasMore: false, loading: false, autoLoadFailed: false, feedMore: {}, cards: [], hero: null, heroItems: [], heroIndex: 0, series: null, episodeIndex: 0, request: 0, quality: localStorage.getItem('guoju:quality') || 'auto', speed: Number(localStorage.getItem('guoju:speed')) || 1 };
const names = { discover: '首页', 'hot-drama': '热门推荐', 'real-drama': '真人短剧', 'comic-drama': '精品漫剧', 'ai-drama': 'AI 短剧', 'official-real': '真人短剧', 'official-comic': '精品漫剧', 'official-ai': 'AI 短剧' };
const discoveryCategories = ['official-real', 'official-comic', 'official-ai'];
const officialCategories = ['real-drama', 'comic-drama', 'ai-drama'];
const video = $('#video');
$('#quality').value = state.quality;
$('#speed').value = String(state.speed);
// Stored player preferences: sharpening strength (enhance.js reads it on load) and picture fit.
$('#enhance').value = ['0', '0.5', '0.9', 'ultra'].includes(localStorage.getItem('guoju:enhance')) ? localStorage.getItem('guoju:enhance') : 'ultra';
$('#fit').value = localStorage.getItem('guoju:fit') === 'cover' ? 'cover' : 'contain';

async function api(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.error || data.success === false) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

// The catalog hands out 640px thumbnails; the same path with `~noop.image` serves the full-size original.
function hiRes(url) {
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return '';
  return /byteimg\.com\/novel-pic\//.test(url) ? url.replace(/~tplv-shrink:\d+:\d+\.image$/, '~noop.image') : url;
}

// Images fade in once decoded instead of popping in line by line.
function smoothImage(image, source, fallback = '') {
  image.decoding = 'async';
  image.classList.remove('loaded');
  image.onload = () => image.classList.add('loaded');
  image.onerror = () => { if (fallback && image.src !== fallback) image.src = fallback; };
  image.src = source;
  if (image.complete && image.naturalWidth) image.classList.add('loaded');
}

function showStatus(message) {
  $('#status').textContent = message;
  $('#status').hidden = !message;
}

/* ---------- Series data + warm-up so a click starts playback quickly ---------- */
const seriesCache = new Map();
function fetchSeries(id) {
  if (!seriesCache.has(id)) {
    seriesCache.set(id, api(`/api/series/${encodeURIComponent(id)}`).catch(error => { seriesCache.delete(id); throw error; }));
  }
  return seriesCache.get(id);
}
const prefetched = new Set();
// full: also download the whole episode into the server's memory cache (used for the episode that
// plays next, so the switch is instant). Without it only the metadata is warmed (hover warm-up).
function prefetchEpisode(vid, full = false) {
  const key = `${vid}:${full ? 'full' : 'meta'}`;
  if (!vid || state.quality !== 'auto' || prefetched.has(key)) return;
  prefetched.add(key);
  fetch(`/api/prefetch/${encodeURIComponent(vid)}${full ? '?full=1' : ''}`, { method: 'POST' }).catch(() => prefetched.delete(key));
}
function warmSeries(item) {
  if (!item?.series_id) return;
  fetchSeries(item.series_id).then(data => {
    const saved = readProgress(item.series_id);
    prefetchEpisode(data.episodes?.[saved?.index || 0]?.vid);
  }).catch(() => {});
}
function attachWarmup(node, item) {
  let timer = 0;
  node.addEventListener('pointerenter', () => { timer = setTimeout(() => warmSeries(item), 280); });
  node.addEventListener('pointerleave', () => clearTimeout(timer));
  node.addEventListener('focus', () => warmSeries(item));
}

function readProgress(id) {
  try { return JSON.parse(localStorage.getItem(`guoju:progress:${id}`)); } catch (_) { return null; }
}

/* ---------- Cards ---------- */
function makeCard(item) {
  const button = document.createElement('button');
  button.className = 'card';
  button.type = 'button';
  const poster = document.createElement('div');
  poster.className = 'poster';
  const source = hiRes(item.cover);
  if (source) {
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    smoothImage(image, source, item.cover);
    poster.append(image);
  }
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = item.total ? `全 ${item.total} 集` : '短剧';
  poster.append(badge);
  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = item.series_title || '未命名短剧';
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.textContent = [item.category_label, ...(Array.isArray(item.tags) ? item.tags.slice(0, 2) : [])].filter(Boolean).join(' · ') || '点击观看';
  button.append(poster, title, meta);
  button.addEventListener('click', () => openDetail(item));
  attachWarmup(button, item);
  return button;
}

const PLAY_ICON = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5.2v13.6a.7.7 0 0 0 1.1.6l10.6-6.8a.7.7 0 0 0 0-1.2L9.1 4.6a.7.7 0 0 0-1.1.6Z"/></svg>';

function makeRailCard(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rail-card';
  button.setAttribute('aria-label', item.series_title || '观看短剧');
  const thumb = document.createElement('span');
  thumb.className = 'rail-thumb';
  const source = hiRes(item.cover);
  if (source) {
    const poster = document.createElement('img');
    poster.className = 'rail-poster';
    poster.alt = '';
    poster.loading = 'lazy';
    smoothImage(poster, source, item.cover);
    thumb.append(poster);
  }
  const overlay = document.createElement('span');
  overlay.className = 'rail-overlay';
  const title = document.createElement('strong');
  title.className = 'rail-cover-title';
  title.textContent = item.series_title || '未命名短剧';
  const progress = readProgress(item.series_id);
  const total = Number(item.episode_count) || 0;
  const meta = document.createElement('span');
  meta.className = 'rail-meta';
  const metaText = document.createElement('span');
  metaText.textContent = progress && Number.isInteger(progress.index)
    ? `看到第 ${progress.index + 1} 集${total ? ` / 共 ${total} 集` : ''}`
    : [...(Array.isArray(item.tags) ? item.tags.slice(0, 2) : []), total ? `${total} 集` : ''].filter(Boolean).join(' · ') || '立即观看';
  // Hover actions: the orange circle plays straight away, ＋ saves to 我的片单; the card itself opens 详情.
  const play = document.createElement('span');
  play.className = 'rail-play';
  play.title = '直接播放';
  play.innerHTML = PLAY_ICON;
  play.addEventListener('click', event => { event.stopPropagation(); openSeries(item); });
  meta.append(play, metaText);
  overlay.append(title, meta);
  thumb.append(overlay, makeListToggle(item, 'rail-list'));
  button.append(thumb);
  if (progress && Number.isInteger(progress.index) && total) {
    const bar = document.createElement('span');
    bar.className = 'rail-progress';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(4, Math.min(100, (progress.index + 1) / total * 100))}%`;
    bar.append(fill);
    button.append(bar);
  }
  button.addEventListener('click', () => openDetail(item));
  attachWarmup(button, item);
  return button;
}

function renderRail(items, title) {
  if (!items.length) return;
  const section = document.createElement('section');
  section.className = 'rail';
  const header = document.createElement('div');
  header.className = 'rail-header';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const arrows = document.createElement('div');
  arrows.className = 'rail-arrows';
  const track = document.createElement('div');
  track.className = 'rail-track';
  for (const [symbol, direction] of [['‹', -1], ['›', 1]]) {
    const arrow = document.createElement('button');
    arrow.type = 'button';
    arrow.textContent = symbol;
    arrow.setAttribute('aria-label', direction < 0 ? '向左浏览' : '向右浏览');
    arrow.addEventListener('click', () => track.scrollBy({ left: direction * track.clientWidth, behavior: 'smooth' }));
    arrows.append(arrow);
  }
  const syncArrows = () => {
    section.classList.toggle('at-start', track.scrollLeft < 8);
    section.classList.toggle('at-end', track.scrollLeft + track.clientWidth >= track.scrollWidth - 8);
  };
  track.addEventListener('scroll', syncArrows, { passive: true });
  header.append(heading, arrows);
  track.append(...items.map(makeRailCard));
  section.append(header, track);
  $('#rails').append(section);
  requestAnimationFrame(syncArrows);
}

/* ---------- Hero (rotating billboard) ---------- */
let heroTimer = 0;
function setHeroItems(items) {
  clearInterval(heroTimer);
  state.heroItems = (items || []).filter(item => item?.series_id && (item.backdrop || item.cover)).slice(0, 6);
  state.heroIndex = 0;
  renderHero(state.heroItems[0] || null);
  const dots = $('#hero-dots');
  dots.replaceChildren(...(state.heroItems.length > 1 ? state.heroItems.map((item, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('aria-label', item.series_title || `第 ${index + 1} 部`);
    dot.addEventListener('click', () => { showHero(index); restartHeroTimer(); });
    return dot;
  }) : []));
  syncHeroDots();
  // Warm the next billboard images so the crossfade never shows a half-loaded picture.
  state.heroItems.slice(1).forEach(item => { const image = new Image(); image.src = hiRes(item.backdrop || item.cover); });
  restartHeroTimer();
}
function restartHeroTimer() {
  clearInterval(heroTimer);
  if (state.heroItems.length < 2) return;
  heroTimer = setInterval(() => {
    if (document.hidden || document.body.classList.contains('player-open') || $('#browse').hidden || $('#hero').matches(':hover')) return;
    showHero(state.heroIndex + 1);
  }, 8000);
}
function showHero(index) {
  const count = state.heroItems.length;
  if (!count) return;
  state.heroIndex = (index + count) % count;
  renderHero(state.heroItems[state.heroIndex]);
  syncHeroDots();
}
function syncHeroDots() {
  [...$('#hero-dots').children].forEach((dot, index) => dot.classList.toggle('active', index === state.heroIndex));
}
function renderHero(item) {
  state.hero = item;
  const hero = $('#hero');
  hero.hidden = !item;
  if (!item) return;
  hero.classList.toggle('has-wide-art', !!item.backdrop);
  $('#hero-title').textContent = item.series_title || '发现好剧';
  $('#hero-description').textContent = item.description || '选一部喜欢的短剧，从第一集开始。';
  const meta = [String(item.category_label || '短剧').replace(/^官网\s*/, ''), ...(Array.isArray(item.tags) ? item.tags.slice(0, 3) : []), item.episode_count ? `全 ${item.episode_count} 集` : ''].filter(Boolean);
  $('#hero-meta').replaceChildren(...meta.map(text => { const span = document.createElement('span'); span.textContent = text; return span; }));
  const progress = readProgress(item.series_id);
  $('#hero-play-label').textContent = progress && Number.isInteger(progress.index) ? `继续观看 第 ${progress.index + 1} 集` : '播放';
  const backdrop = hiRes(item.backdrop || item.cover);
  const poster = hiRes(item.cover);
  if (backdrop) smoothImage($('#hero-backdrop'), backdrop); else $('#hero-backdrop').removeAttribute('src');
  if (poster && !item.backdrop) smoothImage($('#hero-poster'), poster); else $('#hero-poster').removeAttribute('src');
  hero.classList.remove('swap');
  void hero.offsetWidth;
  hero.classList.add('swap');
}

/* ---------- Recent ---------- */
function saveRecent(item) {
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem('guoju:recent')) || []; } catch (_) {}
  recent = [item, ...recent.filter(entry => entry.series_id !== item.series_id)].slice(0, 12);
  localStorage.setItem('guoju:recent', JSON.stringify(recent));
}

function renderRecentRail() {
  if (state.category !== 'discover' || state.keyword) return;
  try {
    const recent = JSON.parse(localStorage.getItem('guoju:recent')) || [];
    renderRail(recent.filter(item => item?.series_id), '继续观看');
  } catch (_) {}
}

/* ---------- Genre dropdown ---------- */
function renderGenres(genres) {
  const wrap = $('#genres');
  if (state.keyword || !Array.isArray(genres) || !genres.length) { wrap.hidden = true; return; }
  const options = [{ slug: '', label: '全部题材' }, ...genres];
  const current = options.find(option => option.slug === state.genre) || options[0];
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'genre-toggle';
  toggle.textContent = current.slug ? current.label : '题材';
  toggle.addEventListener('click', event => { event.stopPropagation(); wrap.classList.toggle('open'); });
  const menu = document.createElement('div');
  menu.className = 'genre-menu';
  menu.append(...options.map(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `genre-chip${state.genre === option.slug ? ' active' : ''}`;
    button.textContent = option.label;
    button.addEventListener('click', () => {
      state.genre = option.slug;
      wrap.classList.remove('open');
      toggle.textContent = option.slug ? option.label : '题材';
      menu.querySelectorAll('.genre-chip').forEach(node => node.classList.toggle('active', node === button));
      loadCatalog();
    });
    return button;
  }));
  wrap.replaceChildren(toggle, menu);
  wrap.classList.remove('open');
  wrap.hidden = false;
}
document.addEventListener('click', event => { if (!event.target.closest('#genres')) $('#genres').classList.remove('open'); });

/* ---------- Catalog ---------- */
async function loadCatalog(append = false) {
  if (append && (state.loading || !state.hasMore)) return;
  if (!append) {
    state.request++;
    state.page = 0;
    state.hasMore = true;
    state.autoLoadFailed = false;
    state.feedMore = Object.fromEntries(discoveryCategories.map(category => [category, true]));
    state.cards = [];
    $('#browse').dataset.view = state.keyword ? 'search' : state.category === 'discover' ? 'home' : 'category';
    $('#rails').replaceChildren();
    setHeroItems([]);
    renderRecentRail();
  }
  const request = state.request;
  state.loading = true;
  showStatus(append ? '' : '正在载入剧目…');
  $('#more').hidden = true;
  try {
    const target = append ? state.cards.length + 12 : 28;
    if (!append && !state.keyword && state.category === 'discover') {
      try {
        const home = await api('/api/official/home');
        if (request !== state.request) return;
        setHeroItems(home.banners);
        // Each homepage row keeps all of its titles (rows may share a few, like any streaming home);
        // only the endless category feed below skips titles already shown.
        const homeIds = new Set();
        for (const section of home.sections || []) {
          const seen = new Set();
          const items = (section.results || []).filter(item => item.series_id && !seen.has(item.series_id) && seen.add(item.series_id));
          renderRail(items, section.title);
          for (const item of items) if (!homeIds.has(item.series_id) && homeIds.add(item.series_id)) state.cards.push(item);
        }
        showStatus('');
      } catch (_) { /* Category pages remain available if the homepage changes. */ }
    }
    let emptyPages = 0;
    do {
      const page = state.page + 1;
      let data;
      if (!state.keyword && state.category === 'discover') {
        const categories = discoveryCategories.filter(category => state.feedMore[category]);
        const pages = await Promise.all(categories.map(category => {
          const kind = `${category.slice('official-'.length)}-drama`;
          return api(`/api/official/catalog?category=${kind}&page=${page}&deep=1`)
            .catch(() => api(`/api/catalog?category=${kind}&page=${page}`));
        }));
        if (request !== state.request) return;
        const lists = pages.map(result => result.results || []);
        const mixed = [];
        for (let index = 0; index < Math.max(0, ...lists.map(list => list.length)); index++) {
          for (let group = 0; group < lists.length; group++) {
            if (lists[group][index]) mixed.push({ ...lists[group][index], category_label: names[categories[group]] });
          }
        }
        categories.forEach((category, index) => { state.feedMore[category] = !!pages[index].hasMore; });
        data = { results: mixed, hasMore: Object.values(state.feedMore).some(Boolean), genres: [] };
      } else if (state.keyword) {
        data = await api(`/api/search?keyword=${encodeURIComponent(state.keyword)}&page=${page}`);
      } else if (officialCategories.includes(state.category)) {
        // The website catalog lists up to 800 titles per category (24 per page) versus ~10 per page from
        // the app catalog, and filters by the website's own topics. Fall back to the app catalog if it fails.
        const appCatalog = genre => api(`/api/catalog?category=${encodeURIComponent(state.category)}&genre=${encodeURIComponent(genre)}&page=${page}`);
        if (state.genreSource === 'app') data = await appCatalog(state.genre);
        else {
          try {
            // Without a topic, page past the 800-title listing into every topic's listing (deep=1).
            data = await api(`/api/official/catalog?category=${encodeURIComponent(state.category)}&genre=${encodeURIComponent(state.genre)}&page=${page}${state.genre ? '' : '&deep=1'}`);
            state.genreSource = 'official';
          } catch (error) {
            if (state.genre && state.genreSource === 'official') throw error;
            data = await appCatalog('');
            state.genreSource = 'app';
          }
        }
      } else {
        data = await api(`/api/catalog?category=${encodeURIComponent(state.category)}&genre=${encodeURIComponent(state.genre)}&page=${page}`);
      }
      if (request !== state.request) return;
      const known = new Set(state.cards.map(item => item.series_id));
      const results = (Array.isArray(data.results) ? data.results : []).filter(item => item.series_id && !known.has(item.series_id) && known.add(item.series_id));
      state.cards.push(...results);
      if (!append && page === 1 && !state.keyword && !state.hero) setHeroItems(results.filter(item => item.cover).slice(0, 5));
      if (state.category === 'discover' && !state.keyword) {
        for (const category of discoveryCategories) {
          const group = results.filter(item => item.category_label === names[category]);
          renderRail(group, page === 1 ? `${names[category]} · 新上线` : `更多${names[category]}`);
        }
      } else renderRail(results, page === 1 ? (state.keyword ? '搜索结果' : names[state.category]) : '继续浏览');
      state.page = page;
      // Deep official paging (no topic) runs to ~400 pages; other sources stop at 50.
      const deepPaging = !state.keyword && !state.genre && state.genreSource !== 'app' && (state.category === 'discover' || officialCategories.includes(state.category));
      state.hasMore = !!data.hasMore && page < (deepPaging ? 2000 : 50);
      if (!append && page === 1) renderGenres(data.genres);
      emptyPages = results.length ? 0 : emptyPages + 1;
      if (state.cards.length) showStatus('');
      // Topic listings overlap, so a deep page can be all repeats: allow a longer run of them.
    } while (state.hasMore && state.cards.length < target && emptyPages < (deepPaging ? 8 : 2));
    $('#more').hidden = !state.hasMore;
    $('#more').textContent = '正在加载更多…';
    showStatus(state.cards.length ? '' : '暂时没有找到剧目，试试其他分类或搜索词。');
  } catch (error) {
    if (request !== state.request) return;
    state.autoLoadFailed = true;
    showStatus(`加载失败：${error.message}`);
    $('#more').hidden = !state.hasMore;
    $('#more').textContent = '加载失败，点击重试';
  } finally {
    if (request === state.request) {
      state.loading = false;
      setTimeout(loadMoreIfVisible, 0);
    }
  }
}

function loadMoreIfVisible() {
  const more = $('#more');
  if (state.mode !== 'drama' || $('#browse').hidden || more.hidden || state.loading || state.autoLoadFailed) return;
  const rect = more.getBoundingClientRect();
  if (rect.top < window.innerHeight + 900 && rect.bottom > -500) loadCatalog(true);
}

/* ---------- Player ---------- */
function progressKey() { return `guoju:progress:${state.series?.series_id}`; }
function saveProgress() {
  if (!state.series || !Number.isFinite(video.currentTime)) return;
  localStorage.setItem(progressKey(), JSON.stringify({ index: state.episodeIndex, second: Math.floor(video.currentTime) }));
}
function episodeAt(index) { return state.series?.episodes?.[index]; }

function playEpisode(index, resumeSecond = 0) {
  const episode = episodeAt(index);
  if (!episode) return;
  saveProgress();
  const changing = index !== state.episodeIndex;
  window.holdEpisodeFrame?.(video, { label: changing ? `第 ${episode.vid_index || index + 1} 集` : '' });
  state.episodeIndex = index;
  video.pause();
  video.removeAttribute('src');
  video.load();
  $('#theater').classList.add('is-buffering');
  video.src = `/api/stream/${encodeURIComponent(episode.vid)}?quality=${state.quality}`;
  video.load();
  video.playbackRate = state.speed;
  window.playerExtras?.onEpisode(episode);
  $('#now-playing').textContent = `${state.series.series_title}  第 ${episode.vid_index || index + 1} 集`;
  $('#prev').disabled = index === 0;
  $('#next').disabled = index === state.series.episodes.length - 1;
  paintEpisodeRange(Math.floor(index / EPISODE_RANGE) * EPISODE_RANGE);
  $('#series-meta').replaceChildren(...[`全 ${state.series.episodes.length} 集`, `正在播放 第 ${episode.vid_index || index + 1} 集`].map((text, i) => {
    const span = document.createElement('span');
    if (i) span.className = 'now';
    span.textContent = text;
    return span;
  }));
  centerActiveEpisode(false);
  $('#video-status').hidden = true;
  video.onloadedmetadata = () => { if (resumeSecond > 0 && resumeSecond < video.duration - 2) video.currentTime = resumeSecond; };
  video.play().catch(() => { window.releaseEpisodeFrame?.(video); $('#video-status').textContent = '点击画面开始播放'; $('#video-status').hidden = false; });
  prefetchEpisode(episodeAt(index + 1)?.vid, true);
  wakeControls();
}

// startIndex (optional) plays a chosen episode; otherwise resume where this series was left off.
async function openSeries(item, startIndex) {
  closeDetail();
  $('#video-status').hidden = true;
  $('#browse').hidden = true;
  $('#actors').hidden = true;
  $('#mine').hidden = true;
  $('#theater').hidden = false;
  $('#theater').classList.add('is-buffering');
  document.body.classList.add('player-open');
  applyOrientation(true);
  $('#theater').classList.remove('show-episodes', 'show-comments');
  $('#settings-panel').hidden = true;
  $('#now-playing').textContent = item.series_title || '';
  try {
    const data = await fetchSeries(item.series_id);
    if (!Array.isArray(data.episodes) || !data.episodes.length) throw new Error('没有可用分集');
    if ($('#theater').hidden) return;
    state.series = data;
    const cover = data.cover || item.cover;
    saveRecent({ series_id: data.series_id || item.series_id, series_title: data.series_title || item.series_title, cover, description: data.intro || item.description, tags: item.tags, episode_count: data.episodes.length });
    $('#series-title').textContent = data.series_title || item.series_title;
    $('#series-intro').textContent = data.intro || item.description || '暂无简介';
    $('#series-intro').classList.remove('expanded');
    $('#episode-total').textContent = `共 ${data.episodes.length} 集`;
    $('#theater-count').textContent = `${data.series_title || item.series_title} · 共 ${data.episodes.length} 集`;
    const coverUrl = hiRes(cover);
    $('#detail-cover').style.backgroundImage = coverUrl ? `url("${coverUrl.replaceAll('"', '%22')}")` : '';
    state.seriesItem = { ...item, series_id: data.series_id || item.series_id, series_title: data.series_title || item.series_title, cover, description: data.intro || item.description, tags: data.tags || item.tags, episode_count: data.episodes.length };
    $('#drawer-list-slot').replaceChildren(makeListToggle(state.seriesItem, 'drawer-list'));
    const saved = readProgress(state.series.series_id);
    const savedIndex = Number.isInteger(saved?.index) && saved.index >= 0 && saved.index < data.episodes.length ? saved.index : 0;
    const chosen = Number.isInteger(startIndex) && startIndex >= 0 && startIndex < data.episodes.length ? startIndex : savedIndex;
    playEpisode(chosen, chosen === savedIndex ? Number(saved?.second) || 0 : 0);
  } catch (error) {
    $('#theater').classList.remove('is-buffering');
    $('#video-status').textContent = `无法播放：${error.message}`;
    $('#video-status').hidden = false;
  }
}

function backToBrowse() {
  saveProgress();
  window.releaseEpisodeFrame?.(video, true);
  video.pause();
  video.removeAttribute('src');
  video.load();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const wasOpen = !$('#theater').hidden;
  state.series = null;
  $('#theater').hidden = true;
  $('#theater').classList.remove('show-episodes', 'show-comments', 'idle', 'is-buffering');
  $('#settings-panel').hidden = true;
  document.body.classList.remove('player-open');
  applyOrientation(false);
  if (state.mode === 'actors') $('#actors').hidden = false;
  else if (state.mode === 'mine') { $('#mine').hidden = false; if (wasOpen) renderMine(); }
  else if (state.mode === 'drama') {
    $('#browse').hidden = false;
    if (wasOpen) refreshProgressViews();
  }
}

// After watching, update the "继续观看" row and the billboard without reloading the page.
function refreshProgressViews() {
  if (state.category !== 'discover' || state.keyword) return;
  let recent = [];
  try { recent = (JSON.parse(localStorage.getItem('guoju:recent')) || []).filter(item => item?.series_id); } catch (_) {}
  const rails = $('#rails');
  const first = rails.firstElementChild;
  if (first?.querySelector('h2')?.textContent === '继续观看') first.remove();
  const anchor = rails.firstElementChild;
  renderRail(recent, '继续观看');
  const added = rails.lastElementChild;
  if (added && added !== anchor && added.querySelector('h2')?.textContent === '继续观看') rails.insertBefore(added, anchor);
  if (state.hero) {
    const progress = readProgress(state.hero.series_id);
    $('#hero-play-label').textContent = progress && Number.isInteger(progress.index) ? `继续观看 第 ${progress.index + 1} 集` : '播放';
  }
}

/* ---------- Navigation ---------- */
function switchView(fn) {
  const main = $('.main');
  main.classList.remove('fade-in');
  fn();
  void main.offsetWidth;
  main.classList.add('fade-in');
  window.scrollTo({ top: 0 });
}

$('#nav').addEventListener('click', event => {
  const feedButton = event.target.closest('[data-feed]');
  if (feedButton) {
    if (state.mode === 'feed') return;
    switchView(() => {
      backToBrowse();
      window.libraryApp?.close();
      window.actorApp?.close();
      state.mode = 'feed';
      $('#browse').hidden = true;
      $('#mine').hidden = true;
      $('#search').placeholder = '片名，按 Enter 搜索';
      document.querySelectorAll('.nav').forEach(node => node.classList.toggle('active', node === feedButton));
      window.feedApp?.open();
    });
    return;
  }
  if (event.target.closest('.nav')) window.feedApp?.close();
  const mineButton = event.target.closest('[data-mine]');
  if (mineButton) {
    switchView(() => {
      backToBrowse();
      window.libraryApp?.close();
      window.actorApp?.close();
      state.mode = 'mine';
      $('#browse').hidden = true;
      $('#search').placeholder = '片名，按 Enter 搜索';
      document.querySelectorAll('.nav').forEach(node => node.classList.toggle('active', node === mineButton));
      $('#mine').hidden = false;
      renderMine();
    });
    return;
  }
  $('#mine').hidden = true;
  const libraryButton = event.target.closest('[data-library]');
  if (libraryButton) {
    switchView(() => {
      backToBrowse();
      window.actorApp?.close();
      state.mode = libraryButton.dataset.library;
      document.querySelectorAll('.nav').forEach(node => node.classList.toggle('active', node === libraryButton));
      $('#browse').hidden = true;
      $('#search').placeholder = state.mode === 'audio' ? '搜索要听的小说' : '搜索要读的小说';
      window.libraryApp?.open(state.mode);
    });
    return;
  }
  const actorButton = event.target.closest('[data-actors]');
  if (actorButton) {
    switchView(() => {
      backToBrowse();
      window.libraryApp?.close();
      state.mode = 'actors';
      $('#browse').hidden = true;
      $('#search').placeholder = '筛选演员';
      document.querySelectorAll('.nav').forEach(node => node.classList.toggle('active', node === actorButton));
      window.actorApp?.open();
    });
    return;
  }
  const button = event.target.closest('[data-category]');
  if (!button) return;
  switchView(() => {
    window.libraryApp?.close();
    window.actorApp?.close();
    state.mode = 'drama';
    state.category = button.dataset.category;
    state.genre = '';
    state.genreSource = '';
    state.keyword = '';
    $('#search').value = '';
    $('#search').placeholder = '片名，按 Enter 搜索';
    $('#page-title').textContent = names[state.category];
    $('#page-subtitle').textContent = '';
    document.querySelectorAll('.nav').forEach(node => node.classList.toggle('active', node === button));
    backToBrowse();
    loadCatalog();
  });
});
$('.brand').addEventListener('click', () => $('[data-category="discover"]').click());

// 白天 / 深夜 mode. The page applies the saved choice before first paint (inline script in <head>).
function paintThemeButton() {
  const light = document.documentElement.dataset.theme === 'light';
  $('#theme-toggle').title = light ? '切换到深夜模式' : '切换到白天模式';
  $('#theme-toggle').setAttribute('aria-label', $('#theme-toggle').title);
}
$('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  const root = document.documentElement;
  root.classList.add('theme-anim');
  root.dataset.theme = next;
  try { localStorage.setItem('guoju:theme', next); } catch (_) {}
  paintThemeButton();
  setTimeout(() => root.classList.remove('theme-anim'), 450);
  showToast(next === 'light' ? '已切换到白天模式' : '已切换到深夜模式');
});
paintThemeButton();
$('#search').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.currentTarget.value = ''; event.currentTarget.blur(); return; }
  if (event.key !== 'Enter') return;
  if (state.mode === 'actors') { window.actorApp?.filter(event.currentTarget.value.trim()); return; }
  if (state.mode === 'mine' || state.mode === 'feed') {
    // Searching from 我的 or 刷剧 looks for dramas.
    state.mode = 'drama';
    $('#mine').hidden = true;
    window.feedApp?.close();
    document.querySelectorAll('.nav').forEach(node => node.classList.remove('active'));
  }
  if (state.mode !== 'drama') { window.libraryApp?.search(event.currentTarget.value.trim()); return; }
  state.keyword = event.currentTarget.value.trim();
  switchView(() => {
    $('#page-title').textContent = state.keyword ? `“${state.keyword}”的搜索结果` : names[state.category];
    $('#page-subtitle').textContent = '';
    backToBrowse();
    loadCatalog();
  });
});
$('#refresh').addEventListener('click', () => loadCatalog());
$('#more').addEventListener('click', () => { state.autoLoadFailed = false; loadCatalog(true); });
$('#hero-play').addEventListener('click', () => { if (state.hero) openSeries(state.hero); });
$('#hero-info').addEventListener('click', () => { if (state.hero) openDetail(state.hero); });
$('#hero-play').addEventListener('pointerenter', () => warmSeries(state.hero));
new IntersectionObserver(loadMoreIfVisible, { rootMargin: '900px' }).observe($('#more'));
// The observer can miss a fast scroll, so every scroll frame also checks whether more titles are needed.
let scrollFrame = 0;
window.addEventListener('scroll', () => {
  document.body.classList.toggle('scrolled', window.scrollY > 8);
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; loadMoreIfVisible(); });
}, { passive: true });

/* ---------- Player controls ---------- */
$('#back').addEventListener('click', backToBrowse);
$('#series-intro').addEventListener('click', event => event.currentTarget.classList.toggle('expanded'));
function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const seconds = Math.floor(value);
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
let scrubbing = false;
function setSeekFill(ratio) {
  $('#seek').style.setProperty('--p', `${Math.max(0, Math.min(1, ratio)) * 100}%`);
}
function updateBuffered() {
  const duration = video.duration;
  if (!Number.isFinite(duration) || !duration || !video.buffered.length) return;
  let end = 0;
  for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= video.currentTime + 1) end = Math.max(end, video.buffered.end(i));
  $('#seek').style.setProperty('--b', `${Math.min(1, end / duration) * 100}%`);
}
function updatePlaybackControls() {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (!scrubbing) {
    $('#seek').value = duration ? String(Math.round(video.currentTime / duration * 1000)) : '0';
    setSeekFill(duration ? video.currentTime / duration : 0);
    $('#time-label').textContent = duration ? formatTime(duration - video.currentTime) : '0:00';
  }
  $('#toggle-play').classList.toggle('is-playing', !video.paused);
  $('#mute').classList.toggle('is-muted', video.muted || video.volume === 0);
  $('#volume').value = String(video.muted ? 0 : Math.round(video.volume * 100));
  $('#volume').style.setProperty('--p', `${video.muted ? 0 : video.volume * 100}%`);
}
function togglePlay() {
  if (!video.getAttribute('src')) return;
  if (video.paused) video.play().catch(() => {}); else video.pause();
  flashCenter(video.paused ? 'pause' : 'play');
}
function seekBy(seconds) {
  if (!Number.isFinite(video.duration)) return;
  video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  wakeControls();
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else $('#theater').requestFullscreen().catch(() => {});
}
// Centre pulse when play state changes from a click or the keyboard.
function flashCenter(kind) {
  document.querySelector('.center-flash')?.remove();
  const flash = document.createElement('div');
  flash.className = 'center-flash';
  flash.innerHTML = kind === 'pause'
    ? '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>'
    : PLAY_ICON;
  $('.video-frame').append(flash);
  flash.addEventListener('animationend', () => flash.remove());
}
$('#toggle-play').addEventListener('click', togglePlay);
$('#back-ten').addEventListener('click', () => seekBy(-10));
$('#forward-ten').addEventListener('click', () => seekBy(10));
$('#mute').addEventListener('click', () => { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.6; });
video.volume = Math.min(1, Math.max(0.05, Number(localStorage.getItem('guoju:volume')) || 1));
$('#volume').addEventListener('input', event => {
  video.volume = Number(event.currentTarget.value) / 100;
  video.muted = video.volume === 0;
  if (video.volume) localStorage.setItem('guoju:volume', String(video.volume));
});
$('#seek').addEventListener('input', event => {
  scrubbing = true;
  const ratio = Number(event.currentTarget.value) / 1000;
  setSeekFill(ratio);
  if (Number.isFinite(video.duration)) $('#time-label').textContent = formatTime(video.duration * (1 - ratio));
});
$('#seek').addEventListener('change', event => {
  scrubbing = false;
  if (Number.isFinite(video.duration)) video.currentTime = Number(event.currentTarget.value) / 1000 * video.duration;
});
$('#fullscreen').addEventListener('click', toggleFullscreen);
$('#episodes-toggle').addEventListener('click', () => { $('#settings-panel').hidden = true; $('#theater').classList.remove('show-comments'); $('#theater').classList.toggle('show-episodes'); centerActiveEpisode(true); });
// Scroll only the episode grid: scrollIntoView would also shift the (overflow-hidden) player sideways.
function centerActiveEpisode(smooth) {
  const grid = $('#episodes');
  const active = grid.querySelector('.active');
  if (!active) return;
  grid.scrollTo({ top: Math.max(0, active.offsetTop - grid.clientHeight / 2 + active.offsetHeight / 2), behavior: smooth ? 'smooth' : 'auto' });
}

// The drawer shows episodes in pages of 30 (1-30, 31-60 …) instead of one very long grid.
const EPISODE_RANGE = 30;
const EQ_BARS = '<i class="eq" aria-hidden="true"><b></b><b></b><b></b></i>';
function paintEpisodeRange(start) {
  const episodes = state.series?.episodes || [];
  const current = state.episodeIndex;
  const tabs = [];
  if (episodes.length > EPISODE_RANGE) {
    for (let from = 0; from < episodes.length; from += EPISODE_RANGE) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.textContent = `${from + 1}-${Math.min(episodes.length, from + EPISODE_RANGE)}`;
      tab.classList.toggle('active', from === start);
      tab.classList.toggle('has-current', current >= from && current < from + EPISODE_RANGE);
      tab.addEventListener('click', () => { paintEpisodeRange(from); $('#episodes').scrollTop = 0; });
      tabs.push(tab);
    }
  }
  $('#episode-ranges').replaceChildren(...tabs);
  $('#episodes').replaceChildren(...episodes.slice(start, start + EPISODE_RANGE).map((episode, offset) => {
    const index = start + offset;
    const number = episode.vid_index || index + 1;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `episode${index === current ? ' active' : index < current ? ' watched' : ''}`;
    button.title = index === current ? `正在播放 第 ${number} 集` : index < current ? `第 ${number} 集（已看过）` : `第 ${number} 集`;
    button.textContent = String(number);
    if (index === current) button.insertAdjacentHTML('beforeend', EQ_BARS);
    button.addEventListener('click', () => { if (index !== state.episodeIndex) playEpisode(index); });
    return button;
  }));
}
$('#drawer-detail').addEventListener('click', () => {
  if (!state.seriesItem) return;
  video.pause();
  openDetail(state.seriesItem);
});
$('#comments-toggle').addEventListener('click', () => { $('#settings-panel').hidden = true; $('#theater').classList.remove('show-episodes'); $('#theater').classList.toggle('show-comments'); });
$('#settings-toggle').addEventListener('click', event => { event.stopPropagation(); $('#settings-panel').hidden = !$('#settings-panel').hidden; });
document.addEventListener('click', event => { if (!event.target.closest('#settings-panel, #settings-toggle')) $('#settings-panel').hidden = true; });
document.querySelectorAll('.drawer-close').forEach(button => button.addEventListener('click', () => $('#theater').classList.remove('show-episodes', 'show-comments')));
video.addEventListener('click', togglePlay);
video.addEventListener('dblclick', toggleFullscreen);
for (const type of ['play', 'pause', 'loadedmetadata', 'volumechange']) video.addEventListener(type, updatePlaybackControls);
video.addEventListener('progress', updateBuffered);
video.addEventListener('waiting', () => $('#theater').classList.add('is-buffering'));
video.addEventListener('canplay', () => $('#theater').classList.remove('is-buffering'));
video.addEventListener('pause', wakeControls);
$('#prev').addEventListener('click', () => playEpisode(state.episodeIndex - 1));
$('#next').addEventListener('click', () => playEpisode(state.episodeIndex + 1));
$('#quality').addEventListener('change', event => {
  state.quality = event.currentTarget.value;
  localStorage.setItem('guoju:quality', state.quality);
  if (state.series) playEpisode(state.episodeIndex, video.currentTime || 0);
});
// 片源: 锐利 = the phone's pre-sharpened HEVC (≈0.84 Mbps); 高码率 = plain H.264 (≈2.3 Mbps at 1080p),
// fewer compression blocks on a big screen. Stored locally and re-applied to the server on start.
function applySource(source) {
  prefetched.clear();
  return fetch(`/api/source?source=${encodeURIComponent(source)}`, { method: 'POST' }).catch(() => {});
}
$('#source').value = (() => { try { return localStorage.getItem('guoju:source') === 'plain' ? 'plain' : 'enhanced'; } catch (_) { return 'enhanced'; } })();
applySource($('#source').value);
$('#source').addEventListener('change', async event => {
  const source = event.currentTarget.value;
  try { localStorage.setItem('guoju:source', source); } catch (_) {}
  await applySource(source);
  if (state.series) playEpisode(state.episodeIndex, video.currentTime || 0);
});
$('#speed').addEventListener('change', event => {
  state.speed = Number(event.currentTarget.value) || 1;
  localStorage.setItem('guoju:speed', String(state.speed));
  video.playbackRate = state.speed;
});
video.addEventListener('ended', () => { if (episodeAt(state.episodeIndex + 1)) playEpisode(state.episodeIndex + 1); });
video.addEventListener('error', () => {
  if (!video.getAttribute('src')) return;
  $('#theater').classList.remove('is-buffering');
  $('#video-status').textContent = '播放失败：片源可能暂时不可用，请换一集或稍后重试。';
  $('#video-status').hidden = false;
});
video.addEventListener('playing', () => { $('#video-status').hidden = true; $('#theater').classList.remove('is-buffering'); });
video.addEventListener('timeupdate', () => { updatePlaybackControls(); updateBuffered(); if (Math.floor(video.currentTime) % 5 === 0) saveProgress(); });
window.addEventListener('beforeunload', saveProgress);

// Turn the quality/speed selects into segmented buttons inside the settings panel.
for (const select of [$('#quality'), $('#source'), $('#speed'), $('#enhance'), $('#fit')]) {
  const group = document.createElement('div');
  group.className = 'seg';
  const sync = () => group.querySelectorAll('button').forEach(button => button.classList.toggle('on', button.dataset.value === select.value));
  for (const option of select.options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.value = option.value;
    button.textContent = option.textContent;
    button.addEventListener('click', () => {
      if (select.value === option.value) return;
      select.value = option.value;
      select.dispatchEvent(new Event('change'));
      sync();
    });
    group.append(button);
  }
  select.hidden = true;
  select.after(group);
  sync();
}

// Hide the chrome after a few idle seconds while playing.
let idleTimer = 0;
function wakeControls() {
  const theater = $('#theater');
  theater.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!video.paused && !theater.classList.contains('is-buffering') && $('#settings-panel').hidden && !theater.matches('.show-episodes, .show-comments') && !$('.player-actions').matches(':hover')) theater.classList.add('idle');
  }, 2800);
}
$('#theater').addEventListener('pointermove', wakeControls);
$('#theater').addEventListener('pointerdown', wakeControls);
video.addEventListener('play', wakeControls);
video.addEventListener('playing', wakeControls);
$('#theater').addEventListener('scroll', event => { event.currentTarget.scrollTop = 0; event.currentTarget.scrollLeft = 0; });

// Short dramas are shot vertically. Fill the side bars with a soft glow sampled from the current frame
// (a tiny canvas scaled up and blurred), instead of plain black.
const ambient = $('#ambient');
const ambientContext = ambient.getContext('2d', { alpha: false });
let ambientTimer = 0;
function paintAmbient() {
  if (video.readyState >= 2 && video.videoWidth) {
    try { ambientContext.drawImage(video, 0, 0, ambient.width, ambient.height); ambient.classList.add('ready'); } catch (_) {}
  }
}
function syncAmbient() {
  clearInterval(ambientTimer);
  const portrait = video.videoHeight > video.videoWidth;
  $('#theater').classList.toggle('portrait', portrait);
  if (!video.videoWidth) return;
  paintAmbient();
  if (!video.paused) ambientTimer = setInterval(paintAmbient, 250);
}
for (const type of ['loadeddata', 'play', 'pause', 'seeked']) video.addEventListener(type, syncAmbient);
// While an episode change holds the last frame, keep the glow lit instead of fading it out and back.
video.addEventListener('emptied', () => { clearInterval(ambientTimer); if (!video.dataset.holding) ambient.classList.remove('ready'); });

document.addEventListener('keydown', event => {
  if ($('#theater').hidden) return;
  if (event.target instanceof HTMLElement && event.target.matches('input[type=search], input[type=text], select')) return;
  const keys = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyF', 'KeyM', 'KeyD', 'KeyR', 'Escape'];
  if (!keys.includes(event.code)) return;
  if (event.target instanceof HTMLElement && event.target.matches('button, input[type=range]')) event.target.blur();
  event.preventDefault();
  wakeControls();
  if (event.code === 'Space') togglePlay();
  if (event.code === 'ArrowUp') playEpisode(state.episodeIndex - 1);
  if (event.code === 'ArrowDown') playEpisode(state.episodeIndex + 1);
  if (event.code === 'ArrowLeft') seekBy(-10);
  if (event.code === 'ArrowRight') seekBy(10);
  if (event.code === 'KeyF') toggleFullscreen();
  if (event.code === 'KeyM') video.muted = !video.muted;
  if (event.code === 'KeyD') $('#danmaku-btn').click();
  if (event.code === 'KeyR' && window.desktop) $('#orientation-btn').click();
  if (event.code === 'Escape') {
    if ($('#theater').matches('.show-episodes, .show-comments') || !$('#settings-panel').hidden) { $('#theater').classList.remove('show-episodes', 'show-comments'); $('#settings-panel').hidden = true; }
    else if (!document.fullscreenElement) backToBrowse();
  }
});

/* ---------- Picture fit and 竖屏 / 横屏 window ---------- */
function applyFit() {
  $('#theater').classList.toggle('fit-cover', $('#fit').value === 'cover');
}
$('#fit').addEventListener('change', () => {
  try { localStorage.setItem('guoju:fit', $('#fit').value); } catch (_) {}
  applyFit();
});
applyFit();

// The preference is remembered; the window is only tall while the player is open,
// and returns to the wide layout for browsing.
let windowOrientation = 'landscape';
function preferredOrientation() { return localStorage.getItem('guoju:orientation') === 'portrait' ? 'portrait' : 'landscape'; }
// The icon shows the window shape currently in use (or the preference when no video is open).
function paintOrientationButton(mode = preferredOrientation()) {
  const portrait = mode === 'portrait';
  const button = $('#orientation-btn');
  button.classList.toggle('is-portrait', portrait);
  button.title = portrait ? '切换为横屏窗口（R）' : '切换为竖屏窗口（R）';
  button.setAttribute('aria-label', button.title);
}
// Landscape episodes (many AI 剧 / 漫剧) always get the wide window; vertical ones follow the
// 竖屏 / 横屏 preference. Until the first frame is known, keep the preference.
let videoIsLandscape = false;
// A click on the button is an explicit choice for the drama being watched: it beats the automatic
// landscape detection until another drama is opened.
let manualOrientation = null;
let manualSeries = null;
function applyOrientation(playerOpen) {
  if (!window.desktop) return;
  const manual = playerOpen && manualOrientation && manualSeries === state.series?.series_id ? manualOrientation : null;
  const wanted = !playerOpen ? 'landscape' : manual || (videoIsLandscape ? 'landscape' : preferredOrientation());
  paintOrientationButton(playerOpen ? wanted : preferredOrientation());
  if (wanted === windowOrientation) return;
  windowOrientation = wanted;
  window.desktop.setOrientation(wanted).catch(() => {});
}
video.addEventListener('loadedmetadata', () => {
  if (!video.videoWidth || !video.videoHeight) return;
  const landscape = video.videoWidth > video.videoHeight;
  const changed = landscape !== videoIsLandscape;
  videoIsLandscape = landscape;
  if ($('#theater').hidden) return;
  const before = windowOrientation;
  applyOrientation(true);
  if (changed && landscape && before === 'portrait' && windowOrientation === 'landscape') showToast('这部剧是横屏画面，已自动切换为横屏窗口（点手机图标可改回竖屏）');
});
if (window.desktop) {
  $('#orientation-btn').hidden = false;
  paintOrientationButton();
  $('#orientation-btn').addEventListener('click', () => {
    // Toggle what is on screen right now, not the stored preference.
    const playerOpen = !$('#theater').hidden;
    const current = playerOpen ? windowOrientation : preferredOrientation();
    const next = current === 'portrait' ? 'landscape' : 'portrait';
    try { localStorage.setItem('guoju:orientation', next); } catch (_) {}
    if (playerOpen) { manualOrientation = next; manualSeries = state.series?.series_id || null; }
    applyOrientation(playerOpen);
    showToast(next === 'portrait' ? '竖屏观看：窗口已调整为手机比例' : '横屏观看：已恢复宽窗口');
  });
}

/* ---------- 我的片单 (saved list, stored on this computer) ---------- */
const LIST_KEY = 'guoju:mylist';
const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
function readStoredList(key) {
  try { const value = JSON.parse(localStorage.getItem(key)); return Array.isArray(value) ? value.filter(entry => entry && (entry.series_id || entry.book_id)) : []; } catch (_) { return []; }
}
function inMyList(id) { return readStoredList(LIST_KEY).some(entry => entry.series_id === id); }
function toggleMyList(item) {
  const list = readStoredList(LIST_KEY);
  const saved = list.some(entry => entry.series_id === item.series_id);
  const next = saved ? list.filter(entry => entry.series_id !== item.series_id) : [{
    series_id: item.series_id, series_title: item.series_title, cover: item.cover, backdrop: item.backdrop || '',
    description: item.description || item.intro || '', tags: Array.isArray(item.tags) ? item.tags.slice(0, 4) : [],
    episode_count: Number(item.episode_count || item.total) || 0, saved_at: Date.now()
  }, ...list].slice(0, 300);
  try { localStorage.setItem(LIST_KEY, JSON.stringify(next)); } catch (_) {}
  syncListToggles(item.series_id);
  showToast(saved ? '已从我的片单移除' : '已加入我的片单');
  if (state.mode === 'mine' && !$('#mine').hidden) renderMine();
}
function paintListToggle(node, saved) {
  node.classList.toggle('saved', saved);
  node.innerHTML = saved ? CHECK_SVG : PLUS_SVG;
  const label = saved ? '已在我的片单（点击移除）' : '加入我的片单';
  node.title = label;
  node.setAttribute('aria-label', label);
  node.setAttribute('aria-pressed', String(saved));
}
function syncListToggles(id) {
  const saved = inMyList(id);
  document.querySelectorAll('.list-toggle').forEach(node => { if (node.dataset.seriesId === id) paintListToggle(node, saved); });
}
function makeListToggle(item, extraClass = '') {
  const node = document.createElement('span');
  node.className = `list-toggle ${extraClass}`.trim();
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  node.dataset.seriesId = item.series_id;
  paintListToggle(node, inMyList(item.series_id));
  const act = event => { event.stopPropagation(); event.preventDefault(); toggleMyList(item); };
  node.addEventListener('click', act);
  node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') act(event); });
  return node;
}

let toastTimer = 0;
function showToast(text) {
  const toast = $('#toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

/* ---------- 详情 modal ---------- */
let detailItem = null;
let detailRequest = 0;
let detailReturnFocus = null;
let detailCloseTimer = 0;
function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  return number >= 1e8 ? `${(number / 1e8).toFixed(1)}亿` : number >= 1e4 ? `${(number / 1e4).toFixed(number >= 1e5 ? 0 : 1)}万` : String(number);
}
async function openDetail(item) {
  if (!item?.series_id) return;
  const request = ++detailRequest;
  const modal = $('#detail-modal');
  clearTimeout(detailCloseTimer);
  if (modal.hidden) detailReturnFocus = document.activeElement;
  paintDetail(item, null);
  modal.hidden = false;
  modal.scrollTop = 0;
  document.documentElement.classList.add('modal-open');
  requestAnimationFrame(() => modal.classList.add('open'));
  $('#detail-close').focus({ preventScroll: true });
  try {
    const data = await fetchSeries(item.series_id);
    if (request !== detailRequest || modal.hidden) return;
    paintDetail(item, data);
    prefetchEpisode(data.episodes?.[readProgress(item.series_id)?.index || 0]?.vid);
  } catch (error) {
    if (request === detailRequest) $('#detail-episodes').textContent = `分集加载失败：${error.message}`;
  }
}
function closeDetail() {
  const modal = $('#detail-modal');
  if (modal.hidden) return;
  detailRequest++;
  modal.classList.remove('open');
  document.documentElement.classList.remove('modal-open');
  detailCloseTimer = setTimeout(() => { modal.hidden = true; }, 220);
  if (detailReturnFocus && document.contains(detailReturnFocus)) detailReturnFocus.focus({ preventScroll: true });
}
function labelled(label, text) {
  const fragment = document.createDocumentFragment();
  const span = document.createElement('span');
  span.className = 'label';
  span.textContent = label;
  fragment.append(span, document.createTextNode(text));
  return fragment;
}
function paintDetail(item, data) {
  const modal = $('#detail-modal');
  const title = data?.series_title || item.series_title || '未命名短剧';
  const intro = data?.intro || item.description || '暂无简介';
  const tags = (Array.isArray(data?.tags) && data.tags.length ? data.tags : item.tags) || [];
  const total = data?.episodes?.length || Number(item.episode_count) || 0;
  const cover = data?.cover || item.cover;
  detailItem = { ...item, series_title: title, cover, description: intro, tags, episode_count: total };
  $('#detail-title').textContent = title;
  if (!data) {
    modal.classList.toggle('has-wide-art', !!item.backdrop);
    const backdrop = hiRes(item.backdrop || cover);
    if (backdrop) smoothImage($('#detail-backdrop'), backdrop); else $('#detail-backdrop').removeAttribute('src');
    if (!item.backdrop && hiRes(cover)) smoothImage($('#detail-poster'), hiRes(cover)); else $('#detail-poster').removeAttribute('src');
  }
  const progress = readProgress(item.series_id);
  const watching = Number.isInteger(progress?.index) && (!total || progress.index < total);
  $('#detail-play-label').textContent = watching ? `继续观看 第 ${progress.index + 1} 集` : '播放';
  const list = $('#detail-list');
  list.dataset.seriesId = item.series_id;
  paintListToggle(list, inMyList(item.series_id));

  const meta = [];
  if (total) meta.push(['', `全 ${total} 集`]);
  meta.push(['hd', '1080P']);
  const favorites = formatCount(data?.social_info?.favorite_count);
  if (favorites) meta.push(['', `${favorites} 人收藏`]);
  if (watching) meta.push(['watching', `看到第 ${progress.index + 1} 集`]);
  $('#detail-meta').replaceChildren(...meta.map(([className, text]) => { const span = document.createElement('span'); if (className) span.className = className; span.textContent = text; return span; }));
  $('#detail-intro').textContent = intro;

  const cast = Array.isArray(data?.celebrities) ? data.celebrities.filter(person => person?.name) : [];
  $('#detail-cast-line').replaceChildren(...(cast.length ? [labelled('演员：', cast.slice(0, 4).map(person => person.name).join('、') + (cast.length > 4 ? ' 等' : ''))] : []));
  $('#detail-genres').replaceChildren(...(tags.length ? [labelled('类型：', tags.slice(0, 6).join('、'))] : []));
  $('#detail-cast-section').hidden = !cast.length;
  $('#detail-cast').replaceChildren(...cast.slice(0, 12).map(person => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'cast';
    node.title = `查看 ${person.name} 的参演作品`;
    const avatar = document.createElement('img');
    avatar.alt = '';
    avatar.loading = 'lazy';
    if (/^https:\/\//.test(person.avatar || '')) avatar.src = person.avatar;
    const name = document.createElement('strong');
    name.textContent = person.name;
    const role = document.createElement('small');
    role.textContent = person.role || '';
    node.append(avatar, name, role);
    node.addEventListener('click', () => {
      if (!person.actor_id) return;
      closeDetail();
      $('[data-actors]').click();
      window.actorApp?.showActor({ actor_id: person.actor_id, name: person.name, avatar: person.avatar });
    });
    return node;
  }));

  $('#detail-episode-total').textContent = total ? `共 ${total} 集` : '';
  if (!data) { $('#detail-ranges').replaceChildren(); $('#detail-episodes').textContent = '正在加载分集…'; return; }
  const episodes = data.episodes || [];
  const size = 50;
  const current = watching ? progress.index : -1;
  const renderRange = start => {
    $('#detail-ranges').querySelectorAll('button').forEach(button => button.classList.toggle('active', Number(button.dataset.start) === start));
    $('#detail-episodes').replaceChildren(...episodes.slice(start, start + size).map((episode, offset) => {
      const index = start + offset;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `episode${index === current ? ' current' : ''}`;
      button.textContent = String(episode.vid_index || index + 1);
      button.title = index === current ? '上次看到这里' : `第 ${index + 1} 集`;
      button.addEventListener('click', () => openSeries(detailItem, index));
      return button;
    }));
  };
  const ranges = [];
  if (episodes.length > size) {
    for (let start = 0; start < episodes.length; start += size) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.start = String(start);
      button.textContent = `${start + 1}-${Math.min(episodes.length, start + size)}`;
      button.addEventListener('click', () => renderRange(start));
      ranges.push(button);
    }
  }
  $('#detail-ranges').replaceChildren(...ranges);
  renderRange(current > 0 ? Math.floor(current / size) * size : 0);
}
$('#detail-close').addEventListener('click', closeDetail);
$('#detail-modal').addEventListener('click', event => { if (event.target === event.currentTarget) closeDetail(); });
$('#detail-play').addEventListener('click', () => { if (detailItem) openSeries(detailItem); });
$('#detail-list').addEventListener('click', () => { if (detailItem) toggleMyList(detailItem); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#detail-modal').hidden) { event.stopImmediatePropagation(); closeDetail(); } }, true);

/* ---------- 我的 page ---------- */
const EMPTY_ICONS = {
  clock: '<svg viewBox="0 0 96 96"><defs><linearGradient id="g-clock" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fa1f41"/><stop offset="1" stop-color="#ff9233"/></linearGradient></defs><circle cx="48" cy="48" r="40" fill="url(#g-clock)"/><circle cx="48" cy="48" r="31" fill="#ffffff22"/><path d="M48 27v22l14 8" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bookmark: '<svg viewBox="0 0 96 96"><defs><linearGradient id="g-mark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fa1f41"/><stop offset="1" stop-color="#ff9233"/></linearGradient></defs><rect x="14" y="20" width="68" height="60" rx="12" fill="url(#g-mark)"/><path d="M14 38h68" stroke="#ffffff55" stroke-width="4"/><path d="M48 46v20M38 56h20" stroke="#fff" stroke-width="6" stroke-linecap="round"/><rect x="30" y="12" width="36" height="14" rx="6" fill="#ff9233"/></svg>',
  book: '<svg viewBox="0 0 96 96"><defs><linearGradient id="g-book" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fa1f41"/><stop offset="1" stop-color="#ff9233"/></linearGradient></defs><path d="M12 24c13-6 25-6 36 2v52c-11-8-23-8-36-2z" fill="url(#g-book)"/><path d="M84 24c-13-6-25-6-36 2v52c11-8 23-8 36-2z" fill="url(#g-book)" opacity=".75"/><path d="M22 38c6-2 12-2 18 1M22 50c6-2 12-2 18 1M56 39c6-3 12-3 18-1M56 51c6-3 12-3 18-1" stroke="#ffffffaa" stroke-width="3.5" stroke-linecap="round" fill="none"/></svg>'
};
function mineBlock(title, items, emptyText, icon, render, gridClass = '', unit = '部') {
  const section = document.createElement('section');
  section.className = 'mine-block';
  const head = document.createElement('div');
  head.className = 'mine-head';
  const heading = document.createElement('h2');
  heading.textContent = title;
  head.append(heading);
  if (items.length) { const count = document.createElement('span'); count.textContent = `${items.length} ${unit}`; head.append(count); }
  section.append(head);
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-panel';
    const art = document.createElement('div');
    art.className = 'empty-art';
    art.innerHTML = EMPTY_ICONS[icon];
    const text = document.createElement('p');
    text.textContent = emptyText;
    empty.append(art, text);
    section.append(empty);
  } else {
    const grid = document.createElement('div');
    grid.className = `mine-grid ${gridClass}`.trim();
    grid.append(...items.map(render));
    section.append(grid);
  }
  return section;
}
function removeRecent(id) {
  const next = readStoredList('guoju:recent').filter(entry => entry.series_id !== id);
  try { localStorage.setItem('guoju:recent', JSON.stringify(next)); } catch (_) {}
  showToast('已从继续观看中移除');
  renderMine();
}
function recentCard(item) {
  const card = makeRailCard(item);
  const remove = document.createElement('span');
  remove.className = 'card-remove';
  remove.setAttribute('role', 'button');
  remove.tabIndex = 0;
  remove.title = '从继续观看中移除';
  remove.setAttribute('aria-label', '从继续观看中移除');
  remove.textContent = '×';
  const act = event => { event.stopPropagation(); event.preventDefault(); removeRecent(item.series_id); };
  remove.addEventListener('click', act);
  remove.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') act(event); });
  card.querySelector('.rail-thumb').append(remove);
  return card;
}
function recentBookCard(book) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'book-result';
  const cover = document.createElement('span');
  cover.className = 'book-cover';
  const fallback = document.createElement('span');
  fallback.className = 'book-cover-text';
  fallback.textContent = String(book.book_name || '').slice(0, 16);
  cover.append(fallback);
  if (/^https:\/\//.test(book.cover || '')) {
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.onerror = () => image.remove();
    image.src = book.cover;
    cover.append(image);
  }
  if (window.bookshelf) cover.append(window.bookshelf.makeToggle(book));
  const body = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = book.book_name || '未命名作品';
  const note = document.createElement('small');
  const chapter = Number(localStorage.getItem(`guoju:book:${book.book_id}`));
  note.textContent = Number.isInteger(chapter) ? `读到第 ${chapter + 1} 章${book.author ? ` · ${book.author}` : ''}` : (book.author || '');
  body.append(title, note);
  button.append(cover, body);
  button.addEventListener('click', () => {
    $('[data-library="novel"]').click();
    window.libraryApp?.openBook(String(book.book_id));
  });
  return button;
}
function renderMine() {
  const recent = readStoredList('guoju:recent').filter(entry => entry.series_id);
  const list = readStoredList(LIST_KEY).filter(entry => entry.series_id);
  const books = readStoredList('guoju:recent-books').filter(entry => entry.book_id);
  const shelf = readStoredList('guoju:bookshelf').filter(entry => entry.book_id);
  $('#mine-content').replaceChildren(
    mineBlock('继续观看', recent, '看过的剧会出现在这里，随时接着看。', 'clock', recentCard),
    mineBlock('我的片单', list, '在剧集卡片或详情里点 ＋，想看的剧都会收进这里。', 'bookmark', makeRailCard),
    mineBlock('我的书架', shelf, '在小说封面上点 ＋，或在阅读时点右上角的书签，喜欢的书都会收进这里。', 'book', recentBookCard, 'books', '本'),
    mineBlock('最近阅读', books, '在“小说”里读过的书会出现在这里。', 'book', recentBookCard, 'books', '本')
  );
}

window.addEventListener('guoju:bookshelf', () => { if (state.mode === 'mine' && !$('#mine').hidden) renderMine(); });

// Every status line (drama, library, actors) shows a spinner while its text says it is loading.
for (const node of document.querySelectorAll('.status')) {
  const sync = () => node.classList.toggle('is-loading', /^正在/.test(node.textContent.trim()));
  new MutationObserver(sync).observe(node, { childList: true, characterData: true, subtree: true });
  sync();
}

updatePlaybackControls();
loadCatalog();

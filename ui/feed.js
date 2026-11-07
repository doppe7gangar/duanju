// 刷剧: a vertical, auto-playing feed for people who don't know what to watch yet.
// One drama per screen, starting at episode 1. Wheel / ↑↓ / drag switches dramas; when an episode
// ends the next one plays in place; 看全集 hands the drama over to the full player at the same spot.
(() => {
  const section = $('#feed');
  const card = $('#feed-card');
  const player = $('#feed-video');
  const poster = $('#feed-poster');
  const backdrop = $('#feed-bg');
  const status = $('#feed-status');
  const fill = $('#feed-progress-fill');
  const kinds = ['real-drama', 'real-drama', 'comic-drama', 'ai-drama'];

  const queue = [];
  const seen = new Set();
  let index = -1;
  let current = null;        // { item, data, ep }
  let token = 0;             // guards against a slow request finishing after the user moved on
  let filling = null;
  let homeLoaded = false;
  let round = 0;
  // Deep official paging (deep=1) chains a category's plain listing with every topic's listing:
  // a few hundred pages of 24. Pick random pages across that whole range, not just the first few hot
  // pages. Until a category reports its real page count, stay within the plain 33-page listing.
  const totalPages = Object.fromEntries(kinds.map(kind => [kind, 33]));
  const randomPage = kind => 1 + Math.floor(Math.random() * totalPages[kind]);
  const pages = Object.fromEntries(kinds.map(kind => [kind, randomPage(kind)]));
  // Dramas already shown in the feed on earlier visits (most recent last). They are skipped next
  // time, so reopening the feed does not start with the same dramas again.
  const SHOWN_KEY = 'guoju:feed-shown';
  const SHOWN_LIMIT = 400;
  let shown = [];
  try { shown = JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]').filter(id => typeof id === 'string'); } catch (_) { shown = []; }
  let shownSet = new Set(shown);
  function rememberShown(id) {
    if (!id || shownSet.has(id)) return;
    shown.push(id); shownSet.add(id);
    if (shown.length > SHOWN_LIMIT) shownSet.delete(shown.shift());
    try { localStorage.setItem(SHOWN_KEY, JSON.stringify(shown)); } catch (_) {}
  }
  let resumeAt = null;       // where to pick up again when the feed is reopened
  let handedToTheater = false;
  let retry = null;

  function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
  // Dramas the viewer has already started are skipped: the feed is for finding something new.
  // Collect the dramas worth showing from a batch: not queued yet, not started, not shown on a recent visit.
  function fresh(items) {
    return items.filter(item => item?.series_id && !seen.has(item.series_id) && !readProgress(item.series_id)
      && !shownSet.has(item.series_id) && seen.add(item.series_id));
  }
  function fillQueue() {
    if (filling) return filling;
    filling = (async () => {
      // One batch mixes several random catalog pages (and, the first time, the official home picks),
      // shuffled together, instead of always playing the same home recommendations first.
      const batch = [];
      if (!homeLoaded) {
        homeLoaded = true;
        try {
          const home = await api('/api/official/home');
          // Only a handful of the (always identical) home picks, so they do not dominate the start.
          const picks = shuffle([...(home.banners || []), ...(home.sections || []).flatMap(section => section.results || [])]);
          // (Slice before fresh(): it marks dramas as queued, which would hide the unpicked ones all session.)
          batch.push(...fresh(picks.filter(item => !shownSet.has(item?.series_id) && !readProgress(item?.series_id)).slice(0, 8)));
        } catch (_) { /* the category feeds below are enough */ }
      }
      for (let attempt = 0; attempt < 6 && (attempt < 2 || batch.length < 24); attempt++) {
        // Everything on the pages tried so far was shown recently: forget that history and keep going.
        if (attempt === 4 && !batch.length && !queue.length && shown.length) {
          shown = []; shownSet = new Set();
          try { localStorage.removeItem(SHOWN_KEY); } catch (_) {}
        }
        const kind = kinds[round++ % kinds.length];
        const page = pages[kind];
        // Jump to another random page next time rather than walking the list in order.
        try {
          const data = await api(`/api/official/catalog?category=${kind}&page=${page}&deep=1`)
            .catch(() => api(`/api/catalog?category=${kind}&page=${Math.min(page, 33)}`));
          if (Number(data.totalPages) > 0) totalPages[kind] = Math.min(2000, Number(data.totalPages));
          batch.push(...fresh(data.results || []));
        } catch (_) { /* try another category */ }
        pages[kind] = randomPage(kind);
      }
      queue.push(...shuffle(batch));
      if (!batch.length && !queue.length) throw new Error('暂时没有取到剧目');
    })().finally(() => { filling = null; });
    return filling;
  }

  function setStatus(text, onClick = null) {
    status.textContent = text;
    status.hidden = !text;
    status.classList.toggle('clickable', !!onClick);
    retry = onClick;
  }
  status.addEventListener('click', () => retry?.());

  function paintInfo(item, data) {
    const total = data?.episodes?.length || Number(item.episode_count || item.total) || 0;
    $('#feed-title').textContent = data?.series_title || item.series_title || '未命名短剧';
    $('#feed-intro').textContent = data?.intro || item.description || '';
    const tags = (Array.isArray(data?.tags) && data.tags.length ? data.tags : item.tags) || [];
    $('#feed-tags').replaceChildren(...tags.slice(0, 4).map(text => { const span = document.createElement('span'); span.textContent = text; return span; }));
    $('#feed-watch-label').textContent = total ? `看全集 · 共 ${total} 集` : '看全集';
    paintEpisode();
    $('#feed-list-slot').replaceChildren(makeListToggle(fullItem(item, data), 'feed-list'));
  }
  function paintEpisode() {
    const total = current?.data?.episodes?.length;
    const ep = current?.data?.episodes?.[current.ep];
    $('#feed-episode').textContent = ep ? `第 ${ep.vid_index || current.ep + 1} 集${total ? ` / 共 ${total} 集` : ''}` : '';
  }
  function fullItem(item, data) {
    return {
      ...item,
      series_id: data?.series_id || item.series_id,
      series_title: data?.series_title || item.series_title,
      cover: data?.cover || item.cover,
      description: data?.intro || item.description,
      tags: (Array.isArray(data?.tags) && data.tags.length ? data.tags : item.tags) || [],
      episode_count: data?.episodes?.length || item.episode_count || 0
    };
  }
  function paintArt(item) {
    const source = hiRes(item.cover);
    card.classList.remove('playing', 'wide');
    if (source) { smoothImage(poster, source, item.cover); smoothImage(backdrop, source, item.cover); }
    else { poster.removeAttribute('src'); backdrop.removeAttribute('src'); }
  }

  function stopVideo() {
    player.pause();
    player.removeAttribute('src');
    player.load();
  }

  async function show(at, resume = null) {
    if (at < 0) { showToast('已经是第一部了'); return; }
    const my = ++token;
    if (at >= queue.length - 3) fillQueue().catch(() => {});
    if (at >= queue.length) {
      setStatus('正在为你挑选短剧…');
      try { await fillQueue(); } catch (error) { if (my === token) setStatus(`加载失败：${error.message}（点击重试）`, () => show(at)); return; }
      if (my !== token) return;
      if (at >= queue.length) { setStatus('暂时没有更多新剧了，点击重试', () => show(at)); return; }
    }
    saveFeedProgress();
    index = at;
    const item = queue[at];
    rememberShown(item.series_id);
    current = { item, data: null, ep: 0 };
    stopVideo();
    setStatus('');
    section.classList.add('is-buffering');
    fill.style.width = '0%';
    paintArt(item);
    paintInfo(item, null);
    let data;
    try {
      data = await fetchSeries(item.series_id);
      if (!Array.isArray(data.episodes) || !data.episodes.length) throw new Error('没有可用分集');
    } catch (_) {
      if (my !== token) return;
      section.classList.remove('is-buffering');
      setStatus('这部剧暂时无法播放，正在换下一部…');
      setTimeout(() => { if (my === token && active()) show(index + 1); }, 1200);
      return;
    }
    if (my !== token) return;
    current.data = data;
    paintInfo(item, data);
    const ep = Number.isInteger(resume?.ep) && resume.ep < data.episodes.length ? resume.ep : 0;
    playEpisode(ep, resume?.time || 0);
    // Warm the next drama so swiping feels instant.
    const next = queue[index + 1];
    if (next) warmSeries(next);
  }

  function playEpisode(ep, second = 0) {
    const episode = current?.data?.episodes?.[ep];
    if (!episode) return;
    current.ep = ep;
    current.started = false;
    paintEpisode();
    section.classList.add('is-buffering');
    player.src = `/api/stream/${encodeURIComponent(episode.vid)}?quality=${state.quality}`;
    player.playbackRate = state.speed;
    player.onloadedmetadata = () => {
      card.classList.toggle('wide', player.videoWidth > player.videoHeight);
      if (second > 0 && second < player.duration - 2) player.currentTime = second;
    };
    if (active()) startPlayback();
    prefetchEpisode(current.data.episodes[ep + 1]?.vid, true);
  }
  // Autoplay with sound; if the browser refuses, fall back to muted playback and tell the viewer.
  function startPlayback() {
    player.play().catch(() => {
      if (!active() || player.muted) return;
      player.muted = true;
      paintMute();
      player.play().then(() => showToast('已静音自动播放，点右侧喇叭打开声音')).catch(() => {});
    });
  }

  // Once a drama has been watched for a while it counts as started: it shows up in 继续观看.
  function saveFeedProgress(force = false) {
    if (!current?.data || !player.getAttribute('src') || !Number.isFinite(player.currentTime)) return;
    if (!force && current.ep === 0 && player.currentTime < 15) return;
    const id = current.data.series_id || current.item.series_id;
    try { localStorage.setItem(`guoju:progress:${id}`, JSON.stringify({ index: current.ep, second: Math.floor(player.currentTime) })); } catch (_) {}
    if (!current.started) { current.started = true; saveRecent(fullItem(current.item, current.data)); }
  }

  function active() {
    return !section.hidden && $('#theater').hidden && $('#detail-modal').hidden;
  }

  /* ---------- Switching dramas ---------- */
  let moving = false;
  function go(direction) {
    if (moving || !queue.length) return;
    const target = index + direction;
    if (target < 0) { showToast('已经是第一部了'); snapBack(); return; }
    moving = true;
    window.releaseEpisodeFrame?.(player, true);
    player.pause();
    card.style.transform = '';
    card.classList.remove('enter-up', 'enter-down', 'snap');
    card.classList.add(direction > 0 ? 'leave-up' : 'leave-down');
    setTimeout(() => {
      card.classList.remove('leave-up', 'leave-down');
      void card.offsetWidth;
      card.classList.add(direction > 0 ? 'enter-up' : 'enter-down');
      moving = false;
      show(target);
    }, 230);
  }
  function snapBack() {
    card.classList.add('snap');
    card.style.transform = '';
    setTimeout(() => card.classList.remove('snap'), 260);
  }
  card.addEventListener('animationend', () => card.classList.remove('enter-up', 'enter-down'));

  // Mouse wheel and touchpads: one notch (or one swipe gesture) moves one drama.
  let wheelLock = 0;
  let wheelSum = 0;
  section.addEventListener('wheel', event => {
    if (event.target.closest('.feed-intro-open')) return;
    event.preventDefault();
    const now = Date.now();
    if (now < wheelLock) return;
    wheelSum += event.deltaY;
    if (Math.abs(wheelSum) < 40) return;
    go(wheelSum > 0 ? 1 : -1);
    wheelSum = 0;
    wheelLock = now + 650;
  }, { passive: false });

  // Drag the card up / down like a phone; a plain click toggles play.
  let drag = null;
  card.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button, .list-toggle, .feed-progress')) return;
    drag = { y: event.clientY, dy: 0, id: event.pointerId, moved: false };
    card.setPointerCapture(event.pointerId);
  });
  card.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    drag.dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(drag.dy) > 8) { drag.moved = true; card.classList.add('dragging'); }
    if (drag.moved) card.style.transform = `translateY(${drag.dy * (index === 0 && drag.dy > 0 ? 0.3 : 0.85)}px)`;
  });
  const endDrag = event => {
    if (!drag || event.pointerId !== drag.id) return;
    const { dy, moved } = drag;
    drag = null;
    card.classList.remove('dragging');
    if (!moved) { if (event.type === 'pointerup') togglePlay(); return; }
    if (dy < -80) go(1);
    else if (dy > 80) go(-1);
    else snapBack();
  };
  card.addEventListener('pointerup', endDrag);
  card.addEventListener('pointercancel', endDrag);

  function togglePlay() {
    if (!player.getAttribute('src')) return;
    if (player.paused) startPlayback(); else player.pause();
  }

  /* ---------- Controls ---------- */
  function paintMute() {
    const muted = player.muted || player.volume === 0;
    $('#feed-mute').classList.toggle('is-muted', muted);
    $('#feed-mute-label').textContent = muted ? '静音' : '声音';
  }
  function watchFull() {
    if (!current) return;
    saveFeedProgress(true);
    handedToTheater = true;
    player.pause();
    openSeries(fullItem(current.item, current.data));
  }
  $('#feed-mute').addEventListener('click', () => {
    player.muted = !player.muted;
    if (!player.muted && player.volume === 0) player.volume = 0.6;
    try { localStorage.setItem('guoju:feed-muted', player.muted ? '1' : '0'); } catch (_) {}
    paintMute();
  });
  $('#feed-watch').addEventListener('click', watchFull);
  $('#feed-full').addEventListener('click', watchFull);
  $('#feed-detail').addEventListener('click', () => { if (current) { player.pause(); openDetail(fullItem(current.item, current.data)); } });
  $('#feed-prev').addEventListener('click', () => go(-1));
  $('#feed-next').addEventListener('click', () => go(1));
  $('#feed-intro').addEventListener('click', event => event.currentTarget.classList.toggle('feed-intro-open'));
  $('#feed-progress').addEventListener('pointerdown', event => {
    if (!Number.isFinite(player.duration)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    player.currentTime = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * player.duration;
  });

  player.volume = Math.min(1, Math.max(0.05, Number(localStorage.getItem('guoju:volume')) || 1));
  player.muted = localStorage.getItem('guoju:feed-muted') === '1';
  paintMute();
  player.addEventListener('volumechange', paintMute);
  player.addEventListener('playing', () => { card.classList.add('playing'); section.classList.remove('is-buffering'); setStatus(''); });
  player.addEventListener('waiting', () => section.classList.add('is-buffering'));
  player.addEventListener('canplay', () => section.classList.remove('is-buffering'));
  player.addEventListener('play', () => { section.classList.remove('is-paused'); if (!active()) player.pause(); });
  player.addEventListener('pause', () => section.classList.add('is-paused'));
  player.addEventListener('timeupdate', () => {
    if (Number.isFinite(player.duration) && player.duration) fill.style.width = `${player.currentTime / player.duration * 100}%`;
    if (Math.floor(player.currentTime) % 5 === 0) saveFeedProgress();
  });
  // End of an episode: keep watching this drama; after its last episode, move on to the next one.
  player.addEventListener('ended', () => {
    saveFeedProgress();
    const next = current?.data?.episodes?.[current.ep + 1];
    if (next) {
      window.holdEpisodeFrame?.(player, { label: `第 ${next.vid_index || current.ep + 2} 集` });
      playEpisode(current.ep + 1);
    } else go(1);
  });
  player.addEventListener('error', () => {
    if (!player.getAttribute('src') || !active()) return;
    section.classList.remove('is-buffering');
    setStatus('片源暂时不可用，正在换下一部…');
    const my = token;
    setTimeout(() => { if (my === token && active()) go(1); }, 1500);
  });
  window.addEventListener('beforeunload', () => saveFeedProgress());

  document.addEventListener('keydown', event => {
    if (!active()) return;
    if (event.target instanceof HTMLElement && event.target.matches('input[type=search], input[type=text], textarea, select')) return;
    const keys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'KeyJ', 'KeyK', 'Space', 'KeyM', 'Enter', 'ArrowLeft', 'ArrowRight'];
    if (!keys.includes(event.code)) return;
    if (event.target instanceof HTMLElement && event.target.matches('button, [role=button]')) event.target.blur();
    event.preventDefault();
    if (event.repeat && !['ArrowLeft', 'ArrowRight'].includes(event.code)) return;
    if (['ArrowDown', 'PageDown', 'KeyJ'].includes(event.code)) go(1);
    if (['ArrowUp', 'PageUp', 'KeyK'].includes(event.code)) go(-1);
    if (event.code === 'Space') togglePlay();
    if (event.code === 'KeyM') $('#feed-mute').click();
    if (event.code === 'Enter') watchFull();
    if (event.code === 'ArrowLeft' && Number.isFinite(player.duration)) player.currentTime = Math.max(0, player.currentTime - 5);
    if (event.code === 'ArrowRight' && Number.isFinite(player.duration)) player.currentTime = Math.min(player.duration, player.currentTime + 5);
  });

  // The full player and the 详情 window sit on top of the feed: pause underneath, pick up afterwards.
  let theaterOpen = false;
  new MutationObserver(() => {
    const open = !$('#theater').hidden;
    if (open === theaterOpen) return;
    theaterOpen = open;
    if (open) { handedToTheater = !section.hidden; player.pause(); return; }
    if (section.hidden) return;
    // Back from watching the whole drama: carry on with something new.
    if (handedToTheater) { handedToTheater = false; go(1); }
    else startPlayback();
  }).observe($('#theater'), { attributes: true, attributeFilter: ['hidden'] });
  let modalOpen = false;
  new MutationObserver(() => {
    const open = !$('#detail-modal').hidden;
    if (open === modalOpen) return;
    modalOpen = open;
    if (open) player.pause();
    else if (active() && player.getAttribute('src')) startPlayback();
  }).observe($('#detail-modal'), { attributes: true, attributeFilter: ['hidden'] });

  window.feedApp = {
    open() {
      section.hidden = false;
      document.body.classList.add('feed-open');
      if (index < 0) show(0);
      else { const at = resumeAt; resumeAt = null; show(index, at); }
    },
    close() {
      if (section.hidden) return;
      saveFeedProgress();
      resumeAt = current?.data ? { ep: current.ep, time: player.currentTime } : null;
      token++;
      stopVideo();
      section.hidden = true;
      document.body.classList.remove('feed-open');
    }
  };
})();

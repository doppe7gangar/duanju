(() => {
  const layer = $('#danmaku-layer');
  const toggle = $('#danmaku-toggle');
  const button = $('#danmaku-btn');
  const comments = $('#comments-list');
  let items = [];
  let cursor = 0;
  let request = 0;

  // The platform writes stickers as bracketed names, e.g. "[捂脸]". Show them as emoji.
  const EMOJI = {
    微笑: '🙂', 笑: '😄', 大笑: '😆', 呲牙: '😁', 憨笑: '😄', 开心: '😊', 可爱: '😊', 害羞: '☺️', 尬笑: '😅', 尴尬: '😅', 擦汗: '😓', 汗: '😅',
    捂脸: '🤦', 笑哭: '😂', 哭: '😭', 大哭: '😭', 泪奔: '😭', 快哭了: '🥺', 委屈: '🥺', 可怜: '🥺', 伤心: '😢', 流泪: '😢', 心碎: '💔',
    偷笑: '🤭', 奸笑: '😏', 坏笑: '😏', 机智: '😏', 得意: '😎', 酷: '😎', 爽: '😎', 做鬼脸: '😜', 调皮: '😜', 吐舌: '😛',
    爱慕: '🥰', 色: '😍', 舔屏: '🤤', 飞吻: '😘', 亲亲: '😚', 送心: '💗', 爱心: '❤️', 比心: '🫶', 送花: '🌹', 玫瑰: '🌹',
    赞: '👍', 强: '💪', 加油: '💪', 鼓掌: '👏', 抱拳: '🙏', 感谢: '🙏', 握手: '🤝', 耶: '✌️', 胜利: '✌️', OK: '👌', 拳头: '👊',
    思考: '🤔', 探究: '🧐', 疑问: '🤨', 懂了: '💡', 学会了: '💡', 灵光一闪: '💡', 惊讶: '😮', 吃惊: '😲', 震惊: '😱', 恐惧: '😨',
    生气: '😠', 怒: '😠', 发怒: '😡', 抓狂: '😫', 无语: '😑', 白眼: '🙄', 鄙视: '😒', 斜眼: '😒', 晕: '😵', 吐: '🤮', 闭嘴: '🤐', 嘘: '🤫',
    睡: '😴', 困: '😪', 再见: '👋', 火: '🔥', 庆祝: '🎉', 礼物: '🎁', 红包: '🧧', 666: '👍', 求爆更: '🙏', 没看够: '🥺', 看: '👀'
  };
  function appendRichText(node, text) {
    const parts = String(text || '').split(/(\[[^\[\]]{1,8}\])/);
    for (const part of parts) {
      if (!part) continue;
      const name = part.startsWith('[') && part.endsWith(']') ? part.slice(1, -1) : null;
      if (name && EMOJI[name]) {
        const emoji = document.createElement('span');
        emoji.className = 'emoji';
        emoji.title = name;
        emoji.textContent = EMOJI[name];
        node.append(emoji);
      } else if (name) {
        const sticker = document.createElement('span');
        sticker.className = 'sticker';
        sticker.textContent = name;
        node.append(sticker);
      } else node.append(document.createTextNode(part.replace(/\[$/, '')));
    }
  }

  /* ---------- Danmaku (on by default; toggle in the control bar or settings) ---------- */
  toggle.checked = localStorage.getItem('guoju:danmaku') !== 'off';
  function syncButton() {
    button.classList.toggle('on', toggle.checked);
    button.setAttribute('aria-pressed', String(toggle.checked));
    button.title = toggle.checked ? '关闭弹幕' : '开启弹幕';
  }
  function resetCursor() {
    layer.replaceChildren();
    lanes.fill(0);
    cursor = items.findIndex(item => item.time >= video.currentTime);
    if (cursor < 0) cursor = items.length;
  }
  toggle.addEventListener('change', () => {
    localStorage.setItem('guoju:danmaku', toggle.checked ? 'on' : 'off');
    syncButton();
    resetCursor();
  });
  button.addEventListener('click', () => {
    toggle.checked = !toggle.checked;
    toggle.dispatchEvent(new Event('change'));
  });

  // Fixed lanes keep comments from piling on top of each other.
  const LANES = 9;
  const lanes = new Array(LANES).fill(0);
  function fire(item) {
    const now = performance.now();
    const lane = lanes.findIndex(busyUntil => busyUntil <= now);
    if (lane < 0) return;
    const node = document.createElement('span');
    node.className = 'danmaku-item';
    if (Number(item.likes) >= 20) node.classList.add('hot');
    appendRichText(node, item.text);
    node.style.top = `${10 + lane * 5.6}%`;
    if (/^#[0-9a-f]{6}$/i.test(item.color || '') && item.color.toUpperCase() !== '#FFFFFF') node.style.color = item.color;
    layer.append(node);
    lanes[lane] = now + 1800 + Math.min(1600, String(item.text || '').length * 90);
    node.addEventListener('animationend', () => node.remove());
  }
  video.addEventListener('timeupdate', () => {
    if (!toggle.checked || !items.length || video.paused) return;
    const now = video.currentTime;
    while (cursor < items.length && items[cursor].time <= now) {
      if (items[cursor].time >= now - 0.6) fire(items[cursor]);
      cursor++;
    }
  });
  video.addEventListener('seeked', resetCursor);
  video.addEventListener('pause', () => layer.classList.add('paused'));
  video.addEventListener('play', () => layer.classList.remove('paused'));

  /* ---------- Comments ---------- */
  function timeAgo(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return '';
    const seconds = Math.max(0, (Date.now() - value) / 1000);
    if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
    const date = new Date(value);
    return date.getFullYear() === new Date().getFullYear() ? `${date.getMonth() + 1}月${date.getDate()}日` : `${date.getFullYear()}年${date.getMonth() + 1}月`;
  }
  function compact(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '';
    return number >= 1e4 ? `${(number / 1e4).toFixed(1).replace(/\.0$/, '')}万` : String(number);
  }
  function showComment(item) {
    const row = document.createElement('div');
    row.className = 'comment';
    const avatar = document.createElement('span');
    avatar.className = 'comment-avatar';
    const name = String(item.author || '').trim();
    avatar.textContent = name ? name.slice(0, 1) : '果';
    if (/^https:\/\//.test(item.avatar || '')) {
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.onerror = () => image.remove();
      image.src = item.avatar;
      avatar.append(image);
    }
    const body = document.createElement('div');
    body.className = 'comment-body';
    const head = document.createElement('div');
    head.className = 'comment-head';
    const author = document.createElement('strong');
    author.textContent = name || '红果用户';
    const when = document.createElement('time');
    when.textContent = timeAgo(item.created_at);
    head.append(author, when);
    const text = document.createElement('p');
    text.className = 'comment-text';
    appendRichText(text, item.content);
    body.append(head, text);
    const likes = compact(item.likes);
    if (likes) {
      const like = document.createElement('span');
      like.className = 'comment-likes';
      like.textContent = `♥ ${likes}`;
      body.append(like);
    }
    row.append(avatar, body);
    return row;
  }
  function setCommentsHeader(title, count, note) {
    $('#comments-title').textContent = title;
    $('#comments-count').textContent = count;
    $('#comments-note').textContent = note || '';
    $('#comments-note').hidden = !note;
  }

  /* Paged comments: 本集评论 / 本剧评论 tabs, next page when scrolled near the end, replies on demand. */
  const feed = { seriesId: '', vid: '', kind: 'episode', cursor: '', hasMore: false, loading: false, loaded: false, request: 0, source: '', seen: new Set() };
  const tabs = $('#comment-tabs');
  function drawerOpen() { return $('#theater').classList.contains('show-comments'); }
  function statusLine(text, retry) {
    const line = document.createElement('div');
    line.className = 'comments-status';
    line.textContent = text;
    if (retry) {
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'pill-btn';
      again.textContent = '重试';
      again.addEventListener('click', () => loadComments(false));
      line.append(again);
    }
    return line;
  }
  function replyBlock(item) {
    const wrap = document.createElement('div');
    wrap.className = 'comment-replies';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'reply-toggle';
    toggle.textContent = `展开 ${compact(item.replies)} 条回复`;
    const list = document.createElement('div');
    list.className = 'reply-list';
    let replyCursor = '';
    let loading = false;
    async function more() {
      if (loading) return;
      loading = true;
      toggle.disabled = true;
      toggle.textContent = '正在加载回复…';
      try {
        const data = await api(`/api/comments/${encodeURIComponent(feed.seriesId)}/${encodeURIComponent(feed.vid)}/replies/${encodeURIComponent(item.id)}?cursor=${encodeURIComponent(replyCursor)}`);
        list.append(...(data.items || []).map(reply => { const row = showComment(reply); row.classList.add('reply'); return row; }));
        replyCursor = data.cursor || '';
        const shown = list.childElementCount;
        if (data.has_more && replyCursor) { toggle.textContent = `更多回复（已显示 ${shown} 条）`; toggle.disabled = false; }
        else toggle.remove();
      } catch (_) {
        toggle.textContent = '回复加载失败，点击重试';
        toggle.disabled = false;
      } finally { loading = false; }
    }
    toggle.addEventListener('click', more);
    wrap.append(list, toggle);
    return wrap;
  }
  function commentRow(item) {
    const row = showComment(item);
    if (feed.source === 'app' && feed.kind === 'episode' && Number(item.replies) > 0) row.querySelector('.comment-body').append(replyBlock(item));
    return row;
  }
  async function loadComments(reset) {
    if (!feed.seriesId || feed.loading || (!reset && feed.loaded && !feed.hasMore)) return;
    const run = reset ? ++feed.request : feed.request;
    if (reset) {
      Object.assign(feed, { cursor: '', hasMore: false, loaded: false, source: '' });
      feed.seen = new Set();
      comments.replaceChildren(statusLine('正在加载评论…'));
      comments.scrollTop = 0;
      setCommentsHeader(feed.kind === 'series' ? '本剧评论' : '本集评论', '', '');
    }
    feed.loading = true;
    comments.querySelector('.comments-status')?.remove();
    comments.append(statusLine(reset ? '正在加载评论…' : '正在加载更多…'));
    try {
      const query = `kind=${feed.kind}${feed.cursor ? `&cursor=${encodeURIComponent(feed.cursor)}` : ''}`;
      const data = await api(`/api/comments/${encodeURIComponent(feed.seriesId)}/${encodeURIComponent(feed.vid)}?${query}`);
      if (run !== feed.request) return;
      comments.querySelector('.comments-status')?.remove();
      if (reset) {
        feed.source = data.source || 'website';
        const title = data.source === 'website' && data.scope === 'series' && feed.kind === 'episode' ? '本剧热评' : (feed.kind === 'series' ? '本剧评论' : '本集评论');
        setCommentsHeader(title, Number(data.total) > 0 ? `共 ${compact(data.total)} 条` : '', data.notice || '');
      }
      const rows = (Array.isArray(data.items) ? data.items : []).filter(item => item?.id && !feed.seen.has(item.id) && feed.seen.add(item.id));
      comments.append(...rows.map(commentRow));
      feed.loaded = true;
      feed.cursor = data.cursor || '';
      feed.hasMore = !!data.has_more && !!feed.cursor;
      if (!comments.querySelector('.comment')) comments.append(statusLine(feed.kind === 'series' ? '这部剧还没有评论。' : '本集还没有评论。'));
      else if (!feed.hasMore) comments.append(statusLine(data.source === 'website' ? '官网只公开这些评论' : '没有更多评论了'));
    } catch (error) {
      if (run !== feed.request) return;
      comments.querySelector('.comments-status')?.remove();
      comments.append(statusLine(`评论加载失败：${error.message}`, true));
    } finally {
      if (run === feed.request) feed.loading = false;
      if (run === feed.request) requestAnimationFrame(fillIfShort);
    }
  }
  // Keep pulling pages while the list is too short to scroll, and when the reader nears the end.
  function fillIfShort() {
    if (drawerOpen() && feed.hasMore && !feed.loading && comments.scrollHeight - comments.scrollTop - comments.clientHeight < 400) loadComments(false);
  }
  comments.addEventListener('scroll', fillIfShort, { passive: true });
  tabs.addEventListener('click', event => {
    const tab = event.target.closest('[data-kind]');
    if (!tab || tab.dataset.kind === feed.kind) return;
    feed.kind = tab.dataset.kind;
    tabs.querySelectorAll('[data-kind]').forEach(node => { node.classList.toggle('active', node === tab); node.setAttribute('aria-selected', String(node === tab)); });
    loadComments(true);
  });
  // Comments are fetched when the drawer is opened, not for every episode in the background.
  $('#comments-toggle').addEventListener('click', () => { if (drawerOpen() && !feed.loaded && !feed.loading) loadComments(true); });

  window.playerExtras = {
    async onEpisode(episode) {
      const current = ++request;
      items = [];
      cursor = 0;
      layer.replaceChildren();
      lanes.fill(0);
      if (!state.series) return;
      const seriesId = state.series.series_id;
      const vid = episode.vid;
      // Series comments are the same for every episode; only reload them when the series changes.
      const sameSeries = feed.seriesId === seriesId;
      feed.seriesId = seriesId;
      feed.vid = vid;
      if (feed.kind === 'episode' || !sameSeries) {
        feed.request++;
        Object.assign(feed, { loaded: false, loading: false, hasMore: false, cursor: '' });
        comments.replaceChildren(statusLine('打开评论时加载'));
        setCommentsHeader(feed.kind === 'series' ? '本剧评论' : '本集评论', '', '');
        if (drawerOpen()) loadComments(true);
      }
      api(`/api/danmaku/${encodeURIComponent(seriesId)}/${encodeURIComponent(vid)}`).then(danmaku => {
        if (current !== request || !state.series || state.series.series_id !== seriesId) return;
        items = (Array.isArray(danmaku.items) ? danmaku.items : []).filter(item => item && item.text && Number.isFinite(Number(item.time)))
          .map(item => ({ ...item, time: Number(item.time) })).sort((a, b) => a.time - b.time);
        cursor = items.findIndex(item => item.time >= video.currentTime);
        if (cursor < 0) cursor = items.length;
        button.dataset.count = items.length ? String(items.length) : '';
      }).catch(() => { if (current === request) button.dataset.count = ''; });
    }
  };
  syncButton();
})();

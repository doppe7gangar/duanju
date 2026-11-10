(() => {
  const section = $('#actors');
  const list = $('#actor-list');
  const works = $('#actor-works');
  const status = $('#actor-status');
  const more = $('#actor-more');
  const back = $('#actor-back');
  let page = 0;
  let hasMore = false;
  let loading = false;
  let autoLoadFailed = false;
  let actors = [];
  let currentActor = null;
  let filter = '';
  // The 剧星榜 stops at 50; after it the list continues with actors gathered from popular dramas.
  let source = 'rank';
  let searched = [];
  let searchTimer = 0;
  let searchToken = 0;

  function actorCard(actor) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'actor-card';
    const avatar = document.createElement('img');
    avatar.className = 'actor-avatar';
    avatar.alt = '';
    if (/^https:\/\//.test(actor.avatar || '')) avatar.src = actor.avatar;
    const name = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = actor.name || '未命名演员';
    const small = document.createElement('small');
    small.textContent = actor.sub_titles?.[0] || actor.score || (actor.dramas > 1 ? `${actor.dramas} 部热门剧` : '查看参演作品');
    name.append(strong, small);
    const rank = document.createElement('span');
    rank.className = 'actor-rank';
    rank.textContent = actor.rank ? `#${actor.rank}` : '';
    button.append(avatar, name, rank);
    button.addEventListener('click', () => showWorks(actor));
    return button;
  }
  function renderActors() {
    const visible = actors.filter(actor => !filter || actor.name?.includes(filter));
    const ids = new Set(visible.map(actor => actor.actor_id));
    if (filter) visible.push(...searched.filter(actor => !ids.has(actor.actor_id)));
    list.replaceChildren(...visible.map(actorCard));
    status.textContent = visible.length ? '' : filter ? `正在查找「${filter}」…` : '';
    status.hidden = !!visible.length || !filter;
  }
  function searchActors(name) {
    clearTimeout(searchTimer);
    searched = [];
    const token = ++searchToken;
    if (name.length < 2) return;
    searchTimer = setTimeout(async () => {
      try {
        const data = await api(`/api/actor-discover?q=${encodeURIComponent(name)}`);
        if (token !== searchToken) return;
        searched = data.actors || [];
      } catch (_) { if (token !== searchToken) return; }
      if (!currentActor) renderActors();
      if (!list.children.length) { status.textContent = `没有找到「${name}」。`; status.hidden = false; }
    }, 400);
  }
  async function loadActors(append = false) {
    if (append && (loading || !hasMore)) return;
    if (!append) { page = 0; actors = []; source = 'rank'; autoLoadFailed = false; }
    loading = true;
    status.textContent = '正在加载演员…';
    status.hidden = false;
    more.hidden = true;
    try {
      const nextPage = page + 1;
      const data = await api(source === 'rank' ? `/api/actors/ranking?page=${nextPage}&limit=20` : `/api/actor-discover?page=${nextPage}`);
      const known = new Set(actors.map(actor => actor.actor_id));
      actors.push(...(data.actors || []).filter(actor => actor.actor_id && !known.has(actor.actor_id)));
      page = nextPage;
      hasMore = !!data.has_more;
      if (!hasMore && source === 'rank') { source = 'discover'; page = 0; hasMore = true; }
      // An actor opened from a drama's 详情 may already be showing; don't cover it with the ranking.
      if (!currentActor) renderActors();
      more.hidden = !hasMore || !!currentActor;
      more.textContent = '下滑自动加载更多演员';
    } catch (error) {
      autoLoadFailed = true;
      if (!currentActor) {
        status.textContent = `演员榜加载失败：${error.message}`;
        status.hidden = false;
      }
      more.hidden = !append || !!currentActor;
      more.textContent = '加载失败，点击重试';
    } finally {
      loading = false;
      setTimeout(loadMoreIfVisible, 0);
    }
  }
  function loadMoreIfVisible() {
    if (section.hidden || currentActor || more.hidden || loading || autoLoadFailed) return;
    const rect = more.getBoundingClientRect();
    if (rect.top < window.innerHeight + 500 && rect.bottom > -500) loadActors(true);
  }
  async function showWorks(actor) {
    currentActor = actor;
    list.hidden = true;
    works.hidden = false;
    more.hidden = true;
    back.hidden = false;
    $('#actors-title').textContent = actor.name;
    status.textContent = '正在加载参演作品…';
    status.hidden = false;
    works.replaceChildren();
    // Works come 50 at a time; keep reading until the actor's full filmography is shown.
    let offset = 0;
    try {
      for (let round = 0; round < 8; round++) {
        const data = await api(`/api/actors/${encodeURIComponent(actor.actor_id)}/works?count=50&offset=${offset}`);
        if (currentActor !== actor) return;
        const items = data.works || [];
        works.append(...items.map(item => makeCard({ ...item, total: item.episode_count })));
        offset += items.length;
        if (!data.has_more || !items.length) break;
      }
      status.textContent = works.children.length ? '' : '暂无参演作品。';
      status.hidden = !!works.children.length;
    } catch (error) {
      if (currentActor !== actor) return;
      status.textContent = works.children.length ? '' : `作品加载失败：${error.message}`;
      status.hidden = !!works.children.length;
    }
  }
  function showRanking() {
    currentActor = null;
    works.hidden = true;
    list.hidden = false;
    back.hidden = true;
    $('#actors-title').textContent = '按演员找剧';
    more.hidden = !hasMore;
    renderActors();
  }
  back.addEventListener('click', showRanking);
  more.addEventListener('click', () => { autoLoadFailed = false; loadActors(true); });
  new IntersectionObserver(loadMoreIfVisible, { rootMargin: '500px' }).observe(more);
  window.addEventListener('scroll', () => requestAnimationFrame(loadMoreIfVisible), { passive: true });
  window.actorApp = {
    open() { section.hidden = false; $('#search').value = ''; filter = ''; searchActors(''); showRanking(); loadActors(); },
    close() { section.hidden = true; },
    filter(value) { filter = value; searchActors(value); if (currentActor) showRanking(); renderActors(); },
    showActor(actor) { if (actor?.actor_id) showWorks(actor); }
  };
})();

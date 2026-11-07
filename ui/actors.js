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
    small.textContent = actor.sub_titles?.[0] || actor.score || '查看参演作品';
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
    list.replaceChildren(...visible.map(actorCard));
    status.textContent = visible.length ? '' : '当前榜单没有匹配的演员，可加载更多后再筛选。';
    status.hidden = !!visible.length;
  }
  async function loadActors(append = false) {
    if (append && (loading || !hasMore)) return;
    if (!append) { page = 0; actors = []; autoLoadFailed = false; }
    loading = true;
    status.textContent = '正在加载演员榜…';
    status.hidden = false;
    more.hidden = true;
    try {
      const nextPage = page + 1;
      const data = await api(`/api/actors/ranking?page=${nextPage}&limit=20`);
      actors.push(...(data.actors || []));
      page = nextPage;
      hasMore = !!data.has_more;
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
    try {
      const data = await api(`/api/actors/${encodeURIComponent(actor.actor_id)}/works?count=60&offset=0`);
      if (currentActor !== actor) return;
      const cards = (data.works || []).map(item => makeCard({ ...item, total: item.episode_count }));
      works.replaceChildren(...cards);
      status.textContent = cards.length ? '' : '暂无参演作品。';
      status.hidden = !!cards.length;
    } catch (error) {
      status.textContent = `作品加载失败：${error.message}`;
      status.hidden = false;
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
    open() { section.hidden = false; $('#search').value = ''; filter = ''; showRanking(); loadActors(); },
    close() { section.hidden = true; },
    filter(value) { filter = value; if (currentActor) showRanking(); renderActors(); },
    showActor(actor) { if (actor?.actor_id) showWorks(actor); }
  };
})();

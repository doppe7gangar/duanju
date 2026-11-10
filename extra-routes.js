const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { fetchPublicDetails } = require('./vendor/comments/public-details');
const { fetchComments, fetchReplies } = require('./app-comments');
const { readRouterData } = require('./vendor/hongguo-open-player/src/server/native/catalog');

const OFFICIAL_ORIGIN = 'https://hongguoduanju.com';
const officialCache = new Map();
function safeImage(value) { return typeof value === 'string' && /^https:\/\//.test(value) ? value : ''; }
function officialItem(item) {
  const seriesId = String(item?.series_id || '');
  const title = String(item?.series_name || item?.series_title || '').trim();
  if (!/^\d{1,30}$/.test(seriesId) || !title) return null;
  return {
    series_id: seriesId, series_title: title.slice(0, 160), cover: safeImage(item.series_cover || item.cover),
    backdrop: safeImage(item.background_cover_pc), description: String(item.series_intro || '').trim().slice(0, 800),
    episode_count: Number(item.episode_cnt) || 0,
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 4).map(String) : Array.isArray(item.category_list) ? item.category_list.slice(0, 4).map(tag => String(tag.name || '')) : [],
    source: 'hongguo-website'
  };
}
async function officialPage(pagePath) {
  const cached = officialCache.get(pagePath);
  if (cached && cached.expires > Date.now()) return cached.data;
  const response = await fetch(`${OFFICIAL_ORIGIN}${pagePath}`, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GuojuDesktop/0.3)' } });
  if (!response.ok || new URL(response.url).origin !== OFFICIAL_ORIGIN) throw new Error(`官网目录暂不可用 (${response.status})`);
  const html = await response.text();
  if (html.length > 3000000) throw new Error('官网目录响应过大');
  const data = readRouterData(html);
  officialCache.set(pagePath, { data, expires: Date.now() + 300000 });
  if (officialCache.size > 150) officialCache.delete(officialCache.keys().next().value);
  return data;
}

let reader;
async function bookClient() {
  if (!reader) {
    const source = pathToFileURL(path.join(__dirname, 'vendor/fanqie/server/core.mjs')).href;
    const { WebsiteClient } = await import(source);
    reader = new WebsiteClient();
  }
  return reader;
}
function failure(res, error) {
  res.status(Number.isInteger(error?.code) && error.code >= 400 && error.code < 600 ? error.code : 502)
    .json({ error: error?.message || '内容暂时不可用' });
}

module.exports = app => {
  // Register an anonymous playback device shortly after start, so the first episode opened does not
  // wait for registration (each device serves one request; see playback-device.js).
  setTimeout(() => {
    try {
      const { getPlaybackDevice } = require('./vendor/hongguo-open-player/src/server/native/playback-device');
      const { requestJson } = require('./vendor/hongguo-open-player/src/server/native/app-source');
      getPlaybackDevice(requestJson).catch(() => { /* registered on demand instead */ });
    } catch (_) { /* optional warm-up */ }
  }, 1500).unref?.();

  // ---- More actors than the 剧星榜 (which is capped upstream at the top 50) ----
  // Actors are gathered from the cast lists of popular live-action dramas: first the app's 真人热播榜,
  // then the website's live-action listing page by page, so the list keeps growing as the user scrolls.
  const dramaService = require('./vendor/hongguo-open-player/src/server/services/dramaService');
  const ACTOR_PAGE = 40;
  const actorPool = { actors: [], byId: new Map(), queue: [], seen: new Set(), webPage: 0, rankPage: 0, exhausted: false, expires: 0, job: null };
  function resetActorPool() {
    Object.assign(actorPool, { actors: [], byId: new Map(), queue: [], seen: new Set(), webPage: 0, rankPage: 0, exhausted: false, expires: Date.now() + 30 * 60 * 1000 });
  }
  function addCast(detail) {
    for (const person of Array.isArray(detail?.celebrities) ? detail.celebrities : []) {
      if (!/^\d{1,30}$/.test(person.actor_id || '') || !person.name) continue;
      const known = actorPool.byId.get(person.actor_id);
      if (known) { known.dramas++; continue; }
      const actor = { actor_id: person.actor_id, name: String(person.name).slice(0, 40), avatar: safeImage(person.avatar), dramas: 1 };
      actorPool.byId.set(actor.actor_id, actor);
      actorPool.actors.push(actor);
    }
  }
  async function refillDramaQueue() {
    // Three pages of the live-action hot chart first (the most-watched casts), then the website listing.
    if (actorPool.rankPage < 3) {
      actorPool.rankPage++;
      const data = await dramaService.catalog({ category: 'hot-real-drama', page: actorPool.rankPage }).catch(() => null);
      for (const item of data?.results || []) if (item.series_id && !actorPool.seen.has(item.series_id)) { actorPool.seen.add(item.series_id); actorPool.queue.push(item.series_id); }
      return;
    }
    if (actorPool.webPage >= 60) { actorPool.exhausted = true; return; }
    actorPool.webPage++;
    const data = await officialCatalogPage('real-drama', '', actorPool.webPage).catch(() => null);
    if (!data?.results?.length && actorPool.webPage > 33) { actorPool.exhausted = true; return; }
    for (const item of data?.results || []) if (!actorPool.seen.has(item.series_id)) { actorPool.seen.add(item.series_id); actorPool.queue.push(item.series_id); }
  }
  async function growActorPool(target) {
    let idle = 0;
    while (actorPool.actors.length < target && !actorPool.exhausted && idle < 6) {
      if (!actorPool.queue.length) { await refillDramaQueue(); idle++; continue; }
      idle = 0;
      const batch = actorPool.queue.splice(0, 8);
      const details = await Promise.all(batch.map(id => dramaService.getSeriesDetail(id).catch(() => null)));
      details.forEach(addCast);
    }
  }
  function ensureActorPool(target) {
    if (actorPool.expires < Date.now() && !actorPool.job) resetActorPool();
    if (actorPool.actors.length >= target || actorPool.exhausted) return Promise.resolve();
    if (!actorPool.job) actorPool.job = growActorPool(target).finally(() => { actorPool.job = null; });
    return actorPool.job.then(() => (actorPool.actors.length < target && !actorPool.exhausted ? ensureActorPool(target) : undefined));
  }
  app.get('/api/actor-discover', async (req, res) => {
    try {
      const query = String(req.query.q || '').trim().slice(0, 20);
      if (query) {
        // Search dramas by the name, then keep the cast members whose name matches.
        const found = await dramaService.search(query, 1);
        const ids = (found?.results || []).map(item => item.series_id).filter(Boolean).slice(0, 8);
        const details = await Promise.all(ids.map(id => dramaService.getSeriesDetail(id).catch(() => null)));
        const matches = new Map();
        for (const detail of details) for (const person of detail?.celebrities || []) {
          if (person.actor_id && person.name?.includes(query) && !matches.has(person.actor_id)) {
            matches.set(person.actor_id, { actor_id: String(person.actor_id), name: String(person.name).slice(0, 40), avatar: safeImage(person.avatar) });
          }
        }
        return res.json({ actors: [...matches.values()], has_more: false });
      }
      const page = Math.max(1, Math.min(100, Number.parseInt(req.query.page, 10) || 1));
      await ensureActorPool(page * ACTOR_PAGE);
      const actors = actorPool.actors.slice((page - 1) * ACTOR_PAGE, page * ACTOR_PAGE);
      res.json({ actors, page, has_more: actors.length === ACTOR_PAGE && !(actorPool.exhausted && actorPool.actors.length <= page * ACTOR_PAGE) });
    } catch (error) { failure(res, error); }
  });
  app.get('/api/library/home', async (req, res) => {
    try {
      const client = await bookClient();
      const { initialState } = await import(pathToFileURL(path.join(__dirname, 'vendor/fanqie/server/core.mjs')).href);
      const home = initialState(await client.request('/')).home;
      const labels = { editorList: '编辑推荐', weekList: '本周热门', boyList: '男生精选', girlList: '女生精选', fantasyList: '奇幻世界', oldSayingList: '古风故事', newbookList: '新书推荐' };
      const sections = Object.entries(labels).flatMap(([key, title]) => {
        const results = (Array.isArray(home?.[key]) ? home[key] : []).filter(book => /^\d{1,24}$/.test(String(book.bookId || '')) && book.bookName).map(book => ({
          book_id: String(book.bookId), book_name: String(book.bookName), author: String(book.author || ''),
          cover: safeImage(book.thumbUri), abstract: String(book.abstract || ''), category: String(book.category || '')
        }));
        return results.length ? [{ title, results }] : [];
      });
      if (!sections.length) throw new Error('官网书单暂时不可用');
      res.json({ sections, source: 'fanqienovel.com', scope: 'public_website_recommendations' });
    } catch (error) { failure(res, error); }
  });
  app.get('/api/official/home', async (req, res) => {
    try {
      const page = (await officialPage('/')).loaderData?.page;
      if (!page?.isSuccess || !Array.isArray(page.bannerList)) throw new Error('官网首页数据暂不可用');
      const banners = page.bannerList.map(officialItem).filter(Boolean);
      const sections = (page.homeSections || []).map(section => ({
        title: String(section.tab_name || '官网精选').slice(0, 50),
        results: (section.video_list || []).map(officialItem).filter(Boolean)
      }));
      res.json({ banners, sections });
    } catch (error) { failure(res, error); }
  });
  async function officialCatalogPage(category, genre, page) {
    // The website filters by topic with a path segment, e.g. /category/real-drama/romance?page=2
    const route = `/category/${category}${genre ? `/${genre}` : ''}?page=${page}`;
    const data = (await officialPage(route)).loaderData?.['category_$'];
    if (!data?.isSuccess || !Array.isArray(data.recommendList) || Number(data.pagination?.pageNum) !== page) throw new Error('官网分类数据暂不可用');
    return {
      results: data.recommendList.map(officialItem).filter(Boolean),
      totalPages: Number(data.pagination?.totalPages || 0),
      total: Number(data.pagination?.total || 0),
      genres: (data.selectorList?.[0]?.items || [])
        .filter(item => /^[a-z][a-z-]{0,39}$/.test(String(item?.selector_item_id || '')) && item.show_name)
        .map(item => ({ slug: String(item.selector_item_id), label: String(item.show_name).slice(0, 20) }))
    };
  }
  // Every website listing stops at 800 titles (33 pages), but each topic has its own 800. "Deep"
  // paging chains the plain listing with every topic's listing into one long sequence of pages, so a
  // category reaches its whole library (≈10,000 real-person dramas instead of 800). Titles repeat
  // across topics; the clients already drop ones they have shown.
  const deepPlans = new Map();
  const deepPlanJobs = new Map();
  function deepPlan(category) {
    const cached = deepPlans.get(category);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.plan);
    if (!deepPlanJobs.has(category)) {
      deepPlanJobs.set(category, buildDeepPlan(category).finally(() => deepPlanJobs.delete(category)));
    }
    return deepPlanJobs.get(category);
  }
  async function buildDeepPlan(category) {
    const first = await officialCatalogPage(category, '', 1);
    const counts = [];
    const queue = [...first.genres];
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const genre = queue.shift();
        try { counts.push({ genre: genre.slug, pages: (await officialCatalogPage(category, genre.slug, 1)).totalPages }); } catch (_) { /* skip this topic */ }
      }
    }));
    const order = new Map(first.genres.map((genre, index) => [genre.slug, index]));
    const plan = [{ genre: '', pages: first.totalPages }, ...counts.filter(item => item.pages > 0).sort((a, b) => order.get(a.genre) - order.get(b.genre))];
    deepPlans.set(category, { plan, expires: Date.now() + 30 * 60 * 1000 });
    return plan;
  }

  app.get('/api/official/catalog', async (req, res) => {
    try {
      const category = String(req.query.category || '');
      const genre = String(req.query.genre || '');
      const page = Number(req.query.page || 1);
      const deep = req.query.deep === '1' && !genre;
      if (!['real-drama', 'comic-drama', 'ai-drama'].includes(category) || !Number.isInteger(page) || page < 1 || page > (deep ? 2000 : 50)) return res.status(400).json({ error: '分类或页码无效' });
      if (genre && !/^[a-z][a-z-]{0,39}$/.test(genre)) return res.status(400).json({ error: '题材无效' });
      // Pages inside the plain listing need no plan: serve them at once and count the topics in the
      // background (that takes several seconds on the slow website), so only deeper pages ever wait.
      const cachedPlan = deepPlans.get(category);
      if (deep && !(cachedPlan && cachedPlan.expires > Date.now())) deepPlan(category).catch(() => {});
      if (deep && page > 1 && (cachedPlan || page > 34)) {
        const plan = await deepPlan(category);
        const totalPages = plan.reduce((sum, item) => sum + item.pages, 0);
        let rest = page;
        const segment = plan.find(item => (rest <= item.pages ? true : (rest -= item.pages, false)));
        if (!segment) return res.json({ results: [], page, hasMore: false, totalPages, genres: [], source: 'hongguo-website' });
        const data = await officialCatalogPage(category, segment.genre, rest);
        return res.json({ results: data.results, page, hasMore: page < totalPages, totalPages, genres: [], source: 'hongguo-website' });
      }
      const data = await officialCatalogPage(category, genre, page);
      const totalPages = deep ? (deepPlans.get(category)?.plan || []).reduce((sum, item) => sum + item.pages, 0) || data.totalPages : data.totalPages;
      res.json({ results: data.results, page, hasMore: deep ? true : page < data.totalPages, totalPages, total: data.total, genres: data.genres, source: 'hongguo-website' });
    } catch (error) { failure(res, error); }
  });
  app.get('/api/library/search', async (req, res) => {
    try {
      const keyword = String(req.query.q || '').trim();
      if (!keyword || keyword.length > 80) return res.status(400).json({ error: '请输入书名或关键词' });
      const offset = Number(req.query.offset || 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > 10000) return res.status(400).json({ error: '页码无效' });
      res.json(await (await bookClient()).search(keyword, 3, offset));
    } catch (error) { failure(res, error); }
  });
  app.get('/api/library/book/:id', async (req, res) => {
    try {
      const client = await bookClient();
      const book = await client.detail(req.params.id);
      const directory = await client.directory(req.params.id);
      res.json({ book, chapters: directory.chapters, total: directory.total });
    } catch (error) { failure(res, error); }
  });
  app.get('/api/library/chapter/:id', async (req, res) => {
    try { res.json(await (await bookClient()).chapter(req.params.id)); }
    catch (error) { failure(res, error); }
  });
  app.get('/api/comments/:seriesId/:vid', async (req, res) => {
    try {
      const { seriesId, vid } = req.params;
      if (!/^\d{6,30}$/.test(seriesId) || !/^\d{6,30}$/.test(vid)) return res.status(400).json({ error: '评论请求编号无效' });
      const kind = req.query.kind === 'series' ? 'series' : 'episode';
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
      // Full, paged comments from the app comment API (every episode, with replies).
      const fromApp = await fetchComments({ seriesId, vid, kind, cursor });
      if (fromApp.success) return res.json(fromApp);
      if (cursor) return res.json({ success: false, error: fromApp.error });
      // Fallback: the short public preview on the website.
      const toItems = reviews => (reviews?.items || []).slice(0, 30).map(review => ({
        // The public preview has no comment IDs; hash stable fields (not the changing like count).
        id: createHash('sha256').update(JSON.stringify([seriesId, review.author, review.created_at, review.content])).digest('hex'),
        content: review.content, author: review.author || '', avatar: String(review.avatar || '').replace(/^http:\/\//i, 'https://'),
        likes: review.likes, created_at: review.created_at, rating: review.rating
      }));
      if (kind === 'series') {
        const series = await fetchPublicDetails(seriesId);
        if (!series.success) return res.json({ success: false, error: series.error || '公开评论暂时不可用' });
        return res.json({ success: true, scope: 'series', source: 'website', items: toItems(series.reviews), total: series.reviews?.total ?? null,
          notice: '评论接口暂时不可用，以下为官网公开的部分剧评。' });
      }
      const episode = await fetchPublicDetails(seriesId, vid);
      if (episode.success) {
        return res.json({ success: true, scope: 'episode', items: toItems(episode.episode_reviews), total: episode.episode_reviews?.total ?? null,
          notice: '官网仅公开本集部分评论，更多评论请到红果短剧 App 查看。' });
      }
      // The website only opens the first few episodes of each series (later ones redirect with
      // pc_locked_episode), so for those show the series' top reviews instead of an error.
      if (!/HTTP 30\d/.test(String(episode.error || ''))) return res.json({ success: false, error: episode.error || '公开评论暂时不可用' });
      const series = await fetchPublicDetails(seriesId);
      if (!series.success) return res.json({ success: false, error: series.error || '公开评论暂时不可用' });
      res.json({ success: true, scope: 'series', items: toItems(series.reviews), total: series.reviews?.total ?? null,
        notice: '官网只公开每部剧前几集的分集评论，这一集暂无公开评论，以下为本剧热评。' });
    } catch (error) { failure(res, error); }
  });
  app.get('/api/comments/:seriesId/:vid/replies/:commentId', async (req, res) => {
    try {
      const { seriesId, vid, commentId } = req.params;
      res.json(await fetchReplies({ seriesId, vid, commentId, cursor: typeof req.query.cursor === 'string' ? req.query.cursor : '' }));
    } catch (error) { failure(res, error); }
  });
};

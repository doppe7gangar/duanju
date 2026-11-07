const path = require('node:path');
const root = path.join(__dirname, '..');
process.env.HONGGUO_CLIENT_DIR = path.join(root, 'ui');
process.env.HONGGUO_EXTENSION_MODULE = path.join(root, 'extra-routes.js');
process.env.HONGGUO_DATA_DIR = path.join(root, 'smoke-data');
process.env.HONGGUO_LOG_DIR = path.join(root, 'smoke-logs');

async function main() {
  const { server, port } = await require('../vendor/hongguo-open-player/src/server/index').startServer(0);
  const origin = `http://127.0.0.1:${port}`;
  try {
    const home = await fetch(origin);
    if (!home.ok) throw new Error(`home ${home.status}`);
    const cookie = home.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    async function get(url) {
      const response = await fetch(origin + url, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(60000) });
      const data = await response.json();
      if (!response.ok || data.error || data.success === false) throw new Error(`${url}: ${data.error || response.status}`);
      return data;
    }
    const catalog = await get('/api/catalog?category=hot-drama&page=1');
    const officialHome = await get('/api/official/home');
    const officialCatalog = await get('/api/official/catalog?category=real-drama&page=2');
    if (!officialHome.banners?.length || officialCatalog.results?.length < 10) throw new Error('official catalog is empty');
    const officialSeries = await get(`/api/series/${officialCatalog.results[5].series_id}`);
    if (!officialSeries.episodes?.length) throw new Error('official website entry has no episodes');
    const types = await get('/api/catalog?category=real-drama&page=1');
    if (!types.genres?.length) throw new Error('genre list is empty');
    const genre = types.genres[0];
    const filtered = await get(`/api/catalog?category=real-drama&genre=${encodeURIComponent(genre.slug)}&page=1`);
    const ranking = await get('/api/actors/ranking?page=1&limit=5');
    if (!ranking.actors?.length) throw new Error('actor ranking is empty');
    const works = await get(`/api/actors/${encodeURIComponent(ranking.actors[0].actor_id)}/works?count=5&offset=0`);
    if (!works.works?.length) throw new Error('actor works are empty');
    const series = await get(`/api/series/${catalog.results[0].series_id}`);
    const stream = await fetch(`${origin}/api/stream/${series.episodes[0].vid}?quality=720p`, {
      headers: { Cookie: cookie, Range: 'bytes=0-32767' }, signal: AbortSignal.timeout(60000)
    });
    const bytes = (await stream.arrayBuffer()).byteLength;
    if (stream.status !== 206 || bytes !== 32768) throw new Error(`stream ${stream.status}, ${bytes} bytes`);
    const books = await get('/api/library/search?q=%E4%B8%89%E4%BD%93');
    const book = await get(`/api/library/book/${books.results[0].book_id}`);
    const chapter = await get(`/api/library/chapter/${book.chapters[5].item_id}`);
    const comments = await get(`/api/comments/${series.series_id}/${series.episodes[0].vid}`);
    const danmaku = await get(`/api/danmaku/${series.series_id}/${series.episodes[0].vid}`);
    console.log(JSON.stringify({ dramas: catalog.results.length, officialBanners: officialHome.banners.length,
      officialPageDramas: officialCatalog.results.length, officialTotal: officialCatalog.total,
      officialPlayableEpisodes: officialSeries.episodes.length,
      genres: types.genres.length, genre: genre.label,
      genreDramas: filtered.results.length, actors: ranking.actors.length, actorWorks: works.works.length,
      episodes: series.episodes.length, streamBytes: bytes,
      books: books.results.length, chapters: book.total, chapterChars: chapter.content.length,
      comments: comments.items.length, danmaku: danmaku.items.length }));
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

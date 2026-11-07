const path = require('node:path');
const root = path.join(__dirname, '..');
process.env.HONGGUO_CLIENT_DIR = path.join(root, 'ui');
process.env.HONGGUO_EXTENSION_MODULE = path.join(root, 'extra-routes.js');
(async () => {
  const { server, port } = await require('../vendor/hongguo-open-player/src/server/index').startServer(0);
  try {
    const origin = `http://127.0.0.1:${port}`;
    const response = await fetch(origin);
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const get = async url => {
      const response = await fetch(origin + url, { headers: { Cookie: cookie } });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || response.status);
      return data;
    };
    const home = await get('/api/library/home');
    const books = home.sections.flatMap(section => section.results);
    const book = await get(`/api/library/book/${books[0].book_id}`);
    const chapter = await get(`/api/library/chapter/${book.chapters[0].item_id}`);
    if (!chapter.content?.length) throw new Error('Empty chapter');
    console.log(JSON.stringify({ source: home.source, sections: home.sections.map(section => [section.title, section.results.length]), uniqueBooks: new Set(books.map(book => book.book_id)).size, sampledBook: book.book.book_name, chapters: book.total, chapterCharacters: chapter.content.length }));
  } finally { server.closeAllConnections(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

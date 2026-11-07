(() => {
  const library = $('#library');
  const results = $('#book-results');
  const reader = $('#reader');
  const speech = window.speechSynthesis;
  const bookState = { mode: 'novel', book: null, chapters: [], chapterIndex: 0, content: '', speechParts: [], speechIndex: 0, speechRun: 0, request: 0, keyword: '', offset: 0, hasMore: false, loading: false, autoLoadFailed: false, discovery: {} };
  const discoveryTopics = ['都市', '言情', '悬疑'];
  $('#speech-speed').value = localStorage.getItem('guoju:speech-speed') || '1';

  /* ---------- 我的书架 (saved books, stored on this computer) ---------- */
  const SHELF_KEY = 'guoju:bookshelf';
  const SHELF_ADD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  const SHELF_DONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  function bookCover(book) {
    return [book?.thumb_url, book?.audio_thumb_uri, book?.thumb_uri, book?.cover].find(url => typeof url === 'string' && /^https:\/\//.test(url)) || '';
  }
  function readShelf() {
    try { const value = JSON.parse(localStorage.getItem(SHELF_KEY)); return Array.isArray(value) ? value.filter(entry => entry && /^\d{1,24}$/.test(String(entry.book_id))) : []; } catch (_) { return []; }
  }
  function onShelf(bookId) { return readShelf().some(entry => String(entry.book_id) === String(bookId)); }
  function toggleShelf(book) {
    const id = String(book?.book_id || '');
    if (!/^\d{1,24}$/.test(id)) return;
    const shelf = readShelf();
    const saved = shelf.some(entry => String(entry.book_id) === id);
    const next = saved ? shelf.filter(entry => String(entry.book_id) !== id) : [{
      book_id: id, book_name: String(book.book_name || book.title || '未命名作品'), author: String(book.author || ''),
      cover: bookCover(book), saved_at: Date.now()
    }, ...shelf].slice(0, 300);
    try { localStorage.setItem(SHELF_KEY, JSON.stringify(next)); } catch (_) {}
    window.showToast?.(saved ? '已从我的书架移除' : '已加入我的书架');
    window.dispatchEvent(new CustomEvent('guoju:bookshelf', { detail: { bookId: id } }));
  }
  function paintShelfToggle(node, saved) {
    node.classList.toggle('saved', saved);
    node.innerHTML = saved ? SHELF_DONE : SHELF_ADD;
    const label = saved ? '已在我的书架（点击移除）' : '加入我的书架';
    node.title = label;
    node.setAttribute('aria-label', label);
    node.setAttribute('aria-pressed', String(saved));
  }
  // A round ＋ / ✓ on a book cover (inside a card button, so it is a span acting as a button).
  function makeShelfToggle(book) {
    const node = document.createElement('span');
    node.className = 'list-toggle shelf-toggle';
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
    node.dataset.shelfId = String(book.book_id);
    paintShelfToggle(node, onShelf(book.book_id));
    const act = event => { event.stopPropagation(); event.preventDefault(); toggleShelf(book); };
    node.addEventListener('click', act);
    node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') act(event); });
    return node;
  }
  function paintReaderShelf() {
    const button = $('#shelf-toggle');
    const saved = !!bookState.book && onShelf(bookState.book.book_id);
    button.classList.toggle('saved', saved);
    const label = saved ? '已在我的书架（点击移除）' : '加入我的书架';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(saved));
  }
  window.addEventListener('guoju:bookshelf', () => {
    document.querySelectorAll('.shelf-toggle').forEach(node => paintShelfToggle(node, onShelf(node.dataset.shelfId)));
    paintReaderShelf();
  });
  window.bookshelf = { read: readShelf, has: onShelf, toggle: toggleShelf, makeToggle: makeShelfToggle };

  function stopSpeech() {
    bookState.speechRun++;
    speech?.cancel();
    $('#speak').textContent = '▶ 开始朗读';
    $('#speech-status').textContent = '';
  }
  function speechParts(content) {
    const pieces = content.split(/(?<=[。！？!?\n])/).filter(Boolean);
    const chunks = [];
    let current = '';
    for (const piece of pieces) {
      if ((current + piece).length > 160 && current) { chunks.push(current); current = ''; }
      if (piece.length > 160) {
        for (let i = 0; i < piece.length; i += 160) chunks.push(piece.slice(i, i + 160));
      } else current += piece;
    }
    if (current) chunks.push(current);
    return chunks;
  }
  function speakNext(run) {
    if (run !== bookState.speechRun || !speech) return;
    if (bookState.speechIndex >= bookState.speechParts.length) {
      $('#speech-status').textContent = '本章朗读完毕';
      $('#speak').textContent = '▶ 开始朗读';
      if (bookState.mode === 'audio' && bookState.chapterIndex + 1 < bookState.chapters.length) {
        loadChapter(bookState.chapterIndex + 1).then(() => startSpeech());
      }
      return;
    }
    const utterance = new SpeechSynthesisUtterance(bookState.speechParts[bookState.speechIndex++]);
    utterance.lang = 'zh-CN';
    utterance.rate = Number($('#speech-speed').value) || 1;
    const voice = speech.getVoices().find(item => item.lang.toLowerCase().startsWith('zh'));
    if (voice) utterance.voice = voice;
    utterance.onend = () => speakNext(run);
    utterance.onerror = () => { if (run === bookState.speechRun) $('#speech-status').textContent = '系统语音朗读失败，请检查 Windows 中文语音设置。'; };
    speech.speak(utterance);
  }
  function startSpeech() {
    if (!speech) { $('#speech-status').textContent = '当前系统没有可用的语音朗读功能。'; return; }
    if (!bookState.content) return;
    stopSpeech();
    bookState.speechParts = speechParts(bookState.content);
    bookState.speechIndex = 0;
    const run = bookState.speechRun;
    $('#speak').textContent = '❚❚ 暂停朗读';
    $('#speech-status').textContent = '正在使用 Windows 语音朗读';
    speakNext(run);
  }

  function bookCard(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'book-result';
    button.dataset.bookId = String(item.book_id);
    const cover = document.createElement('span');
    cover.className = 'book-cover';
    const fallback = document.createElement('span');
    fallback.className = 'book-cover-text';
    fallback.textContent = (item.book_name || item.title || '读一本好书').slice(0, 16);
    cover.append(fallback);
    const candidates = [...new Set([item.thumb_url, item.audio_thumb_uri, item.cover].filter(url => typeof url === 'string' && /^https:\/\//.test(url)))];
    if (candidates.length) {
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      let index = 0;
      image.onerror = () => { index++; if (index < candidates.length) image.src = candidates[index]; else image.remove(); };
      image.src = candidates[index];
      cover.append(image);
    }
    const body = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = item.book_name || item.title || '未命名作品';
    const author = document.createElement('small');
    author.textContent = item.author || '作者未标注';
    body.append(title, author);
    cover.append(makeShelfToggle(item));
    button.append(cover, body);
    button.addEventListener('click', () => openBook(String(item.book_id)));
    return button;
  }
  function showBooks(items, append = false) {
    const known = new Set(append ? [...results.querySelectorAll('[data-book-id]')].map(node => node.dataset.bookId) : []);
    const cards = items.filter(item => item.book_id && !known.has(String(item.book_id)) && known.add(String(item.book_id))).map(bookCard);
    if (append) results.append(...cards);
    else results.replaceChildren(...cards);
  }
  function renderBookRail(items, title) {
    const known = new Set([...results.querySelectorAll('[data-book-id]')].map(node => node.dataset.bookId));
    const cards = items.filter(item => item.book_id && !known.has(String(item.book_id)) && known.add(String(item.book_id))).map(bookCard);
    if (!cards.length) return;
    const section = document.createElement('section');
    section.className = 'rail book-rail';
    const header = document.createElement('div');
    header.className = 'rail-header';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const arrows = document.createElement('div');
    arrows.className = 'rail-arrows';
    const track = document.createElement('div');
    track.className = 'rail-track book-rail-track';
    for (const [symbol, direction] of [['‹', -1], ['›', 1]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = symbol;
      button.setAttribute('aria-label', direction < 0 ? '向左浏览书单' : '向右浏览书单');
      button.addEventListener('click', () => track.scrollBy({ left: direction * track.clientWidth * 0.8, behavior: 'smooth' }));
      arrows.append(button);
    }
    track.append(...cards);
    header.append(heading, arrows);
    section.append(header, track);
    results.append(section);
  }
  async function discover(append = false) {
    if (append && (bookState.loading || !bookState.hasMore)) return;
    if (!append) {
      bookState.request++;
      stopSpeech();
      reader.hidden = true;
      results.hidden = false;
      results.replaceChildren();
      results.classList.add('library-rails');
      bookState.keyword = '';
      bookState.discovery = Object.fromEntries(discoveryTopics.map(topic => [topic, { offset: 0, more: true }]));
      bookState.autoLoadFailed = false;
      $('#search').value = '';
      $('#book-topics').querySelectorAll('[data-book-topic]').forEach(node => node.classList.remove('active'));
    }
    const request = bookState.request;
    bookState.loading = true;
    $('#book-more').hidden = true;
    $('#library-status').textContent = '正在载入可阅读书目…';
    $('#library-status').hidden = false;
    try {
      if (!append) {
        try {
          const home = await api('/api/library/home');
          if (request !== bookState.request) return;
          for (const section of home.sections || []) renderBookRail(section.results || [], section.title);
        } catch (_) { /* Search discovery remains available if website recommendations fail. */ }
      }
      const topics = discoveryTopics.filter(topic => bookState.discovery[topic]?.more);
      const settled = await Promise.allSettled(topics.map(topic => api(`/api/library/search?q=${encodeURIComponent(topic)}&offset=${bookState.discovery[topic].offset}`)));
      if (request !== bookState.request) return;
      const items = [];
      settled.forEach((result, index) => {
        if (result.status !== 'fulfilled') return;
        const topic = topics[index], data = result.value;
        const books = Array.isArray(data.results) ? data.results : [];
        items.push(...books);
        renderBookRail(books, `${topics[index]}${append ? ' · 继续探索' : '作品'}`);
        const current = bookState.discovery[topic];
        const next = Number(data.next_offset);
        current.offset = Number.isInteger(next) && next > current.offset ? next : current.offset + books.length;
        current.more = data.has_more === true || (Number.isFinite(data.total) && current.offset < data.total);
      });
      if (settled.every(result => result.status === 'rejected') && !results.children.length) throw new Error('书目接口暂时不可用');
      bookState.hasMore = Object.values(bookState.discovery).some(topic => topic.more);
      $('#book-more').hidden = !bookState.hasMore || !reader.hidden;
      $('#book-more').textContent = '下滑自动加载更多书籍';
      $('#library-status').textContent = results.children.length ? '' : '书目暂时无法加载，请稍后重试，或在上方输入书名搜索。';
      $('#library-status').hidden = !!results.children.length;
    } catch (error) {
      if (request !== bookState.request) return;
      bookState.autoLoadFailed = true;
      $('#library-status').textContent = `书目加载失败：${error.message}`;
      $('#library-status').hidden = false;
      $('#book-more').hidden = !append;
      $('#book-more').textContent = '加载失败，点击重试';
    } finally {
      if (request === bookState.request) { bookState.loading = false; setTimeout(loadMoreIfVisible, 0); }
    }
  }
  async function search(keyword, append = false) {
    if (!keyword) return discover();
    if (append && (bookState.loading || !bookState.hasMore)) return;
    const request = append ? bookState.request : ++bookState.request;
    if (!append) {
      stopSpeech();
      reader.hidden = true;
      results.hidden = false;
      results.replaceChildren();
      results.classList.remove('library-rails');
      bookState.keyword = keyword;
      bookState.offset = 0;
      bookState.autoLoadFailed = false;
      $('#book-topics').querySelectorAll('[data-book-topic]').forEach(node => node.classList.toggle('active', node.dataset.bookTopic === keyword));
    }
    bookState.loading = true;
    $('#book-more').hidden = true;
    $('#library-status').textContent = '正在搜索小说…';
    $('#library-status').hidden = false;
    try {
      const data = await api(`/api/library/search?q=${encodeURIComponent(keyword)}&offset=${bookState.offset}`);
      if (request !== bookState.request) return;
      const items = Array.isArray(data.results) ? data.results : [];
      showBooks(items, append);
      const next = Number(data.next_offset);
      bookState.offset = Number.isInteger(next) && next > bookState.offset ? next : bookState.offset + items.length;
      bookState.hasMore = data.has_more === true || (Number.isFinite(data.total) && bookState.offset < data.total);
      $('#book-more').hidden = !bookState.hasMore || !reader.hidden;
      $('#book-more').textContent = '下滑自动加载更多书籍';
      $('#library-status').textContent = results.children.length ? '' : '没有找到可阅读的小说。';
      $('#library-status').hidden = !!results.children.length;
    } catch (error) {
      if (request !== bookState.request) return;
      $('#library-status').textContent = `搜索失败：${error.message}`;
      $('#library-status').hidden = false;
      bookState.autoLoadFailed = true;
      $('#book-more').hidden = !append;
      $('#book-more').textContent = '加载失败，点击重试';
    } finally {
      if (request === bookState.request) { bookState.loading = false; setTimeout(loadMoreIfVisible, 0); }
    }
  }
  function loadMoreIfVisible() {
    const more = $('#book-more');
    if (library.hidden || !reader.hidden || more.hidden || bookState.loading || bookState.autoLoadFailed) return;
    const rect = more.getBoundingClientRect();
    if (rect.top < window.innerHeight + 500 && rect.bottom > -500) {
      if (bookState.keyword) search(bookState.keyword, true);
      else discover(true);
    }
  }
  // Remembered for the 最近阅读 row on the 我的 page.
  function saveRecentBook(bookId, book) {
    const cover = bookCover(book);
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem('guoju:recent-books')) || []; } catch (_) {}
    if (!Array.isArray(recent)) recent = [];
    recent = [{ book_id: String(bookId), book_name: String(book?.book_name || '未命名作品'), author: String(book?.author || ''), cover },
      ...recent.filter(entry => entry && String(entry.book_id) !== String(bookId))].slice(0, 24);
    try { localStorage.setItem('guoju:recent-books', JSON.stringify(recent)); } catch (_) {}
  }
  async function openBook(bookId) {
    if (!/^\d{1,24}$/.test(bookId)) return;
    $('#library-status').textContent = '正在载入书籍目录…';
    $('#library-status').hidden = false;
    try {
      const data = await api(`/api/library/book/${bookId}`);
      bookState.book = data.book;
      bookState.chapters = data.chapters || [];
      if (!bookState.chapters.length) throw new Error('没有可阅读章节');
      saveRecentBook(bookId, data.book);
      $('#book-title').textContent = data.book.book_name || '未命名作品';
      $('#book-author').textContent = data.book.author || '';
      paintReaderShelf();
      const buttons = bookState.chapters.map((chapter, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chapter-link';
        const number = document.createElement('span');
        number.className = 'chapter-no';
        number.textContent = String(index + 1);
        const name = document.createElement('span');
        name.textContent = chapter.title;
        button.append(number, name);
        button.addEventListener('click', () => loadChapter(index));
        return button;
      });
      $('#chapter-list').replaceChildren(...buttons);
      $('#chapter-count').textContent = `共 ${bookState.chapters.length} 章`;
      results.hidden = true;
      $('#book-more').hidden = true;
      window.bookReader.open();
      $('#library-status').hidden = true;
      const saved = Number(localStorage.getItem(`guoju:book:${bookId}`));
      await loadChapter(Number.isInteger(saved) && saved >= 0 && saved < bookState.chapters.length ? saved : 0);
      if (bookState.mode === 'audio') startSpeech();
    } catch (error) {
      $('#library-status').textContent = `打开书籍失败：${error.message}`;
      $('#library-status').hidden = false;
    }
  }
  // toEnd: when paging backwards into the previous chapter, open it on its last page.
  // target: { p } — open the chapter at that paragraph (bookmarks and notes).
  async function loadChapter(index, toEnd = false, target = null) {
    if (index < 0 || index >= bookState.chapters.length) return;
    stopSpeech();
    bookState.chapterIndex = index;
    const chapter = bookState.chapters[index];
    const kicker = `第 ${index + 1} 章`;
    window.bookReader.render('', { title: chapter.title, kicker, message: '正在载入正文…' });
    $('#chapter-position').textContent = `第 ${index + 1} / ${bookState.chapters.length} 章`;
    $('#chapter-prev').disabled = index === 0;
    $('#chapter-next').disabled = index === bookState.chapters.length - 1;
    [...$('#chapter-list').children].forEach((node, i) => node.classList.toggle('active', i === index));
    localStorage.setItem(`guoju:book:${bookState.book.book_id}`, String(index));
    try {
      const data = await api(`/api/library/chapter/${encodeURIComponent(chapter.item_id)}`);
      if (bookState.chapterIndex !== index) return;
      bookState.content = data.content || '';
      window.bookReader.render(bookState.content, { title: chapter.title, kicker, toEnd, target });
    } catch (error) {
      if (bookState.chapterIndex !== index) return;
      bookState.content = '';
      window.bookReader.render('', { title: chapter.title, kicker, message: `正文加载失败：${error.message}` });
    }
  }
  window.bookReader.onEdges(
    () => { if (bookState.chapterIndex + 1 < bookState.chapters.length) loadChapter(bookState.chapterIndex + 1); },
    () => { if (bookState.chapterIndex > 0) loadChapter(bookState.chapterIndex - 1, true); }
  );
  function closeReader() {
    stopSpeech();
    reader.hidden = true;
    window.bookReader.close();
  }

  $('#reader-back').addEventListener('click', () => { closeReader(); results.hidden = false; $('#book-more').hidden = !bookState.hasMore; });
  $('#book-topics').addEventListener('click', event => { const topic = event.target.closest('[data-book-topic]'); if (topic) { $('#search').value = topic.dataset.bookTopic; search(topic.dataset.bookTopic); } });
  $('#book-discover').addEventListener('click', () => discover());
  $('#book-more').addEventListener('click', () => { bookState.autoLoadFailed = false; if (bookState.keyword) search(bookState.keyword, true); else discover(true); });
  new IntersectionObserver(loadMoreIfVisible, { rootMargin: '500px' }).observe($('#book-more'));
  window.addEventListener('scroll', () => requestAnimationFrame(loadMoreIfVisible), { passive: true });
  $('#shelf-toggle').addEventListener('click', () => { if (bookState.book) toggleShelf(bookState.book); });
  $('#chapter-prev').addEventListener('click', () => loadChapter(bookState.chapterIndex - 1));
  $('#chapter-next').addEventListener('click', () => loadChapter(bookState.chapterIndex + 1));
  $('#speak').addEventListener('click', () => {
    if (speech?.speaking && !speech.paused) { speech.pause(); $('#speak').textContent = '▶ 继续朗读'; }
    else if (speech?.paused) { speech.resume(); $('#speak').textContent = '❚❚ 暂停朗读'; }
    else startSpeech();
  });
  $('#stop-speak').addEventListener('click', stopSpeech);
  $('#speech-speed').addEventListener('change', event => { localStorage.setItem('guoju:speech-speed', event.currentTarget.value); if (speech?.speaking) startSpeech(); });

  window.libraryApp = {
    open(mode) {
      bookState.mode = mode;
      library.hidden = false;
      $('#library-title').textContent = mode === 'audio' ? '小说朗读' : '小说阅读';
      $('#library-subtitle').textContent = mode === 'audio' ? '选择作品后使用系统语音朗读，可连续听章。当前未接入红果官方有声书录音。' : '番茄小说官网推荐与公开搜索书目，可阅读网站开放的章节。';
      $('#search').value = '';
      discover();
    },
    close() { if (!reader.hidden) closeReader(); stopSpeech(); library.hidden = true; },
    search,
    openBook,
    // The open book and chapter, for notes and bookmarks.
    current() {
      if (!bookState.book || reader.hidden) return null;
      return {
        bookId: String(bookState.book.book_id), bookName: String(bookState.book.book_name || ''),
        chapterIndex: bookState.chapterIndex, chapterTitle: String(bookState.chapters[bookState.chapterIndex]?.title || ''),
        chapterCount: bookState.chapters.length
      };
    },
    goTo(chapterIndex, target) {
      if (chapterIndex === bookState.chapterIndex && bookState.content) window.bookReader.goTo(target?.p || 0);
      else loadChapter(chapterIndex, false, target);
    }
  };
})();

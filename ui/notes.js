// 书签与笔记 for the book reader, kept on this computer per book (localStorage "guoju:notes:<bookId>").
//   书签 — marks a page; a ribbon hangs on the book while that page is open.
//   划线 / 笔记 — select text to underline it, optionally with a note; shown on the page as a marker.
// Everything is listed in the 笔记 panel; clicking an entry turns to it.
(() => {
  const reader = $('#reader');
  const text = $('#chapter-text');
  const book = document.querySelector('.book');
  const panel = $('#notes-panel');
  const list = $('#notes-list');
  const bubble = $('#note-bubble');
  const editor = $('#note-editor');
  let filter = 'all';
  let editing = null;   // { id } of the note being edited, or { draft } for a new one
  let pending = null;   // the selection the bubble is acting on

  const KEY = id => `guoju:notes:${id}`;
  const current = () => window.libraryApp?.current?.() || null;
  function load(bookId) {
    try {
      const value = JSON.parse(localStorage.getItem(KEY(bookId)));
      return Array.isArray(value) ? value.filter(entry => entry && entry.id && Number.isInteger(entry.chapter)) : [];
    } catch (_) { return []; }
  }
  function store(bookId, entries) {
    try { localStorage.setItem(KEY(bookId), JSON.stringify(entries.slice(0, 2000))); }
    catch (_) { window.showToast?.('保存失败：本机存储空间不足'); }
    refresh();
  }
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const clip = (value, length) => { const plain = String(value || '').replace(/\s+/g, ' ').trim(); return plain.length > length ? `${plain.slice(0, length)}…` : plain; };
  function when(time) {
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /* ---------- Highlights on the page ---------- */
  // Rebuild each paragraph from its plain text, wrapping the parts covered by notes in <mark>.
  function paint() {
    const open = current();
    if (!open) return;
    const notes = load(open.bookId).filter(entry => entry.type === 'note' && entry.chapter === open.chapterIndex);
    window.bookReader.paragraphs().forEach((p, index) => {
      const plain = p.textContent;
      const ranges = [];
      for (const note of notes) {
        if (index < note.p1 || index > note.p2) continue;
        const start = Math.max(0, index === note.p1 ? note.o1 : 0);
        const end = Math.min(plain.length, index === note.p2 ? note.o2 : plain.length);
        if (end > start) ranges.push({ start, end, note });
      }
      if (!ranges.length) { if (p.querySelector('mark')) p.textContent = plain; return; }
      const cuts = [...new Set([0, plain.length, ...ranges.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b);
      const parts = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const piece = plain.slice(cuts[i], cuts[i + 1]);
        const cover = ranges.filter(range => range.start <= cuts[i] && range.end >= cuts[i + 1]).pop();
        if (!cover) { parts.push(document.createTextNode(piece)); continue; }
        const mark = document.createElement('mark');
        mark.className = cover.note.note ? 'note-mark has-note' : 'note-mark';
        mark.dataset.noteId = cover.note.id;
        if (cover.note.note) mark.title = clip(cover.note.note, 120);
        mark.textContent = piece;
        parts.push(mark);
      }
      p.replaceChildren(...parts);
    });
  }

  /* ---------- Selection → bubble ---------- */
  function measure(p, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(p);
    range.setEnd(node, offset);
    return range.toString().length;
  }
  function readSelection() {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const paragraphs = window.bookReader.paragraphs();
    const hits = paragraphs.map((p, index) => [p, index]).filter(([p]) => range.intersectsNode(p));
    if (!hits.length) return null;
    let [startP, p1] = hits[0];
    let [endP, p2] = hits[hits.length - 1];
    let o1 = startP.contains(range.startContainer) ? measure(startP, range.startContainer, range.startOffset) : 0;
    let o2 = endP.contains(range.endContainer) ? measure(endP, range.endContainer, range.endOffset) : endP.textContent.length;
    // A selection that ends at the very start of the next paragraph does not include it.
    if (o2 === 0 && p2 > p1) { p2--; endP = paragraphs[p2]; o2 = endP.textContent.length; }
    if (o1 >= startP.textContent.length && p1 < p2) { p1++; startP = paragraphs[p1]; o1 = 0; }
    const quote = clip(range.toString(), 500);
    if (!quote) return null;
    return { p1, o1, p2, o2, quote, rect: range.getBoundingClientRect() };
  }
  function placeBubble(rect) {
    bubble.hidden = false;
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2));
    const above = rect.top - height - 10;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${above > 8 ? above : rect.bottom + 10}px`;
  }
  function showBubble(mode, rect) {
    bubble.dataset.mode = mode;
    const note = mode === 'mark' ? findNote(pending?.id) : null;
    $('#nb-note').textContent = mode === 'mark' ? (note?.note ? '编辑笔记' : '写笔记') : '写笔记';
    placeBubble(rect);
  }
  function hideBubble() { bubble.hidden = true; pending = null; }
  function findNote(id) {
    const open = current();
    return open && id ? load(open.bookId).find(entry => entry.id === id) || null : null;
  }

  text.addEventListener('mouseup', () => {
    setTimeout(() => {
      const selection = readSelection();
      if (!selection) return;
      pending = { selection };
      showBubble('select', selection.rect);
    }, 0);
  });
  text.addEventListener('click', event => {
    const mark = event.target.closest('mark.note-mark');
    if (!mark || getSelection()?.toString()) return;
    event.stopPropagation(); // do not turn the page
    pending = { id: mark.dataset.noteId };
    showBubble('mark', mark.getBoundingClientRect());
  });
  document.addEventListener('mousedown', event => { if (!bubble.hidden && !event.target.closest('#note-bubble')) hideBubble(); });

  function addNote(selection, note = '') {
    const open = current();
    if (!open || !selection) return null;
    const entry = {
      id: uid(), type: 'note', chapter: open.chapterIndex, chapterTitle: open.chapterTitle,
      p1: selection.p1, o1: selection.o1, p2: selection.p2, o2: selection.o2, text: selection.quote, note, created: Date.now()
    };
    store(open.bookId, [...load(open.bookId), entry]);
    getSelection()?.removeAllRanges();
    paint();
    return entry;
  }
  function removeEntry(id) {
    const open = current();
    if (!open) return;
    store(open.bookId, load(open.bookId).filter(entry => entry.id !== id));
    paint();
  }
  $('#nb-highlight').addEventListener('click', () => {
    if (bubble.dataset.mode === 'select') { addNote(pending?.selection); window.showToast?.('已划线'); }
    hideBubble();
  });
  $('#nb-note').addEventListener('click', () => {
    if (bubble.dataset.mode === 'select') openEditor({ draft: pending?.selection });
    else openEditor({ id: pending?.id });
    hideBubble();
  });
  $('#nb-copy').addEventListener('click', async () => {
    const value = bubble.dataset.mode === 'select' ? getSelection()?.toString() : findNote(pending?.id)?.text;
    try { await navigator.clipboard.writeText(String(value || '')); window.showToast?.('已复制'); } catch (_) {}
    hideBubble();
  });
  $('#nb-delete').addEventListener('click', () => {
    if (pending?.id) { removeEntry(pending.id); window.showToast?.('已删除划线'); }
    hideBubble();
  });

  /* ---------- Note editor ---------- */
  function openEditor(target) {
    const existing = target.id ? findNote(target.id) : null;
    if (!existing && !target.draft) return;
    editing = target;
    $('#note-quote').textContent = existing ? existing.text : target.draft.quote;
    $('#note-input').value = existing?.note || '';
    $('#note-remove').hidden = !existing;
    editor.hidden = false;
    $('#note-input').focus();
  }
  function closeEditor() { editor.hidden = true; editing = null; }
  function saveEditor() {
    const open = current();
    const value = $('#note-input').value.trim().slice(0, 5000);
    if (!open || !editing) return closeEditor();
    if (editing.id) {
      store(open.bookId, load(open.bookId).map(entry => entry.id === editing.id ? { ...entry, note: value, updated: Date.now() } : entry));
      paint();
    } else addNote(editing.draft, value);
    window.showToast?.(value ? '笔记已保存' : '已划线');
    closeEditor();
  }
  $('#note-save').addEventListener('click', saveEditor);
  $('#note-cancel').addEventListener('click', closeEditor);
  $('#note-remove').addEventListener('click', () => { if (editing?.id) { removeEntry(editing.id); window.showToast?.('已删除笔记'); } closeEditor(); });
  editor.addEventListener('click', event => { if (event.target === editor) closeEditor(); });
  $('#note-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); saveEditor(); }
  });

  /* ---------- Bookmarks ---------- */
  function pageBookmarks() {
    const open = current();
    if (!open) return [];
    const [first, last] = window.bookReader.visibleRange();
    if (first < 0) return [];
    return load(open.bookId).filter(entry => entry.type === 'bookmark' && entry.chapter === open.chapterIndex && entry.p >= first && entry.p <= last);
  }
  function paintBookmark() {
    const marked = pageBookmarks().length > 0;
    book.classList.toggle('bookmarked', marked);
    const button = $('#bookmark-toggle');
    button.classList.toggle('saved', marked);
    const label = marked ? '移除本页书签（B）' : '给本页加书签（B）';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(marked));
  }
  function toggleBookmark() {
    const open = current();
    if (!open) return;
    const here = pageBookmarks();
    if (here.length) {
      const ids = new Set(here.map(entry => entry.id));
      store(open.bookId, load(open.bookId).filter(entry => !ids.has(entry.id)));
      window.showToast?.('已移除书签');
    } else {
      const [first] = window.bookReader.visibleRange();
      if (first < 0) return;
      const excerpt = clip(window.bookReader.paragraphs()[first]?.textContent, 60);
      store(open.bookId, [...load(open.bookId), { id: uid(), type: 'bookmark', chapter: open.chapterIndex, chapterTitle: open.chapterTitle, p: first, text: excerpt, created: Date.now() }]);
      window.showToast?.('已添加书签');
    }
    paintBookmark();
  }
  $('#bookmark-toggle').addEventListener('click', event => { event.stopPropagation(); toggleBookmark(); });

  /* ---------- 笔记 panel ---------- */
  function refresh() {
    paintBookmark();
    if (reader.classList.contains('show-notes')) renderPanel();
  }
  function renderPanel() {
    const open = current();
    const entries = open ? load(open.bookId) : [];
    const counts = { all: entries.length, bookmark: entries.filter(entry => entry.type === 'bookmark').length, note: entries.filter(entry => entry.type === 'note').length };
    panel.querySelectorAll('[data-notes-filter]').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.notesFilter === filter);
      tab.querySelector('i').textContent = counts[tab.dataset.notesFilter] ? String(counts[tab.dataset.notesFilter]) : '';
    });
    const shown = entries
      .filter(entry => filter === 'all' || entry.type === filter)
      .sort((a, b) => a.chapter - b.chapter || (a.p ?? a.p1) - (b.p ?? b.p1) || (a.o1 || 0) - (b.o1 || 0));
    if (!shown.length) {
      const empty = document.createElement('p');
      empty.className = 'notes-empty';
      empty.textContent = filter === 'bookmark' ? '还没有书签。读到想回来的地方，点右上角的书签（或按 B）。'
        : filter === 'note' ? '还没有划线和笔记。用鼠标选中一段文字，就可以划线或写下想法。'
        : '还没有书签和笔记。\n选中文字可以划线、写笔记；点右上角的书签（或按 B）给当前页加书签。';
      list.replaceChildren(empty);
      return;
    }
    let lastChapter = -1;
    const nodes = [];
    for (const entry of shown) {
      if (entry.chapter !== lastChapter) {
        lastChapter = entry.chapter;
        const heading = document.createElement('h3');
        heading.className = 'notes-chapter';
        heading.textContent = entry.chapterTitle || `第 ${entry.chapter + 1} 章`;
        nodes.push(heading);
      }
      const item = document.createElement('div');
      item.className = `notes-item ${entry.type}`;
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      const kind = document.createElement('span');
      kind.className = 'notes-kind';
      kind.textContent = entry.type === 'bookmark' ? '书签' : entry.note ? '笔记' : '划线';
      const quote = document.createElement('blockquote');
      quote.textContent = entry.text || '';
      item.append(kind, quote);
      if (entry.note) {
        const note = document.createElement('p');
        note.className = 'notes-text';
        note.textContent = entry.note;
        item.append(note);
      }
      const meta = document.createElement('div');
      meta.className = 'notes-meta';
      const time = document.createElement('span');
      time.textContent = when(entry.updated || entry.created);
      const actions = document.createElement('span');
      if (entry.type === 'note') {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = entry.note ? '编辑' : '写笔记';
        edit.addEventListener('click', event => { event.stopPropagation(); openEditor({ id: entry.id }); });
        actions.append(edit);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '删除';
      remove.addEventListener('click', event => { event.stopPropagation(); removeEntry(entry.id); });
      actions.append(remove);
      meta.append(time, actions);
      item.append(meta);
      const go = () => jump(entry);
      item.addEventListener('click', go);
      item.addEventListener('keydown', event => { if (event.key === 'Enter') go(); });
      nodes.push(item);
    }
    list.replaceChildren(...nodes);
  }
  function jump(entry) {
    reader.classList.remove('show-notes');
    window.libraryApp?.goTo(entry.chapter, { p: entry.type === 'bookmark' ? entry.p : entry.p1 });
    if (entry.type === 'note') {
      // Flash the highlight once the chapter is on screen.
      setTimeout(() => {
        document.querySelectorAll(`mark[data-note-id="${CSS.escape(entry.id)}"]`).forEach(mark => {
          mark.classList.remove('flash');
          void mark.offsetWidth;
          mark.classList.add('flash');
        });
      }, 700);
    }
  }
  $('#notes-toggle').addEventListener('click', event => {
    event.stopPropagation();
    $('#reader-settings').hidden = true;
    reader.classList.remove('show-toc');
    reader.classList.toggle('show-notes');
    if (reader.classList.contains('show-notes')) renderPanel();
  });
  panel.addEventListener('click', event => {
    const tab = event.target.closest('[data-notes-filter]');
    if (!tab) return;
    filter = tab.dataset.notesFilter;
    renderPanel();
  });

  document.addEventListener('keydown', event => {
    if (reader.hidden) return;
    if (!editor.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeEditor(); }
      return;
    }
    if (event.key === 'Escape' && !bubble.hidden) { event.stopImmediatePropagation(); hideBubble(); return; }
    if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.code === 'KeyB') { event.preventDefault(); toggleBookmark(); }
    else if (event.code === 'KeyN') { event.preventDefault(); $('#notes-toggle').click(); }
  }, true);

  window.bookReader.onRendered(paint);
  window.bookReader.onPage(() => { if (!bubble.hidden && bubble.dataset.mode) hideBubble(); paintBookmark(); });
  // Leaving the reader closes any open note UI.
  new MutationObserver(() => { if (reader.hidden) { hideBubble(); closeEditor(); } })
    .observe(reader, { attributes: true, attributeFilter: ['hidden'] });
})();

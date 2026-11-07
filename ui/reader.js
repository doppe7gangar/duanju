// Book-style reader for 小说: cleaned paragraphs laid out as real pages (two-page spread on wide
// windows, single page on narrow ones) using CSS columns, turned with keys / wheel / clicks.
(() => {
  const reader = $('#reader');
  const viewport = $('#book-viewport');
  const flow = $('#book-flow');
  const SETTINGS_KEY = 'guoju:reader';
  const DEFAULTS = { size: 19, font: 'song', leading: '2', paper: 'paper', layout: 'page' };
  let settings = { ...DEFAULTS };
  try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (_) {}
  const page = { index: 0, count: 1, perSpread: 1, step: 0 };
  let onLastPage = null;   // called when turning past the end → next chapter
  let onFirstPage = null;  // called when turning before the start → previous chapter
  const renderedHooks = [];  // after a chapter is rendered (notes paint highlights here)
  const pageHooks = [];      // after the visible page changes (bookmarks follow it)
  const notifyPage = () => pageHooks.forEach(hook => { try { hook(); } catch (_) {} });

  /* ---------- Text clean-up: one <p> per paragraph, no stray blank lines or leading spaces ---------- */
  function paragraphs(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n+/)
      .map(line => line.replace(/^[\s　 ]+|[\s　 ]+$/g, ''))
      .filter(Boolean);
  }
  function render(text, { title = '', kicker = '', toEnd = false, message = '', target = null } = {}) {
    $('#chapter-title').textContent = title;
    // Skip "第 N 章" above the title when the title already starts with it.
    $('#chapter-kicker').textContent = /^\s*第\s*[0-9零一二三四五六七八九十百千]+\s*[章节回卷]/.test(title) ? '' : kicker;
    const body = $('#chapter-text');
    if (message) {
      const note = document.createElement('p');
      note.className = 'chapter-message';
      note.textContent = message;
      body.replaceChildren(note);
    } else {
      const parts = paragraphs(text);
      body.replaceChildren(...(parts.length ? parts : ['本章没有可显示的正文。']).map(part => {
        const p = document.createElement('p');
        p.textContent = part;
        return p;
      }));
    }
    $('#chapter-end').textContent = message ? '' : '— 本章完 —';
    if (!message) renderedHooks.forEach(hook => { try { hook(); } catch (_) {} });
    layout(toEnd ? 'end' : 'start');
    if (target && !message) goTo(target.p);
  }

  /* ---------- Positions: which paragraphs are on screen, and jumping to one ---------- */
  const textParagraphs = () => [...$('#chapter-text').children].filter(node => node.tagName === 'P' && !node.classList.contains('chapter-message'));
  // [first, last] paragraph indexes visible on the current page / scroll position (-1 when none).
  // Page mode measures against the flow itself, so a page-turn animation in progress does not matter.
  function visibleRange() {
    const view = viewport.getBoundingClientRect();
    const origin = flow.getBoundingClientRect();
    const scroll = settings.layout === 'scroll';
    const start = page.index * page.step;
    const end = start + view.width;
    let first = -1;
    let last = -1;
    textParagraphs().forEach((p, index) => {
      const visible = [...p.getClientRects()].some(rect => scroll
        ? rect.bottom > view.top + 2 && rect.top < view.bottom - 2
        : rect.right - origin.left > start + 2 && rect.left - origin.left < end - 2);
      if (visible) { if (first < 0) first = index; last = index; }
    });
    return [first, last];
  }
  function goTo(paragraphIndex) {
    const p = textParagraphs()[Math.max(0, paragraphIndex)];
    if (!p) return;
    const rect = p.getClientRects()[0] || p.getBoundingClientRect();
    if (settings.layout === 'scroll') {
      viewport.scrollTop += rect.top - viewport.getBoundingClientRect().top - 24;
      notifyPage();
      return;
    }
    // Pages sit side by side in the flow; work out which one holds the paragraph's first line.
    const offset = rect.left - flow.getBoundingClientRect().left;
    page.index = Math.min(page.count - 1, Math.max(0, Math.floor((offset + 4) / page.step)));
    show(false);
  }

  /* ---------- Pagination ---------- */
  function applySettings() {
    reader.dataset.paper = settings.paper;
    reader.dataset.font = settings.font;
    reader.dataset.layout = settings.layout;
    reader.style.setProperty('--read-size', `${settings.size}px`);
    reader.style.setProperty('--read-leading', settings.leading);
    $('#rs-size').textContent = String(settings.size);
    document.querySelectorAll('#reader-settings [data-key]').forEach(group => {
      group.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.value === String(settings[group.dataset.key])));
    });
  }
  function save() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {} }

  // Lay the chapter out into columns that are exactly one page wide; a spread shows 1 or 2 of them.
  function layout(position = 'keep') {
    if (reader.hidden) return;
    const ratio = page.count > 1 ? page.index / (page.count - 1) : 0;
    if (settings.layout === 'scroll') {
      flow.style.columnWidth = '';
      flow.style.columnGap = '';
      flow.style.transform = '';
      page.count = 1;
      page.index = 0;
      if (position === 'start') viewport.scrollTop = 0;
      if (position === 'end') viewport.scrollTop = viewport.scrollHeight;
      updatePosition();
      notifyPage();
      return;
    }
    // Decide one or two pages from the space available, then measure the page area after the book resizes.
    const wantSpread = $('.book-stage').clientWidth >= 1080;
    reader.classList.toggle('spread', wantSpread);
    const width = viewport.clientWidth;
    page.perSpread = wantSpread ? 2 : 1;
    const gap = page.perSpread === 2 ? Math.round(Math.min(140, width * 0.09)) : 0;
    const column = Math.floor((width - gap * (page.perSpread - 1)) / page.perSpread);
    flow.style.columnWidth = `${column}px`;
    flow.style.columnGap = `${gap}px`;
    flow.style.transition = 'none';
    flow.style.transform = 'translateX(0)';
    page.step = width + gap;
    // scrollWidth includes every column the text flowed into.
    const columns = Math.max(1, Math.round((flow.scrollWidth + gap) / (column + gap)));
    page.count = Math.max(1, Math.ceil(columns / page.perSpread));
    page.index = position === 'end' ? page.count - 1 : position === 'start' ? 0 : Math.round(ratio * (page.count - 1));
    show(false);
  }
  function show(animate = true) {
    flow.style.transition = animate ? '' : 'none';
    flow.style.transform = `translateX(${-page.index * page.step}px)`;
    updatePosition();
    notifyPage();
  }
  function updatePosition() {
    const scroll = settings.layout === 'scroll';
    $('#page-position').textContent = scroll ? '' : `第 ${page.index + 1} / ${page.count} 页`;
    $('#page-prev').hidden = scroll;
    $('#page-next').hidden = scroll;
  }
  function turn(direction) {
    if (reader.hidden) return;
    if (settings.layout === 'scroll') {
      viewport.scrollBy({ top: direction * viewport.clientHeight * 0.85, behavior: 'smooth' });
      return;
    }
    const next = page.index + direction;
    if (next >= page.count) { onLastPage?.(); return; }
    if (next < 0) { onFirstPage?.(); return; }
    page.index = next;
    show(true);
  }

  /* ---------- Controls ---------- */
  $('#page-prev').addEventListener('click', () => turn(-1));
  $('#page-next').addEventListener('click', () => turn(1));
  // Clicking the outer third of the page turns it, like tapping the edge of a book.
  viewport.addEventListener('click', event => {
    if (settings.layout === 'scroll' || getSelection()?.toString()) return;
    const rect = viewport.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    if (x < 0.3) turn(-1); else if (x > 0.7) turn(1);
  });
  let wheelLock = 0;
  viewport.addEventListener('wheel', event => {
    if (settings.layout === 'scroll') return;
    event.preventDefault();
    if (Date.now() < wheelLock || Math.abs(event.deltaY) < 8) return;
    wheelLock = Date.now() + 320;
    turn(event.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  function closePanels() {
    reader.classList.remove('show-toc', 'show-notes');
    $('#reader-settings').hidden = true;
  }
  $('#toc-toggle').addEventListener('click', event => {
    event.stopPropagation();
    $('#reader-settings').hidden = true;
    reader.classList.remove('show-notes');
    reader.classList.toggle('show-toc');
    if (reader.classList.contains('show-toc')) {
      const list = $('#chapter-list');
      const active = list.querySelector('.active');
      if (active) list.scrollTop = active.offsetTop - list.clientHeight / 2;
    }
  });
  $('#chapter-list').addEventListener('click', event => { if (event.target.closest('.chapter-link')) reader.classList.remove('show-toc'); });
  $('#reader-settings-toggle').addEventListener('click', event => {
    event.stopPropagation();
    reader.classList.remove('show-toc', 'show-notes');
    $('#reader-settings').hidden = !$('#reader-settings').hidden;
  });
  $('#reader-settings').addEventListener('click', event => {
    event.stopPropagation();
    const sizeButton = event.target.closest('[data-size]');
    if (sizeButton) settings.size = Math.min(30, Math.max(14, settings.size + Number(sizeButton.dataset.size)));
    const option = event.target.closest('[data-key] button');
    if (option) settings[option.parentElement.dataset.key] = option.dataset.value;
    if (!sizeButton && !option) return;
    applySettings();
    save();
    requestAnimationFrame(() => layout('keep'));
  });
  reader.addEventListener('click', event => {
    if (!event.target.closest('#reader-settings, #reader-settings-toggle, #chapter-panel, #toc-toggle, #notes-panel, #notes-toggle, .note-bubble, .note-editor')) closePanels();
  });

  document.addEventListener('keydown', event => {
    if (reader.hidden || event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) return;
    const keys = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, Space: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };
    if (event.code in keys) {
      if (settings.layout === 'scroll' && (event.code === 'ArrowDown' || event.code === 'ArrowUp')) return;
      event.preventDefault();
      if (event.target instanceof HTMLElement && event.target.matches('button')) event.target.blur();
      turn(event.code === 'Space' && event.shiftKey ? -1 : keys[event.code]);
    } else if (event.code === 'KeyT') {
      $('#toc-toggle').click();
    } else if (event.code === 'Escape') {
      if (reader.classList.contains('show-toc') || reader.classList.contains('show-notes') || !$('#reader-settings').hidden) closePanels();
      else $('#reader-back').click();
    }
  });

  let scrollFrame = 0;
  viewport.addEventListener('scroll', () => {
    if (settings.layout !== 'scroll') return;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(notifyPage);
  }, { passive: true });

  let resizeFrame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => layout('keep'));
  }).observe(viewport);
  // Fonts can finish loading after the first layout and change line breaks.
  document.fonts?.addEventListener?.('loadingdone', () => layout('keep'));

  // However the reader gets hidden (back button, search, switching tabs), leave reading mode.
  new MutationObserver(() => { if (reader.hidden) { document.body.classList.remove('reading'); closePanels(); } })
    .observe(reader, { attributes: true, attributeFilter: ['hidden'] });

  applySettings();
  window.bookReader = {
    render,
    open() {
      reader.hidden = false;
      document.body.classList.add('reading');
      closePanels();
      applySettings();
    },
    close() {
      document.body.classList.remove('reading');
      closePanels();
    },
    onEdges(next, previous) { onLastPage = next; onFirstPage = previous; },
    onRendered(hook) { renderedHooks.push(hook); },
    onPage(hook) { pageHooks.push(hook); },
    paragraphs: textParagraphs,
    visibleRange,
    goTo,
    closePanels
  };
})();

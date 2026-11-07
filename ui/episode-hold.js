// Episode-change transition: instead of the picture going black while the next episode loads,
// freeze the last frame on a canvas over the video, dim it slightly with a "第 N 集" chip, and
// fade it away once the new episode's first frame is actually on screen.
(() => {
  const holds = new WeakMap();

  function release(video, immediate = false) {
    const hold = holds.get(video);
    if (!hold) return;
    holds.delete(video);
    delete video.dataset.holding;
    clearTimeout(hold.timer);
    for (const [type, fn] of hold.listeners) video.removeEventListener(type, fn);
    if (immediate) { hold.el.remove(); return; }
    hold.el.classList.add('leaving');
    setTimeout(() => hold.el.remove(), 600);
  }

  // Returns true when a frame was held. Call before changing video.src.
  function holdEpisodeFrame(video, { label = '' } = {}) {
    release(video, true);
    if (!video || video.readyState < 2 || !video.videoWidth || !video.parentElement) return false;
    const el = document.createElement('div');
    el.className = 'episode-hold';
    el.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    try { canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height); } catch (_) { return false; }
    canvas.style.objectFit = getComputedStyle(video).objectFit || 'contain';
    el.append(canvas);
    if (label) {
      const chip = document.createElement('span');
      chip.className = 'episode-hold-chip';
      chip.textContent = label;
      el.append(chip);
    }
    // Above the 画质增强 canvas (which blanks on emptied), below danmaku and status overlays.
    (video.parentElement.querySelector(':scope > .enhance') || video).after(el);
    video.dataset.holding = '1';

    const hold = { el, listeners: [], timer: 0 };
    holds.set(video, hold);
    // Fade only once the new frame has been composited, so there is never a black gap.
    const onPlaying = () => {
      if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(() => release(video));
      else requestAnimationFrame(() => release(video));
    };
    const onFail = () => release(video);
    hold.listeners.push(['playing', onPlaying], ['error', onFail]);
    for (const [type, fn] of hold.listeners) video.addEventListener(type, fn);
    // If the next episode stalls or autoplay is refused, do not hide its state behind an old frame.
    hold.timer = setTimeout(() => release(video), 8000);
    return true;
  }

  window.holdEpisodeFrame = holdEpisodeFrame;
  window.releaseEpisodeFrame = release;
})();

// In-app update UI: silent check shortly after start, a banner when a new version exists,
// download progress, then "重启并更新". The 我的 page has a manual "检查更新" card.
(() => {
  const updater = window.desktop?.update;
  const banner = $('#update-banner');
  const status = $('#update-status');
  const go = $('#update-go');
  let info = null;
  let phase = 'idle'; // idle | checking | available | downloading | ready | error
  let dismissed = false;

  function setStatus(text) { status.textContent = text; }
  function cleanNotes(text) {
    return String(text || '').replace(/sha-?256\s*[:：]\s*[a-f0-9]{64}/ig, '').replace(/[#*`>]/g, '').replace(/\r/g, '')
      .split('\n').map(line => line.trim()).filter(Boolean).slice(0, 4).join('\n');
  }
  function showBanner() {
    if (dismissed && phase === 'available') return;
    banner.hidden = false;
    requestAnimationFrame(() => banner.classList.add('show'));
  }
  function hideBanner() {
    banner.classList.remove('show');
    setTimeout(() => { if (!banner.classList.contains('show')) banner.hidden = true; }, 250);
  }
  function paint() {
    const bar = $('#update-bar');
    $('#update-later').hidden = phase === 'downloading';
    go.disabled = phase === 'downloading';
    if (phase === 'available') {
      $('#update-title').textContent = `发现新版本 v${info.latest}`;
      $('#update-notes').textContent = cleanNotes(info.notes) || '包含界面与稳定性改进。';
      bar.hidden = true;
      $('#update-progress').textContent = '';
      go.textContent = info.canInstall ? '立即更新' : '前往下载';
    } else if (phase === 'downloading') {
      $('#update-title').textContent = `正在下载 v${info.latest}`;
      bar.hidden = false;
      go.textContent = '下载中…';
    } else if (phase === 'ready') {
      $('#update-title').textContent = `v${info.latest} 已下载完成`;
      $('#update-notes').textContent = '重启后即为新版本，观看进度、片单和设置都会保留。';
      bar.hidden = true;
      $('#update-progress').textContent = '';
      go.textContent = '重启并更新';
    } else if (phase === 'error') {
      bar.hidden = true;
      go.textContent = '重试';
    }
  }

  async function check(manual) {
    if (!updater || phase === 'checking' || phase === 'downloading') return;
    phase = 'checking';
    setStatus('正在检查更新…');
    const result = await updater.check().catch(error => ({ ok: false, error: error.message }));
    if (!result?.ok) {
      phase = 'idle';
      setStatus(`检查更新失败：${result?.error || '网络不可用'}`);
      if (manual) showToast('检查更新失败，请稍后再试');
      return;
    }
    if (!result.configured) {
      phase = 'idle';
      setStatus('尚未设置更新源，暂时无法在线更新。');
      if (manual) showToast('尚未设置更新源');
      return;
    }
    info = result;
    if (result.available) {
      phase = 'available';
      setStatus(`发现新版本 v${result.latest}（当前 v${result.current}）`);
      if (manual) dismissed = false;
      paint();
      showBanner();
    } else {
      phase = 'idle';
      setStatus(result.reason ? `当前版本 v${result.current} · ${result.reason}` : `已是最新版本 v${result.current}`);
      if (manual) showToast(result.reason || '已是最新版本');
    }
  }

  async function download() {
    if (!info?.canInstall) { showToast('当前不是打包版程序，请到发行版页面手动下载'); return; }
    phase = 'downloading';
    paint();
    const fill = $('#update-bar').querySelector('i');
    const stop = updater.onProgress(({ received, total }) => {
      const percent = total ? Math.min(100, Math.round(received / total * 100)) : 0;
      fill.style.width = `${percent}%`;
      $('#update-progress').textContent = total ? `${percent}% · ${(received / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB` : `${(received / 1048576).toFixed(0)} MB`;
    });
    const result = await updater.download().catch(error => ({ ok: false, error: error.message }));
    stop();
    if (result?.ok) {
      phase = 'ready';
      setStatus(`v${info.latest} 已下载，重启即可完成更新`);
    } else {
      phase = 'error';
      $('#update-title').textContent = '更新下载失败';
      $('#update-notes').textContent = result?.error || '网络中断，请重试。';
      setStatus(`更新下载失败：${result?.error || ''}`);
    }
    paint();
    showBanner();
  }

  go.addEventListener('click', async () => {
    if (phase === 'available' || phase === 'error') download();
    else if (phase === 'ready') {
      go.disabled = true;
      go.textContent = '正在重启…';
      const ok = await updater.install();
      if (!ok) { go.disabled = false; phase = 'error'; $('#update-notes').textContent = '无法完成替换，请重新下载。'; paint(); }
    }
  });
  for (const id of ['#update-later', '#update-dismiss']) {
    $(id).addEventListener('click', () => { if (phase !== 'downloading') { dismissed = true; hideBanner(); } });
  }
  $('#update-check').addEventListener('click', () => {
    if (phase === 'ready' || phase === 'available') { dismissed = false; paint(); showBanner(); return; }
    check(true);
  });

  if (!updater) {
    $('#app-version').textContent = '';
    setStatus('当前以开发模式运行，在线更新仅在打包后的程序中可用。');
    $('#update-check').disabled = true;
    return;
  }
  window.desktop.version().then(version => { $('#app-version').textContent = `v${version}`; setStatus(`当前版本 v${version}`); });
  // Quietly check a few seconds after start so it never slows down opening the app.
  setTimeout(() => check(false), 6000);
})();

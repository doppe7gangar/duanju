const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require('electron');
const path = require('node:path');

const MIN_LANDSCAPE = [940, 600];
let landscapeBounds = null;
let landscapeMaximized = true;
let orientation = 'landscape';

// 竖屏 turns the window into a tall 9:16 phone-shaped window that a vertical drama fills exactly;
// 横屏 restores the previous wide window.
function setOrientation(mode) {
  if (!window || window.isDestroyed() || (mode !== 'portrait' && mode !== 'landscape')) return orientation;
  if (window.isFullScreen()) window.setFullScreen(false);
  if (mode === 'portrait') {
    if (orientation === 'landscape') {
      landscapeMaximized = window.isMaximized();
      landscapeBounds = window.getNormalBounds();
    }
    if (window.isMaximized()) window.unmaximize();
    const area = screen.getDisplayMatching(window.getBounds()).workArea;
    const outer = window.getBounds();
    const inner = window.getContentBounds();
    const chromeWidth = outer.width - inner.width;
    const chromeHeight = outer.height - inner.height;
    const contentHeight = area.height - chromeHeight;
    const contentWidth = Math.round(contentHeight * 9 / 16);
    window.setMinimumSize(360, 600);
    window.setBounds({
      x: Math.round(area.x + (area.width - contentWidth - chromeWidth) / 2), y: area.y,
      width: contentWidth + chromeWidth, height: area.height
    }, true);
  } else if (orientation === 'portrait') {
    window.setMinimumSize(...MIN_LANDSCAPE);
    if (landscapeBounds) window.setBounds(landscapeBounds, true);
    if (landscapeMaximized) window.maximize();
  }
  orientation = mode;
  return orientation;
}
ipcMain.handle('window:set-orientation', (event, mode) => (event.sender === window?.webContents ? setOrientation(mode) : orientation));

// In-app updates (Gitee releases). Only the app's own window may drive them.
const updater = require('./updater');
const fromApp = event => event.sender === window?.webContents;
ipcMain.handle('update:check', async event => {
  if (!fromApp(event)) return null;
  try { return { ok: true, ...(await updater.check(app.getVersion())) }; }
  catch (error) { return { ok: false, error: error?.message || '检查更新失败' }; }
});
ipcMain.handle('update:download', async event => {
  if (!fromApp(event)) return null;
  try { return { ok: true, ...(await updater.download(progress => { if (!event.sender.isDestroyed()) event.sender.send('update:progress', progress); })) }; }
  catch (error) { return { ok: false, error: error?.message || '下载更新失败' }; }
});
ipcMain.handle('update:install', event => (fromApp(event) ? updater.install(() => app.quit()) : false));
ipcMain.handle('app:version', () => app.getVersion());

app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch('enable-accelerated-video-decode');

if (!app.requestSingleInstanceLock()) app.quit();

let window;
let server;

app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

app.whenReady().then(async () => {
  try {
    process.env.HONGGUO_CLIENT_DIR = path.join(__dirname, 'ui');
    process.env.HONGGUO_EXTENSION_MODULE = path.join(__dirname, 'extra-routes.js');
    process.env.HONGGUO_DATA_DIR = path.join(app.getPath('userData'), 'data');
    process.env.HONGGUO_LOG_DIR = path.join(app.getPath('userData'), 'logs');
    const started = await require('./vendor/hongguo-open-player/src/server/index').startServer(8899);
    server = started.server;
    const origin = `http://127.0.0.1:${started.port}`;

    window = new BrowserWindow({
      width: 1320,
      height: 820,
      minWidth: 940,
      minHeight: 600,
      title: '果剧桌面',
      icon: path.join(__dirname, 'assets', 'icon.ico'),
      backgroundColor: '#131414',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url === 'https://github.com/zfdang/hongguo-open-player') shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      try { if (new URL(url).origin === origin) return; } catch (_) {}
      event.preventDefault();
    });
    window.maximize();
    await window.loadURL(origin);
  } catch (error) {
    dialog.showErrorBox('启动失败', String(error?.message || error));
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => server?.close());

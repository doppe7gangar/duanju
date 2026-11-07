// Exposes only the window-orientation switch and the updater to the page; nothing else from Electron or Node.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  setOrientation: mode => ipcRenderer.invoke('window:set-orientation', mode === 'portrait' ? 'portrait' : 'landscape'),
  version: () => ipcRenderer.invoke('app:version'),
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onProgress: callback => {
      const listener = (_event, progress) => callback({ received: Number(progress?.received) || 0, total: Number(progress?.total) || 0 });
      ipcRenderer.on('update:progress', listener);
      return () => ipcRenderer.removeListener('update:progress', listener);
    }
  }
});

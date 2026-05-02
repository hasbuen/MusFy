import { contextBridge, ipcRenderer } from 'electron';

const musfyDesktop = {
  minimizeToTray: () => ipcRenderer.invoke('window:minimize-to-tray'),
  showMiniPlayer: () => ipcRenderer.invoke('window:show-mini-player'),
  toggleMiniPlayer: () => ipcRenderer.invoke('window:toggle-mini-player'),
  showMain: () => ipcRenderer.invoke('window:show-main'),
  closeMiniPlayer: () => ipcRenderer.invoke('window:close-mini-player'),
  setMiniPlayerMode: (mode: 'compact' | 'video') => ipcRenderer.invoke('window:set-mini-player-mode', mode),
  quitApp: () => ipcRenderer.invoke('window:quit-app'),
  getServiceConfig: () => ipcRenderer.sendSync('service:get-config'),
  getPreferences: () => ipcRenderer.invoke('app:get-preferences'),
  notifyRendererReady: () => ipcRenderer.send('app:renderer-ready'),
  getUpdateStatus: () => ipcRenderer.invoke('app:get-update-status'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  selectBackupDirectory: () => ipcRenderer.invoke('app:select-backup-directory'),
  openExternal: (targetUrl: string) => ipcRenderer.invoke('app:open-external', targetUrl),
  onUpdateStatus: (listener: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: unknown) => listener(status);
    ipcRenderer.on('app:update-status', handler);
    return () => ipcRenderer.removeListener('app:update-status', handler);
  },
  updatePreferences: (patch: { showSplash?: boolean; startHiddenInTray?: boolean; autoUpdateEnabled?: boolean; updateFeedUrl?: string; backupDirectory?: string; backupFormat?: 'mp3' | 'mp4' | 'avi' }) =>
    ipcRenderer.invoke('app:update-preferences', patch)
};

contextBridge.exposeInMainWorld('musfyDesktop', musfyDesktop);

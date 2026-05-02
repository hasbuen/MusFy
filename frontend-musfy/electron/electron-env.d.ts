export {};

declare global {
  interface Window {
    musfyDesktop?: {
      minimizeToTray: () => Promise<void>;
      showMiniPlayer: () => Promise<boolean>;
      toggleMiniPlayer: () => Promise<boolean>;
      showMain: () => Promise<void>;
      closeMiniPlayer: () => Promise<void>;
      setMiniPlayerMode: (mode: 'compact' | 'video') => Promise<boolean>;
      quitApp: () => Promise<void>;
      getServiceConfig: () => {
        host: string;
        port: number;
        baseUrl: string;
        mode: 'managed' | 'external';
      } | null;
      getPreferences: () => Promise<{
        showSplash: boolean;
        startHiddenInTray: boolean;
        autoUpdateEnabled: boolean;
        updateFeedUrl: string;
        backupDirectory: string;
        backupFormat: 'mp3' | 'mp4' | 'avi';
      }>;
      notifyRendererReady: () => void;
      getUpdateStatus: () => Promise<{
        state: 'idle' | 'disabled' | 'unconfigured' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
        message: string;
        currentVersion: string;
        availableVersion?: string | null;
        feedUrl?: string | null;
        progress?: number | null;
        releaseName?: string | null;
        releaseNotes?: string | null;
        releaseDate?: string | null;
        releaseUrl?: string | null;
      }>;
      checkForUpdates: () => Promise<{
        state: 'idle' | 'disabled' | 'unconfigured' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
        message: string;
        currentVersion: string;
        availableVersion?: string | null;
        feedUrl?: string | null;
        progress?: number | null;
        releaseName?: string | null;
        releaseNotes?: string | null;
        releaseDate?: string | null;
        releaseUrl?: string | null;
      }>;
      installUpdate: () => Promise<boolean>;
      selectBackupDirectory: () => Promise<string | null>;
      openExternal: (targetUrl: string) => Promise<boolean>;
      onUpdateStatus: (listener: (status: {
        state: 'idle' | 'disabled' | 'unconfigured' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
        message: string;
        currentVersion: string;
        availableVersion?: string | null;
        feedUrl?: string | null;
        progress?: number | null;
        releaseName?: string | null;
        releaseNotes?: string | null;
        releaseDate?: string | null;
        releaseUrl?: string | null;
      }) => void) => () => void;
      updatePreferences: (patch: {
        showSplash?: boolean;
        startHiddenInTray?: boolean;
        autoUpdateEnabled?: boolean;
        updateFeedUrl?: string;
        backupDirectory?: string;
        backupFormat?: 'mp3' | 'mp4' | 'avi';
      }) => Promise<{
        showSplash: boolean;
        startHiddenInTray: boolean;
        autoUpdateEnabled: boolean;
        updateFeedUrl: string;
        backupDirectory: string;
        backupFormat: 'mp3' | 'mp4' | 'avi';
      }>;
    };
  }
}

export type Song = {
  id: string;
  title: string;
  artist?: string | null;
  thumbnail?: string | null;
  source?: string | null;
  favorite?: boolean;
  youtubeUrl?: string | null;
  audioMimeType?: string | null;
  videoMimeType?: string | null;
  hasVideo?: boolean;
  uploadedByUserName?: string | null;
  uploadedByUserId?: string | null;
  ownerUserId?: string | null;
};

export type SongSection = 'library' | 'favorites' | 'explore';

export type Playlist = {
  id: string;
  name: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  ownerUserId?: string | null;
  ownerUserName?: string | null;
  musicIds?: string[];
  songs?: Song[];
};

export type PlaylistScope = 'mine' | 'discover';

export type User = {
  id: string;
  nome: string;
  email?: string | null;
  criadoEm?: string | null;
};

export type ServiceStorage = {
  sqlite?: {
    ready?: boolean;
    path?: string | null;
  };
  redis?: {
    mode?: string | null;
    url?: string | null;
  };
};

export type HealthStatus = {
  ok: boolean;
  status?: string | null;
  service?: string | null;
  mode?: string | null;
  host?: string | null;
  port?: number | null;
  ready?: boolean | null;
  storage?: ServiceStorage | null;
};

export type AndroidApkInfo = {
  fileExists?: boolean;
  fileName?: string | null;
  preferredUrl?: string | null;
  localUrls?: string[];
  storagePath?: string | null;
};

export type DownloadMode = 'auto' | 'audio' | 'video' | 'playlist';

export type DownloadJobItem = {
  id?: string | null;
  title?: string | null;
  artist?: string | null;
  stage?: string | null;
  status?: string | null;
  message?: string | null;
  progress?: number | null;
  outputPath?: string | null;
  musicId?: string | null;
  videoPath?: string | null;
};

export type DownloadJob = {
  id: string;
  url?: string | null;
  title?: string | null;
  artist?: string | null;
  status?: string | null;
  stage?: string | null;
  message?: string | null;
  progress?: number | null;
  mode?: string | null;
  includeVideo?: boolean;
  targetPlaylistId?: string | null;
  playlistTitle?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  items?: DownloadJobItem[];
};

export type OfflineTrack = {
  songId: string;
  title: string;
  artist?: string | null;
  thumbnail?: string | null;
  localUri: string;
  mimeType?: string | null;
  savedAt: string;
  sizeBytes?: number | null;
};

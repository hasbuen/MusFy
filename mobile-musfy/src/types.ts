export type Song = {
  id: string;
  title: string;
  artist?: string | null;
  thumbnail?: string | null;
  source?: string | null;
  favorite?: boolean;
  youtubeUrl?: string | null;
  audioMimeType?: string | null;
  hasVideo?: boolean;
  uploadedByUserName?: string | null;
  ownerUserId?: string | null;
};

export type Playlist = {
  id: string;
  name: string;
  updatedAt?: string | null;
  songs?: Song[];
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
  storage?: ServiceStorage | null;
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

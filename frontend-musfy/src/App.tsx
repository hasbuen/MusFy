import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { AnimatePresence, motion } from 'framer-motion';
import localforage from 'localforage';
import {
  Check,
  Compass,
  Download,
  Expand,
  HardDriveDownload,
  Heart,
  Home,
  LayoutGrid,
  Library,
  List,
  LogIn,
  LogOut,
  LoaderCircle,
  Minimize2,
  MonitorSpeaker,
  Music,
  Pause,
  Pencil,
  Play,
  QrCode,
  Search,
  Server,
  Settings2,
  SkipBack,
  SkipForward,
  Smartphone,
  Sparkles,
  Plus,
  Trash2,
  UserPlus,
  Video,
  Volume2,
  X
} from 'lucide-react';
import api from './services/api';

interface Song {
  id: string;
  title: string;
  artist?: string | null;
  thumbnail?: string | null;
  source?: string;
  favorite?: boolean;
  youtubeUrl?: string;
  ownerUserId?: string | null;
  uploadedByUserId?: string | null;
  uploadedByUserName?: string | null;
  path?: string;
  audioMimeType?: string | null;
  videoPath?: string | null;
  videoMimeType?: string | null;
  hasVideo?: boolean;
}

interface User {
  id: string;
  nome: string;
  email?: string;
  login?: string;
  criadoEm?: string;
}

interface Playlist {
  id: string;
  name: string;
  ownerUserId?: string | null;
  ownerUserName?: string | null;
  musicIds?: string[];
  songs?: Song[];
  updatedAt?: string;
}

type YoutubeDownloadMode = 'single' | 'playlist';

interface YoutubeAnalysis {
  kind: 'single' | 'playlist';
  url: string;
  videoId?: string | null;
  playlistId?: string | null;
  hasPlaylist: boolean;
  selectedEntry?: {
    id?: string | null;
    url: string;
    title?: string | null;
  } | null;
  playlist?: {
    id?: string | null;
    title: string;
    entryCount: number;
    entries: Array<{
      id?: string | null;
      url: string;
      title: string;
    }>;
  } | null;
}

interface YoutubeSearchResult {
  id: string;
  title: string;
  url: string;
  thumbnail?: string | null;
  channel?: string | null;
  duration?: string | null;
  durationSeconds?: number | null;
  position?: number;
}

interface YoutubeSearchPlaylistResult {
  id: string;
  title: string;
  url: string;
  thumbnail?: string | null;
  channel?: string | null;
  entryCount?: number | null;
  previewEntries?: Array<{
    id?: string | null;
    title: string;
    url: string;
  }>;
  position?: number;
}

interface YoutubeSearchSelection {
  kind: 'track' | 'playlist';
  title: string;
  subtitle?: string | null;
}

interface YoutubeActionModalState {
  analysis: YoutubeAnalysis;
  selection: YoutubeSearchSelection;
}

interface YoutubeRecentSearch {
  query: string;
  lastSearchedAt: string;
  totalHits: number;
  lastSource?: string | null;
}

interface AndroidApkInfo {
  fileExists: boolean;
  fileName: string;
  localUrls: string[];
  preferredUrl?: string | null;
  externalUrl?: string | null;
  storagePath?: string | null;
}

interface DesktopPreferences {
  showSplash: boolean;
  startHiddenInTray: boolean;
  autoUpdateEnabled: boolean;
  updateFeedUrl: string;
}

interface DesktopUpdateStatus {
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
}

interface DeviceSession {
  deviceId: string;
  deviceName: string;
  userId?: string | null;
  userName?: string | null;
  ipAddress?: string | null;
  platform?: string | null;
  lastSeenAt?: string;
  lastAckAt?: string | null;
  lastAckCommandId?: number;
  lastError?: string | null;
  lastState?: {
    status?: string;
    currentSongTitle?: string | null;
    currentSongArtist?: string | null;
    isPlaying?: boolean;
    currentTime?: number;
    duration?: number;
    volume?: number;
    lastUpdateAt?: string;
  } | null;
}

interface DownloadJobItem {
  index: number;
  title: string;
  status: string;
  progress: number;
  stage?: string;
  message?: string;
  error?: string;
}

interface DownloadJob {
  id: string;
  url: string;
  status: string;
  progress: number;
  stage: string;
  message?: string;
  mode?: string;
  includeVideo?: boolean;
  updatedAt?: string;
  items?: DownloadJobItem[];
}

type ViewMode = 'grid' | 'list';
type Section = 'home' | 'explore' | 'library' | 'favorites' | 'download' | 'settings';
type AuthMode = 'login' | 'register';
type PlaybackMode = 'audio' | 'video';

type PlayerSnapshot = {
  currentSong: Song | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  queue: Song[];
  playbackMode: PlaybackMode;
  showVideoInMiniPlayer: boolean;
};

type OfflineAudioRecord = {
  songId: string;
  title: string;
  mimeType: string;
  blob: Blob;
  savedAt: string;
};

function getDownloadJobStatusLabel(status?: string) {
  if (status === 'running') return 'Em andamento';
  if (status === 'queued') return 'Na fila';
  if (status === 'paused') return 'Pausado';
  if (status === 'completed') return 'Concluido';
  if (status === 'error') return 'Erro';
  return 'Aguardando';
}

type PlayerCommand =
  | { type: 'TOGGLE_PLAY' }
  | { type: 'PLAY_SONG'; song: Song }
  | { type: 'SET_PLAYBACK_MODE'; mode: PlaybackMode }
  | { type: 'NEXT' }
  | { type: 'PREVIOUS' }
  | { type: 'SEEK'; time: number }
  | { type: 'SET_VOLUME'; volume: number };

const isMiniMode = new URLSearchParams(window.location.search).get('mini') === '1';
const channel = new BroadcastChannel('musfy-player');
const offlineAudioStore = localforage.createInstance({
  name: 'musfy-offline',
  storeName: 'audio_cache'
});
const AUTH_STORAGE_KEY = 'musfy-current-user';
const DEVICE_ID_STORAGE_KEY = 'musfy-device-id';
const DEVICE_NAME_STORAGE_KEY = 'musfy-device-name';

function getSongSubtitle(song: Song | null) {
  if (!song) return 'Biblioteca';
  return getDisplayArtist(song) || (song.source === 'youtube' ? 'YouTube Audio' : 'Biblioteca');
}

function getSongSearchText(song: Song) {
  return `${getDisplayTitle(song)} ${getDisplayArtist(song) || ''}`.toLowerCase();
}

function getOfflineAudioKey(songId: string) {
  return `audio:${songId}`;
}

function getSongSourceLabel(song: Song | null) {
  if (!song) return 'Biblioteca';
  return song.source === 'youtube' ? 'YouTube' : 'Arquivo local';
}

function getSongUploaderLabel(song: Song | null) {
  if (!song?.uploadedByUserName) return null;
  return `Por ${song.uploadedByUserName}`;
}

function getYoutubeResultSubtitle(result: YoutubeSearchResult) {
  return [result.channel, result.duration].filter(Boolean).join(' • ');
}

function getYoutubePlaylistSubtitle(result: YoutubeSearchPlaylistResult) {
  return [result.channel, result.entryCount ? `${result.entryCount} faixas` : null].filter(Boolean).join(' • ');
}

function getDeviceStatusLabel(device: DeviceSession) {
  const status = device.lastState?.status;
  if (status === 'playing') return 'Tocando agora';
  if (status === 'paused') return 'Pausado';
  if (status === 'error') return 'Com erro';
  return 'Disponivel';
}

function createDeviceId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  return `musfy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isGenericArtistName(value?: string | null) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || ['arquivo', 'youtube', 'audio', 'artista desconhecido', 'youtube audio'].includes(normalized);
}

function isGenericSongTitle(value?: string | null) {
  const normalized = String(value || '').trim();
  if (!normalized) return true;

  return (
    /^youtube\s+[a-z0-9_-]{6,}$/i.test(normalized) ||
    /^\d+$/.test(normalized) ||
    ['faixa do youtube', 'youtube audio'].includes(normalized.toLowerCase())
  );
}

function splitSongTitle(rawTitle?: string | null) {
  const title = String(rawTitle || '').trim();
  if (!title) return { artistFromTitle: null, cleanTitle: 'Musica sem titulo' };

  const separators = [' - ', ' | ', ': '];
  for (const separator of separators) {
    if (title.includes(separator)) {
      const [artistPart, ...titleParts] = title.split(separator);
      const artistFromTitle = artistPart.trim();
      const cleanTitle = titleParts.join(separator).trim();

      if (artistFromTitle && cleanTitle) {
        return { artistFromTitle, cleanTitle };
      }
    }
  }

  return { artistFromTitle: null, cleanTitle: title };
}

function getDisplayArtist(song: Song | null) {
  if (!song) return null;

  const fromField = String(song.artist || '').trim();
  if (!isGenericArtistName(fromField)) {
    return fromField;
  }

  const fromTitle = splitSongTitle(song.title).artistFromTitle;
  return isGenericArtistName(fromTitle) ? null : fromTitle;
}

function getDisplayTitle(song: Song | null) {
  if (!song) return 'Musica sem titulo';

  const { cleanTitle } = splitSongTitle(song.title);
  if (!isGenericSongTitle(cleanTitle)) {
    return cleanTitle;
  }

  const rawTitle = String(song.title || '').trim();
  return rawTitle && !isGenericSongTitle(rawTitle) ? rawTitle : cleanTitle || 'Musica sem titulo';
}

function getActivityMeta(entry: string) {
  const match = entry.match(/^\[([^\]]+)\]\s*(.*)$/);
  const timestamp = match ? match[1] : null;
  const message = match ? match[2] : entry;
  const lower = message.toLowerCase();

  if (lower.includes('[error]') || lower.includes('erro')) {
    return { timestamp, message, tone: 'error' as const, label: 'Erro' };
  }

  if (lower.includes('[warn]') || lower.includes('falha') || lower.includes('ignorada')) {
    return { timestamp, message, tone: 'warn' as const, label: 'Alerta' };
  }

  if (lower.includes('[playlist]')) {
    return { timestamp, message, tone: 'playlist' as const, label: 'Playlist' };
  }

  if (lower.includes('[inspect]')) {
    return { timestamp, message, tone: 'inspect' as const, label: 'Analise' };
  }

  if (lower.includes('[download]') || lower.includes('yt-dlp') || lower.includes('ffmpeg')) {
    return { timestamp, message, tone: 'download' as const, label: 'Download' };
  }

  return { timestamp, message, tone: 'info' as const, label: 'Info' };
}

function splitReleaseNotesText(releaseNotes?: string | null) {
  return String(releaseNotes || '')
    .trim()
    .split(/\n\s*\n/g)
    .map((section) => section.trim())
    .filter(Boolean);
}

function formatReleaseDateLabel(value?: string | null) {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(parsed);
}

export default function App() {
  const storedDeviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY) || createDeviceId();
  const storedDeviceName =
    localStorage.getItem(DEVICE_NAME_STORAGE_KEY) ||
    `${navigator.platform.includes('Win') ? 'Notebook' : 'Dispositivo'} MusFy`;
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, storedDeviceId);
  localStorage.setItem(DEVICE_NAME_STORAGE_KEY, storedDeviceName);

  const [songs, setSongs] = useState<Song[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('audio');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerNotice, setPlayerNotice] = useState('');
  const [activeSection, setActiveSection] = useState<Section>(() =>
    localStorage.getItem('musfy-prefer-download-on-launch') === 'false' ? 'home' : 'download'
  );
  const [youtubeSearchQuery, setYoutubeSearchQuery] = useState('');
  const [youtubeSearchResults, setYoutubeSearchResults] = useState<YoutubeSearchResult[]>([]);
  const [youtubePlaylistSearchResults, setYoutubePlaylistSearchResults] = useState<YoutubeSearchPlaylistResult[]>([]);
  const [youtubeActionModal, setYoutubeActionModal] = useState<YoutubeActionModalState | null>(null);
  const [youtubeSearchSource, setYoutubeSearchSource] = useState('');
  const [youtubeSearchMessage, setYoutubeSearchMessage] = useState('');
  const [youtubeRecentSearches, setYoutubeRecentSearches] = useState<YoutubeRecentSearch[]>([]);
  const [isSearchingYoutube, setIsSearchingYoutube] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeArtist, setYoutubeArtist] = useState('');
  const [youtubeTitle, setYoutubeTitle] = useState('');
  const [youtubeIncludeVideo, setYoutubeIncludeVideo] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isInspectingYoutube, setIsInspectingYoutube] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState('');
  const [youtubeAnalysis, setYoutubeAnalysis] = useState<YoutubeAnalysis | null>(null);
  const [lastAnalyzedUrl, setLastAnalyzedUrl] = useState('');
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);
  const [activeDownloadJobActionId, setActiveDownloadJobActionId] = useState<string | null>(null);
  const [activityLogs, setActivityLogs] = useState<string[]>([]);
  const [showActivityPanel, setShowActivityPanel] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authLogin, setAuthLogin] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as User) : null;
  });
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [discoverPlaylists, setDiscoverPlaylists] = useState<Playlist[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [youtubeTargetPlaylistId, setYoutubeTargetPlaylistId] = useState('');
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [activeDiscoverPlaylistId, setActiveDiscoverPlaylistId] = useState<string | null>(null);
  const [playlistMessage, setPlaylistMessage] = useState('');
  const [playlistPickerSong, setPlaylistPickerSong] = useState<Song | null>(null);
  const [playlistEditingId, setPlaylistEditingId] = useState<string | null>(null);
  const [playlistEditingName, setPlaylistEditingName] = useState('');
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState(storedDeviceId);
  const [deviceName] = useState(storedDeviceName);
  const [lastRemoteCommandId, setLastRemoteCommandId] = useState(0);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [offlineSongIds, setOfflineSongIds] = useState<string[]>([]);
  const [offlineBusyIds, setOfflineBusyIds] = useState<string[]>([]);
  const [isVideoTheaterOpen, setIsVideoTheaterOpen] = useState(false);
  const [isVideoPanelOpen, setIsVideoPanelOpen] = useState(false);
  const [showVideoInMiniPlayer, setShowVideoInMiniPlayer] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [desktopPreferences, setDesktopPreferences] = useState<DesktopPreferences>({
    showSplash: true,
    startHiddenInTray: false,
    autoUpdateEnabled: true,
    updateFeedUrl: ''
  });
  const [preferDownloadOnLaunch, setPreferDownloadOnLaunch] = useState(
    () => localStorage.getItem('musfy-prefer-download-on-launch') !== 'false'
  );
  const [androidApkUrl, setAndroidApkUrl] = useState(() => localStorage.getItem('musfy-android-apk-url') || '');
  const [androidApkInfo, setAndroidApkInfo] = useState<AndroidApkInfo | null>(null);
  const [apkQrCodeDataUrl, setApkQrCodeDataUrl] = useState('');
  const [serviceStorage, setServiceStorage] = useState<any>(null);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [desktopUpdateFocusTarget, setDesktopUpdateFocusTarget] = useState<'panel' | 'notes' | null>(null);
  const [desktopUpdateStatus, setDesktopUpdateStatus] = useState<DesktopUpdateStatus>({
    state: 'idle',
    message: 'Atualizador pronto.',
    currentVersion: '0.0.0',
    availableVersion: null,
    feedUrl: null,
    progress: null,
    releaseName: null,
    releaseNotes: null,
    releaseDate: null,
    releaseUrl: null
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const playbackModeRef = useRef<PlaybackMode>('audio');
  const videoPanelRef = useRef<HTMLDivElement | null>(null);
  const desktopUpdatePanelRef = useRef<HTMLDivElement | null>(null);
  const desktopUpdateNotesRef = useRef<HTMLDivElement | null>(null);
  const desktopUpdateFocusTimerRef = useRef<number | null>(null);

  const desktopApi = {
    minimizeToTray: async () => {
      if (!window.musfyDesktop) return false;
      await window.musfyDesktop.minimizeToTray();
      return true;
    },
    showMiniPlayer: async () => {
      if (!window.musfyDesktop?.showMiniPlayer) return false;
      return window.musfyDesktop.showMiniPlayer();
    },
    toggleMiniPlayer: async () => {
      if (!window.musfyDesktop) return false;
      return window.musfyDesktop.toggleMiniPlayer();
    },
    showMain: async () => {
      if (!window.musfyDesktop) return false;
      await window.musfyDesktop.showMain();
      return true;
    },
    closeMiniPlayer: async () => {
      if (!window.musfyDesktop) return false;
      await window.musfyDesktop.closeMiniPlayer();
      return true;
    },
    setMiniPlayerMode: async (mode: 'compact' | 'video') => {
      if (!window.musfyDesktop?.setMiniPlayerMode) return false;
      return window.musfyDesktop.setMiniPlayerMode(mode);
    },
    quitApp: async () => {
      if (!window.musfyDesktop) return false;
      await window.musfyDesktop.quitApp();
      return true;
    },
    openExternal: async (targetUrl: string) => {
      if (!window.musfyDesktop?.openExternal) return false;
      return window.musfyDesktop.openExternal(targetUrl);
    }
  };

  useEffect(() => {
    window.musfyDesktop?.notifyRendererReady?.();
  }, []);

  useEffect(() => {
    if (!window.musfyDesktop?.onUpdateStatus) return;
    return window.musfyDesktop.onUpdateStatus((status) => {
      setDesktopUpdateStatus(status as DesktopUpdateStatus);
    });
  }, []);

  useEffect(
    () => () => {
      if (desktopUpdateFocusTimerRef.current) {
        window.clearTimeout(desktopUpdateFocusTimerRef.current);
      }
    },
    []
  );

  const persistCurrentUser = (user: User | null) => {
    setCurrentUser(user);
    if (user) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  };

  const loadSongs = async (section = activeSection, user = currentUser) => {
    const res = await api.get('/enviar-musica', {
      params: {
        section,
        ...(user?.id ? { userId: user.id } : {})
      }
    });
    setSongs(Array.isArray(res.data) ? res.data : []);
  };

  const loadPlaylists = async (user = currentUser) => {
    if (!user) {
      setPlaylists([]);
      return;
    }

    const res = await api.get('/playlists', {
      params: { userId: user.id }
    });

    setPlaylists(Array.isArray(res.data) ? res.data : []);
  };

  const loadDiscoverPlaylists = async (user = currentUser) => {
    const res = await api.get('/playlists', {
      params: {
        scope: 'discover',
        ...(user?.id ? { userId: user.id, excludeUserId: user.id } : {})
      }
    });

    setDiscoverPlaylists(Array.isArray(res.data) ? res.data : []);
  };

  const loadActivityLogs = async () => {
    const res = await api.get('/logs');
    const nextLogs = Array.isArray(res.data) ? (res.data as string[]) : [];
    const filteredLogs = nextLogs.filter(
      (entry) =>
        !entry.includes('Dispositivo ativo:') &&
        !entry.includes('Estado ') &&
        !entry.includes('ACK dispositivo')
    );
    setActivityLogs(filteredLogs.slice(-80));
  };

  const registerDevice = async (user = currentUser) => {
    await api.post('/devices/register', {
      deviceId: storedDeviceId,
      deviceName,
      platform: navigator.platform,
      userId: user?.id
    });
  };

  const loadDevices = async (user = currentUser) => {
    const res = await api.get('/devices', {
      params: {
        excludeDeviceId: storedDeviceId,
        ...(user?.id ? { userId: user.id } : {})
      }
    });

    const nextDevices = Array.isArray(res.data) ? (res.data as DeviceSession[]) : [];
    setDevices(nextDevices);
    if (
      selectedOutputDeviceId !== storedDeviceId &&
      !nextDevices.some((device) => device.deviceId === selectedOutputDeviceId)
    ) {
      setSelectedOutputDeviceId(storedDeviceId);
    }
  };

  const loadOfflineIndex = async () => {
    const keys = await offlineAudioStore.keys();
    const ids = keys
      .map((key) => String(key))
      .filter((key) => key.startsWith('audio:'))
      .map((key) => key.slice('audio:'.length));
    setOfflineSongIds(ids);
  };

  const releaseObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const getActiveMediaElement = () =>
    playbackModeRef.current === 'video' && currentSong?.hasVideo ? videoRef.current : audioRef.current;

  const getPlaybackUrl = async (song: Song, mode: PlaybackMode) => {
    if (mode === 'audio') {
      const offline = await offlineAudioStore.getItem<OfflineAudioRecord>(getOfflineAudioKey(song.id));
      if (offline?.blob) {
        releaseObjectUrl();
        objectUrlRef.current = URL.createObjectURL(offline.blob);
        return objectUrlRef.current;
      }

      return `${api.defaults.baseURL}/reproduzir-musica/${song.id}`;
    }

    if (!song.hasVideo) {
      throw new Error('Esta faixa nao possui video salvo');
    }

    return `${api.defaults.baseURL}/reproduzir-video/${song.id}`;
  };

  const loadDownloadJobs = async () => {
    const res = await api.get('/downloads/status');
    setDownloadJobs(Array.isArray(res.data) ? (res.data as DownloadJob[]) : []);
  };

  const loadDesktopPreferences = async () => {
    if (!window.musfyDesktop?.getPreferences) return;
    const preferences = await window.musfyDesktop.getPreferences();
    setDesktopPreferences(preferences);
  };

  const loadDesktopUpdateStatus = async () => {
    if (!window.musfyDesktop?.getUpdateStatus) return;
    const status = await window.musfyDesktop.getUpdateStatus();
    setDesktopUpdateStatus(status);
  };

  const triggerDesktopUpdateCheck = async () => {
    if (!window.musfyDesktop?.checkForUpdates) return;
    const status = await window.musfyDesktop.checkForUpdates();
    setDesktopUpdateStatus(status);
  };

  const installDesktopUpdate = async () => {
    if (!window.musfyDesktop?.installUpdate) return;
    await window.musfyDesktop.installUpdate();
  };

  const focusDesktopUpdateSection = (target: 'panel' | 'notes') => {
    setActiveSection('settings');
    setDesktopUpdateFocusTarget(target);

    if (desktopUpdateFocusTimerRef.current) {
      window.clearTimeout(desktopUpdateFocusTimerRef.current);
    }

    const scrollToTarget = () => {
      const targetRef = target === 'notes' ? desktopUpdateNotesRef : desktopUpdatePanelRef;
      targetRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    };

    window.requestAnimationFrame(() => {
      window.setTimeout(scrollToTarget, activeSection === 'settings' ? 0 : 180);
    });

    desktopUpdateFocusTimerRef.current = window.setTimeout(() => {
      setDesktopUpdateFocusTarget(null);
      desktopUpdateFocusTimerRef.current = null;
    }, 2200);
  };

  const probeBackendAvailability = async () => {
    try {
      await api.get('/health');
      setBackendAvailable(true);
      return true;
    } catch {
      setBackendAvailable(false);
      return false;
    }
  };

  const loadAndroidApkInfo = async () => {
    const [apkRes, storageRes] = await Promise.all([api.get('/android/apk-info'), api.get('/service/storage')]);
    setAndroidApkInfo((apkRes.data || null) as AndroidApkInfo | null);
    setServiceStorage(storageRes.data?.storage || null);
  };

  const resolvedAndroidApkUrl = (androidApkUrl || androidApkInfo?.preferredUrl || '').trim();

  const loadYoutubeRecentSearches = async () => {
    const res = await api.get('/youtube/history', { params: { limit: 8 } });
    setYoutubeRecentSearches(Array.isArray(res.data) ? (res.data as YoutubeRecentSearch[]) : []);
  };

  const sendDeviceState = async (
    status: 'idle' | 'playing' | 'paused' | 'error',
    overrides?: Partial<{
      currentSong: Song | null;
      currentTime: number;
      duration: number;
      volume: number;
      errorMessage: string | null;
    }>
  ) => {
    try {
      const song = overrides?.currentSong === undefined ? currentSong : overrides.currentSong;
      const nextCurrentTime = overrides?.currentTime ?? currentTime;
      const nextDuration = overrides?.duration ?? duration;
      const nextVolume = overrides?.volume ?? volume;

      await api.post(`/devices/${storedDeviceId}/state`, {
        deviceName,
        platform: navigator.platform,
        userId: currentUser?.id,
        status,
        currentSongId: song?.id || null,
        currentSongTitle: song ? getDisplayTitle(song) : null,
        currentSongArtist: song ? getDisplayArtist(song) : null,
        isPlaying: status === 'playing',
        currentTime: nextCurrentTime,
        duration: nextDuration,
        volume: nextVolume,
        errorMessage: overrides?.errorMessage || null
      });
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (isMiniMode) return;

    void probeBackendAvailability();
    const interval = window.setInterval(() => {
      void probeBackendAvailability();
    }, backendAvailable ? 10000 : 2000);

    return () => window.clearInterval(interval);
  }, [backendAvailable, isMiniMode]);

  useEffect(() => {
    if (!isMiniMode && backendAvailable) {
      loadSongs().catch(console.error);
    }
  }, [activeSection, currentUser, isMiniMode, backendAvailable]);

  useEffect(() => {
    loadOfflineIndex().catch(console.error);
    setIsVideoTheaterOpen(false);
    setIsVideoPanelOpen(false);
    setShowVideoInMiniPlayer(false);

    return () => {
      releaseObjectUrl();
    };
  }, []);

  useEffect(() => {
    if (!isMiniMode && currentUser && backendAvailable) {
      loadPlaylists().catch(console.error);
    }
  }, [currentUser, isMiniMode, backendAvailable]);

  useEffect(() => {
    if (youtubeTargetPlaylistId && !playlists.some((playlist) => playlist.id === youtubeTargetPlaylistId)) {
      setYoutubeTargetPlaylistId('');
    }
  }, [youtubeTargetPlaylistId, playlists]);

  useEffect(() => {
    playbackModeRef.current = playbackMode;
  }, [playbackMode]);

  useEffect(() => {
    void desktopApi.setMiniPlayerMode(
      showVideoInMiniPlayer && currentSong && playbackMode === 'video' && currentSong.hasVideo ? 'video' : 'compact'
    );
  }, [currentSong?.id, currentSong?.hasVideo, playbackMode, showVideoInMiniPlayer]);

  useEffect(() => {
    if (!backendAvailable) {
      return;
    }

    if (!currentSong || playbackMode !== 'video' || !currentSong.hasVideo || !videoRef.current) {
      return;
    }

    const nextSrc = `${api.defaults.baseURL}/reproduzir-video/${currentSong.id}`;
    const element = videoRef.current;
    const currentSrc = element.currentSrc || element.src || '';

    if (!currentSrc.includes(`/reproduzir-video/${currentSong.id}`)) {
      element.src = nextSrc;
      element.load();
    }

    element.volume = volume;

    if (isPlaying) {
      element.play().catch(console.error);
    }
  }, [currentSong?.id, currentSong?.hasVideo, playbackMode, isPlaying, volume, backendAvailable]);

  useEffect(() => {
    if (playbackMode !== 'video' || !currentSong?.hasVideo) {
      setIsVideoTheaterOpen(false);
      setIsVideoPanelOpen(false);
      setShowVideoInMiniPlayer(false);
    }
  }, [playbackMode, currentSong?.id, currentSong?.hasVideo]);

  useEffect(() => {
    if (isMiniMode) return;

    broadcastSnapshot({
      currentSong,
      isPlaying,
      currentTime,
      duration,
      volume,
      playbackMode,
      showVideoInMiniPlayer
    });
  }, [isMiniMode, currentSong, isPlaying, currentTime, duration, volume, playbackMode, showVideoInMiniPlayer]);

  useEffect(() => {
    if (!isMiniMode && backendAvailable) {
      loadDiscoverPlaylists().catch(console.error);
    }
  }, [currentUser, isMiniMode, backendAvailable]);

  useEffect(() => {
    if (isMiniMode || !backendAvailable) return;

    registerDevice().catch(console.error);
    loadDevices().catch(console.error);

    const interval = window.setInterval(() => {
      registerDevice().catch(console.error);
      loadDevices().catch(console.error);
    }, 10000);

    return () => window.clearInterval(interval);
  }, [currentUser, isMiniMode, deviceName, backendAvailable]);

  useEffect(() => {
    if (isMiniMode || !backendAvailable) return;

    const status: 'idle' | 'playing' | 'paused' =
      currentSong ? (isPlaying ? 'playing' : 'paused') : 'idle';
    sendDeviceState(status).catch(console.error);

    const interval = window.setInterval(() => {
      sendDeviceState(status).catch(console.error);
    }, 15000);

    return () => window.clearInterval(interval);
  }, [currentUser, isMiniMode, currentSong?.id, isPlaying, volume, backendAvailable]);

  useEffect(() => {
    if (isMiniMode || !backendAvailable) return;

    const interval = window.setInterval(async () => {
      try {
        const res = await api.get(`/devices/${storedDeviceId}/command`, {
          params: {
            after: lastRemoteCommandId,
            deviceName,
            platform: navigator.platform,
            ...(currentUser?.id ? { userId: currentUser.id } : {})
          }
        });

        const command = res.data?.command;
        if (!command?.payload) return;

        setLastRemoteCommandId(command.commandId);
        try {
          await runPlayerCommand(command.payload as PlayerCommand, true);
          await api.post(`/devices/${storedDeviceId}/ack`, {
            commandId: command.commandId,
            deviceName,
            platform: navigator.platform,
            userId: currentUser?.id,
            status: 'executed',
            details: `Comando ${command.payload.type} executado no dispositivo`
          });
        } catch (executionError: any) {
          await sendDeviceState('error', {
            errorMessage: executionError?.message || 'Falha ao executar comando remoto'
          });
          await api.post(`/devices/${storedDeviceId}/ack`, {
            commandId: command.commandId,
            deviceName,
            platform: navigator.platform,
            userId: currentUser?.id,
            status: 'error',
            details: executionError?.message || 'Falha ao executar comando remoto'
          });
        }
      } catch (error) {
        console.error(error);
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [currentUser, isMiniMode, lastRemoteCommandId, deviceName, selectedOutputDeviceId, backendAvailable]);

  useEffect(() => {
    if (!showActivityPanel) return;
    if (!backendAvailable) return;

    loadActivityLogs().catch(console.error);
    const interval = window.setInterval(() => {
      loadActivityLogs().catch(console.error);
    }, 2000);

    return () => window.clearInterval(interval);
  }, [showActivityPanel, isDownloading, backendAvailable]);

  useEffect(() => {
    if (activeSection !== 'download' && !isDownloading) return;
    if (!backendAvailable) return;

    loadDownloadJobs().catch(console.error);
    const interval = window.setInterval(() => {
      loadDownloadJobs().catch(console.error);
    }, 1200);

    return () => window.clearInterval(interval);
  }, [activeSection, isDownloading, backendAvailable]);

  useEffect(() => {
    if (isMiniMode || activeSection !== 'download' || !backendAvailable) return;
    loadYoutubeRecentSearches().catch(console.error);
  }, [activeSection, isMiniMode, backendAvailable]);

  useEffect(() => {
    if (isMiniMode || activeSection !== 'settings') return;
    loadDesktopPreferences().catch(console.error);
    loadDesktopUpdateStatus().catch(console.error);
  }, [activeSection, isMiniMode]);

  useEffect(() => {
    if (isMiniMode || activeSection !== 'settings' || !backendAvailable) return;
    loadAndroidApkInfo().catch(console.error);
  }, [activeSection, isMiniMode, backendAvailable]);

  useEffect(() => {
    localStorage.setItem('musfy-prefer-download-on-launch', preferDownloadOnLaunch ? 'true' : 'false');
  }, [preferDownloadOnLaunch]);

  useEffect(() => {
    localStorage.setItem('musfy-android-apk-url', androidApkUrl);
  }, [androidApkUrl]);

  useEffect(() => {
    if (!resolvedAndroidApkUrl) {
      setApkQrCodeDataUrl('');
      return;
    }

    QRCode.toDataURL(resolvedAndroidApkUrl, {
      width: 240,
      margin: 1,
      color: {
        dark: '#050505',
        light: '#0000'
      }
    })
      .then((dataUrl: string) => setApkQrCodeDataUrl(dataUrl))
      .catch(() => setApkQrCodeDataUrl(''));
  }, [resolvedAndroidApkUrl]);

  useEffect(() => {
    const normalizedUrl = youtubeUrl.trim();

    if (!normalizedUrl) {
      setYoutubeAnalysis(null);
      setYoutubeActionModal(null);
      setLastAnalyzedUrl('');
      return;
    }

    if (normalizedUrl !== lastAnalyzedUrl) {
      setYoutubeAnalysis(null);
      setYoutubeActionModal(null);
    }
  }, [youtubeUrl, lastAnalyzedUrl]);

  const activePlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === activePlaylistId) || null,
    [playlists, activePlaylistId]
  );

  const activeDiscoverPlaylist = useMemo(
    () => discoverPlaylists.find((playlist) => playlist.id === activeDiscoverPlaylistId) || null,
    [discoverPlaylists, activeDiscoverPlaylistId]
  );

  const selectedOutputDevice = useMemo(() => {
    if (selectedOutputDeviceId === storedDeviceId) {
      return null;
    }

    return devices.find((device) => device.deviceId === selectedOutputDeviceId) || null;
  }, [devices, selectedOutputDeviceId, storedDeviceId]);

  const homePlaylists = useMemo(() => {
    const term = searchTerm.toLowerCase();

    return playlists.filter((playlist) => {
      if (!term) return true;
      const haystack = [
        playlist.name,
        ...(playlist.songs || []).map((song) => `${getDisplayTitle(song)} ${getDisplayArtist(song) || ''}`)
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [playlists, searchTerm]);

  const explorePlaylists = useMemo(() => {
    const term = searchTerm.toLowerCase();

    return discoverPlaylists.filter((playlist) => {
      if (!term) return true;
      const haystack = [
        playlist.name,
        playlist.ownerUserName || '',
        ...(playlist.songs || []).map((song) => `${getDisplayTitle(song)} ${getDisplayArtist(song) || ''}`)
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [discoverPlaylists, searchTerm]);

  const filteredSongs = useMemo(() => {
    let base = songs;

    if (activePlaylist) {
      base = activePlaylist.songs || [];
    } else if (activeDiscoverPlaylist) {
      base = activeDiscoverPlaylist.songs || [];
    } else if (activeSection === 'favorites') {
      base = songs.filter((song) => Boolean(song.favorite));
    }

    return base.filter((song) => getSongSearchText(song).includes(searchTerm.toLowerCase()));
  }, [songs, searchTerm, activeSection, activePlaylist, activeDiscoverPlaylist]);

  const queue = filteredSongs;
  const activeCollection = activePlaylist || activeDiscoverPlaylist || null;
  const activeCollectionCover = activeCollection?.songs?.[0]?.thumbnail || null;
  const isPlaylistDetailView = Boolean(activeCollection);

  const heroTitle =
    activePlaylist
      ? activePlaylist.name
      : activeDiscoverPlaylist
        ? activeDiscoverPlaylist.name
      : activeSection === 'home'
      ? 'Início'
      : activeSection === 'explore'
        ? 'Explorar'
        : activeSection === 'download'
          ? 'Baixar do YouTube'
        : activeSection === 'favorites'
          ? 'Favoritas'
          : activeSection === 'settings'
            ? 'Configurações'
            : 'Sua Biblioteca';

  const heroDescription =
    activePlaylist
      ? `${filteredSongs.length} musicas nesta playlist.`
      : activeDiscoverPlaylist
        ? `${filteredSongs.length} musicas na playlist de ${activeDiscoverPlaylist.ownerUserName || 'outro usuario'}.`
      : activeSection === 'explore'
      ? 'Explore playlists publicadas por outros usuarios da rede.'
      : activeSection === 'download'
        ? 'Cole um link, envie para o backend e publique a musica no Explorar.'
      : activeSection === 'favorites'
        ? 'Suas musicas favoritas em um so lugar.'
        : activeSection === 'settings'
          ? 'Ajuste o desktop e acompanhe o host local sem poluicao visual.'
          : currentUser
          ? `${homePlaylists.length} playlists organizadas para ${currentUser.nome}.`
          : 'Entre com um usuario para separar sua biblioteca.';

  const sqliteStatusLabel = !backendAvailable
    ? 'Host iniciando'
    : serviceStorage?.sqlite?.ready
      ? 'Pronto'
      : 'Sem resposta';
  const redisStatusLabel = !backendAvailable
    ? 'Aguardando host'
    : serviceStorage?.redis?.mode || 'Sem endpoint';
  const apkStatusLabel = !backendAvailable
    ? 'Aguardando host'
    : androidApkInfo?.fileExists || resolvedAndroidApkUrl
      ? 'Disponível'
      : 'Em preparacao';
  const updateStatusLabel =
    desktopUpdateStatus.state === 'downloaded'
      ? 'Pronto para instalar'
      : desktopUpdateStatus.state === 'downloading'
        ? 'Baixando'
        : desktopUpdateStatus.state === 'available'
          ? 'Nova tag'
        : desktopUpdateStatus.state === 'checking'
          ? 'Verificando'
          : desktopUpdateStatus.state === 'unconfigured'
            ? 'Sem feed'
            : desktopUpdateStatus.state === 'disabled'
              ? 'Desligado'
              : desktopUpdateStatus.state === 'error'
                ? 'Erro'
                : 'Ativo';
  const shouldShowDesktopUpdateBanner =
    desktopUpdateStatus.state === 'available' ||
    desktopUpdateStatus.state === 'downloading' ||
    desktopUpdateStatus.state === 'downloaded';
  const releaseNotesSections = useMemo(
    () => splitReleaseNotesText(desktopUpdateStatus.releaseNotes),
    [desktopUpdateStatus.releaseNotes]
  );
  const releaseNotesPreview = releaseNotesSections.slice(0, 2);
  const formattedReleaseDate = useMemo(
    () => formatReleaseDateLabel(desktopUpdateStatus.releaseDate),
    [desktopUpdateStatus.releaseDate]
  );
  const updateHeadline =
    desktopUpdateStatus.releaseName ||
    (desktopUpdateStatus.availableVersion ? `MusFy ${desktopUpdateStatus.availableVersion}` : 'Atualizacao do MusFy');

  const settingsContent = (
    <div className="space-y-6">
      <div className="rounded-[36px] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.12),transparent_28%),linear-gradient(180deg,#151515_0%,#090909_100%)] p-6 md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-green-300">Configurações</p>
            <h3 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Desktop, servidor local e Android</h3>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-400">
              Ajuste o comportamento do app, confira a saude do host Windows e prepare a distribuicao do APK pela rede local.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.24em] text-gray-500">Splash</p>
              <p className="mt-1 text-sm font-semibold text-white">{desktopPreferences.showSplash ? 'Ligada' : 'Desligada'}</p>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.24em] text-gray-500">Inicializacao</p>
              <p className="mt-1 text-sm font-semibold text-white">{desktopPreferences.startHiddenInTray ? 'Bandeja' : 'Janela'}</p>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.24em] text-gray-500">Host</p>
              <p className="mt-1 text-sm font-semibold text-white">LAN pronta</p>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.24em] text-gray-500">Atualizações</p>
              <p className="mt-1 text-sm font-semibold text-white">{updateStatusLabel}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_360px]">
        <div className="min-w-0 space-y-6">
          <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,#111111_0%,#0a0a0a_100%)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.16)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-green-300">Aplicativo</p>
                <h3 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">Comportamento do desktop</h3>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">
                  Preferencias principais do cliente Windows. Menos ruido, mais controle.
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] p-3 text-gray-300">
                <Settings2 size={18} />
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <button
                onClick={() => void updateDesktopPreference({ showSplash: !desktopPreferences.showSplash })}
                className="flex w-full items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-green-400/20 hover:bg-white/[0.05]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">Mostrar splash ao iniciar</p>
                  <p className="mt-2 text-sm leading-6 text-gray-400">Exibe a tela de abertura antes da interface principal.</p>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${desktopPreferences.showSplash ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-gray-400'}`}>
                  {desktopPreferences.showSplash ? 'Ligado' : 'Desligado'}
                </span>
              </button>

              <button
                onClick={() => void updateDesktopPreference({ startHiddenInTray: !desktopPreferences.startHiddenInTray })}
                className="flex w-full items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-green-400/20 hover:bg-white/[0.05]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">Iniciar escondido na bandeja</p>
                  <p className="mt-2 text-sm leading-6 text-gray-400">Usado para auto-start em background. Ao abrir manualmente, a janela principal continua aparecendo.</p>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${desktopPreferences.startHiddenInTray ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-gray-400'}`}>
                  {desktopPreferences.startHiddenInTray ? 'Ligado' : 'Desligado'}
                </span>
              </button>

              <button
                onClick={() => handlePreferDownloadOnLaunchChange(!preferDownloadOnLaunch)}
                className="flex w-full items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-green-400/20 hover:bg-white/[0.05]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">Abrir sempre em downloads</p>
                  <p className="mt-2 text-sm leading-6 text-gray-400">Usa a captura do YouTube como ponto de entrada principal.</p>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${preferDownloadOnLaunch ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-gray-400'}`}>
                  {preferDownloadOnLaunch ? 'Ligado' : 'Desligado'}
                </span>
              </button>

              <button
                onClick={() => void updateDesktopPreference({ autoUpdateEnabled: !desktopPreferences.autoUpdateEnabled })}
                className="flex w-full items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-green-400/20 hover:bg-white/[0.05]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">Atualização automática</p>
                  <p className="mt-2 text-sm leading-6 text-gray-400">
                    Verifica novas versões do MusFy em segundo plano e baixa o instalador sozinho quando houver update.
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${desktopPreferences.autoUpdateEnabled ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-gray-400'}`}>
                  {desktopPreferences.autoUpdateEnabled ? 'Ligado' : 'Desligado'}
                </span>
              </button>

              <div className="rounded-[24px] border border-white/10 bg-[#0d0d0d] p-5">
                <p className="text-xs uppercase tracking-[0.22em] text-gray-500">Endereco do host</p>
                <p className="mt-3 break-all text-base font-semibold text-white">{api.defaults.baseURL}</p>
                <p className="mt-2 text-sm leading-6 text-gray-400">Este endereco e usado pelo desktop e pelos clientes da rede local.</p>
              </div>

              <div
                ref={desktopUpdatePanelRef}
                className={`rounded-[24px] border bg-[#0d0d0d] p-5 transition ${
                  desktopUpdateFocusTarget === 'panel'
                    ? 'border-cyan-400/40 shadow-[0_0_0_1px_rgba(34,211,238,0.22)]'
                    : 'border-white/10'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-gray-500">Atualizações do GitHub</p>
                    <p className="mt-3 text-base font-semibold text-white">Versão atual {desktopUpdateStatus.currentVersion}</p>
                    <p className="mt-2 text-sm leading-6 text-gray-400">
                      O MusFy cruza o feed automático com a última tag publicada no GitHub Releases para avisar quando entrar uma atualização nova.
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-gray-300">
                    {updateStatusLabel}
                  </span>
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Canal automático</p>
                  <p className="mt-3 break-all text-sm font-semibold text-white">
                    {desktopUpdateStatus.feedUrl || 'Canal embutido indisponível'}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-gray-500">
                    O usuário final não precisa conhecer esse endereço. O MusFy consulta esse release sozinho em segundo plano.
                  </p>
                </div>

                <div
                  ref={desktopUpdateNotesRef}
                  className={`mt-4 rounded-2xl border bg-white/[0.03] px-4 py-4 transition ${
                    desktopUpdateFocusTarget === 'notes'
                      ? 'border-cyan-400/40 shadow-[0_0_0_1px_rgba(34,211,238,0.22)]'
                      : 'border-white/10'
                  }`}
                >
                  <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Último release detectado</p>
                  <p className="mt-3 break-all text-sm font-semibold text-white">
                    {desktopUpdateStatus.releaseUrl || 'URL do release ainda indisponível'}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-gray-500">
                    Se entrar uma tag nova no repositório, o app compara a versão atual com esse release e dispara o aviso automaticamente.
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    onClick={() => void triggerDesktopUpdateCheck()}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-gray-200 hover:bg-white/[0.08]"
                  >
                    Verificar atualizações
                  </button>
                  {desktopUpdateStatus.releaseUrl ? (
                    <button
                      onClick={() => void desktopApi.openExternal(desktopUpdateStatus.releaseUrl || '')}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-gray-200 hover:bg-white/[0.08]"
                    >
                      Abrir release
                    </button>
                  ) : null}
                  {desktopUpdateStatus.state === 'downloaded' ? (
                    <button
                      onClick={() => void installDesktopUpdate()}
                      className="rounded-full border border-green-500/30 bg-green-500/15 px-4 py-2 text-sm text-green-100 hover:bg-green-500/20"
                    >
                      Reiniciar e instalar
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                  <p className="text-sm font-semibold text-white">
                    {desktopUpdateStatus.availableVersion
                      ? `Nova versão detectada: ${desktopUpdateStatus.availableVersion}`
                      : desktopUpdateStatus.releaseName
                        ? 'Último release confirmado'
                        : 'Nenhuma nova versão detectada ainda'}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-gray-400">{desktopUpdateStatus.message}</p>
                  {desktopUpdateStatus.progress !== null && desktopUpdateStatus.progress !== undefined ? (
                    <div className="mt-3">
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-green-400 to-cyan-400"
                          style={{ width: `${Math.max(3, Math.min(100, Number(desktopUpdateStatus.progress || 0)))}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Notas da versão</p>
                      <p className="mt-3 text-base font-semibold text-white">{updateHeadline}</p>
                      {formattedReleaseDate ? (
                        <p className="mt-2 text-xs uppercase tracking-[0.18em] text-gray-500">Publicado em {formattedReleaseDate}</p>
                      ) : null}
                    </div>
                    {desktopUpdateStatus.availableVersion ? (
                      <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-100">
                        v{desktopUpdateStatus.availableVersion}
                      </span>
                    ) : null}
                  </div>

                  {desktopUpdateStatus.releaseNotes ? (
                    <div className="mt-4 max-h-[280px] overflow-y-auto rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                      <p className="whitespace-pre-wrap text-sm leading-6 text-gray-300">{desktopUpdateStatus.releaseNotes}</p>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm leading-6 text-gray-500">
                      As notas aparecem aqui quando uma versão publicada expõe o que mudou junto do updater.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {settingsMessage ? <p className="mt-4 text-sm text-gray-400">{settingsMessage}</p> : null}
          </div>

          <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,#111111_0%,#0a0a0a_100%)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.16)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Servidor local</p>
                <h3 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">Status do host Windows</h3>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">
                  O backend continua no centro da operacao. Aqui ficam os motores e o armazenamento em uso.
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] p-3 text-gray-300">
                <Server size={18} />
              </div>
            </div>

            {!backendAvailable ? (
              <div className="mt-5 rounded-[24px] border border-amber-400/15 bg-amber-400/8 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">Host local</p>
                <p className="mt-2 text-sm font-semibold text-white">O desktop abriu antes do backend responder.</p>
                <p className="mt-2 text-sm leading-6 text-gray-300">
                  Assim que o servidor local terminar de subir, este painel troca automaticamente para os caminhos reais de SQLite, Redis e APK.
                </p>
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-[24px] border border-white/10 bg-[#0d0d0d] p-5">
                <p className="text-xs uppercase tracking-[0.22em] text-gray-500">SQLite</p>
                <p className="mt-3 text-lg font-semibold text-white">{sqliteStatusLabel}</p>
                <p className="mt-2 break-all text-xs leading-5 text-gray-500">
                  {backendAvailable ? serviceStorage?.sqlite?.path || 'Sem caminho informado' : 'Conectando ao armazenamento local...'}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-[#0d0d0d] p-5">
                <p className="text-xs uppercase tracking-[0.22em] text-gray-500">Redis</p>
                <p className="mt-3 text-lg font-semibold text-white">{redisStatusLabel}</p>
                <p className="mt-2 break-all text-xs leading-5 text-gray-500">
                  {backendAvailable
                    ? serviceStorage?.redis?.url || serviceStorage?.redis?.error || 'Sem endpoint'
                    : 'Aguardando disponibilidade do cache em memoria...'}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-[#0d0d0d] p-5">
                <p className="text-xs uppercase tracking-[0.22em] text-gray-500">APK Android</p>
                <p className="mt-3 text-lg font-semibold text-white">{apkStatusLabel}</p>
                <p className="mt-2 text-xs leading-5 text-gray-500">{androidApkInfo?.fileName || 'MusFy-Android.apk'}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,#111111_0%,#0a0a0a_100%)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.16)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-green-300">Android</p>
                <h3 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">Distribuicao do APK</h3>
                <p className="mt-3 text-sm leading-6 text-gray-400">
                  Quando o APK existir, o QR e as URLs locais aparecem aqui sem poluir o restante da tela.
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] p-3 text-gray-300">
                <Smartphone size={18} />
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-gray-500">URL do APK</p>
                <input
                  value={androidApkUrl}
                  onChange={(e) => setAndroidApkUrl(e.target.value)}
                  placeholder={androidApkInfo?.preferredUrl || 'https://seu-servidor/musfy-android.apk'}
                  className="mt-3 h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none focus:border-cyan-300/30"
                />
              </div>

              <div className="flex flex-col items-center rounded-[28px] border border-dashed border-white/10 bg-[#0b0b0b] p-5 text-center">
                {apkQrCodeDataUrl ? (
                  <img src={apkQrCodeDataUrl} alt="QR do APK Android" className="h-52 w-52 rounded-[24px] bg-white p-3" />
                ) : (
                  <div className="flex h-52 w-52 items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.03] text-gray-500">
                    <QrCode size={42} />
                  </div>
                )}
                <p className="mt-4 text-sm font-semibold text-white">{resolvedAndroidApkUrl || 'Nenhuma URL de APK configurada ainda'}</p>
                <p className="mt-2 text-xs leading-5 text-gray-500">
                  {androidApkInfo?.fileExists
                    ? 'O servidor local ja esta pronto para expor o APK pela LAN.'
                    : 'Assim que o APK existir, este QR sera preenchido automaticamente.'}
                </p>
              </div>

              {androidApkInfo?.localUrls?.length ? (
                <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-gray-500">URLs locais</p>
                  <div className="mt-3 space-y-2">
                    {androidApkInfo.localUrls.slice(0, 3).map((url) => (
                      <p key={url} className="break-all rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-400">
                        {url}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
  const formatTime = (time: number) => {
    if (!isFinite(time) || Number.isNaN(time)) return '0:00';
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const getSongIndex = (song: Song | null, list: Song[]) => {
    if (!song) return -1;
    return list.findIndex((s) => s.id === song.id);
  };

  const broadcastSnapshot = (next?: Partial<PlayerSnapshot>, queueOverride?: Song[]) => {
    const snapshot: PlayerSnapshot = {
      currentSong: next?.currentSong ?? currentSong,
      isPlaying: next?.isPlaying ?? isPlaying,
      currentTime: next?.currentTime ?? currentTime,
      duration: next?.duration ?? duration,
      volume: next?.volume ?? volume,
      queue: queueOverride ?? next?.queue ?? queue,
      playbackMode: next?.playbackMode ?? playbackModeRef.current,
      showVideoInMiniPlayer: next?.showVideoInMiniPlayer ?? showVideoInMiniPlayer
    };

    channel.postMessage({ type: 'PLAYER_STATE', payload: snapshot });
  };

  const executePlaySong = async (
    song: Song,
    options?: {
      preferredMode?: PlaybackMode;
      forceReload?: boolean;
    }
  ) => {
    const preferredMode = options?.preferredMode || playbackModeRef.current;
    const forceReload = Boolean(options?.forceReload);
    const targetMode: PlaybackMode = preferredMode === 'video' && song.hasVideo ? 'video' : 'audio';
    const activeElement = targetMode === 'video' ? videoRef.current : audioRef.current;
    const inactiveElement = targetMode === 'video' ? audioRef.current : videoRef.current;

    if (!activeElement) {
      throw new Error(targetMode === 'video' ? 'Player de video indisponivel' : 'Player de audio indisponivel');
    }

    try {
      if (currentSong?.id === song.id && playbackModeRef.current === targetMode && !forceReload) {
        if (isPlaying) {
          activeElement.pause();
          setIsPlaying(false);
          setPlayerNotice('');
          broadcastSnapshot({ isPlaying: false });
          await sendDeviceState('paused', { currentSong: song });
        } else {
          await activeElement.play();
          setIsPlaying(true);
          setPlayerNotice('');
          broadcastSnapshot({ isPlaying: true });
          await sendDeviceState('playing', { currentSong: song });
        }
        return;
      }

      setPlaybackMode(targetMode);
      setCurrentSong(song);
      const playbackUrl = await getPlaybackUrl(song, targetMode);
      activeElement.volume = volume;
      inactiveElement?.pause();
      inactiveElement?.removeAttribute('src');
      inactiveElement?.load?.();

      activeElement.src = playbackUrl;
      activeElement.load();
      activeElement.currentTime = 0;
      await activeElement.play();

      setIsPlaying(true);
      setCurrentTime(0);
      setPlayerNotice('');

      broadcastSnapshot({
        currentSong: song,
        isPlaying: true,
        currentTime: 0
      });
      await sendDeviceState('playing', { currentSong: song, currentTime: 0 });
    } catch (error) {
      console.error(error);
      if (targetMode === 'audio' && !offlineSongIds.includes(song.id)) {
      setPlayerNotice('Servidor indisponível. Esta faixa não está salva offline e não pode ser reproduzida agora.');
      } else if (targetMode === 'video') {
        setPlayerNotice('Vídeo indisponível sem o backend ativo.');
      } else {
        setPlayerNotice(error instanceof Error ? error.message : 'Falha ao reproduzir faixa.');
      }
      await sendDeviceState('error', {
        currentSong: song,
        errorMessage: error instanceof Error ? error.message : 'Falha ao reproduzir faixa'
      });
      throw error;
    }
  };

  const executePlayNext = async () => {
    const idx = getSongIndex(currentSong, queue);
    if (idx >= 0 && idx < queue.length - 1) {
      await executePlaySong(queue[idx + 1]);
    }
  };

  const executePlayPrevious = async () => {
    const idx = getSongIndex(currentSong, queue);
    if (idx > 0) {
      await executePlaySong(queue[idx - 1]);
    }
  };

  const executeTogglePlay = async () => {
    const activeElement = getActiveMediaElement();

    if (!activeElement || !currentSong) {
      throw new Error('Nenhuma musica carregada para alternar reproducao');
    }

    try {
      if (isPlaying) {
        activeElement.pause();
        setIsPlaying(false);
        broadcastSnapshot({ isPlaying: false });
        await sendDeviceState('paused', { currentSong });
      } else {
        await activeElement.play();
        setIsPlaying(true);
        broadcastSnapshot({ isPlaying: true });
        await sendDeviceState('playing', { currentSong });
      }
    } catch (error) {
      console.error(error);
      await sendDeviceState('error', {
        currentSong,
        errorMessage: error instanceof Error ? error.message : 'Falha ao alternar reproducao'
      });
      throw error;
    }
  };

  const executeSeek = async (time: number) => {
    const activeElement = getActiveMediaElement();
    if (!activeElement) return;
    activeElement.currentTime = time;
    setCurrentTime(time);
    broadcastSnapshot({ currentTime: time });
    await sendDeviceState(isPlaying ? 'playing' : currentSong ? 'paused' : 'idle', {
      currentTime: time
    });
  };

  const executeSetVolume = async (nextVolume: number) => {
    if (audioRef.current) audioRef.current.volume = nextVolume;
    if (videoRef.current) videoRef.current.volume = nextVolume;
    setVolume(nextVolume);
    broadcastSnapshot({ volume: nextVolume });
    await sendDeviceState(isPlaying ? 'playing' : currentSong ? 'paused' : 'idle', {
      volume: nextVolume
    });
  };

  const sendRemoteCommand = async (payload: PlayerCommand) => {
    if (!selectedOutputDeviceId || selectedOutputDeviceId === storedDeviceId) return false;

    await api.post(`/devices/${selectedOutputDeviceId}/command`, {
      sourceDeviceId: storedDeviceId,
      sourceDeviceName: deviceName,
      userId: currentUser?.id,
      payload
    });

    return true;
  };

  const runPlayerCommand = async (payload: PlayerCommand, forceLocal = false) => {
    if (isMiniMode) {
      channel.postMessage({ type: 'COMMAND', payload });
      return;
    }

    if (!forceLocal) {
      const sentRemote = await sendRemoteCommand(payload);
      if (sentRemote) return;
    }

    switch (payload.type) {
      case 'PLAY_SONG':
        await executePlaySong(payload.song);
        break;
      case 'TOGGLE_PLAY':
        await executeTogglePlay();
        break;
      case 'SET_PLAYBACK_MODE':
        await switchCurrentPlaybackMode(payload.mode);
        break;
      case 'NEXT':
        await executePlayNext();
        break;
      case 'PREVIOUS':
        await executePlayPrevious();
        break;
      case 'SEEK':
        await executeSeek(payload.time);
        break;
      case 'SET_VOLUME':
        await executeSetVolume(payload.volume);
        break;
      default:
        break;
    }
  };

  const playSong = async (song: Song) => runPlayerCommand({ type: 'PLAY_SONG', song });
  const playSongWithMode = async (song: Song, mode: PlaybackMode) => {
    playbackModeRef.current = mode;
    setPlaybackMode(mode);
    setIsVideoPanelOpen(mode === 'video');
    if (mode !== 'video') {
      setShowVideoInMiniPlayer(false);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await executePlaySong(song, { preferredMode: mode, forceReload: true });
  };
  const playNext = async () => runPlayerCommand({ type: 'NEXT' });
  const playPrevious = async () => runPlayerCommand({ type: 'PREVIOUS' });
  const togglePlay = async () => runPlayerCommand({ type: 'TOGGLE_PLAY' });
  const showDesktopMiniPlayer = async (mode: 'compact' | 'video' = 'compact') => {
    setIsVideoTheaterOpen(false);
    if (mode === 'video') {
      setIsVideoPanelOpen(true);
      setShowVideoInMiniPlayer(true);
    } else {
      setShowVideoInMiniPlayer(false);
    }

    const shown = await desktopApi.showMiniPlayer();
    if (!shown) return false;

    await desktopApi.setMiniPlayerMode(mode);
    return true;
  };

  const toggleFavorite = async (song: Song) => {
    const res = await api.patch(`/musicas/${song.id}/favorito`, {
      favorite: !song.favorite,
      userId: currentUser?.id
    });

    const updated = res.data.music as Song;
    setSongs((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    if (currentSong?.id === updated.id) setCurrentSong(updated);
    await loadSongs(activeSection, currentUser);
  };

  const createPlaylist = async () => {
    if (!currentUser) return;
    const name = newPlaylistName.trim();
    if (!name) return;

    try {
      const res = await api.post('/playlists', {
        name,
        userId: currentUser.id
      });

      const playlist = res.data.playlist as Playlist;
      setPlaylists((prev) => [playlist, ...prev]);
      setNewPlaylistName('');
      setPlaylistMessage('Playlist criada.');
    } catch (error: any) {
      setPlaylistMessage(error?.response?.data?.error || 'Falha ao criar playlist.');
    }
  };

  const addSongToPlaylist = async (playlistId: string, song: Song) => {
    try {
      await api.post(`/playlists/${playlistId}/musicas`, {
        musicId: song.id
      });

      await loadPlaylists();
      if (activePlaylistId) {
        setActivePlaylistId(playlistId);
      }
      setPlaylistMessage(`"${song.title}" adicionada à playlist.`);
    } catch (error: any) {
      setPlaylistMessage(error?.response?.data?.error || 'Falha ao adicionar música na playlist.');
    }
  };

  const openPlaylistPicker = (song: Song) => {
    setPlaylistPickerSong(song);
    setPlaylistMessage('');
  };

  const startPlaylistRename = (playlist: Playlist) => {
    setPlaylistEditingId(playlist.id);
    setPlaylistEditingName(playlist.name);
    setPlaylistMessage('');
  };

  const submitPlaylistRename = async (playlistId: string) => {
    const name = playlistEditingName.trim();
    if (!name) return;

    try {
      await api.patch(`/playlists/${playlistId}`, { name });
      await loadPlaylists();
      await loadDiscoverPlaylists();
      setPlaylistEditingId(null);
      setPlaylistEditingName('');
      setPlaylistMessage('Playlist renomeada.');
    } catch (error: any) {
      setPlaylistMessage(error?.response?.data?.error || 'Falha ao renomear playlist.');
    }
  };

  const removeSongFromActivePlaylist = async (song: Song) => {
    if (!activePlaylist) return;

    try {
      await api.delete(`/playlists/${activePlaylist.id}/musicas/${song.id}`);
      await loadPlaylists();
      setPlaylistMessage(`"${getDisplayTitle(song)}" removida da playlist.`);
    } catch (error: any) {
      setPlaylistMessage(error?.response?.data?.error || 'Falha ao remover música da playlist.');
    }
  };

  const canDeleteSongFromPlatform = (song: Song) =>
    Boolean(currentUser?.id) && String(song.uploadedByUserId || song.ownerUserId || '') === String(currentUser?.id);

  const removeSongFromPlatform = async (song: Song) => {
    if (!currentUser || !canDeleteSongFromPlatform(song)) return;

    try {
      await api.delete(`/musicas/${song.id}`, {
        params: { userId: currentUser.id }
      });

      if (currentSong?.id === song.id) {
        audioRef.current?.pause();
        videoRef.current?.pause();
        setCurrentSong(null);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
      }

      await loadSongs(activeSection, currentUser);
      await loadPlaylists(currentUser);
      await loadDiscoverPlaylists(currentUser);
      setPlaylistMessage(`"${getDisplayTitle(song)}" removida da plataforma.`);
    } catch (error: any) {
      setPlaylistMessage(error?.response?.data?.error || 'Falha ao remover arquivo da plataforma.');
    }
  };

  const deletePlaylist = async (playlist: Playlist) => {
    try {
      await api.delete(`/playlists/${playlist.id}`);
      await loadPlaylists();
      if (activePlaylistId === playlist.id) {
        setActivePlaylistId(null);
      }
      if (youtubeTargetPlaylistId === playlist.id) {
        setYoutubeTargetPlaylistId('');
      }
      setPlaylistEditingId(null);
      setPlaylistEditingName('');
      setPlaylistMessage('Playlist removida.');
    } catch (error: any) {
      setPlaylistMessage(error?.response?.data?.error || 'Falha ao remover playlist.');
    }
  };

  const choosePlaylist = async (playlistId: string) => {
    if (!playlistPickerSong) return;
    await addSongToPlaylist(playlistId, playlistPickerSong);
    setPlaylistPickerSong(null);
  };

  const updateDesktopPreference = async (patch: Partial<DesktopPreferences>) => {
    if (!window.musfyDesktop?.updatePreferences) return;

    const nextPreferences = await window.musfyDesktop.updatePreferences(patch);
    setDesktopPreferences(nextPreferences);
    setSettingsMessage('Preferencia salva. Reinicie o app para aplicar no proximo inicio.');
  };

  const handlePreferDownloadOnLaunchChange = (enabled: boolean) => {
    setPreferDownloadOnLaunch(enabled);
    setSettingsMessage('Preferencia local salva.');
  };

  const searchYoutubeInsideApp = async (queryOverride?: string) => {
    const query = (queryOverride || youtubeSearchQuery).trim();
    if (!query || isSearchingYoutube) return;

    setIsSearchingYoutube(true);
    setYoutubeSearchMessage('Buscando no YouTube...');
    setYoutubeAnalysis(null);
    setYoutubeActionModal(null);

    try {
      const res = await api.post('/youtube/search', { query }, { timeout: 30000 });
      const results = Array.isArray(res.data?.results) ? (res.data.results as YoutubeSearchResult[]) : [];
      const playlistResults = Array.isArray(res.data?.playlists)
        ? (res.data.playlists as YoutubeSearchPlaylistResult[])
        : [];
      const source = String(res.data?.source || '');

      setYoutubeSearchResults(results);
      setYoutubePlaylistSearchResults(playlistResults);
      setYoutubeSearchSource(source);
      const resultChunks = [
        playlistResults.length > 0 ? `${playlistResults.length} playlists` : null,
        results.length > 0 ? `${results.length} faixas` : null
      ].filter(Boolean);

      setYoutubeSearchMessage(
        resultChunks.length > 0
          ? `${resultChunks.join(' • ')} encontrados${source ? ` • cache ${source}` : ''}`
          : 'Nenhum resultado encontrado para esse termo.'
      );
      await loadYoutubeRecentSearches();
    } catch (error: any) {
      const backendMessage = error?.response?.data?.error;
      const networkMessage =
        error?.message === 'Network Error'
          ? 'Falha ao falar com o backend na porta 3001. Confirme se o servico local esta rodando.'
          : null;
      setYoutubeSearchMessage(backendMessage || networkMessage || 'Falha ao buscar no YouTube.');
    } finally {
      setIsSearchingYoutube(false);
    }
  };

  const selectYoutubeSearchResult = async (result: YoutubeSearchResult) => {
    const baseSelection = {
      kind: 'track',
      title: result.title,
      subtitle: getYoutubeResultSubtitle(result)
    } satisfies YoutubeSearchSelection;

    setYoutubeSearchQuery(result.title);
    setYoutubeUrl(result.url);
    setYoutubeArtist(result.channel || '');
    setYoutubeTitle(result.title || '');
    setYoutubeAnalysis(null);
    setLastAnalyzedUrl('');
    setDownloadMessage(`Resultado selecionado: "${result.title}". Preparando ações de download...`);
    const analysis = await inspectYoutubeLink(result.url);
    if (analysis?.selectedEntry?.title) {
      setYoutubeTitle(analysis.selectedEntry.title);
    }
    if (analysis) {
      const selection = analysis.kind === 'playlist' && analysis.playlist
        ? ({
            kind: 'playlist',
            title: analysis.playlist.title || result.title,
            subtitle: `${analysis.playlist.entryCount} faixas encontradas nesta playlist`
          } satisfies YoutubeSearchSelection)
        : baseSelection;
      setYoutubeActionModal({ analysis, selection });
    }
  };

  const selectYoutubePlaylistSearchResult = async (result: YoutubeSearchPlaylistResult) => {
    const baseSelection = {
      kind: 'playlist',
      title: result.title,
      subtitle: getYoutubePlaylistSubtitle(result)
    } satisfies YoutubeSearchSelection;

    setYoutubeSearchQuery(result.title);
    setYoutubeUrl(result.url);
    setYoutubeArtist(result.channel || '');
    setYoutubeTitle(result.previewEntries?.[0]?.title || '');
    setYoutubeAnalysis(null);
    setLastAnalyzedUrl('');
    setDownloadMessage(`Playlist selecionada: "${result.title}". Carregando opções de faixa e playlist...`);
    const analysis = await inspectYoutubeLink(result.url);
    if (analysis?.selectedEntry?.title) {
      setYoutubeTitle(analysis.selectedEntry.title);
    }
    if (analysis) {
      const selection = analysis.kind === 'playlist' && analysis.playlist
        ? ({
            kind: 'playlist',
            title: analysis.playlist.title || result.title,
            subtitle: `${analysis.playlist.entryCount} faixas encontradas nesta playlist`
          } satisfies YoutubeSearchSelection)
        : baseSelection;
      setYoutubeActionModal({ analysis, selection });
    }
  };

  const inspectYoutubeLink = async (rawUrl?: string) => {
    const url = (rawUrl || youtubeUrl).trim();
    if (!url) return null;

    if (youtubeAnalysis && lastAnalyzedUrl === url) {
      return youtubeAnalysis;
    }

    setIsInspectingYoutube(true);
    setDownloadMessage('Analisando link do YouTube...');
    await loadActivityLogs().catch(console.error);

    try {
      const res = await api.post('/baixar-youtube/analisar', { url }, { timeout: 45000 });
      const analysis = (res.data?.analysis || null) as YoutubeAnalysis | null;
      setYoutubeAnalysis(analysis);
      setLastAnalyzedUrl(url);

      if (analysis?.kind === 'playlist' && analysis.playlist) {
        setDownloadMessage(
          `Playlist detectada: "${analysis.playlist.title}" com ${analysis.playlist.entryCount} faixas. Escolha no modal se quer baixar só a faixa destacada ou a playlist inteira.`
        );
      } else {
        setDownloadMessage('Link validado. Pronto para baixar a faixa.');
      }

      return analysis;
    } catch (error: any) {
      const backendMessage = error?.response?.data?.error;
      const networkMessage =
        error?.message === 'Network Error'
          ? 'Falha ao falar com o backend na porta 3001. Confirme se o servidor esta rodando.'
          : error?.code === 'ECONNABORTED'
            ? 'A análise do link demorou demais. O backend ainda pode estar consultando o YouTube.'
            : null;
      setDownloadMessage(backendMessage || networkMessage || 'Falha ao analisar o link do YouTube.');
      return null;
    } finally {
      await loadActivityLogs().catch(console.error);
      setIsInspectingYoutube(false);
    }
  };

  const buildYoutubeDownloadPayload = (mode: YoutubeDownloadMode, analysisOverride?: YoutubeAnalysis | null) => {
    const analysis = analysisOverride || youtubeAnalysis;
    const url = (analysis?.url || youtubeUrl).trim();

    if (!currentUser) {
      setDownloadMessage('Entre com um usuário antes de baixar do YouTube.');
      return null;
    }

    if (!url) return null;

    return {
      url,
      mode,
      includeVideo: youtubeIncludeVideo,
      userId: currentUser.id,
      targetPlaylistId: youtubeTargetPlaylistId || undefined,
      artist: youtubeArtist.trim() || undefined,
      title: youtubeTitle.trim() || undefined,
      label:
        analysis?.playlist?.title ||
        analysis?.selectedEntry?.title ||
        youtubeTitle.trim() ||
        youtubeSearchQuery.trim() ||
        url
    };
  };

  const executeYoutubeDownload = async (
    task: ReturnType<typeof buildYoutubeDownloadPayload>,
    resetComposer = false
  ) => {
    if (!task) return;

    setIsDownloading(true);
    setDownloadMessage(
      task.mode === 'playlist'
        ? `Baixando playlist "${task.label}" e convertendo faixas para OPUS...`
        : `Baixando faixa "${task.label}" e convertendo para OPUS...`
    );
    await loadActivityLogs().catch(console.error);

    try {
      const res = await api.post(
        '/baixar-youtube',
        {
          url: task.url,
          mode: task.mode,
          includeVideo: task.includeVideo,
          userId: task.userId,
          targetPlaylistId: task.targetPlaylistId,
          artist: task.artist,
          title: task.title
        },
        {
          timeout: 0
        }
      );

      const music = res.data?.music as Song | undefined;
      const importedPlaylist = res.data?.playlist as Playlist | undefined;
      const importedSongs = Array.isArray(res.data?.songs) ? (res.data.songs as Song[]) : [];
      const skippedEntries = Array.isArray(res.data?.skippedEntries) ? res.data.skippedEntries : [];

      await loadSongs(activeSection, currentUser);
      await loadPlaylists(currentUser);
      await loadDiscoverPlaylists(currentUser);

      if (resetComposer) {
        setYoutubeUrl('');
        setYoutubeArtist('');
        setYoutubeTitle('');
        setYoutubeIncludeVideo(false);
        setYoutubeTargetPlaylistId('');
        setYoutubeAnalysis(null);
        setYoutubeActionModal(null);
        setLastAnalyzedUrl('');
      }

      setDownloadMessage(
        importedPlaylist
          ? skippedEntries.length > 0
            ? `Playlist "${importedPlaylist.name}" importada com ${importedSongs.length} faixas. ${skippedEntries.length} itens foram ignorados.`
            : `Playlist "${importedPlaylist.name}" importada com ${importedSongs.length} faixas.`
          : music
            ? `"${getDisplayArtist(music) ? `${getDisplayArtist(music)} - ` : ''}${getDisplayTitle(music)}" entrou no Explorar e já foi favoritada para ${currentUser?.nome || 'o usuário atual'}.`
            : task.label
              ? `"${task.label}" foi baixada com sucesso.`
              : 'Download concluído com sucesso.'
      );
    } catch (error: any) {
      const backendMessage = error?.response?.data?.error;
      const networkMessage =
        error?.message === 'Network Error'
          ? 'Falha ao falar com o backend na porta 3001. Confirme se o servidor está rodando.'
          : error?.response?.data?.paused
            ? 'Download pausado. Você pode retomar pela fila de downloads.'
          : error?.code === 'ECONNABORTED'
            ? 'O download ainda está em processamento no backend. Aguarde a conversão terminar na fila ao lado.'
            : null;
      setDownloadMessage(backendMessage || networkMessage || 'Falha ao baixar áudio do YouTube.');
    } finally {
      await loadActivityLogs().catch(console.error);
      setIsDownloading(false);
    }
  };

  const startYoutubeDownload = async (mode: YoutubeDownloadMode, analysisOverride?: YoutubeAnalysis | null) => {
    const task = buildYoutubeDownloadPayload(mode, analysisOverride);
    if (!task || isDownloading) return;
    await executeYoutubeDownload(task, true);
  };

  const enqueueYoutubeDownload = async (mode: YoutubeDownloadMode, analysisOverride?: YoutubeAnalysis | null) => {
    const task = buildYoutubeDownloadPayload(mode, analysisOverride);
    if (!task) return;

    try {
      await api.post('/downloads/enqueue', task);
      await loadDownloadJobs();
      setYoutubeActionModal(null);
      setDownloadMessage(`"${task.label}" foi adicionada à fila de downloads.`);
    } catch (error: any) {
      setDownloadMessage(error?.response?.data?.error || 'Falha ao adicionar item à fila.');
    }
  };

  const pauseDownloadJob = async (jobId: string) => {
    if (activeDownloadJobActionId) return;

    setActiveDownloadJobActionId(jobId);
    try {
      await api.post(`/downloads/${jobId}/pause`);
      await loadDownloadJobs();
      setDownloadMessage('Download pausado. Ele pode ser retomado depois do ponto atual, reiniciando a etapa incompleta.');
    } catch (error: any) {
      setDownloadMessage(error?.response?.data?.error || 'Falha ao pausar download.');
    } finally {
      setActiveDownloadJobActionId(null);
    }
  };

  const resumeDownloadJob = async (jobId: string) => {
    if (activeDownloadJobActionId) return;

    setActiveDownloadJobActionId(jobId);
    try {
      await api.post(`/downloads/${jobId}/resume`);
      await loadDownloadJobs();
      setDownloadMessage('Download recolocado na fila. As partes incompletas serão iniciadas novamente.');
    } catch (error: any) {
      setDownloadMessage(error?.response?.data?.error || 'Falha ao retomar download.');
    } finally {
      setActiveDownloadJobActionId(null);
    }
  };

  const saveSongOffline = async (song: Song) => {
    if (offlineBusyIds.includes(song.id)) return;

    setOfflineBusyIds((prev) => [...prev, song.id]);
    try {
      const res = await fetch(`${api.defaults.baseURL}/download-musica/${song.id}`);
      if (!res.ok) {
        throw new Error(`Falha ao baixar faixa para offline (${res.status})`);
      }

      const blob = await res.blob();
      const record: OfflineAudioRecord = {
        songId: song.id,
        title: getDisplayTitle(song),
        mimeType: blob.type || song.audioMimeType || 'audio/ogg',
        blob,
        savedAt: new Date().toISOString()
      };

      await offlineAudioStore.setItem(getOfflineAudioKey(song.id), record);
      await loadOfflineIndex();
      if (currentSong?.id === song.id) {
        setPlayerNotice('');
      }
      setDownloadMessage(`"${getDisplayTitle(song)}" ficou disponivel para ouvir offline.`);
    } catch (error: any) {
      setDownloadMessage(error?.message || 'Falha ao salvar faixa offline.');
    } finally {
      setOfflineBusyIds((prev) => prev.filter((id) => id !== song.id));
    }
  };

  const removeSongOffline = async (song: Song) => {
    if (offlineBusyIds.includes(song.id)) return;

    setOfflineBusyIds((prev) => [...prev, song.id]);
    try {
      await offlineAudioStore.removeItem(getOfflineAudioKey(song.id));
      const isCurrentOfflineBlob =
        currentSong?.id === song.id &&
        playbackModeRef.current === 'audio' &&
        Boolean(objectUrlRef.current) &&
        Boolean(audioRef.current?.src?.startsWith('blob:'));

      if (isCurrentOfflineBlob) {
        audioRef.current?.pause();
        audioRef.current?.removeAttribute('src');
        audioRef.current?.load();
        releaseObjectUrl();
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setPlayerNotice('Cache offline removido. Esta faixa volta a depender do servidor para tocar.');
      }

      await loadOfflineIndex();
      setDownloadMessage(`Cache offline removido para "${getDisplayTitle(song)}".`);
    } catch (error: any) {
      setDownloadMessage(error?.message || 'Falha ao remover cache offline.');
    } finally {
      setOfflineBusyIds((prev) => prev.filter((id) => id !== song.id));
    }
  };

  const switchCurrentPlaybackMode = async (nextMode: PlaybackMode) => {
    if (!currentSong) {
      setPlaybackMode(nextMode);
      setIsVideoPanelOpen(nextMode === 'video');
      if (nextMode !== 'video') setShowVideoInMiniPlayer(false);
      return;
    }

    if (nextMode === 'video' && !currentSong.hasVideo) {
      setDownloadMessage('Esta faixa nao possui video salvo.');
      return;
    }

    const resumeTime = currentTime;
    const shouldResume = isPlaying;
    playbackModeRef.current = nextMode;
    setPlaybackMode(nextMode);
    setIsVideoPanelOpen(nextMode === 'video');
    if (nextMode !== 'video') setShowVideoInMiniPlayer(false);

    try {
      await executePlaySong(currentSong, { preferredMode: nextMode, forceReload: true });
      const activeElement = nextMode === 'video' ? videoRef.current : audioRef.current;
      if (activeElement) {
        activeElement.currentTime = resumeTime;
        setCurrentTime(resumeTime);
        if (!shouldResume) {
          activeElement.pause();
          setIsPlaying(false);
        }
      }
    } catch (error) {
      console.error(error);
    }
  };

  const openVideoFullscreen = async () => {
    if (!currentSong || !currentSong.hasVideo) return;
    setIsVideoPanelOpen(true);
    setIsVideoTheaterOpen((previous) => !previous);
  };

  const openVideoInMiniPlayer = async () => {
    if (!currentSong || !currentSong.hasVideo) return;

    setIsVideoTheaterOpen(false);
    setIsVideoPanelOpen(true);
    setShowVideoInMiniPlayer(true);
    playbackModeRef.current = 'video';
    setPlaybackMode('video');
    await playSongWithMode(currentSong, 'video');
    await showDesktopMiniPlayer('video');
  };

  const submitAuth = async () => {
    if (!authLogin.trim() || !authPassword.trim()) {
      setAuthMessage('Preencha login e senha.');
      return;
    }

    try {
      let user: User;

      if (authMode === 'register') {
        const registerRes = await api.post('/auth/register', {
          nome: authLogin,
          email: authLogin,
          senha: authPassword
        });

        user = registerRes.data.usuario as User;
        setAuthMessage('Usuário criado com sucesso.');
      } else {
        const loginRes = await api.post('/auth/login', {
          email: authLogin,
          senha: authPassword
        });

        user = loginRes.data.usuario as User;
        setAuthMessage(`Sessão iniciada como ${user.nome}.`);
      }

      persistCurrentUser(user);
      setAuthLogin('');
      setAuthPassword('');
      setActiveSection('library');
      await loadSongs('library', user);
    } catch (error: any) {
      setAuthMessage(error?.response?.data?.error || 'Falha ao autenticar usuário.');
    }
  };

  const logout = async () => {
    persistCurrentUser(null);
    setSongs([]);
    setCurrentSong(null);
    setIsPlaying(false);
    setAuthMessage('Sessão encerrada.');
    setActiveSection('explore');
    await loadSongs('explore', null);
  };

  useEffect(() => {
    if (isMiniMode) return;
    if (audioRef.current) audioRef.current.volume = volume;
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume, isMiniMode]);

  useEffect(() => {
    broadcastSnapshot({}, queue);
  }, [songs, searchTerm, activeSection]);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'PLAYER_STATE' && isMiniMode) {
        const payload = data.payload as PlayerSnapshot;
        setCurrentSong(payload.currentSong);
        setIsPlaying(payload.isPlaying);
        setCurrentTime(payload.currentTime);
        setDuration(payload.duration);
        setVolume(payload.volume);
        setSongs(payload.queue || []);
        playbackModeRef.current = payload.playbackMode || 'audio';
        setPlaybackMode(payload.playbackMode || 'audio');
        setShowVideoInMiniPlayer(Boolean(payload.showVideoInMiniPlayer));
      }

      if (data.type === 'COMMAND' && !isMiniMode) {
        const command = data.payload as PlayerCommand;
        await runPlayerCommand(command);
      }

      if (data.type === 'REQUEST_STATE' && !isMiniMode) {
        broadcastSnapshot({}, queue);
      }
    };

    channel.addEventListener('message', onMessage);

    if (isMiniMode) {
      channel.postMessage({ type: 'REQUEST_STATE' });
    }

    return () => channel.removeEventListener('message', onMessage);
  }, [isMiniMode, currentSong, isPlaying, currentTime, duration, volume, queue, selectedOutputDeviceId]);

  const isMiniVideoMode = showVideoInMiniPlayer && playbackMode === 'video' && currentSong?.hasVideo;

  useEffect(() => {
    if (!isMiniMode) return;

    const element = videoRef.current;
    if (!element) return;

    if (!isMiniVideoMode || !currentSong?.hasVideo) {
      element.pause();
      element.removeAttribute('src');
      element.load();
      return;
    }

    const nextSrc = `${api.defaults.baseURL}/reproduzir-video/${currentSong.id}`;
    const currentSrc = element.currentSrc || element.src || '';
    element.defaultMuted = true;
    element.muted = true;
    element.volume = 0;

    if (!currentSrc.includes(`/reproduzir-video/${currentSong.id}`)) {
      element.src = nextSrc;
      element.load();
    }

    const syncCurrentTime = () => {
      const nextTime = currentTime || 0;
      if (Math.abs((element.currentTime || 0) - nextTime) > 0.75) {
        try {
          element.currentTime = nextTime;
        } catch {
          // Ignore seek errors while metadata is still loading in the mirrored mini-player video.
        }
      }
    };

    syncCurrentTime();

    if (isPlaying) {
      element.play().then(syncCurrentTime).catch(console.error);
      return;
    }

    element.pause();
  }, [isMiniMode, isMiniVideoMode, currentSong?.id, currentSong?.hasVideo, currentTime, isPlaying]);

  const miniVideoLayout = (
    <div className="h-screen bg-transparent p-2 text-white">
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-[#121212] to-[#0a0a0a] shadow-2xl"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{getDisplayTitle(currentSong) || 'Nenhum video'}</p>
            <p className="truncate text-xs text-gray-400">{getSongSubtitle(currentSong)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button onClick={() => void desktopApi.showMain()} className="rounded-xl bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
              Abrir
            </button>
            <button onClick={() => void desktopApi.closeMiniPlayer()} className="rounded-xl p-2 hover:bg-white/10">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 bg-black" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <video
            ref={videoRef}
            preload="metadata"
            playsInline
            muted
            poster={currentSong?.thumbnail || undefined}
            className="h-full w-full object-contain"
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>

        <div className="border-t border-white/10 px-4 py-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <button onClick={playPrevious} className="flex h-9 w-9 items-center justify-center rounded-full text-gray-300 hover:bg-white/10">
                <SkipBack size={16} />
              </button>
              <button onClick={togglePlay} className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-lg">
                {isPlaying ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
              </button>
              <button onClick={playNext} className="flex h-9 w-9 items-center justify-center rounded-full text-gray-300 hover:bg-white/10">
                <SkipForward size={16} />
              </button>
            </div>
            <button
              onClick={() => void runPlayerCommand({ type: 'SET_PLAYBACK_MODE', mode: 'audio' })}
              className="ml-auto rounded-xl border border-white/10 px-3 py-2 text-xs hover:bg-white/10"
            >
              Ouvir audio
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <span className="w-12 text-right text-[11px] text-gray-500">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={(e) =>
                channel.postMessage({
                  type: 'COMMAND',
                  payload: { type: 'SEEK', time: Number(e.target.value) }
                })
              }
              className="min-w-0 flex-1 accent-green-500"
            />
            <span className="w-12 text-[11px] text-gray-500">{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );

  const miniLayout = isMiniVideoMode ? miniVideoLayout : (
    <div className="h-screen bg-transparent p-2 text-white">
      <div
        className="grid h-full w-full grid-cols-[minmax(0,1.7fr)_auto_auto] items-center gap-4 rounded-[28px] border border-white/10 bg-gradient-to-br from-[#121212] to-[#0a0a0a] px-4 shadow-2xl"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex min-w-0 items-center gap-4">
          <div className="h-16 w-16 overflow-hidden rounded-2xl bg-[#1b1b1b] shadow-inner">
            {currentSong?.thumbnail ? (
              <img src={currentSong.thumbnail} alt={currentSong.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Music size={22} className="text-gray-600" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{getDisplayTitle(currentSong) || 'Nenhuma música'}</p>
            <p className="truncate text-xs text-gray-400">{getSongSubtitle(currentSong)}</p>

            <div className="mt-2 flex items-center gap-2">
              <span className="w-8 text-[10px] text-gray-500">{formatTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={(e) =>
                  channel.postMessage({
                    type: 'COMMAND',
                    payload: { type: 'SEEK', time: Number(e.target.value) }
                  })
                }
                className="min-w-0 flex-1 accent-green-500"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              />
              <span className="w-8 text-[10px] text-gray-500">{formatTime(duration)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={playPrevious} className="flex h-9 w-9 items-center justify-center rounded-full text-gray-300 hover:bg-white/10">
            <SkipBack size={16} />
          </button>
          <button onClick={togglePlay} className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-lg">
            {isPlaying ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
          </button>
          <button onClick={playNext} className="flex h-9 w-9 items-center justify-center rounded-full text-gray-300 hover:bg-white/10">
            <SkipForward size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Volume2 size={15} className="text-gray-400" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) =>
              channel.postMessage({
                type: 'COMMAND',
                payload: { type: 'SET_VOLUME', volume: Number(e.target.value) }
              })
            }
            className="w-24 accent-green-500"
          />
          <button onClick={() => void desktopApi.showMain()} className="rounded-xl bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
            Abrir
          </button>
          <button onClick={() => void desktopApi.closeMiniPlayer()} className="rounded-xl p-2 hover:bg-white/10">
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );

  if (isMiniMode) return miniLayout;

  if (!currentUser) {
    return (
      <div className="flex h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,#103322_0%,#050505_45%,#020202_100%)] px-6 text-white">
        <div className="grid w-full max-w-5xl grid-cols-[1.1fr_0.9fr] overflow-hidden rounded-[36px] border border-white/10 bg-black/60 shadow-[0_30px_120px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
          <div className="flex flex-col justify-between border-r border-white/10 bg-[linear-gradient(180deg,rgba(9,30,20,0.92)_0%,rgba(5,5,5,0.92)_100%)] p-10">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-green-400/80">MusFy Desktop</p>
              <h1 className="mt-5 text-6xl font-black tracking-tight">Sua musica, sua casa.</h1>
              <p className="mt-5 max-w-xl text-lg leading-8 text-gray-300">
                Entre com login e senha para abrir a biblioteca do seu usuario, baixar links do YouTube e manter tudo separado por perfil.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {[
                ['Perfis', 'Bibliotecas separadas por usuário'],
                ['Busca', 'Pesquisa por música e artista'],
                ['Download', 'YouTube direto para o backend']
              ].map(([title, text]) => (
                <div key={title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="font-semibold">{title}</p>
                  <p className="mt-2 text-sm text-gray-400">{text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center p-10">
            <div className="w-full max-w-md rounded-[32px] border border-white/10 bg-[#0b0b0b] p-8">
              <div className="mb-8">
                <h2 className="text-3xl font-black">{authMode === 'login' ? 'Entrar' : 'Criar usuario'}</h2>
                <p className="mt-2 text-sm text-gray-400">
                  Use apenas login e senha. Sem email, sem complicação.
                </p>
              </div>

              <div className="space-y-4">
                <input
                  value={authLogin}
                  onChange={(e) => setAuthLogin(e.target.value)}
                  placeholder="Login"
                  className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm outline-none focus:border-green-500/40"
                />

                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitAuth();
                  }}
                  placeholder="Senha"
                  className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm outline-none focus:border-green-500/40"
                />

                <button
                  onClick={() => void submitAuth()}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-green-500 font-semibold text-black"
                >
                  {authMode === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />}
                  {authMode === 'login' ? 'Entrar' : 'Cadastrar'}
                </button>

                <button
                  onClick={() => setAuthMode((prev) => (prev === 'login' ? 'register' : 'login'))}
                  className="w-full text-sm text-gray-400 hover:text-white"
                >
                  {authMode === 'login'
                    ? 'Primeira vez? Criar novo usuário'
                    : 'Já possui usuário? Entrar'}
                </button>

                {authMessage ? <p className="text-sm text-gray-400">{authMessage}</p> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sidebarItems = [
    { id: 'home' as Section, label: 'Início', icon: Home },
    { id: 'explore' as Section, label: 'Explorar', icon: Compass },
    { id: 'library' as Section, label: 'Sua Biblioteca', icon: Library },
    { id: 'favorites' as Section, label: 'Favoritas', icon: Heart },
    { id: 'download' as Section, label: 'Baixar do YouTube', icon: Download }
  ];

  const handleMediaTimeUpdate = (element: HTMLMediaElement | null) => {
    if (!element) return;
    const nextTime = element.currentTime || 0;
    const nextDuration = element.duration || 0;
    setCurrentTime(nextTime);
    setDuration(nextDuration);
    broadcastSnapshot({ currentTime: nextTime, duration: nextDuration });
  };

  const handleMediaLoadedMetadata = (element: HTMLMediaElement | null) => {
    if (!element) return;
    const nextDuration = element.duration || 0;
    setDuration(nextDuration);
    broadcastSnapshot({ duration: nextDuration });
  };

  return (
    <div className="h-screen overflow-hidden bg-[#050505] text-white">
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={() => handleMediaTimeUpdate(audioRef.current)}
        onLoadedMetadata={() => handleMediaLoadedMetadata(audioRef.current)}
        onPause={() => {
          if (playbackModeRef.current === 'audio') {
            setIsPlaying(false);
            broadcastSnapshot({ isPlaying: false });
          }
        }}
        onPlay={() => {
          if (playbackModeRef.current === 'audio') {
            setIsPlaying(true);
            broadcastSnapshot({ isPlaying: true });
          }
        }}
        onError={() => {
          if (playbackModeRef.current === 'audio') {
            setDownloadMessage('Falha ao reproduzir audio desta faixa.');
          }
        }}
        onEnded={() => {
          void playNext();
        }}
      />

      <div className="flex h-full min-h-0">
        <aside className="hidden h-full w-80 flex-col overflow-y-auto border-r border-white/5 bg-[linear-gradient(180deg,#070707_0%,#0d0d0d_100%)] lg:flex">
          <div className="px-7 pb-6 pt-7">
            <h1 className="bg-gradient-to-r from-green-400 via-emerald-300 to-teal-500 bg-clip-text text-4xl font-black tracking-tight text-transparent">
              MUSFY
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Sua sessão, sua biblioteca, seu player.
            </p>
          </div>

          <div className="px-4">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-3">
              {sidebarItems.map((item) => {
                const active = activeSection === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActivePlaylistId(null);
                      setActiveDiscoverPlaylistId(null);
                      setActiveSection(item.id);
                    }}
                    className={`mb-1 flex w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition ${
                      active
                        ? 'bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.12)]'
                        : 'text-gray-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <item.icon size={19} />
                    <span className="font-medium">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="px-4 pt-4">
            <div className="rounded-[28px] border border-white/10 bg-[#0f0f0f] p-4">
              <div className="mb-3 flex items-center gap-3">
                <Sparkles size={18} className="text-green-400" />
                <span className="font-semibold">Usuário ativo</span>
              </div>
              <div className="space-y-3">
                <div className="rounded-2xl bg-white/[0.04] p-4">
                  <p className="font-semibold text-white">{currentUser.nome}</p>
                  <p className="text-sm text-gray-400">@{currentUser.login || currentUser.nome}</p>
                </div>
                <button
                  onClick={() => void logout()}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-medium hover:bg-white/[0.07]"
                >
                  <LogOut size={16} />
                  Trocar usuário
                </button>
              </div>
            </div>
          </div>

          <div className="px-4 pt-4">
            <div className="rounded-[28px] border border-white/10 bg-[#0f0f0f] p-4">
              <div className="mb-3 flex items-center gap-3">
                <Library size={18} className="text-green-400" />
                <span className="font-semibold">Playlists</span>
              </div>

                  <div className="mb-3 flex gap-2">
                <input
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createPlaylist();
                  }}
                  placeholder="Nova playlist"
                  className="h-10 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm outline-none"
                />
                <button
                  onClick={() => void createPlaylist()}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl bg-green-500 text-black"
                >
                  <Plus size={16} />
                </button>
              </div>

              <div className="space-y-2">
                {playlists.map((playlist) => {
                  const active = activePlaylistId === playlist.id;

                  return (
                    <div
                      key={playlist.id}
                      className={`rounded-2xl border px-3 py-2 ${
                        active ? 'border-white/20 bg-white text-black' : 'border-white/5 bg-white/[0.04] text-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setActiveDiscoverPlaylistId(null);
                            setActivePlaylistId(playlist.id);
                            setActiveSection('library');
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          {playlistEditingId === playlist.id ? (
                            <input
                              autoFocus
                              value={playlistEditingName}
                              onChange={(e) => setPlaylistEditingName(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void submitPlaylistRename(playlist.id);
                                if (e.key === 'Escape') {
                                  setPlaylistEditingId(null);
                                  setPlaylistEditingName('');
                                }
                              }}
                              className="h-9 w-full rounded-xl border border-black/10 bg-black/10 px-3 text-sm outline-none"
                            />
                          ) : (
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate">{playlist.name}</span>
                              <span className={`text-xs ${active ? 'text-black/70' : 'text-gray-500'}`}>
                                {(playlist.songs || []).length}
                              </span>
                            </div>
                          )}
                        </button>

                        <div className="flex items-center gap-1">
                          {playlistEditingId === playlist.id ? (
                            <>
                              <button
                                onClick={() => void submitPlaylistRename(playlist.id)}
                                className={`rounded-xl p-2 ${active ? 'hover:bg-black/10' : 'hover:bg-white/10'}`}
                                title="Salvar nome"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                onClick={() => {
                                  setPlaylistEditingId(null);
                                  setPlaylistEditingName('');
                                }}
                                className={`rounded-xl p-2 ${active ? 'hover:bg-black/10' : 'hover:bg-white/10'}`}
                                title="Cancelar edicao"
                              >
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startPlaylistRename(playlist)}
                                className={`rounded-xl p-2 ${active ? 'hover:bg-black/10' : 'hover:bg-white/10'}`}
                                title="Renomear playlist"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                onClick={() => void deletePlaylist(playlist)}
                                className={`rounded-xl p-2 ${active ? 'hover:bg-black/10' : 'hover:bg-white/10'}`}
                                title="Excluir playlist"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {playlistMessage ? <p className="mt-3 text-sm text-gray-400">{playlistMessage}</p> : null}
            </div>
          </div>

          <div className="mt-auto px-4 pt-4">
            <button
              onClick={() => {
                setActivePlaylistId(null);
                setActiveDiscoverPlaylistId(null);
                setActiveSection('settings');
              }}
              className={`flex w-full items-center gap-4 rounded-[24px] border px-4 py-4 text-left transition ${
                activeSection === 'settings'
                  ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-50 shadow-[0_16px_40px_rgba(34,211,238,0.12)]'
                  : 'border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/15 hover:bg-white/[0.05] hover:text-white'
              }`}
            >
              <Settings2 size={18} />
              <div>
                <p className="font-semibold">Configurações</p>
                <p className="mt-1 text-xs text-inherit/70">Desktop, servidor local e atualização</p>
              </div>
            </button>
          </div>

          <div className="px-4 pb-32 pt-4">
            <div className="rounded-[28px] border border-white/10 bg-gradient-to-br from-white/[0.06] to-transparent p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Sessão</p>
              <p className="mt-2 text-lg font-semibold">
                {currentUser ? `Biblioteca de ${currentUser.nome}` : 'Modo exploração'}
              </p>
              <p className="mt-2 text-sm text-gray-400">
                {currentUser
                  ? 'Seções e músicas agora respeitam o usuário conectado.'
                  : 'Entre para separar biblioteca, favoritos e downloads por usuário.'}
              </p>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div
            className="h-8 border-b border-white/5 bg-black/60"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          />
          <header className="border-b border-white/5 bg-black/50 px-8 py-6 backdrop-blur-2xl">
            <div className="flex items-start justify-between gap-6">
              <div className="flex flex-1 flex-col gap-4">
                <div className="relative max-w-xl">
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={
                      activeSection === 'download'
                        ? 'Busque na biblioteca enquanto baixa novas musicas...'
                        : 'Busque por musica, artista ou playlist...'
                    }
                    className="h-12 w-full rounded-full border border-white/10 bg-[#101010] pl-12 pr-4 text-sm outline-none focus:border-white/20"
                  />
                </div>
                {activeSection === 'settings' ? (
                  <p className="text-sm text-gray-400">
                    Ajuste inicializacao, bandeja, servidor local e distribuicao do APK sem baguncar o layout principal.
                  </p>
                ) : activeSection === 'download' ? (
                  <p className="text-sm text-gray-400">
                    Busque dentro do próprio MusFy, abra o modal de ação e escolha entre baixar faixa única ou playlist inteira.
                  </p>
                ) : activeSection === 'explore' ? (
                  <p className="text-sm text-gray-400">
                    Aqui entram playlists publicas de outros usuarios. As suas continuam no Inicio.
                  </p>
                ) : activeSection === 'home' ? (
                  <p className="text-sm text-gray-400">
                    Sua home agora organiza sua colecao por playlist, como uma vitrine pessoal.
                  </p>
                ) : null}
              </div>

              <div className="relative z-20 flex items-center gap-3 pointer-events-auto">
                {activeSection !== 'download' && activeSection !== 'home' && activeSection !== 'explore' ? (
                  <div className="flex items-center rounded-full border border-white/10 bg-[#101010] p-1">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`flex h-11 w-11 items-center justify-center rounded-full ${
                        viewMode === 'grid' ? 'bg-white text-black' : 'text-gray-300'
                      }`}
                    >
                      <LayoutGrid size={18} />
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`flex h-11 w-11 items-center justify-center rounded-full ${
                        viewMode === 'list' ? 'bg-white text-black' : 'text-gray-300'
                      }`}
                    >
                      <List size={18} />
                    </button>
                  </div>
                ) : null}

                <button
                  onClick={() =>
                    void showDesktopMiniPlayer(
                      currentSong?.hasVideo && playbackMode === 'video' ? 'video' : 'compact'
                    )
                  }
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  className="flex h-12 items-center gap-2 rounded-full border border-white/10 bg-[#101010] px-4 hover:bg-white/5"
                >
                  <MonitorSpeaker size={16} />
                  Mini Player
                </button>

                <button
                  onClick={() => void desktopApi.minimizeToTray()}
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  className="flex h-12 items-center gap-2 rounded-full border border-white/10 bg-[#101010] px-4 hover:bg-white/5"
                >
                  <Minimize2 size={16} />
                  Bandeja
                </button>

                <button
                  onClick={() => void desktopApi.quitApp()}
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  className="flex h-12 items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-4 text-red-100 hover:bg-red-500/20"
                >
                  <LogOut size={16} />
                  Sair
                </button>
              </div>
            </div>
          </header>

          <section className="min-h-0 flex-1 overflow-y-auto px-8 py-8 pb-44">
            {!isPlaylistDetailView ? (
              <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                <h2 className="mb-3 text-5xl font-black tracking-tight">{heroTitle}</h2>
                <p className="text-gray-400">{heroDescription}</p>
              </motion.div>
            ) : null}

            {activeSection === 'settings' ? (
              settingsContent
            ) : activeSection === 'download' ? (
              <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,380px)]">
                <div className="min-w-0 rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.14),transparent_45%),linear-gradient(180deg,#101010_0%,#0a0a0a_100%)] p-6">
                  <div className="max-w-2xl">
                    <div className="mb-4 inline-flex rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-green-300">
                      Downloader
                    </div>
                    <h3 className="text-3xl font-black tracking-tight">Encontre no YouTube e publique no catálogo</h3>
                    <p className="mt-3 text-sm leading-6 text-gray-400">
                      O MusFy consulta o YouTube dentro do app, agrupa faixas e playlists e deixa tudo pronto para baixar sem sair da tela.
                    </p>
                  </div>

                  <div className="mt-8 rounded-[28px] border border-cyan-400/20 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_40%),rgba(0,0,0,0.28)] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Busca integrada</p>
                        <h4 className="mt-2 text-2xl font-black tracking-tight text-white">Encontre sem sair do MusFy</h4>
                        <p className="mt-2 max-w-xl text-sm leading-6 text-gray-300">
                          Digite artista, música, live, acoustic ou remix. O MusFy consulta o YouTube, mostra faixas e playlists e você escolhe exatamente o que vai baixar.
                        </p>
                      </div>
                      <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
                        Cache inteligente
                      </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 lg:flex-row">
                      <div className="relative flex-1">
                        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-cyan-200/70" />
                        <input
                          value={youtubeSearchQuery}
                          onChange={(e) => setYoutubeSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void searchYoutubeInsideApp();
                          }}
                          placeholder="Busque por artista, faixa, versao, set, podcast..."
                          className="h-14 w-full rounded-2xl border border-cyan-300/15 bg-[#071116] pl-11 pr-4 text-sm text-white outline-none focus:border-cyan-300/40"
                        />
                      </div>
                      <button
                        onClick={() => void searchYoutubeInsideApp()}
                        disabled={isSearchingYoutube || youtubeSearchQuery.trim().length < 2}
                        className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-6 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isSearchingYoutube ? <LoaderCircle size={18} className="animate-spin" /> : <Search size={18} />}
                        {isSearchingYoutube ? 'Buscando...' : 'Buscar no YouTube'}
                      </button>
                    </div>

                    {youtubeSearchMessage ? (
                      <p className="mt-3 text-sm text-cyan-50/80">
                        {youtubeSearchMessage}
                        {youtubeSearchSource ? <span className="ml-2 text-cyan-200/60">[{youtubeSearchSource}]</span> : null}
                      </p>
                    ) : null}

                    {youtubeRecentSearches.length > 0 ? (
                      <div className="mt-5">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gray-500">Buscas recentes</p>
                          <p className="text-[11px] text-gray-500">SQLite local</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {youtubeRecentSearches.map((entry) => (
                            <button
                              key={`${entry.query}-${entry.lastSearchedAt}`}
                              onClick={() => {
                                setYoutubeSearchQuery(entry.query);
                                void searchYoutubeInsideApp(entry.query);
                              }}
                              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-gray-300 transition hover:border-cyan-400/30 hover:bg-cyan-400/10 hover:text-white"
                            >
                              {entry.query}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {youtubePlaylistSearchResults.length > 0 ? (
                      <div className="mt-6">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Playlists agrupadas</p>
                            <p className="mt-1 text-sm text-gray-400">Clique em uma playlist para abrir um modal com as quatro ações de faixa e playlist.</p>
                          </div>
                          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] text-cyan-100">
                            {youtubePlaylistSearchResults.length} playlists
                          </span>
                        </div>

                        <div className="pr-2">
                          <div className="grid gap-4 xl:grid-cols-2">
                          {youtubePlaylistSearchResults.map((result) => (
                            <button
                              key={`${result.id}-${result.url}`}
                              onClick={() => void selectYoutubePlaylistSearchResult(result)}
                              className="group overflow-hidden rounded-[26px] border border-cyan-400/15 bg-[#071116] text-left transition hover:border-cyan-300/35 hover:bg-[#0b151b]"
                            >
                              <div className="relative aspect-[16/9] overflow-hidden bg-black">
                                {result.thumbnail ? (
                                  <img
                                    src={result.thumbnail}
                                    alt={result.title}
                                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center bg-gradient-to-br from-cyan-500/20 to-transparent text-cyan-100">
                                    <List size={28} />
                                  </div>
                                )}
                                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 pb-3 pt-8 text-xs">
                                  <span className="rounded-full border border-white/10 bg-black/40 px-2 py-1 text-white/80">
                                    Playlist #{result.position || 0}
                                  </span>
                                  {result.entryCount ? (
                                    <span className="rounded-full border border-white/10 bg-black/40 px-2 py-1 text-white/80">
                                      {result.entryCount} faixas
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              <div className="p-4">
                                <p className="line-clamp-2 text-base font-semibold text-white">{result.title}</p>
                                <p className="mt-2 text-xs text-gray-400">
                                  {getYoutubePlaylistSubtitle(result) || 'Playlist pronta para faixa ou importação completa'}
                                </p>

                                {result.previewEntries?.length ? (
                                  <div className="mt-4 space-y-2">
                                    {result.previewEntries.slice(0, 3).map((entry, index) => (
                                      <div
                                        key={`${entry.url}-${index}`}
                                        className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2 text-xs"
                                      >
                                        <span className="truncate text-gray-200">{entry.title}</span>
                                        <span className="ml-3 text-gray-500">#{index + 1}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}

                                <div className="mt-4 flex items-center justify-between text-xs">
                                  <span className="text-cyan-200/80">Abrir faixa e playlist</span>
                                  <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-cyan-100">4 ações</span>
                                </div>
                              </div>
                            </button>
                          ))}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {youtubeSearchResults.length > 0 ? (
                      <div className="mt-6">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">Faixas encontradas</p>
                            <p className="mt-1 text-sm text-gray-400">Clique em uma faixa para abrir as ações de download ou fila.</p>
                          </div>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-gray-300">
                            {youtubeSearchResults.length} faixas
                          </span>
                        </div>

                        <div className="pr-2">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {youtubeSearchResults.map((result) => (
                          <button
                            key={`${result.id}-${result.url}`}
                            onClick={() => void selectYoutubeSearchResult(result)}
                            className="group overflow-hidden rounded-[24px] border border-white/10 bg-[#081015] text-left transition hover:border-cyan-300/30 hover:bg-[#0b151b]"
                          >
                            <div className="relative aspect-video overflow-hidden bg-black">
                              {result.thumbnail ? (
                                <img
                                  src={result.thumbnail}
                                  alt={result.title}
                                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center bg-gradient-to-br from-cyan-500/20 to-transparent text-cyan-100">
                                  <Video size={26} />
                                </div>
                              )}
                              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 pb-3 pt-8 text-xs">
                                <span className="rounded-full border border-white/10 bg-black/40 px-2 py-1 text-white/80">
                                  #{result.position || 0}
                                </span>
                                {result.duration ? (
                                  <span className="rounded-full border border-white/10 bg-black/40 px-2 py-1 text-white/80">
                                    {result.duration}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="p-4">
                              <p className="line-clamp-2 text-sm font-semibold text-white">{result.title}</p>
                              <p className="mt-2 text-xs text-gray-400">{getYoutubeResultSubtitle(result) || 'Resultado pronto para download'}</p>
                              <div className="mt-4 flex items-center justify-between text-xs">
                                <span className="text-cyan-200/80">Abrir ações</span>
                                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-cyan-100">faixa</span>
                              </div>
                            </div>
                          </button>
                        ))}
                        </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => setShowActivityPanel((prev) => !prev)}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-gray-300 hover:bg-white/[0.08]"
                    >
                      {showActivityPanel ? 'Ocultar atividade' : 'Ver atividade'}
                    </button>
                    <span className="text-xs text-gray-500">
                      {isDownloading
                        ? 'Logs atualizados em tempo real durante download e conversão.'
                        : 'Abra o painel para acompanhar análise, fila, playlist e avisos do backend.'}
                    </span>
                  </div>

                  {downloadMessage ? <p className="mt-4 text-sm leading-6 text-gray-300">{downloadMessage}</p> : null}
                </div>

                <div className="min-w-0 xl:sticky xl:top-6">
                  <div className="rounded-[32px] border border-white/10 bg-[#0d0d0d] p-6">
                    <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Destino</p>

                    <div className="mt-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Fila de downloads</p>
                        <p className="mt-1 text-sm text-gray-300">Acompanhe audio, video e itens da playlist em tempo real.</p>
                      </div>
                      <button
                        onClick={() => void loadDownloadJobs()}
                        className="rounded-full border border-white/10 px-3 py-2 text-xs text-gray-300 hover:bg-white/5"
                      >
                        Atualizar
                      </button>
                    </div>

                    <div className="mt-4 max-h-[44vh] space-y-3 overflow-y-auto pr-1">
                      {downloadJobs.length === 0 ? (
                        <p className="text-sm text-gray-500">Nenhum download recente.</p>
                      ) : (
                        downloadJobs.slice(0, 6).map((job) => (
                          <div key={job.id} className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-white">
                                  {job.message || (job.mode === 'playlist' ? 'Playlist em processamento' : 'Faixa em processamento')}
                                </p>
                                <p className="mt-1 text-xs text-gray-500">
                                  {job.mode === 'playlist' ? 'Playlist' : 'Faixa unica'}
                                  {job.includeVideo ? ' • áudio + vídeo' : ' • áudio'}
                                  {job.updatedAt ? ` • ${new Date(job.updatedAt).toLocaleTimeString('pt-BR')}` : ''}
                                </p>
                              </div>
                              <span
                                className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${
                                  job.status === 'completed'
                                    ? 'bg-green-500/15 text-green-200'
                                    : job.status === 'paused'
                                      ? 'bg-amber-500/15 text-amber-100'
                                      : job.status === 'queued'
                                        ? 'bg-white/10 text-gray-200'
                                    : job.status === 'error'
                                      ? 'bg-red-500/15 text-red-200'
                                      : 'bg-cyan-500/15 text-cyan-100'
                                }`}
                              >
                                {getDownloadJobStatusLabel(job.status)}
                              </span>
                            </div>

                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  job.status === 'error'
                                    ? 'bg-red-400'
                                    : job.status === 'paused'
                                      ? 'bg-amber-300'
                                      : 'bg-gradient-to-r from-green-400 to-cyan-400'
                                }`}
                                style={{ width: `${Math.max(4, Math.min(100, Number(job.progress || 0)))}%` }}
                              />
                            </div>

                            <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                              <span>{job.stage}</span>
                              <span>{Math.round(Number(job.progress || 0))}%</span>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              {job.status === 'running' || job.status === 'queued' ? (
                                <button
                                  onClick={() => void pauseDownloadJob(job.id)}
                                  disabled={activeDownloadJobActionId === job.id}
                                  className="rounded-full border border-white/10 px-3 py-2 text-xs text-gray-200 hover:bg-white/5 disabled:opacity-50"
                                >
                                  {activeDownloadJobActionId === job.id ? 'Pausando...' : 'Pausar'}
                                </button>
                              ) : null}
                              {job.status === 'paused' || job.status === 'error' ? (
                                <button
                                  onClick={() => void resumeDownloadJob(job.id)}
                                  disabled={activeDownloadJobActionId === job.id}
                                  className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-400/15 disabled:opacity-50"
                                >
                                  {activeDownloadJobActionId === job.id ? 'Retomando...' : 'Retomar'}
                                </button>
                              ) : null}
                            </div>

                            {job.items?.length ? (
                              <div className="mt-3 grid gap-2">
                                {job.items.slice(0, 4).map((item) => (
                                  <div key={`${job.id}-${item.index}`} className="rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2">
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="truncate text-xs text-gray-200">{item.title}</span>
                                      <span className="text-[10px] text-gray-500">{Math.round(item.progress || 0)}%</span>
                                    </div>
                                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                                      <div
                                        className={`h-full rounded-full ${
                                          item.status === 'error'
                                            ? 'bg-red-400'
                                            : item.status === 'paused'
                                              ? 'bg-amber-300'
                                            : item.status === 'completed'
                                              ? 'bg-green-400'
                                              : 'bg-cyan-400'
                                        }`}
                                        style={{ width: `${Math.max(3, Math.min(100, Number(item.progress || 0)))}%` }}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                    <div className="mt-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-sm text-gray-400">Usuario atual</p>
                      <p className="mt-2 text-2xl font-bold text-white">{currentUser?.nome || 'Nenhum usuario conectado'}</p>
                      <p className="mt-2 text-sm text-gray-400">
                        {currentUser
                          ? 'A faixa entra no Explorar e fica favoritada para este usuario. Se for playlist, o MusFy tambem cria uma playlist local automaticamente.'
                          : 'Entre com um usuario antes de enviar downloads.'}
                      </p>
                    </div>

                    <div className="mt-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Performance</p>
                      <div className="mt-3 space-y-3 text-sm text-gray-300">
                        <p>Baixa a melhor trilha de audio disponivel e prioriza OPUS/WebM quando possivel.</p>
                        <p>Playlists usam importacao paralela para acelerar o throughput sem travar a interface.</p>
                        <p>Logs mostram analise, download, conversao e faixas ignoradas.</p>
                      </div>
                    </div>
                  </div>
                </div>
                </div>
            ) : activeSection === 'home' && !activePlaylist ? (
              homePlaylists.length === 0 ? (
                <div className="flex h-[50vh] flex-col items-center justify-center text-center text-gray-500">
                  <Library size={60} className="mb-4 opacity-30" />
                  <p className="text-2xl font-bold text-gray-200">Nenhuma playlist criada</p>
                  <p className="mt-2 max-w-md text-sm text-gray-500">
                    Crie playlists na sidebar e use o Inicio como sua vitrine pessoal.
                  </p>
                </div>
              ) : (
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {homePlaylists.map((playlist) => {
                    const cover = playlist.songs?.[0]?.thumbnail || null;
                    return (
                      <button
                        key={playlist.id}
                        onClick={() => {
                          setActiveDiscoverPlaylistId(null);
                          setActivePlaylistId(playlist.id);
                          setActiveSection('library');
                        }}
                        className="group overflow-hidden rounded-[32px] border border-white/10 bg-[#101010] text-left transition hover:border-white/20 hover:bg-[#151515]"
                      >
                        <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-green-500/20 via-white/5 to-transparent">
                          {cover ? (
                            <img src={cover} alt={playlist.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-gray-600">
                              <Library size={46} />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
                          <div className="absolute bottom-4 left-4 right-4">
                            <p className="text-xs uppercase tracking-[0.22em] text-gray-300">Sua playlist</p>
                            <h3 className="mt-2 truncate text-2xl font-black text-white">{playlist.name}</h3>
                          </div>
                        </div>
                        <div className="flex items-center justify-between px-5 py-4 text-sm text-gray-400">
                          <span>{(playlist.songs || []).length} faixas</span>
                          <span>Abrir playlist</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : activeSection === 'explore' && !activeDiscoverPlaylist ? (
              explorePlaylists.length === 0 ? (
                <div className="flex h-[50vh] flex-col items-center justify-center text-center text-gray-500">
                  <Compass size={60} className="mb-4 opacity-30" />
                  <p className="text-2xl font-bold text-gray-200">Nenhuma playlist publica encontrada</p>
                  <p className="mt-2 max-w-md text-sm text-gray-500">
                    Quando outros usuarios criarem playlists, elas vao aparecer aqui para descoberta.
                  </p>
                </div>
              ) : (
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {explorePlaylists.map((playlist) => {
                    const cover = playlist.songs?.[0]?.thumbnail || null;
                    const owner = playlist.ownerUserName || 'Outro usuario';
                    return (
                      <button
                        key={playlist.id}
                        onClick={() => {
                          setActivePlaylistId(null);
                          setActiveDiscoverPlaylistId(playlist.id);
                        }}
                        className="group overflow-hidden rounded-[32px] border border-white/10 bg-[#101010] text-left transition hover:border-white/20 hover:bg-[#151515]"
                      >
                        <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-cyan-500/20 via-white/5 to-transparent">
                          {cover ? (
                            <img src={cover} alt={playlist.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-gray-600">
                              <Compass size={46} />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                          <div className="absolute bottom-4 left-4 right-4">
                            <p className="text-xs uppercase tracking-[0.22em] text-cyan-200">Playlist de {owner}</p>
                            <h3 className="mt-2 truncate text-2xl font-black text-white">{playlist.name}</h3>
                          </div>
                        </div>
                        <div className="flex items-center justify-between px-5 py-4 text-sm text-gray-400">
                          <span>{(playlist.songs || []).length} faixas</span>
                          <span>Ver selecao</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : isPlaylistDetailView ? (
              <div className="overflow-hidden rounded-[34px] border border-white/8 bg-[linear-gradient(180deg,#151515_0%,#111111_28%,#0b0b0b_100%)] shadow-[0_30px_80px_rgba(0,0,0,0.28)]">
                <div className="bg-[linear-gradient(180deg,rgba(41,121,255,0.16)_0%,rgba(18,18,18,0.86)_78%,#111111_100%)] px-8 pb-8 pt-10">
                  <div className="flex flex-col gap-8 lg:flex-row lg:items-end">
                    <div className="h-52 w-52 overflow-hidden rounded-[28px] bg-[#1b1b1b] shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
                      {activeCollectionCover ? (
                        <img src={activeCollectionCover} alt={activeCollection?.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-gray-600">
                          <Library size={64} />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gray-300">
                        {activePlaylist ? 'Sua playlist' : `Playlist de ${activeDiscoverPlaylist?.ownerUserName || 'outro usuario'}`}
                      </p>
                      <h2 className="mt-4 text-5xl font-black tracking-[-0.04em] text-white md:text-7xl">{heroTitle}</h2>
                      <p className="mt-4 max-w-3xl text-sm text-gray-300">{heroDescription}</p>
                      <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-gray-400">
                        <span className="font-semibold text-white">{filteredSongs.length} faixas</span>
                        {activePlaylist ? (
                          <span>Organizada por {currentUser?.nome || 'voce'}</span>
                        ) : (
                          <span>Publicada por {activeDiscoverPlaylist?.ownerUserName || 'outro usuario'}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-white/6 bg-[linear-gradient(180deg,#111111_0%,#0b0b0b_100%)] px-8 py-6">
                  <div className="flex flex-wrap items-center gap-4">
                    <button
                      onClick={() => {
                        if (filteredSongs[0]) void playSong(filteredSongs[0]);
                      }}
                      className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-black shadow-[0_18px_38px_rgba(34,197,94,0.28)]"
                    >
                      <Play size={22} fill="currentColor" />
                    </button>

                    {activePlaylist ? (
                      <button
                        onClick={() => setViewMode('list')}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-gray-200 hover:bg-white/[0.08]"
                      >
                        Modo lista
                      </button>
                    ) : null}

                    <button
                      onClick={() => setShowActivityPanel((prev) => !prev)}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-gray-200 hover:bg-white/[0.08]"
                    >
                      {showActivityPanel ? 'Ocultar atividade' : 'Ver atividade'}
                    </button>
                  </div>
                </div>

                <div className="px-8 pb-8">
                  <div className="grid grid-cols-[56px_minmax(0,1.8fr)_minmax(0,1fr)_180px] items-center gap-4 border-b border-white/6 px-4 py-4 text-xs uppercase tracking-[0.2em] text-gray-500">
                    <span>#</span>
                    <span>Titulo</span>
                    <span>Origem</span>
                    <span className="text-right">Acoes</span>
                  </div>

                  <div className="divide-y divide-white/5">
                    {filteredSongs.map((song, index) => {
                      const active = currentSong?.id === song.id;

                      return (
                        <button
                          key={song.id}
                          onClick={() => void playSong(song)}
                          className={`grid w-full grid-cols-[56px_minmax(0,1.8fr)_minmax(0,1fr)_180px] items-center gap-4 px-4 py-4 text-left transition ${
                            active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
                          }`}
                        >
                          <div className="flex items-center gap-3 text-gray-400">
                            <span className="w-5 text-center text-base">{index + 1}</span>
                          </div>

                          <div className="flex min-w-0 items-center gap-4">
                            <div className="h-14 w-14 overflow-hidden rounded-2xl bg-[#1b1b1b]">
                              {song.thumbnail ? (
                                <img src={song.thumbnail} alt={song.title} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-gray-600">
                                  <Music size={20} />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className={`truncate text-base font-semibold ${active ? 'text-white' : 'text-gray-100'}`}>
                                {getDisplayTitle(song)}
                              </p>
                              <p className="mt-1 truncate text-sm text-gray-400">
                                {getDisplayArtist(song) || 'Artista desconhecido'}
                              </p>
                            </div>
                          </div>

                          <div className="min-w-0">
                            <p className="truncate text-sm text-gray-300">{getSongSourceLabel(song)}</p>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                              {song.hasVideo ? (
                                <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-cyan-200">
                                  Video
                                </span>
                              ) : null}
                              {offlineSongIds.includes(song.id) ? (
                                <span className="rounded-full border border-green-400/20 bg-green-400/10 px-2.5 py-1 text-green-200">
                                  Offline
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            {canDeleteSongFromPlatform(song) ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void removeSongFromPlatform(song);
                                }}
                                className="flex h-10 w-10 items-center justify-center rounded-full text-red-400 hover:bg-red-500/10 hover:text-red-200"
                                title="Remover da plataforma"
                              >
                                <Trash2 size={17} />
                              </button>
                            ) : null}
                            {activePlaylist ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void removeSongFromActivePlaylist(song);
                                }}
                                className="flex h-10 w-10 items-center justify-center rounded-full text-red-300 hover:bg-red-500/10 hover:text-red-100"
                                title="Remover da playlist"
                              >
                                <Trash2 size={17} />
                              </button>
                            ) : null}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                offlineSongIds.includes(song.id) ? void removeSongOffline(song) : void saveSongOffline(song);
                              }}
                              className={`flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/5 ${
                                offlineSongIds.includes(song.id) ? 'text-green-400' : 'text-gray-400 hover:text-white'
                              }`}
                              title={offlineSongIds.includes(song.id) ? 'Remover offline' : 'Salvar offline'}
                            >
                              {offlineBusyIds.includes(song.id) ? (
                                <LoaderCircle size={17} className="animate-spin" />
                              ) : offlineSongIds.includes(song.id) ? (
                                <Check size={17} />
                              ) : (
                                <HardDriveDownload size={17} />
                              )}
                            </button>
                            {song.hasVideo ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowVideoInMiniPlayer(false);
                                  setIsVideoPanelOpen(true);
                                  void playSongWithMode(song, 'video');
                                }}
                                className="flex h-10 w-10 items-center justify-center rounded-full text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-100"
                                title="Assistir video"
                              >
                                <Video size={17} />
                              </button>
                            ) : null}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openPlaylistPicker(song);
                              }}
                              className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 hover:bg-white/5 hover:text-white"
                              title="Escolher playlist"
                            >
                              <Plus size={17} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void toggleFavorite(song);
                              }}
                              className={`flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/5 ${
                                song.favorite ? 'text-green-400' : 'text-gray-400 hover:text-white'
                              }`}
                              title="Favoritar"
                            >
                              <Heart size={17} fill={song.favorite ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : filteredSongs.length === 0 ? (
              <div className="flex h-[50vh] flex-col items-center justify-center text-center text-gray-500">
                <Music size={60} className="mb-4 opacity-30" />
                <p className="text-2xl font-bold text-gray-200">Nenhuma musica encontrada</p>
                <p className="mt-2 max-w-md text-sm text-gray-500">
                  {currentUser
                    ? 'Baixe musicas para este usuario ou troque para Explorar para ver tudo.'
                    : 'Crie uma conta ou entre para montar uma biblioteca separada.'}
                </p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                <AnimatePresence>
                  {filteredSongs.map((song, index) => {
                    const active = currentSong?.id === song.id;

                    return (
                      <motion.div
                        key={song.id}
                        layout
                        initial={{ opacity: 0, y: 16, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.96 }}
                        transition={{ delay: index * 0.02 }}
                        onClick={() => void playSong(song)}
                        className={`group relative cursor-pointer overflow-hidden rounded-[30px] border transition ${
                          active
                            ? 'border-green-500/35 bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.14),transparent_42%),linear-gradient(180deg,#171717_0%,#101010_100%)] shadow-[0_18px_50px_rgba(34,197,94,0.08)]'
                            : 'border-white/5 bg-[linear-gradient(180deg,#121212_0%,#0d0d0d_100%)] hover:border-white/10 hover:bg-[#161616]'
                        }`}
                      >
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />
                        <div className="relative p-4">
                          <div className="relative aspect-[1.08/1] overflow-hidden rounded-[24px] bg-[#1b1b1b]">
                            {song.thumbnail ? (
                              <img
                                src={song.thumbnail}
                                alt={song.title}
                                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <Music size={42} className="text-gray-700" />
                              </div>
                            )}

                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

                            <div className="absolute left-4 top-4 flex flex-wrap gap-2 text-[11px]">
                              <span className="rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-gray-200 backdrop-blur-xl">
                                {getSongSourceLabel(song)}
                              </span>
                              {song.hasVideo ? (
                                <span className="rounded-full border border-cyan-400/20 bg-cyan-400/15 px-2.5 py-1 text-cyan-100 backdrop-blur-xl">
                                  Video
                                </span>
                              ) : null}
                              {offlineSongIds.includes(song.id) ? (
                                <span className="rounded-full border border-green-400/20 bg-green-400/15 px-2.5 py-1 text-green-100 backdrop-blur-xl">
                                  Offline
                                </span>
                              ) : null}
                            </div>

                            <motion.button
                              whileHover={{ scale: 1.08 }}
                              whileTap={{ scale: 0.96 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                void playSong(song);
                              }}
                              className="absolute bottom-4 right-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-black shadow-[0_18px_40px_rgba(34,197,94,0.35)]"
                            >
                              {active && isPlaying ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
                            </motion.button>
                          </div>

                          <div className="pt-5">
                            <p className="truncate text-[18px] font-black leading-tight tracking-[-0.02em] text-white">
                              {getDisplayTitle(song)}
                            </p>
                            <p className="mt-2 truncate text-sm text-gray-300">
                              {getDisplayArtist(song) || 'Artista desconhecido'}
                            </p>

                            <div className="mt-5 flex items-center">
                              {getSongUploaderLabel(song) ? (
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-gray-400">
                                  {getSongUploaderLabel(song)}
                                </span>
                              ) : (
                                <span className="rounded-full border border-white/5 bg-white/[0.03] px-3 py-1.5 text-[11px] text-gray-500">
                                  Biblioteca
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="mt-5 flex flex-nowrap items-center gap-1.5 overflow-hidden rounded-[20px] border border-white/6 bg-black/25 px-2 py-2 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
                            {canDeleteSongFromPlatform(song) ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void removeSongFromPlatform(song);
                                }}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-red-400 transition hover:bg-red-500/10 hover:text-red-200"
                                title="Remover da plataforma"
                              >
                                <Trash2 size={15} />
                              </button>
                            ) : null}
                            {activePlaylist ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void removeSongFromActivePlaylist(song);
                                }}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-red-300 transition hover:bg-red-500/10 hover:text-red-100"
                                title="Remover da playlist"
                              >
                                <Trash2 size={15} />
                              </button>
                            ) : null}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                offlineSongIds.includes(song.id)
                                  ? void removeSongOffline(song)
                                  : void saveSongOffline(song);
                              }}
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition hover:bg-white/5 ${
                                offlineSongIds.includes(song.id) ? 'text-green-400' : 'text-gray-500 hover:text-white'
                              }`}
                              title={offlineSongIds.includes(song.id) ? 'Remover offline' : 'Salvar offline'}
                            >
                              {offlineBusyIds.includes(song.id) ? (
                                <LoaderCircle size={15} className="animate-spin" />
                              ) : offlineSongIds.includes(song.id) ? (
                                <Check size={15} />
                              ) : (
                                <HardDriveDownload size={15} />
                              )}
                            </button>

                            {song.hasVideo ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowVideoInMiniPlayer(false);
                                  setIsVideoPanelOpen(true);
                                  void playSongWithMode(song, 'video');
                                }}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-cyan-300 transition hover:bg-cyan-500/10 hover:text-cyan-100"
                                title="Assistir video"
                              >
                                <Video size={15} />
                              </button>
                            ) : null}

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openPlaylistPicker(song);
                              }}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-gray-500 transition hover:bg-white/5 hover:text-white"
                              title="Escolher playlist"
                            >
                              <Plus size={15} />
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void toggleFavorite(song);
                              }}
                              className={`ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition hover:bg-white/5 ${
                                song.favorite ? 'text-green-400' : 'text-gray-500 hover:text-white'
                              }`}
                            >
                              <Heart size={15} fill={song.favorite ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            ) : (
              <div className="overflow-hidden rounded-3xl border border-white/5 bg-[#0d0d0d]">
                {filteredSongs.map((song, index) => {
                  const active = currentSong?.id === song.id;

                  return (
                    <motion.div
                      key={song.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => void playSong(song)}
                      className={`grid cursor-pointer grid-cols-[50px_1.7fr_1.1fr_130px] gap-4 border-b border-white/5 px-6 py-4 ${
                        active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="text-gray-500">{index + 1}</div>
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-[#1b1b1b]">
                          {song.thumbnail ? (
                            <img src={song.thumbnail} alt={song.title} className="h-full w-full object-cover" />
                          ) : (
                            <Music size={18} className="text-gray-700" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{getDisplayTitle(song)}</p>
                          <p className="truncate text-xs text-gray-500">
                            {getDisplayArtist(song) || 'Artista desconhecido'}
                          </p>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-col justify-center">
                        <p className="truncate text-sm text-gray-300">{getSongSourceLabel(song)}</p>
                        <p className="truncate text-xs text-gray-500">
                          {offlineSongIds.includes(song.id)
                            ? 'Disponivel offline'
                            : getSongUploaderLabel(song) || 'Sem autor de upload'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {canDeleteSongFromPlatform(song) ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void removeSongFromPlatform(song);
                            }}
                            className="text-red-400 hover:text-red-200"
                            title="Remover da plataforma"
                          >
                            <Trash2 size={17} />
                          </button>
                        ) : null}
                        {activePlaylist ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void removeSongFromActivePlaylist(song);
                            }}
                            className="text-red-300 hover:text-red-100"
                            title="Remover da playlist"
                          >
                            <Trash2 size={17} />
                          </button>
                        ) : null}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            offlineSongIds.includes(song.id)
                              ? void removeSongOffline(song)
                              : void saveSongOffline(song);
                          }}
                          className={offlineSongIds.includes(song.id) ? 'text-green-400' : 'text-gray-500 hover:text-white'}
                          title={offlineSongIds.includes(song.id) ? 'Remover offline' : 'Salvar offline'}
                        >
                          {offlineBusyIds.includes(song.id) ? (
                            <LoaderCircle size={17} className="animate-spin" />
                          ) : offlineSongIds.includes(song.id) ? (
                            <Check size={17} />
                          ) : (
                            <HardDriveDownload size={17} />
                          )}
                        </button>

                        {song.hasVideo ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowVideoInMiniPlayer(false);
                              setIsVideoPanelOpen(true);
                              void playSongWithMode(song, 'video');
                            }}
                            className="text-cyan-300 hover:text-cyan-100"
                            title="Assistir video"
                          >
                            <Video size={17} />
                          </button>
                        ) : null}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openPlaylistPicker(song);
                          }}
                          className="text-gray-500 hover:text-white"
                          title="Escolher playlist"
                        >
                          <Plus size={17} />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleFavorite(song);
                          }}
                          className={song.favorite ? 'text-green-400' : 'text-gray-500 hover:text-white'}
                        >
                          <Heart size={17} fill={song.favorite ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>

      {playlistPickerSong ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-6">
          <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#0d0d0d] p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Salvar em playlist</p>
                <h3 className="mt-2 text-2xl font-bold">{getDisplayTitle(playlistPickerSong)}</h3>
                <p className="mt-1 text-sm text-gray-400">{getSongSubtitle(playlistPickerSong)}</p>
              </div>
              <button
                onClick={() => setPlaylistPickerSong(null)}
                className="rounded-xl p-2 text-gray-400 hover:bg-white/5 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            {playlists.length === 0 ? (
              <p className="text-sm text-gray-400">Crie uma playlist na sidebar antes de adicionar musicas.</p>
            ) : (
              <div className="space-y-2">
                {playlists.map((playlist) => (
                  <button
                    key={playlist.id}
                    onClick={() => void choosePlaylist(playlist.id)}
                    className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left hover:bg-white/[0.06]"
                  >
                    <span>{playlist.name}</span>
                    <span className="text-xs text-gray-500">{(playlist.songs || []).length}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {youtubeActionModal ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-6 py-10 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[32px] border border-white/10 bg-[#0b0b0b] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
                  {youtubeActionModal.selection.kind === 'playlist' ? 'Playlist detectada' : 'Faixa selecionada'}
                </p>
                <h3 className="mt-3 text-3xl font-black tracking-tight text-white">
                  {youtubeActionModal.analysis.playlist?.title || youtubeActionModal.analysis.selectedEntry?.title || youtubeActionModal.selection.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-gray-300">
                  {youtubeActionModal.selection.subtitle || 'Escolha como o MusFy deve tratar esse resultado do YouTube.'}
                </p>
                {youtubeActionModal.analysis.kind === 'playlist' && youtubeActionModal.analysis.playlist ? (
                  <p className="mt-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-50">
                    Você quer baixar só a faixa destacada ou a playlist inteira? Se escolher a playlist inteira, o MusFy cria uma playlist nova automaticamente com o nome correto.
                  </p>
                ) : null}
                {youtubeActionModal.analysis.selectedEntry?.title ? (
                  <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-gray-200">
                    Faixa usada nas ações de faixa: {youtubeActionModal.analysis.selectedEntry.title}
                  </p>
                ) : null}
              </div>

              <button
                onClick={() => setYoutubeActionModal(null)}
                className="rounded-xl p-2 text-gray-400 hover:bg-white/5 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => {
                    const analysis = youtubeActionModal.analysis;
                    setYoutubeActionModal(null);
                    void startYoutubeDownload('single', analysis);
                  }}
                  disabled={isDownloading || isInspectingYoutube || !youtubeActionModal.analysis.selectedEntry}
                  className="rounded-[24px] border border-white/10 bg-black/20 p-5 text-left transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <p className="text-sm font-semibold text-white">Salvar só a faixa agora</p>
                  <p className="mt-2 text-xs leading-5 text-gray-400">
                    Baixa apenas a faixa destacada e publica direto na biblioteca atual.
                  </p>
                </button>

                <button
                  onClick={() => {
                    const analysis = youtubeActionModal.analysis;
                    setYoutubeActionModal(null);
                    enqueueYoutubeDownload('single', analysis);
                  }}
                  disabled={isInspectingYoutube || !youtubeActionModal.analysis.selectedEntry}
                  className="rounded-[24px] border border-white/10 bg-black/20 p-5 text-left transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <p className="text-sm font-semibold text-white">Adicionar só a faixa à fila</p>
                  <p className="mt-2 text-xs leading-5 text-gray-400">
                    Guarda a faixa atual para processar depois, sem começar agora.
                  </p>
                </button>

                {youtubeActionModal.analysis.kind === 'playlist' && youtubeActionModal.analysis.playlist ? (
                  <>
                    <button
                      onClick={() => {
                        const analysis = youtubeActionModal.analysis;
                        setYoutubeActionModal(null);
                        void startYoutubeDownload('playlist', analysis);
                      }}
                      disabled={isDownloading || isInspectingYoutube}
                      className="rounded-[24px] border border-cyan-400/30 bg-cyan-400/10 p-5 text-left transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <p className="text-sm font-semibold text-white">Salvar a playlist inteira agora</p>
                      <p className="mt-2 text-xs leading-5 text-cyan-100/80">
                        Importa todas as faixas e já cria uma playlist nova no MusFy com o mesmo nome da playlist do YouTube.
                      </p>
                    </button>

                    <button
                      onClick={() => {
                        const analysis = youtubeActionModal.analysis;
                        setYoutubeActionModal(null);
                        enqueueYoutubeDownload('playlist', analysis);
                      }}
                      disabled={isInspectingYoutube}
                      className="rounded-[24px] border border-cyan-400/20 bg-cyan-500/5 p-5 text-left transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <p className="text-sm font-semibold text-white">Adicionar a playlist inteira à fila</p>
                      <p className="mt-2 text-xs leading-5 text-cyan-100/80">
                        Empilha a playlist completa e preserva o nome dela para criar tudo certo depois.
                      </p>
                    </button>
                  </>
                ) : null}
              </div>

              <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">Preferências desta ação</p>
                <label className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={youtubeIncludeVideo}
                    onChange={(e) => setYoutubeIncludeVideo(e.target.checked)}
                    className="h-4 w-4 accent-green-500"
                  />
                  Salvar vídeo também quando eu quiser assistir dentro do MusFy
                </label>

                <div className="mt-4">
                  <label className="mb-2 block text-sm font-medium text-gray-300">Playlist de destino opcional</label>
                  <select
                    value={youtubeTargetPlaylistId}
                    onChange={(e) => setYoutubeTargetPlaylistId(e.target.value)}
                    className="h-12 w-full rounded-2xl border border-white/10 bg-[#101010] px-4 text-sm text-gray-200 outline-none focus:border-green-500/40"
                  >
                    <option value="">Criar ou usar a playlist automática</option>
                    {playlists.map((playlist) => (
                      <option key={playlist.id} value={playlist.id}>
                        {playlist.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs leading-5 text-gray-500">
                    Em faixa única, o download entra nesta playlist. Em playlist inteira, o MusFy pode anexar nela ou criar automaticamente uma nova playlist com o nome original.
                  </p>
                </div>

                {youtubeActionModal.analysis.kind === 'playlist' && youtubeActionModal.analysis.playlist ? (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">Prévia</p>
                      <span className="text-xs text-gray-500">{youtubeActionModal.analysis.playlist.entryCount} faixas</span>
                    </div>
                    <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                      {(youtubeActionModal.analysis.playlist.entries || []).map((entry, index) => (
                        <div
                          key={`${entry.url}-${index}`}
                          className="flex items-center justify-between rounded-2xl border border-white/5 bg-black/20 px-3 py-2 text-sm"
                        >
                          <span className="truncate text-gray-200">{entry.title}</span>
                          <span className="ml-3 text-xs text-gray-500">#{index + 1}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showActivityPanel ? (
        <div className="fixed bottom-28 right-6 z-40 w-[420px] overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0b0b]/95 shadow-2xl backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Atividade</p>
              <p className="mt-1 text-sm text-gray-300">Analise, download, playlist e avisos do backend</p>
            </div>
            <button
              onClick={() => setShowActivityPanel(false)}
              className="rounded-xl p-2 text-gray-400 hover:bg-white/5 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          <div className="max-h-[380px] overflow-y-auto px-5 py-4">
            {activityLogs.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhuma atividade registrada ainda.</p>
            ) : (
              <div className="space-y-2">
                {activityLogs.map((entry, index) => {
                  const meta = getActivityMeta(entry);
                  const toneClass =
                    meta.tone === 'error'
                      ? 'border-red-500/20 bg-red-500/10'
                      : meta.tone === 'warn'
                        ? 'border-amber-500/20 bg-amber-500/10'
                        : meta.tone === 'playlist'
                          ? 'border-cyan-500/20 bg-cyan-500/10'
                          : meta.tone === 'inspect'
                            ? 'border-violet-500/20 bg-violet-500/10'
                            : meta.tone === 'download'
                              ? 'border-green-500/20 bg-green-500/10'
                              : 'border-white/5 bg-white/[0.03]';

                  return (
                    <div key={`${entry}-${index}`} className={`rounded-2xl border px-3 py-3 text-xs ${toneClass}`}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-200">
                          {meta.label}
                        </span>
                        {meta.timestamp ? <span className="text-[10px] text-gray-400">{meta.timestamp}</span> : null}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap leading-5 text-gray-200">{meta.message}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {shouldShowDesktopUpdateBanner ? (
        <div className="fixed right-4 top-4 z-40 w-[min(420px,calc(100vw-2rem))] rounded-[28px] border border-green-500/20 bg-[linear-gradient(180deg,rgba(17,24,39,0.96)_0%,rgba(7,10,16,0.98)_100%)] p-5 shadow-[0_25px_80px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-green-300">Atualização disponível</p>
              <p className="mt-2 truncate text-lg font-black text-white">{updateHeadline}</p>
              <p className="mt-2 text-sm leading-6 text-gray-300">{desktopUpdateStatus.message}</p>
              {formattedReleaseDate ? (
                <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-gray-500">{formattedReleaseDate}</p>
              ) : null}
            </div>
            <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-gray-200">
              {updateStatusLabel}
            </span>
          </div>

          {desktopUpdateStatus.progress !== null && desktopUpdateStatus.progress !== undefined ? (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-green-400 to-cyan-400"
                  style={{ width: `${Math.max(3, Math.min(100, Number(desktopUpdateStatus.progress || 0)))}%` }}
                />
              </div>
            </div>
          ) : null}

          {releaseNotesPreview.length ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
              {releaseNotesPreview.map((section, index) => (
                <p key={`${section}-${index}`} className={`text-sm leading-6 text-gray-300 ${index > 0 ? 'mt-3' : ''}`}>
                  {section}
                </p>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            {desktopUpdateStatus.state === 'downloaded' ? (
              <button
                onClick={() => void installDesktopUpdate()}
                className="rounded-full border border-green-500/30 bg-green-500/15 px-4 py-2 text-sm text-green-100 hover:bg-green-500/20"
              >
                Reiniciar e instalar
              </button>
            ) : (
              <button
                onClick={() => {
                  focusDesktopUpdateSection('panel');
                  void triggerDesktopUpdateCheck();
                }}
                className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-gray-200 hover:bg-white/[0.08]"
              >
                Abrir detalhes
              </button>
            )}
            <button
              onClick={() => focusDesktopUpdateSection('notes')}
              className="rounded-full border border-white/10 bg-transparent px-4 py-2 text-sm text-gray-400 hover:border-white/20 hover:text-white"
            >
              Ver notas
            </button>
          </div>
        </div>
      ) : null}

      <div
        ref={videoPanelRef}
        className={`fixed z-30 overflow-hidden border border-white/10 bg-black/90 shadow-2xl backdrop-blur-2xl ${
          isVideoTheaterOpen
            ? 'inset-4 rounded-[32px]'
            : 'bottom-32 right-6 w-[420px] rounded-[28px]'
        } ${
          currentSong && playbackMode === 'video' && currentSong.hasVideo && isVideoPanelOpen ? 'block' : 'hidden'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{getDisplayTitle(currentSong)}</p>
              <p className="truncate text-xs text-gray-400">{getSongSubtitle(currentSong)}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void openVideoInMiniPlayer()}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white"
              >
                Mini player
              </button>
              <button
                onClick={() => void openVideoFullscreen()}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <Expand size={14} />
                  {isVideoTheaterOpen ? 'Janela' : 'Tela cheia'}
                </span>
              </button>
              <button
                onClick={() => void switchCurrentPlaybackMode('audio')}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white"
              >
                Ouvir audio
              </button>
              <button
                onClick={() => {
                  setIsVideoTheaterOpen(false);
                  setIsVideoPanelOpen(false);
                  setShowVideoInMiniPlayer(false);
                  videoRef.current?.pause();
                  void switchCurrentPlaybackMode('audio');
                }}
                className="rounded-xl p-2 text-gray-400 hover:bg-white/5 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className={`relative bg-black ${isVideoTheaterOpen ? 'min-h-0 flex-1' : 'aspect-video'}`}>
          <video
            ref={videoRef}
            preload="metadata"
            playsInline
            poster={currentSong?.thumbnail || undefined}
            className="h-full w-full bg-black object-contain"
            onContextMenu={(e) => e.preventDefault()}
            onTimeUpdate={() => handleMediaTimeUpdate(videoRef.current)}
            onLoadedMetadata={() => handleMediaLoadedMetadata(videoRef.current)}
            onPause={() => {
              if (playbackModeRef.current === 'video') {
                setIsPlaying(false);
                broadcastSnapshot({ isPlaying: false });
              }
            }}
            onPlay={() => {
              if (playbackModeRef.current === 'video') {
                setIsPlaying(true);
                broadcastSnapshot({ isPlaying: true });
              }
            }}
            onError={() => {
              if (playbackModeRef.current === 'video') {
                setDownloadMessage('Falha ao reproduzir video desta faixa. Verifique se o arquivo de video foi salvo.');
              }
            }}
            onEnded={() => {
              void playNext();
            }}
          />
          </div>
          <div className="border-t border-white/10 bg-[linear-gradient(180deg,rgba(9,9,9,0.9)_0%,rgba(4,4,4,0.98)_100%)] px-4 py-4">
            <div className="flex items-center gap-3">
              <span className="w-12 text-right text-[11px] text-gray-400">{formatTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={(e) => {
                  const nextTime = Number(e.target.value);
                  void runPlayerCommand({ type: 'SEEK', time: nextTime });
                }}
                className="min-w-0 flex-1 accent-green-500"
              />
              <span className="w-12 text-[11px] text-gray-400">{formatTime(duration)}</span>
            </div>

            <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => void playPrevious()}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white"
                >
                  <SkipBack size={18} />
                </button>
                <button
                  onClick={() => void togglePlay()}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black shadow-lg"
                >
                  {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                </button>
                <button
                  onClick={() => void playNext()}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white"
                >
                  <SkipForward size={18} />
                </button>
              </div>

              <div className="flex flex-1 flex-col gap-4 xl:flex-row xl:items-center xl:justify-end">
                <div className="flex items-center gap-3 xl:max-w-[240px] xl:flex-1">
                  <Volume2 size={16} className="text-gray-400" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => {
                      const nextVolume = Number(e.target.value);
                      void runPlayerCommand({ type: 'SET_VOLUME', volume: nextVolume });
                    }}
                    className="min-w-0 flex-1 accent-green-500"
                  />
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => void openVideoInMiniPlayer()}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-gray-200 hover:bg-white/[0.08]"
                  >
                    Mini player
                  </button>
                  <button
                    onClick={() => void switchCurrentPlaybackMode('audio')}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-gray-200 hover:bg-white/[0.08]"
                  >
                    Ouvir audio
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className={`fixed bottom-0 left-0 right-0 h-24 items-center justify-between gap-5 border-t border-white/10 bg-black/80 px-6 backdrop-blur-2xl lg:left-80 ${isVideoTheaterOpen ? 'hidden' : 'flex'}`}>
        <div className="flex min-w-0 w-1/3 items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-[#171717]">
            {currentSong?.thumbnail ? (
              <img src={currentSong.thumbnail} alt={currentSong.title} className="h-full w-full object-cover" />
            ) : (
              <Music size={20} className="text-gray-600" />
            )}
          </div>

          <div className="min-w-0">
            <p className="truncate font-bold">{getDisplayTitle(currentSong) || 'Nenhuma musica selecionada'}</p>
            <p className="text-xs text-gray-500">{getSongSubtitle(currentSong)}</p>
            {playerNotice ? <p className="mt-1 max-w-md truncate text-[11px] text-amber-300">{playerNotice}</p> : null}
          </div>
        </div>

        <div className="flex w-1/3 flex-col items-center gap-2">
          <div className="flex items-center gap-6">
            <button onClick={() => void playPrevious()} className="text-gray-400 hover:text-white">
              <SkipBack size={20} />
            </button>
            <motion.button
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => void togglePlay()}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black"
            >
              {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </motion.button>
            <button onClick={() => void playNext()} className="text-gray-400 hover:text-white">
              <SkipForward size={20} />
            </button>
          </div>

          <div className="flex w-full max-w-xl items-center gap-3">
            <span className="w-10 text-right text-[11px] text-gray-400">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={(e) => {
                const value = Number(e.target.value);
                void runPlayerCommand({ type: 'SEEK', time: value });
              }}
              className="flex-1 accent-white"
            />
            <span className="w-10 text-[11px] text-gray-400">{formatTime(duration)}</span>
          </div>
        </div>

        <div className="flex w-1/3 items-center justify-end gap-3">
          {currentSong ? (
            <>
              <button
                onClick={() =>
                  offlineSongIds.includes(currentSong.id)
                    ? void removeSongOffline(currentSong)
                    : void saveSongOffline(currentSong)
                }
                className={`flex h-11 items-center gap-2 rounded-full border px-4 text-sm transition ${
                  offlineSongIds.includes(currentSong.id)
                    ? 'border-green-500/30 bg-green-500/10 text-green-200'
                    : 'border-white/10 bg-[#111111] text-gray-300 hover:border-white/20 hover:text-white'
                }`}
                title={
                  offlineSongIds.includes(currentSong.id)
                    ? 'Remover cache offline'
                    : 'Salvar audio para ouvir offline'
                }
              >
                {offlineBusyIds.includes(currentSong.id) ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : offlineSongIds.includes(currentSong.id) ? (
                  <Check size={16} />
                ) : (
                  <HardDriveDownload size={16} />
                )}
                {offlineSongIds.includes(currentSong.id) ? 'Offline' : 'Salvar offline'}
              </button>

              {currentSong.hasVideo ? (
                <button
                  onClick={() => void switchCurrentPlaybackMode(playbackMode === 'video' ? 'audio' : 'video')}
                  className={`flex h-11 items-center gap-2 rounded-full border px-4 text-sm transition ${
                    playbackMode === 'video'
                      ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100'
                      : 'border-white/10 bg-[#111111] text-gray-300 hover:border-white/20 hover:text-white'
                  }`}
                  title={playbackMode === 'video' ? 'Voltar para audio' : 'Assistir video'}
                >
                  <Video size={16} />
                  {playbackMode === 'video' ? 'Modo video' : 'Ver video'}
                </button>
              ) : null}
            </>
          ) : null}

          <div className="relative hidden xl:flex">
            <button
              onClick={() => setShowDevicePicker((value) => !value)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-[#111111] text-gray-300 transition hover:border-white/20 hover:bg-[#161616] hover:text-white"
              title={
                selectedOutputDevice
                  ? `Saida: ${selectedOutputDevice.deviceName}`
                  : `Saida: ${deviceName}`
              }
            >
              <MonitorSpeaker size={18} />
            </button>

            {showDevicePicker ? (
              <div className="absolute bottom-16 right-0 z-50 w-[360px] overflow-hidden rounded-[24px] border border-white/10 bg-[#0b0b0b]/95 p-3 shadow-2xl backdrop-blur-2xl">
                <div className="mb-3 px-2">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-gray-500">Escolha onde tocar</p>
                  <p className="mt-1 text-sm text-gray-300">Troque a saida entre este dispositivo e os outros apps ativos na rede.</p>
                </div>

                <div className="space-y-2">
                  <button
                    onClick={() => {
                      setSelectedOutputDeviceId(storedDeviceId);
                      setShowDevicePicker(false);
                    }}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      selectedOutputDeviceId === storedDeviceId
                        ? 'border-green-500/40 bg-green-500/10'
                        : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{deviceName}</p>
                        <p className="truncate text-xs text-gray-400">Este dispositivo</p>
                      </div>
                      <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-gray-300">
                        Local
                      </span>
                    </div>
                  </button>

                  {devices.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-gray-500">
                      Nenhum outro dispositivo ativo encontrado agora.
                    </div>
                  ) : (
                    devices.map((device) => (
                      <button
                        key={device.deviceId}
                        onClick={() => {
                          setSelectedOutputDeviceId(device.deviceId);
                          setShowDevicePicker(false);
                        }}
                        className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                          selectedOutputDeviceId === device.deviceId
                            ? 'border-green-500/40 bg-green-500/10'
                            : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{device.deviceName}</p>
                            <p className="truncate text-xs text-gray-400">
                              {device.userName || 'Sem usuario'}
                              {device.ipAddress ? ` Â· ${device.ipAddress}` : ''}
                            </p>
                            <p className="mt-1 truncate text-xs text-gray-500">
                              {getDeviceStatusLabel(device)}
                              {device.lastState?.currentSongTitle ? ` Â· ${device.lastState.currentSongTitle}` : ''}
                            </p>
                            {device.lastError ? (
                              <p className="mt-1 truncate text-[11px] text-red-400">{device.lastError}</p>
                            ) : null}
                          </div>
                          <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-gray-300">
                            Remoto
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <Volume2 size={18} className="text-gray-400" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => {
              const nextVolume = Number(e.target.value);
              void runPlayerCommand({ type: 'SET_VOLUME', volume: nextVolume });
            }}
            className="w-32 accent-white"
          />
        </div>
      </footer>
    </div>
  );
}

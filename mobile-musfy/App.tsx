import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowRight,
  Check,
  CircleAlert,
  Download,
  Heart,
  Library,
  ListMusic,
  LogOut,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  SkipBack,
  SkipForward,
  Smartphone,
  Speaker,
  UserRound,
  Wifi,
  WifiOff
} from 'lucide-react-native';
import {
  ackDeviceCommand,
  buildAudioStreamUrl,
  fetchDeviceCommand,
  fetchDevices,
  fetchHealth,
  fetchPlaylists,
  fetchSongs,
  loginUser,
  normalizeBaseUrl,
  registerAndroidDevice,
  sendDeviceCommand,
  sendDeviceState,
  toggleFavorite
} from './src/api/client';
import type { DeviceCommand, DeviceSummary, HealthStatus, OfflineTrack, Playlist, Song, User } from './src/types';

type AudioPlayer = import('expo-audio').AudioPlayer;
type AudioStatus = import('expo-audio').AudioStatus;
type AudioModule = typeof import('expo-audio');
type DatabaseModule = typeof import('./src/storage/database');
type OfflineModule = typeof import('./src/storage/offline');
type ViewMode = 'library' | 'favorites' | 'playlists' | 'offline';
type Tone = 'info' | 'success' | 'error';
type PlaybackTarget = 'local' | 'remote';
type PlayerCommand = { type: 'PLAY_SONG'; song: Song } | { type: 'TOGGLE_PLAY' };
type QueueEntry = { song: Song; localUri?: string; playlistId?: string | null };
type IconComponent = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number; fill?: string }>;

const DEFAULT_SERVER_URL = 'http://192.168.0.10:3001';
const BRAND_MARK_SOURCE = require('./assets/branding/musfy-play.png');
const SETTINGS = {
  baseUrl: 'mobile.baseUrl',
  user: 'mobile.user',
  deviceId: 'mobile.deviceId',
  lastLogin: 'mobile.lastLogin',
  outputDeviceId: 'mobile.outputDeviceId'
} as const;
const VIEW_META: Record<ViewMode, { label: string; icon: IconComponent }> = {
  library: { label: 'Biblioteca', icon: Library },
  favorites: { label: 'Favoritas', icon: Heart },
  playlists: { label: 'Playlists', icon: ListMusic },
  offline: { label: 'Offline', icon: Download }
};

let audioModulePromise: Promise<AudioModule> | null = null;
let databaseModulePromise: Promise<DatabaseModule> | null = null;
let offlineModulePromise: Promise<OfflineModule> | null = null;
const memorySettings = new Map<string, string>();
let memorySongsCache: Song[] = [];
let memoryPlaylistsCache: Playlist[] = [];
let memoryOfflineCache: OfflineTrack[] = [];

async function loadAudioModule() { if (!audioModulePromise) audioModulePromise = import('expo-audio'); return await audioModulePromise; }
async function loadDatabaseModule() { if (!databaseModulePromise) databaseModulePromise = import('./src/storage/database'); return await databaseModulePromise; }
async function loadOfflineModule() { if (!offlineModulePromise) offlineModulePromise = import('./src/storage/offline'); return await offlineModulePromise; }
async function trySetAudioMode() { const audio = await loadAudioModule(); await audio.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, interruptionMode: 'doNotMix', shouldPlayInBackground: true, shouldRouteThroughEarpiece: false }); }
async function safeInitDatabase() { try { const db = await loadDatabaseModule(); await db.initDatabase(); return true; } catch { return false; } }
async function safeGetSetting(key: string) { try { const db = await loadDatabaseModule(); const value = await db.getSetting(key); if (value !== null) memorySettings.set(key, value); return value; } catch { return memorySettings.get(key) ?? null; } }
async function safeSetSetting(key: string, value: string) { memorySettings.set(key, value); try { const db = await loadDatabaseModule(); await db.setSetting(key, value); } catch {} }
async function safeGetCachedSongs() { try { const db = await loadDatabaseModule(); const songs = await db.getCachedSongs(); memorySongsCache = songs; return songs; } catch { return [...memorySongsCache]; } }
async function safeCacheSongs(songs: Song[]) { memorySongsCache = songs; try { const db = await loadDatabaseModule(); await db.cacheSongs(songs); } catch {} }
async function safeGetCachedPlaylists() { try { const db = await loadDatabaseModule(); const playlists = await db.getCachedPlaylists(); memoryPlaylistsCache = playlists; return playlists; } catch { return [...memoryPlaylistsCache]; } }
async function safeCachePlaylists(playlists: Playlist[]) { memoryPlaylistsCache = playlists; try { const db = await loadDatabaseModule(); await db.cachePlaylists(playlists); } catch {} }
async function safeListOfflineTracks() { try { const db = await loadDatabaseModule(); const tracks = await db.listOfflineTracks(); memoryOfflineCache = tracks; return tracks; } catch { return [...memoryOfflineCache]; } }
async function safeDownloadSongOffline(baseUrl: string, song: Song, playlistId?: string) { const offline = await loadOfflineModule(); const track = await offline.downloadSongOffline(baseUrl, song, playlistId); memoryOfflineCache = [track, ...memoryOfflineCache.filter((item) => item.songId !== track.songId)]; return track; }
async function safeRemoveSongOffline(track: OfflineTrack) { const offline = await loadOfflineModule(); await offline.removeSongOffline(track); memoryOfflineCache = memoryOfflineCache.filter((item) => item.songId !== track.songId); }
function id() { return `musfy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function err(error: unknown, fallback: string) { if (error instanceof Error && error.message) return error.message; if (typeof error === 'string' && error) return error; return fallback; }
function parseUser(raw: string | null) { if (!raw) return null; try { return JSON.parse(raw) as User; } catch { return null; } }
function formatTime(ms: number) { const total = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60; return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; }
function formatBytes(bytes?: number | null) { if (!bytes || bytes <= 0) return ''; if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`; if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; return `${Math.round(bytes / 1024)} KB`; }
function isAudioFocusedSong(song: Song) { return !(song.hasVideo && song.videoMimeType && !song.audioMimeType); }
function matchesSearch(song: Song, search: string) { return `${song.title || ''} ${song.artist || ''}`.toLowerCase().includes(search.toLowerCase()); }
function matchesOfflineSearch(track: OfflineTrack, search: string) { return `${track.title || ''} ${track.artist || ''}`.toLowerCase().includes(search.toLowerCase()); }
function asSong(value: unknown) { if (!value || typeof value !== 'object') return null; const raw = value as Record<string, unknown>; if (!raw.id || !raw.title) return null; return { id: String(raw.id), title: String(raw.title), artist: typeof raw.artist === 'string' ? raw.artist : null, thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : null, audioMimeType: typeof raw.audioMimeType === 'string' ? raw.audioMimeType : null, videoMimeType: typeof raw.videoMimeType === 'string' ? raw.videoMimeType : null, hasVideo: Boolean(raw.hasVideo), favorite: Boolean(raw.favorite) } satisfies Song; }
function buildSongFromOffline(track: OfflineTrack) { return { id: track.songId, title: track.title, artist: track.artist || null, thumbnail: track.thumbnail || null, audioMimeType: track.mimeType || null, hasVideo: false } satisfies Song; }
function buildLockScreenMetadata(song: Song) { return { title: song.title, artist: song.artist || 'MusFy', artworkUrl: song.thumbnail || undefined }; }

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('[mobile-musfy] fatal render error', error); }
  render() { if (!this.state.error) return this.props.children; return <SafeAreaView style={styles.fatalRoot}><LinearGradient colors={['#0b0c0e', '#121417']} style={styles.fatalGradient}><MusFyLogo size={84} /><Text style={styles.fatalTitle}>MusFy</Text><Text style={styles.fatalBody}>O app encontrou um erro ao abrir.</Text></LinearGradient></SafeAreaView>; }
}

function MusFyLogo({ size = 88 }: { size?: number }) {
  return <Image source={BRAND_MARK_SOURCE} style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }} resizeMode="contain" />;
}

function SplashScreenView() { return <SafeAreaView style={styles.splashRoot}><StatusBar style="light" /><LinearGradient colors={['#090a0c', '#111317']} style={styles.splashGradient}><MusFyLogo size={132} /><Text style={styles.splashTitle}>MusFy</Text><Text style={styles.splashCaption}>audio player conectado ao servidor</Text></LinearGradient></SafeAreaView>; }

function IconButton({ icon: Icon, onPress, kind = 'ghost', disabled, busy, active = false, size = 'md', fillActive = false }: { icon: IconComponent; onPress: (event?: GestureResponderEvent) => void; kind?: 'ghost' | 'primary' | 'soft'; disabled?: boolean; busy?: boolean; active?: boolean; size?: 'sm' | 'md'; fillActive?: boolean; }) {
  const iconColor = kind === 'primary' ? '#08130d' : active ? '#1ed760' : '#f4f7f4';
  return <Pressable style={[styles.iconButton, size === 'sm' && styles.iconButtonSmall, kind === 'primary' && styles.iconButtonPrimary, kind === 'soft' && styles.iconButtonSoft, active && styles.iconButtonActive, (disabled || busy) && styles.iconButtonDisabled]} onPress={(event) => { event.stopPropagation?.(); onPress(event); }} disabled={disabled || busy}>{busy ? <ActivityIndicator size={size === 'sm' ? 'small' : 'small'} color={kind === 'primary' ? '#08130d' : '#f4f7f4'} /> : <Icon size={size === 'sm' ? 16 : 18} color={iconColor} fill={fillActive && active ? iconColor : 'transparent'} strokeWidth={2.4} />}</Pressable>;
}

function SegmentTabs<T extends string>({ items, selected, meta, onChange }: { items: readonly T[]; selected: T; meta: Record<T, { label: string; icon: IconComponent }>; onChange: (value: T) => void; }) {
  return <View style={styles.segmentWrap}>{items.map((item) => { const active = item === selected; const Icon = meta[item].icon; return <Pressable key={item} style={[styles.segmentItem, active && styles.segmentItemActive]} onPress={() => onChange(item)}><Icon size={16} color={active ? '#ffffff' : '#a4adb7'} strokeWidth={2.4} /><Text style={[styles.segmentText, active && styles.segmentTextActive]}>{meta[item].label}</Text></Pressable>; })}</View>;
}

function Artwork({ uri, size, radius }: { uri?: string | null; size: number; radius: number }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius }} resizeMode="cover" />;
  return <View style={[styles.artworkFallback, { width: size, height: size, borderRadius: radius }]}><MusFyLogo size={size * 0.56} /></View>;
}

function MusFyApp() {
  const playerRef = useRef<AudioPlayer | null>(null);
  const playerStatusSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const commandLockRef = useRef(false);
  const lastCommandIdRef = useRef(0);
  const playbackRequestRef = useRef(0);
  const playbackQueueRef = useRef<QueueEntry[]>([]);
  const currentIdRef = useRef<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<{ tone: Tone; text: string } | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [serverInput, setServerInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loginHealth, setLoginHealth] = useState<HealthStatus | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState('');
  const [activeView, setActiveView] = useState<ViewMode>('library');
  const [search, setSearch] = useState('');
  const [songs, setSongs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [offlineTracks, setOfflineTracks] = useState<OfflineTrack[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [playerBusy, setPlayerBusy] = useState(false);
  const [offlineBusyId, setOfflineBusyId] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState('');
  const [currentArtist, setCurrentArtist] = useState('');
  const [currentThumbnail, setCurrentThumbnail] = useState<string | null>(null);
  const [playbackTarget, setPlaybackTarget] = useState<PlaybackTarget>('local');
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playbackQueue, setPlaybackQueue] = useState<QueueEntry[]>([]);
  const [capabilities, setCapabilities] = useState({ audio: true, storage: true });
  const normalized = normalizeBaseUrl(baseUrl);
  const currentUserId = currentUser?.id || null;
  const localDeviceName = Platform.OS === 'android' ? 'MusFy Android' : 'MusFy';
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) || null;
  const offlineMap = useMemo(() => new Map(offlineTracks.map((track) => [track.songId, track])), [offlineTracks]);
  const trackPool = useMemo(() => {
    if (activeView === 'playlists') return (selectedPlaylist?.songs || []).filter(isAudioFocusedSong);
    if (activeView === 'favorites') return songs.filter((song) => song.favorite).filter(isAudioFocusedSong);
    if (activeView === 'offline') return [];
    return songs.filter(isAudioFocusedSong);
  }, [activeView, selectedPlaylist, songs]);
  const visibleTracks = useMemo(() => trackPool.filter((song) => matchesSearch(song, search)), [search, trackPool]);
  const visibleOfflineTracks = useMemo(() => offlineTracks.filter((track) => matchesOfflineSearch(track, search)), [offlineTracks, search]);
  const currentTrackIndex = activeView === 'offline' ? visibleOfflineTracks.findIndex((track) => track.songId === currentId) : visibleTracks.findIndex((song) => song.id === currentId);
  const currentQueueIndex = useMemo(() => playbackQueue.findIndex((entry) => entry.song.id === currentId), [currentId, playbackQueue]);
  const outputDevices = useMemo(() => [{ deviceId, deviceName: 'Este celular', platform: Platform.OS, lastState: null } as DeviceSummary, ...devices].filter((device) => Boolean(device.deviceId)).reduce<DeviceSummary[]>((acc, device) => { if (!acc.some((item) => item.deviceId === device.deviceId)) acc.push(device); return acc; }, []), [deviceId, devices]);
  const selectedOutputDevice = outputDevices.find((device) => device.deviceId === selectedOutputDeviceId) || outputDevices[0] || null;
  const remoteSelected = Boolean(selectedOutputDeviceId && selectedOutputDeviceId !== deviceId);
  const currentPlaybackSong = useMemo(() => {
    if (!currentId) return null;
    const onlineSong = songs.find((song) => song.id === currentId) || (selectedPlaylist?.songs || []).find((song) => song.id === currentId);
    if (onlineSong) return onlineSong;
    const offlineTrack = offlineMap.get(currentId);
    return offlineTrack ? buildSongFromOffline(offlineTrack) : null;
  }, [currentId, offlineMap, selectedPlaylist, songs]);
  const canSkipPrevious = playbackQueue.length > 0 ? currentQueueIndex > 0 : currentTrackIndex > 0;
  const canSkipNext = playbackQueue.length > 0 ? currentQueueIndex >= 0 && currentQueueIndex < playbackQueue.length - 1 : currentTrackIndex >= 0 && (activeView === 'offline' ? currentTrackIndex < visibleOfflineTracks.length - 1 : currentTrackIndex < visibleTracks.length - 1);

  useEffect(() => { playbackQueueRef.current = playbackQueue; }, [playbackQueue]);
  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);

  function toast(tone: Tone, text: string) { setBanner({ tone, text }); }
  function updateCurrentSong(song: Song, target: PlaybackTarget) { setCurrentId(song.id); setCurrentTitle(song.title); setCurrentArtist(song.artist || ''); setCurrentThumbnail(song.thumbnail || null); setPlaybackTarget(target); if (target === 'remote') { setPositionMs(0); setDurationMs(0); setIsPlaying(true); } }
  function syncLockScreenForSong(player: AudioPlayer | null, song: Song | null) { if (!player || !song) return; player.setActiveForLockScreen(true, buildLockScreenMetadata(song)); }
  async function persistUser(next: User | null) { await safeSetSetting(SETTINGS.user, next ? JSON.stringify(next) : ''); setCurrentUser(next); }
  async function refreshOfflineLibrary() { setOfflineTracks(await safeListOfflineTracks()); }

  async function bootstrap() {
    setBooting(true);
    try {
      const [storageReady, audioReady] = await Promise.allSettled([safeInitDatabase(), trySetAudioMode()]);
      setCapabilities({ audio: audioReady.status === 'fulfilled', storage: storageReady.status === 'fulfilled' ? storageReady.value : false });
      const [storedBaseUrl, storedUser, storedDeviceId, storedLastLogin, storedOutputDeviceId, cachedSongs, cachedPlaylists, cachedOfflineTracks] = await Promise.all([safeGetSetting(SETTINGS.baseUrl), safeGetSetting(SETTINGS.user), safeGetSetting(SETTINGS.deviceId), safeGetSetting(SETTINGS.lastLogin), safeGetSetting(SETTINGS.outputDeviceId), safeGetCachedSongs(), safeGetCachedPlaylists(), safeListOfflineTracks()]);
      const nextDeviceId = storedDeviceId || id();
      const nextBaseUrl = normalizeBaseUrl(storedBaseUrl || '');
      const nextUser = parseUser(storedUser);
      if (!storedDeviceId) await safeSetSetting(SETTINGS.deviceId, nextDeviceId);
      setDeviceId(nextDeviceId);
      setBaseUrl(nextBaseUrl);
      setServerInput(nextBaseUrl || DEFAULT_SERVER_URL);
      setCurrentUser(nextUser);
      setUsernameInput(storedLastLogin || nextUser?.email || '');
      setSelectedOutputDeviceId(storedOutputDeviceId || nextDeviceId);
      setSongs(cachedSongs.filter(isAudioFocusedSong));
      setPlaylists(cachedPlaylists);
      setOfflineTracks(cachedOfflineTracks);
      setSelectedPlaylistId(cachedPlaylists[0]?.id || null);
      if (audioReady.status === 'rejected') toast('error', 'Audio nativo indisponivel nesta instalacao.');
      else if (storageReady.status === 'fulfilled' && !storageReady.value) toast('info', 'Cache local ativo em modo temporario.');
    } catch (error) { toast('error', err(error, 'Falha ao iniciar o MusFy.')); } finally { setBooting(false); }
  }

  useEffect(() => { void bootstrap(); }, []);
  useEffect(() => { if (booting) return; const timer = setTimeout(() => setShowSplash(false), 1100); return () => clearTimeout(timer); }, [booting]);
  useEffect(() => { if (!banner) return; const timer = setTimeout(() => setBanner(null), 3800); return () => clearTimeout(timer); }, [banner]);
  useEffect(() => () => { void unloadLocalPlayer(); }, []);
  useEffect(() => { if (!playlists.length) { setSelectedPlaylistId(null); return; } if (!selectedPlaylistId || !playlists.some((playlist) => playlist.id === selectedPlaylistId)) setSelectedPlaylistId(playlists[0].id); }, [playlists, selectedPlaylistId]);
  useEffect(() => { if (!deviceId) return; const valid = selectedOutputDeviceId === deviceId || devices.some((device) => device.deviceId === selectedOutputDeviceId); if (!valid) { setSelectedOutputDeviceId(deviceId); void safeSetSetting(SETTINGS.outputDeviceId, deviceId); } }, [deviceId, devices, selectedOutputDeviceId]);
  useEffect(() => { if (!selectedOutputDeviceId) return; void safeSetSetting(SETTINGS.outputDeviceId, selectedOutputDeviceId); }, [selectedOutputDeviceId]);

  async function syncHealth(targetBaseUrl = normalized, targetUserId = currentUserId, silent = true) {
    if (!targetBaseUrl || !deviceId) return;
    try {
      const nextHealth = await fetchHealth(targetBaseUrl);
      setHealth(nextHealth);
      await registerAndroidDevice(targetBaseUrl, deviceId, localDeviceName, targetUserId);
      if (!silent) toast(nextHealth.ready ? 'success' : 'info', nextHealth.ready ? 'Servidor conectado.' : 'Servidor respondeu.');
    } catch (error) { setHealth(null); if (!silent) toast('error', err(error, 'Falha ao conectar com o servidor.')); }
  }

  async function syncDevices(targetBaseUrl = normalized, targetUserId = currentUserId, silent = true) {
    if (!targetBaseUrl || !deviceId) return;
    try { setDevices(await fetchDevices(targetBaseUrl, { userId: targetUserId, excludeDeviceId: deviceId })); }
    catch (error) { if (!silent) toast('error', err(error, 'Falha ao listar dispositivos.')); }
  }

  async function syncSongs(targetView: ViewMode = activeView, targetBaseUrl = normalized, targetUserId = currentUserId, silent = true) {
    if (!targetBaseUrl || !targetUserId || targetView === 'playlists' || targetView === 'offline') return;
    try { const nextSongs = await fetchSongs(targetBaseUrl, targetUserId, targetView === 'favorites' ? 'favorites' : 'library'); const filtered = nextSongs.filter(isAudioFocusedSong); setSongs(filtered); await safeCacheSongs(filtered); }
    catch (error) { if (!silent) toast('error', err(error, 'Falha ao sincronizar as faixas.')); }
  }

  async function syncPlaylists(targetBaseUrl = normalized, targetUserId = currentUserId, silent = true) {
    if (!targetBaseUrl || !targetUserId) return;
    try { const nextPlaylists = await fetchPlaylists(targetBaseUrl, { userId: targetUserId, scope: 'mine' }); setPlaylists(nextPlaylists); await safeCachePlaylists(nextPlaylists); }
    catch (error) { if (!silent) toast('error', err(error, 'Falha ao sincronizar playlists.')); }
  }

  useEffect(() => { if (booting || !normalized || !deviceId) return; void syncHealth(); const timer = setInterval(() => void syncHealth(normalized, currentUserId, true), 15000); return () => clearInterval(timer); }, [booting, normalized, deviceId, currentUserId]);
  useEffect(() => { if (booting || !normalized || !deviceId) return; void syncDevices(); const timer = setInterval(() => void syncDevices(normalized, currentUserId, true), 8000); return () => clearInterval(timer); }, [booting, normalized, deviceId, currentUserId]);
  useEffect(() => { if (booting || !normalized || !currentUser || activeView === 'playlists' || activeView === 'offline') return; void syncSongs(); }, [booting, normalized, activeView, currentUser, currentUserId]);
  useEffect(() => { if (booting || !normalized || !currentUser) return; void syncPlaylists(); }, [booting, normalized, currentUser, currentUserId]);
  useEffect(() => {
    if (booting || currentUser) return;
    const probeUrl = normalizeBaseUrl(serverInput);
    if (!probeUrl) {
      setLoginHealth(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const nextHealth = await fetchHealth(probeUrl);
        if (!cancelled) setLoginHealth(nextHealth);
      } catch {
        if (!cancelled) setLoginHealth(null);
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [booting, currentUser, serverInput]);

  async function refreshAll() {
    setRefreshing(true);
    await Promise.allSettled([syncHealth(normalized, currentUserId, true), syncDevices(normalized, currentUserId, true), currentUser ? syncPlaylists(normalized, currentUserId, true) : Promise.resolve(), currentUser ? syncSongs(activeView, normalized, currentUserId, true) : Promise.resolve(), refreshOfflineLibrary()]);
    setRefreshing(false);
  }

  async function submitLogin() {
    const nextBaseUrl = normalizeBaseUrl(serverInput);
    if (!nextBaseUrl || !usernameInput.trim() || !passwordInput.trim()) { toast('error', 'Preencha servidor, usuario e senha.'); return; }
    setAuthBusy(true);
    try {
      await safeSetSetting(SETTINGS.baseUrl, nextBaseUrl);
      await safeSetSetting(SETTINGS.lastLogin, usernameInput.trim());
      const nextUser = await loginUser(nextBaseUrl, usernameInput.trim(), passwordInput.trim());
      setBaseUrl(nextBaseUrl);
      setServerInput(nextBaseUrl);
      await persistUser(nextUser);
      setPasswordInput('');
      await Promise.allSettled([syncHealth(nextBaseUrl, nextUser.id, false), syncDevices(nextBaseUrl, nextUser.id, true), syncSongs('library', nextBaseUrl, nextUser.id, true), syncPlaylists(nextBaseUrl, nextUser.id, true), refreshOfflineLibrary()]);
      setActiveView('library');
      toast('success', 'MusFy conectado.');
    } catch (error) { toast('error', err(error, 'Falha ao entrar.')); } finally { setAuthBusy(false); }
  }

  async function logout() { playbackRequestRef.current += 1; await unloadLocalPlayer(); await persistUser(null); setSongs([]); setPlaylists([]); setDevices([]); setHealth(null); setSelectedPlaylistId(null); setSelectedOutputDeviceId(deviceId); toast('info', 'Sessao encerrada.'); }
  function onStatus(status: AudioStatus) {
    if (!status.isLoaded) return;
    setIsPlaying(status.playing);
    setPositionMs(Math.round(Number(status.currentTime || 0) * 1000));
    setDurationMs(Math.round(Number(status.duration || 0) * 1000));
    if (status.didJustFinish) {
      const finishedSongId = currentIdRef.current;
      playerRef.current?.setActiveForLockScreen(false);
      if (playbackQueueRef.current.length > 1 && finishedSongId) {
        void advancePlaybackQueue(1, finishedSongId).then((advanced) => {
          if (!advanced) {
            setPlaybackQueue([]);
            setIsPlaying(false);
            setPositionMs(0);
          }
        });
        return;
      }
      setPlaybackQueue([]);
      setIsPlaying(false);
      setPositionMs(0);
    }
  }

  async function pushDeviceState(state?: { status?: string; currentSongId?: string | null; currentSongTitle?: string | null; currentSongArtist?: string | null; isPlaying?: boolean; currentTime?: number; duration?: number; errorMessage?: string | null; }) {
    if (!normalized || !deviceId) return;
    const isLocalPlayback = playbackTarget === 'local' && Boolean(currentId);
    try {
      await sendDeviceState(normalized, deviceId, {
        deviceName: localDeviceName,
        userId: currentUserId,
        platform: Platform.OS,
        status: state?.status || (isLocalPlayback ? (isPlaying ? 'playing' : 'paused') : 'idle'),
        currentSongId: state?.currentSongId ?? (isLocalPlayback ? currentId : null),
        currentSongTitle: state?.currentSongTitle ?? (isLocalPlayback ? currentTitle : null),
        currentSongArtist: state?.currentSongArtist ?? (isLocalPlayback ? currentArtist : null),
        isPlaying: state?.isPlaying ?? (isLocalPlayback ? isPlaying : false),
        currentTime: state?.currentTime ?? (isLocalPlayback ? positionMs : 0),
        duration: state?.duration ?? (isLocalPlayback ? durationMs : 0),
        volume: 1,
        errorMessage: state?.errorMessage || null
      });
    } catch {}
  }

  async function unloadLocalPlayer(clearCurrent = true) {
    playerStatusSubscriptionRef.current?.remove();
    playerStatusSubscriptionRef.current = null;
    if (playerRef.current) {
      const activePlayer = playerRef.current;
      playerRef.current = null;
      try {
        if (activePlayer.playing) activePlayer.pause();
        activePlayer.setActiveForLockScreen(false);
        activePlayer.remove();
      } catch {}
    }
    setIsPlaying(false);
    setPositionMs(0);
    setDurationMs(0);
    setPlaybackTarget('local');
    if (clearCurrent) { setCurrentId(null); setCurrentTitle(''); setCurrentArtist(''); setCurrentThumbnail(null); setPlaybackQueue([]); }
    await pushDeviceState({ status: 'idle', currentSongId: null, currentSongTitle: null, currentSongArtist: null, isPlaying: false, currentTime: 0, duration: 0 });
  }

  function buildVisibleQueue(startIndex = 0) {
    if (activeView === 'offline') {
      return visibleOfflineTracks.slice(startIndex).map<QueueEntry>((track) => ({ song: buildSongFromOffline(track), localUri: track.localUri }));
    }
    return visibleTracks.slice(startIndex).map<QueueEntry>((track) => ({ song: track, playlistId: selectedPlaylist?.id || null }));
  }

  async function advancePlaybackQueue(offset: number, fromSongId = currentIdRef.current) {
    const queue = playbackQueueRef.current;
    if (!queue.length || !fromSongId) return false;
    const queueIndex = queue.findIndex((entry) => entry.song.id === fromSongId);
    if (queueIndex < 0) return false;
    const nextEntry = queue[queueIndex + offset];
    if (!nextEntry) return false;
    await startLocalPlayback(nextEntry.song, nextEntry.localUri, undefined);
    return true;
  }

  async function startVisibleQueue(startIndex = 0) {
    const queue = buildVisibleQueue(startIndex);
    if (!queue.length) return;
    setSelectedOutputDeviceId(deviceId);
    await startLocalPlayback(queue[0].song, queue[0].localUri, queue);
  }

  async function startLocalPlayback(song: Song, localUri?: string, queueOverride?: QueueEntry[] | null) {
    if (!capabilities.audio) { toast('error', 'Audio nativo indisponivel nesta instalacao.'); return; }
    const offlineTrack = offlineMap.get(song.id);
    const sourceUri = localUri || offlineTrack?.localUri || (normalized ? buildAudioStreamUrl(normalized, song.id) : '');
    if (!sourceUri) { toast('error', 'Sem acesso ao servidor e sem copia offline desta faixa.'); return; }
    const requestId = playbackRequestRef.current + 1;
    playbackRequestRef.current = requestId;
    setPlayerBusy(true);
    try {
      if (queueOverride) setPlaybackQueue(queueOverride);
      else if (queueOverride === null) setPlaybackQueue([]);
      if (playerRef.current && currentId === song.id && playbackTarget === 'local') {
        const status = playerRef.current.currentStatus;
        if (status.isLoaded) {
          if (playerRef.current.playing) { playerRef.current.pause(); setIsPlaying(false); } else { await trySetAudioMode(); syncLockScreenForSong(playerRef.current, song); playerRef.current.play(); setIsPlaying(true); }
          return;
        }
      }
      await unloadLocalPlayer(false);
      if (requestId !== playbackRequestRef.current) return;
      await trySetAudioMode();
      if (requestId !== playbackRequestRef.current) return;
      const audio = await loadAudioModule();
      if (requestId !== playbackRequestRef.current) return;
      const player = audio.createAudioPlayer(sourceUri, { updateInterval: 500 });
      if (requestId !== playbackRequestRef.current) {
        player.remove();
        return;
      }
      syncLockScreenForSong(player, song);
      playerStatusSubscriptionRef.current = player.addListener('playbackStatusUpdate', onStatus);
      playerRef.current = player;
      updateCurrentSong(song, 'local');
      player.play();
      setIsPlaying(true);
    } catch (error) {
      await unloadLocalPlayer();
      toast('error', err(error, 'Falha ao tocar a faixa.'));
      await pushDeviceState({ status: 'error', errorMessage: err(error, 'Falha ao tocar a faixa.') });
    } finally { setPlayerBusy(false); }
  }

  async function sendRemoteCommandPayload(payload: PlayerCommand) {
    if (!normalized || !selectedOutputDevice || !selectedOutputDeviceId || selectedOutputDeviceId === deviceId) return false;
    await sendDeviceCommand(normalized, selectedOutputDeviceId, { sourceDeviceId: deviceId, sourceDeviceName: localDeviceName, userId: currentUserId, targetDeviceName: selectedOutputDevice.deviceName, payload });
    return true;
  }

  async function playTrack(song: Song, forceLocal = false) {
    const usingRemoteOutput = !forceLocal && selectedOutputDeviceId && selectedOutputDeviceId !== deviceId;
    if (usingRemoteOutput) {
      try { playbackRequestRef.current += 1; await unloadLocalPlayer(); await sendRemoteCommandPayload({ type: 'PLAY_SONG', song }); updateCurrentSong(song, 'remote'); toast('success', `Tocando em ${selectedOutputDevice?.deviceName || 'outro dispositivo'}.`); }
      catch (error) { toast('error', err(error, 'Falha ao enviar a reproducao remota.')); }
      return;
    }
    await startLocalPlayback(song, undefined, null);
  }

  async function playOfflineTrack(track: OfflineTrack) { await startLocalPlayback(buildSongFromOffline(track), track.localUri, null); }
  async function togglePlayback(forceLocal = false) {
    const shouldControlRemote = !forceLocal && playbackTarget === 'remote' && selectedOutputDeviceId && selectedOutputDeviceId !== deviceId;
    if (shouldControlRemote) {
      try { await sendRemoteCommandPayload({ type: 'TOGGLE_PLAY' }); setIsPlaying((current) => !current); }
      catch (error) { toast('error', err(error, 'Falha ao alternar a reproducao remota.')); }
      return;
    }
    if (!playerRef.current) return;
    const status = playerRef.current.currentStatus;
    if (!status.isLoaded) return;
    if (playerRef.current.playing) { playerRef.current.pause(); setIsPlaying(false); }
    else { await trySetAudioMode(); syncLockScreenForSong(playerRef.current, currentPlaybackSong); playerRef.current.play(); setIsPlaying(true); }
  }

  async function playAdjacent(offset: number) {
    if (playbackQueueRef.current.length > 1) {
      const advanced = await advancePlaybackQueue(offset);
      if (!advanced && offset > 0) setPlaybackQueue([]);
      return;
    }
    if (activeView === 'offline') {
      if (!visibleOfflineTracks.length || currentTrackIndex < 0) return;
      const nextTrack = visibleOfflineTracks[currentTrackIndex + offset];
      if (nextTrack) await playOfflineTrack(nextTrack);
      return;
    }
    if (!visibleTracks.length || currentTrackIndex < 0) return;
    const nextTrack = visibleTracks[currentTrackIndex + offset];
    if (nextTrack) await playTrack(nextTrack);
  }

  function mergeSongEverywhere(nextSong: Song) {
    setSongs((current) => {
      const nextSongs = current.map((song) => (song.id === nextSong.id ? { ...song, ...nextSong } : song));
      void safeCacheSongs(nextSongs);
      return nextSongs;
    });
    setPlaylists((current) => {
      const nextPlaylists = current.map((playlist) => ({
        ...playlist,
        songs: playlist.songs?.map((song) => (song.id === nextSong.id ? { ...song, ...nextSong } : song))
      }));
      void safeCachePlaylists(nextPlaylists);
      return nextPlaylists;
    });
  }
  async function toggleSongFavorite(song: Song) { if (!normalized || !currentUser) { toast('info', 'Entre com sua conta para favoritar.'); return; } try { mergeSongEverywhere(await toggleFavorite(normalized, song.id, !song.favorite, currentUser.id)); } catch (error) { toast('error', err(error, 'Falha ao atualizar favorito.')); } }

  async function toggleOfflineSong(song: Song, playlistId?: string) {
    if (!capabilities.storage) { toast('error', 'Armazenamento local indisponivel nesta instalacao.'); return; }
    const existing = offlineMap.get(song.id);
    setOfflineBusyId(song.id);
    try {
      if (existing) { await safeRemoveSongOffline(existing); await refreshOfflineLibrary(); toast('info', 'Faixa removida do offline.'); }
      else { if (!normalized) throw new Error('Servidor MusFy nao configurado.'); await safeDownloadSongOffline(normalized, song, playlistId); await refreshOfflineLibrary(); toast('success', 'Faixa salva para ouvir offline.'); }
    } catch (error) { toast('error', err(error, 'Falha ao atualizar o offline.')); } finally { setOfflineBusyId(null); }
  }

  async function executeRemoteCommand(command: DeviceCommand) {
    const payload = command.payload || null;
    if (!payload || typeof payload !== 'object') throw new Error('Comando remoto invalido.');
    const type = String((payload as Record<string, unknown>).type || '');
    if (type === 'PLAY_SONG') { const song = asSong((payload as Record<string, unknown>).song); if (!song) throw new Error('Faixa remota invalida.'); await playTrack(song, true); toast('info', `Reproduzindo de ${command.sourceDeviceName || 'MusFy'}.`); return; }
    if (type === 'TOGGLE_PLAY') { await togglePlayback(true); return; }
    throw new Error('Tipo de comando remoto nao suportado.');
  }

  useEffect(() => {
    if (booting || !normalized || !deviceId) return;
    let alive = true;
    const poll = async () => {
      if (commandLockRef.current) return;
      commandLockRef.current = true;
      try {
        const command = await fetchDeviceCommand(normalized, deviceId, { deviceName: localDeviceName, userId: currentUserId, platform: Platform.OS, after: lastCommandIdRef.current });
        if (!alive || !command || !command.commandId || command.commandId <= lastCommandIdRef.current) return;
        try { await executeRemoteCommand(command); await ackDeviceCommand(normalized, deviceId, { deviceName: localDeviceName, userId: currentUserId, platform: Platform.OS, commandId: command.commandId, status: 'completed' }); }
        catch (error) { await ackDeviceCommand(normalized, deviceId, { deviceName: localDeviceName, userId: currentUserId, platform: Platform.OS, commandId: command.commandId, status: 'error', details: err(error, 'Falha ao executar comando remoto.') }); }
        finally { lastCommandIdRef.current = command.commandId; }
      } catch {} finally { commandLockRef.current = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1800);
    return () => { alive = false; clearInterval(timer); };
  }, [booting, normalized, deviceId, currentUserId, localDeviceName]);

  useEffect(() => { if (booting || !normalized || !deviceId) return; const timer = setTimeout(() => void pushDeviceState(), 250); return () => clearTimeout(timer); }, [booting, normalized, deviceId, currentUserId, playbackTarget, currentId, currentTitle, currentArtist, isPlaying, positionMs, durationMs]);
  useEffect(() => { if (booting || !normalized || !deviceId) return; const timer = setInterval(() => void pushDeviceState(), 7000); return () => clearInterval(timer); }, [booting, normalized, deviceId, currentUserId, playbackTarget, currentId, isPlaying, positionMs, durationMs]);

  function renderLogin() {
    const shownHealth = loginHealth || health;
    return <SafeAreaView style={styles.root}><StatusBar style="light" /><LinearGradient colors={['#0b0c0e', '#111317']} style={styles.loginGradient}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.loginShell}><View style={styles.loginHero}><MusFyLogo size={86} /><Text style={styles.loginBrand}>MusFy</Text><Text style={styles.loginSubtle}>Conecte no servidor e reproduza sua biblioteca.</Text></View><View style={styles.loginCard}><View style={styles.fieldHeaderRow}><Text style={styles.fieldLabel}>Servidor</Text><Pressable style={styles.defaultChip} onPress={() => setServerInput(baseUrl || DEFAULT_SERVER_URL)}><RefreshCw size={14} color="#dfe5ea" strokeWidth={2.4} /><Text style={styles.defaultChipText}>Padrao</Text></Pressable></View><View style={styles.inputWrap}><Server size={16} color="#8f98a3" strokeWidth={2.4} /><TextInput style={styles.input} placeholder="http://192.168.0.10:3001" placeholderTextColor="#626a73" autoCapitalize="none" value={serverInput} onChangeText={setServerInput} /></View><Text style={styles.fieldLabel}>Usuario</Text><View style={styles.inputWrap}><UserRound size={16} color="#8f98a3" strokeWidth={2.4} /><TextInput style={styles.input} placeholder="usuario" placeholderTextColor="#626a73" autoCapitalize="none" value={usernameInput} onChangeText={setUsernameInput} /></View><Text style={styles.fieldLabel}>Senha</Text><View style={styles.inputWrap}><CircleAlert size={16} color="#8f98a3" strokeWidth={2.4} /><TextInput style={styles.input} placeholder="senha" placeholderTextColor="#626a73" secureTextEntry value={passwordInput} onChangeText={setPasswordInput} /></View><View style={styles.loginFooter}><View style={styles.loginStatusRow}>{shownHealth?.ready ? <Wifi size={16} color="#1ed760" strokeWidth={2.4} /> : <WifiOff size={16} color="#8f98a3" strokeWidth={2.4} />}<Text style={styles.loginStatusText}>{shownHealth?.ready ? 'Servidor ativo' : 'Aguardando conexao'}</Text></View><IconButton icon={ArrowRight} kind="primary" onPress={() => void submitLogin()} busy={authBusy} /></View></View></KeyboardAvoidingView></LinearGradient></SafeAreaView>;
  }

  function renderHeader() {
    return <View style={styles.headerRow}><View style={styles.headerBrand}><MusFyLogo size={48} /><View><Text style={styles.headerTitle}>MusFy</Text><Text style={styles.headerMeta}>{health?.ready ? 'Servidor online' : 'Modo cache / offline'}</Text></View></View><View style={styles.headerActions}><IconButton icon={RefreshCw} kind="soft" onPress={() => void refreshAll()} /><IconButton icon={LogOut} onPress={() => void logout()} /></View></View>;
  }

  function renderPlayer() {
    const remoteState = remoteSelected ? selectedOutputDevice?.lastState : null;
    const shownTitle = remoteSelected && remoteState?.currentSongTitle ? remoteState.currentSongTitle : currentTitle || 'Escolha uma faixa';
    const shownArtist = remoteSelected && remoteState?.currentSongArtist ? remoteState.currentSongArtist : currentArtist || (currentUser?.nome || 'MusFy');
    const shownStatus = remoteSelected ? remoteState?.status || 'ativo' : playbackTarget === 'remote' ? 'enviado' : isPlaying ? 'tocando' : 'pronto';
    const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
    return <View style={styles.playerShell}><LinearGradient colors={['#181a1f', '#111318']} style={styles.playerCard}><View style={styles.playerTop}><Artwork uri={currentThumbnail} size={112} radius={26} /><View style={styles.playerBody}><View style={styles.playerBadgeRow}><View style={styles.playerBadge}><Speaker size={12} color="#d8dde2" strokeWidth={2.4} /><Text style={styles.playerBadgeText}>{selectedOutputDevice?.deviceName || 'Este celular'}</Text></View><View style={styles.playerBadge}><Text style={styles.playerBadgeText}>{shownStatus}</Text></View>{playbackQueue.length > 1 ? <View style={styles.playerBadge}><Text style={styles.playerBadgeText}>lista ativa</Text></View> : null}</View><Text numberOfLines={2} style={styles.playerTitle}>{shownTitle}</Text><Text numberOfLines={1} style={styles.playerArtist}>{shownArtist}</Text><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(5, progress * 100)}%` }]} /></View><View style={styles.progressMetaRow}><Text style={styles.progressMeta}>{remoteSelected ? (remoteState?.status || 'remoto') : formatTime(positionMs)}</Text><Text style={styles.progressMeta}>{remoteSelected ? 'rede local' : formatTime(durationMs)}</Text></View></View></View><View style={styles.controlsRow}><IconButton icon={SkipBack} onPress={() => void playAdjacent(-1)} disabled={!canSkipPrevious} /><IconButton icon={isPlaying && playbackTarget !== 'remote' ? Pause : Play} kind="primary" onPress={() => void togglePlayback()} disabled={(!currentId && playbackTarget === 'local') || playerBusy} busy={playerBusy} /><IconButton icon={SkipForward} onPress={() => void playAdjacent(1)} disabled={!canSkipNext} />{currentPlaybackSong ? <IconButton icon={offlineMap.has(currentPlaybackSong.id) ? Check : Download} kind={offlineMap.has(currentPlaybackSong.id) ? 'soft' : 'ghost'} onPress={() => void toggleOfflineSong(currentPlaybackSong, selectedPlaylist?.id)} busy={offlineBusyId === currentPlaybackSong.id} /> : null}</View></LinearGradient><View style={styles.outputPanel}><View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Tocar em</Text><Text style={styles.sectionMeta}>{outputDevices.length > 1 ? `${outputDevices.length} dispositivos` : 'Somente este celular'}</Text></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.outputRow}>{outputDevices.map((device) => { const active = device.deviceId === selectedOutputDeviceId; const isLocal = device.deviceId === deviceId; const DeviceIcon = isLocal ? Smartphone : Speaker; const deviceState = isLocal ? (isPlaying ? 'tocando' : currentId ? 'pausado' : 'local') : device.lastState?.status || 'ativo'; return <Pressable key={device.deviceId} style={[styles.outputChip, active && styles.outputChipActive]} onPress={() => setSelectedOutputDeviceId(device.deviceId)}><DeviceIcon size={16} color={active ? '#ffffff' : '#cfd4d9'} strokeWidth={2.4} /><View style={styles.outputChipTextBlock}><Text numberOfLines={1} style={[styles.outputChipTitle, active && styles.outputChipTitleActive]}>{isLocal ? 'Este celular' : device.deviceName || 'MusFy'}</Text><Text numberOfLines={1} style={[styles.outputChipMeta, active && styles.outputChipMetaActive]}>{deviceState}</Text></View></Pressable>; })}</ScrollView></View></View>;
  }

  function renderPlaylistStrip() {
    if (!playlists.length) return null;
    return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.playlistStrip}>{playlists.map((playlist) => { const active = playlist.id === selectedPlaylistId; return <Pressable key={playlist.id} style={[styles.playlistPill, active && styles.playlistPillActive]} onPress={() => setSelectedPlaylistId(playlist.id)}><Text style={[styles.playlistPillTitle, active && styles.playlistPillTitleActive]} numberOfLines={1}>{playlist.name}</Text><Text style={[styles.playlistPillMeta, active && styles.playlistPillMetaActive]}>{(playlist.songs || []).filter(isAudioFocusedSong).length} faixas</Text></Pressable>; })}</ScrollView>;
  }

  function renderTrackListHeader() {
    const listSize = activeView === 'offline' ? visibleOfflineTracks.length : visibleTracks.length;
    const title = activeView === 'playlists' ? selectedPlaylist?.name || 'Playlist' : activeView === 'favorites' ? 'Favoritas' : activeView === 'offline' ? 'Offline' : 'Biblioteca';
    const queueActive = playbackQueue.length > 1 && playbackTarget === 'local';
    return <View style={styles.trackSectionHeader}><View style={styles.trackSectionMetaBlock}><Text style={styles.trackSectionTitle}>{title}</Text><Text style={styles.trackSectionMeta}>{listSize} faixas</Text></View><Pressable style={[styles.listActionButton, queueActive && styles.listActionButtonActive, (!listSize || playerBusy) && styles.iconButtonDisabled]} onPress={() => void startVisibleQueue()} disabled={!listSize || playerBusy}><Play size={14} color={queueActive ? '#08130d' : '#1ed760'} fill={queueActive ? '#08130d' : 'transparent'} strokeWidth={2.5} /><Text style={[styles.listActionText, queueActive && styles.listActionTextActive]}>{queueActive ? 'Lista ativa' : 'Tocar lista'}</Text></Pressable></View>;
  }

  function renderTrack(song: Song) {
    const active = song.id === currentId;
    const savedOffline = offlineMap.has(song.id);
    return <Pressable key={song.id} style={[styles.trackRow, active && styles.trackRowActive]} onPress={() => void playTrack(song)}><View style={styles.trackLead}><Artwork uri={song.thumbnail} size={52} radius={14} /><View style={styles.trackTextBlock}><Text numberOfLines={1} style={[styles.trackTitle, active && styles.trackTitleActive]}>{song.title}</Text><Text numberOfLines={1} style={styles.trackArtist}>{song.artist || 'MusFy'}</Text></View></View><View style={styles.trackMetaRight}><View style={styles.trackActions}>{savedOffline ? <Text style={styles.trackStateText}>offline</Text> : null}<IconButton icon={Heart} kind={song.favorite ? 'soft' : 'ghost'} size="sm" active={song.favorite} fillActive onPress={() => void toggleSongFavorite(song)} /><IconButton icon={savedOffline ? Check : Download} kind={savedOffline ? 'soft' : 'ghost'} size="sm" onPress={() => void toggleOfflineSong(song, selectedPlaylist?.id)} busy={offlineBusyId === song.id} /><IconButton icon={active && isPlaying && playbackTarget === 'local' ? Pause : Play} kind="primary" size="sm" onPress={() => void playTrack(song)} /></View></View></Pressable>;
  }

  function renderOfflineTrack(track: OfflineTrack) {
    const active = track.songId === currentId;
    return <Pressable key={track.songId} style={[styles.trackRow, active && styles.trackRowActive]} onPress={() => void playOfflineTrack(track)}><View style={styles.trackLead}><Artwork uri={track.thumbnail} size={52} radius={14} /><View style={styles.trackTextBlock}><Text numberOfLines={1} style={[styles.trackTitle, active && styles.trackTitleActive]}>{track.title}</Text><Text numberOfLines={1} style={styles.trackArtist}>{track.artist || 'Offline'}</Text><Text numberOfLines={1} style={styles.offlineMeta}>{formatBytes(track.sizeBytes)}{track.sizeBytes ? ' salvo no aparelho' : 'salvo offline'}</Text></View></View><View style={styles.trackMetaRight}><View style={styles.trackActions}><Text style={styles.trackStateText}>offline</Text><IconButton icon={Check} kind="soft" size="sm" onPress={() => { setOfflineBusyId(track.songId); void safeRemoveSongOffline(track).then(refreshOfflineLibrary).then(() => toast('info', 'Faixa removida do offline.')).catch((error) => toast('error', err(error, 'Falha ao remover o offline.'))).finally(() => setOfflineBusyId(null)); }} busy={offlineBusyId === track.songId} /><IconButton icon={active && isPlaying && playbackTarget === 'local' ? Pause : Play} kind="primary" size="sm" onPress={() => void playOfflineTrack(track)} /></View></View></Pressable>;
  }

  function renderTracks() {
    if (activeView === 'offline') {
      if (!visibleOfflineTracks.length) return <View style={styles.emptyState}><Download size={22} color="#9199a3" strokeWidth={2.2} /><Text style={styles.emptyTitle}>Nada salvo offline</Text><Text style={styles.emptyBody}>Use o icone de download nas faixas para ouvir fora da rede.</Text></View>;
      return <View style={styles.trackList}>{visibleOfflineTracks.map((track) => renderOfflineTrack(track))}</View>;
    }
    if (activeView === 'playlists' && !playlists.length) return <View style={styles.emptyState}><ListMusic size={22} color="#9199a3" strokeWidth={2.2} /><Text style={styles.emptyTitle}>Nenhuma playlist</Text><Text style={styles.emptyBody}>Suas playlists do servidor aparecem aqui.</Text></View>;
    if (!visibleTracks.length) return <View style={styles.emptyState}><Search size={22} color="#9199a3" strokeWidth={2.2} /><Text style={styles.emptyTitle}>Nada por aqui</Text><Text style={styles.emptyBody}>Ajuste a busca ou sincronize novamente.</Text></View>;
    return <View style={styles.trackList}>{visibleTracks.map((song) => renderTrack(song))}</View>;
  }

  function renderMain() {
    return <SafeAreaView style={styles.root}><StatusBar style="light" /><LinearGradient colors={['#0b0c0e', '#111317']} style={styles.mainGradient}><ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} tintColor="#1ed760" />} showsVerticalScrollIndicator={false}>{renderHeader()}{renderPlayer()}<View style={styles.searchBar}><Search size={18} color="#8f98a3" strokeWidth={2.4} /><TextInput style={styles.searchInput} placeholder="Buscar faixa ou artista" placeholderTextColor="#626a73" value={search} onChangeText={setSearch} /></View><SegmentTabs items={['library', 'favorites', 'playlists', 'offline'] as const} selected={activeView} meta={VIEW_META} onChange={setActiveView} />{activeView === 'playlists' ? renderPlaylistStrip() : null}{renderTrackListHeader()}{renderTracks()}</ScrollView></LinearGradient></SafeAreaView>;
  }

  if (showSplash) return <SplashScreenView />;
  return <>{!currentUser ? renderLogin() : renderMain()}{banner ? <View pointerEvents="none" style={[styles.banner, banner.tone === 'success' && styles.bannerSuccess, banner.tone === 'error' && styles.bannerError]}><Text style={styles.bannerText}>{banner.text}</Text></View> : null}</>;
}

export default function App() {
  return <RootErrorBoundary><MusFyApp /></RootErrorBoundary>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#090a0c' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 34, gap: 18 },
  mainGradient: { flex: 1 },
  splashRoot: { flex: 1, backgroundColor: '#090a0c' },
  splashGradient: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  splashTitle: { color: '#ffffff', fontSize: 38, fontWeight: '900' },
  splashCaption: { color: '#98a1ab', fontSize: 14 },
  fatalRoot: { flex: 1, backgroundColor: '#090a0c' },
  fatalGradient: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  fatalTitle: { color: '#ffffff', fontSize: 32, fontWeight: '900', marginTop: 16 },
  fatalBody: { color: '#a9b0b9', fontSize: 14, textAlign: 'center', marginTop: 8 },
  loginGradient: { flex: 1 },
  loginShell: { flex: 1, justifyContent: 'center', padding: 22, gap: 20 },
  loginHero: { alignItems: 'center', gap: 10, marginBottom: 6 },
  loginBrand: { color: '#ffffff', fontSize: 36, fontWeight: '900' },
  loginSubtle: { color: '#9aa2ac', fontSize: 14, textAlign: 'center' },
  loginCard: { backgroundColor: '#14171b', borderRadius: 28, padding: 18, borderWidth: 1, borderColor: '#24282e', gap: 10 },
  fieldHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { color: '#cdd2d8', fontSize: 12, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', marginTop: 8 },
  defaultChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#1c2025', borderWidth: 1, borderColor: '#2b3038' },
  defaultChipText: { color: '#dfe5ea', fontSize: 12, fontWeight: '700' },
  inputWrap: { minHeight: 56, borderRadius: 18, paddingHorizontal: 14, backgroundColor: '#111419', borderWidth: 1, borderColor: '#24282e', flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, color: '#ffffff', fontSize: 15, paddingVertical: 0 },
  loginFooter: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  loginStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loginStatusText: { color: '#9aa2ac', fontSize: 13, fontWeight: '600' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerTitle: { color: '#ffffff', fontSize: 28, fontWeight: '900' },
  headerMeta: { color: '#8f98a3', fontSize: 13 },
  headerActions: { flexDirection: 'row', gap: 8 },
  playerShell: { gap: 14 },
  playerCard: { borderRadius: 28, padding: 18, borderWidth: 1, borderColor: '#24282e', gap: 18 },
  playerTop: { flexDirection: 'row', gap: 16 },
  artworkFallback: { backgroundColor: '#111419', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  playerBody: { flex: 1, justifyContent: 'space-between' },
  playerBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  playerBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#1b1f24' },
  playerBadgeText: { color: '#d8dde2', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  playerTitle: { color: '#ffffff', fontSize: 24, fontWeight: '900', marginTop: 10 },
  playerArtist: { color: '#9aa2ac', fontSize: 14, marginTop: 4 },
  progressTrack: { width: '100%', height: 6, borderRadius: 999, backgroundColor: '#1e2228', marginTop: 16, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: '#1ed760' },
  progressMetaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  progressMeta: { color: '#87909a', fontSize: 12, fontWeight: '600' },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  outputPanel: { backgroundColor: '#14171b', borderRadius: 24, borderWidth: 1, borderColor: '#24282e', padding: 16, gap: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  sectionMeta: { color: '#8f98a3', fontSize: 12 },
  outputRow: { gap: 10, paddingRight: 12 },
  outputChip: { width: 168, borderRadius: 20, padding: 14, backgroundColor: '#111419', borderWidth: 1, borderColor: '#24282e', flexDirection: 'row', alignItems: 'center', gap: 12 },
  outputChipActive: { borderColor: '#1ed760', backgroundColor: '#171c1a' },
  outputChipTextBlock: { flex: 1 },
  outputChipTitle: { color: '#f1f3f5', fontSize: 14, fontWeight: '800' },
  outputChipTitleActive: { color: '#ffffff' },
  outputChipMeta: { color: '#8a939d', fontSize: 11, marginTop: 4, textTransform: 'uppercase' },
  outputChipMetaActive: { color: '#b8c0c7' },
  searchBar: { minHeight: 56, borderRadius: 18, paddingHorizontal: 16, backgroundColor: '#121417', borderWidth: 1, borderColor: '#22272d', flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: { flex: 1, color: '#ffffff', fontSize: 15, paddingVertical: 0 },
  segmentWrap: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  segmentItem: { minWidth: 92, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18, backgroundColor: '#121417', borderWidth: 1, borderColor: '#22272d', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  segmentItemActive: { backgroundColor: '#161d18', borderColor: '#1ed760' },
  segmentText: { color: '#a4adb7', fontSize: 13, fontWeight: '700' },
  segmentTextActive: { color: '#ffffff' },
  playlistStrip: { gap: 10, paddingRight: 12 },
  playlistPill: { width: 158, borderRadius: 22, padding: 14, backgroundColor: '#14171b', borderWidth: 1, borderColor: '#24282e' },
  playlistPillActive: { borderColor: '#1ed760', backgroundColor: '#171c1a' },
  playlistPillTitle: { color: '#eef1f4', fontSize: 14, fontWeight: '800' },
  playlistPillTitleActive: { color: '#ffffff' },
  playlistPillMeta: { color: '#89929c', fontSize: 12, marginTop: 8 },
  playlistPillMetaActive: { color: '#b9c2ca' },
  trackSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  trackSectionMetaBlock: { gap: 3 },
  trackSectionTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  trackSectionMeta: { color: '#8f98a3', fontSize: 12 },
  listActionButton: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#141a16', borderWidth: 1, borderColor: '#1f7a3f' },
  listActionButtonActive: { backgroundColor: '#1ed760', borderColor: '#1ed760' },
  listActionText: { color: '#d9ffe4', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  listActionTextActive: { color: '#08130d' },
  trackList: { borderRadius: 24, borderWidth: 1, borderColor: '#1f2429', backgroundColor: '#0f1114', overflow: 'hidden' },
  trackRow: { minHeight: 82, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1f24', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  trackRowActive: { backgroundColor: '#141a16', borderBottomColor: '#233128' },
  trackLead: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  trackIndex: { width: 26, color: '#6f7882', fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  trackIndexActive: { color: '#1ed760' },
  trackTextBlock: { flex: 1 },
  trackTitle: { color: '#f7f8f8', fontSize: 15, fontWeight: '800' },
  trackTitleActive: { color: '#ffffff' },
  trackArtist: { color: '#929aa4', fontSize: 13, marginTop: 4 },
  offlineMeta: { color: '#6fbf86', fontSize: 11, marginTop: 6 },
  trackMetaRight: { alignItems: 'flex-end', justifyContent: 'center' },
  trackStateText: { color: '#1ed760', fontSize: 10, fontWeight: '800', letterSpacing: 0.9, textTransform: 'uppercase' },
  trackActions: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end' },
  emptyState: { minHeight: 190, borderRadius: 24, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#14171b', borderWidth: 1, borderColor: '#24282e', padding: 20 },
  emptyTitle: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  emptyBody: { color: '#8f98a3', fontSize: 13, textAlign: 'center' },
  iconButton: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1e24', borderWidth: 1, borderColor: '#262b33' },
  iconButtonSmall: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#161a1f' },
  iconButtonPrimary: { backgroundColor: '#1ed760', borderColor: '#1ed760' },
  iconButtonSoft: { backgroundColor: '#1c2520', borderColor: '#244a30' },
  iconButtonActive: { borderColor: '#1ed760' },
  iconButtonDisabled: { opacity: 0.45 },
  banner: { position: 'absolute', left: 18, right: 18, bottom: 24, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#191d22', borderWidth: 1, borderColor: '#2b3038' },
  bannerSuccess: { backgroundColor: '#122017', borderColor: '#1e5e33' },
  bannerError: { backgroundColor: '#2a1419', borderColor: '#6c2b35' },
  bannerText: { color: '#f4f7f4', fontSize: 13, fontWeight: '700', textAlign: 'center' }
});

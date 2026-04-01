import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus
} from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import {
  addSongToPlaylist,
  buildAudioStreamUrl,
  createPlaylist,
  deletePlaylist,
  enqueueYoutubeDownload,
  fetchDownloadJobs,
  fetchHealth,
  fetchPlaylists,
  fetchSongs,
  loginUser,
  normalizeBaseUrl,
  pauseDownloadJob,
  registerAndroidDevice,
  registerUser,
  removeSongFromPlaylist,
  renamePlaylist,
  resumeDownloadJob,
  toggleFavorite
} from './src/api/client';
import {
  cachePlaylists,
  cacheSongs,
  getCachedPlaylists,
  getCachedSongs,
  getSetting,
  initDatabase,
  listOfflineTracks,
  setSetting
} from './src/storage/database';
import { downloadPlaylistOffline, downloadSongOffline, removeSongOffline } from './src/storage/offline';
import type {
  DownloadJob,
  DownloadMode,
  HealthStatus,
  OfflineTrack,
  Playlist,
  PlaylistScope,
  Song,
  SongSection,
  User
} from './src/types';

type Tab = 'server' | 'library' | 'playlists' | 'offline' | 'downloads';
type Tone = 'info' | 'success' | 'error';
type AuthMode = 'login' | 'register';
type Source = 'stream' | 'offline';

const SETTINGS = {
  baseUrl: 'mobile.baseUrl',
  user: 'mobile.user',
  deviceId: 'mobile.deviceId'
} as const;

const TABS: Tab[] = ['server', 'library', 'playlists', 'offline', 'downloads'];
const TAB_LABEL: Record<Tab, string> = {
  server: 'Servidor',
  library: 'Biblioteca',
  playlists: 'Playlists',
  offline: 'Offline',
  downloads: 'Fila'
};

const SONG_SECTIONS: SongSection[] = ['library', 'favorites', 'explore'];
const SONG_LABEL: Record<SongSection, string> = {
  library: 'Minha',
  favorites: 'Favoritas',
  explore: 'Explorar'
};

const PLAYLIST_SCOPES: PlaylistScope[] = ['mine', 'discover'];
const PLAYLIST_LABEL: Record<PlaylistScope, string> = {
  mine: 'Minhas',
  discover: 'Descobrir'
};

const DOWNLOAD_MODES: DownloadMode[] = ['auto', 'audio', 'video', 'playlist'];
const DOWNLOAD_LABEL: Record<DownloadMode, string> = {
  auto: 'Auto',
  audio: 'Audio',
  video: 'Video',
  playlist: 'Playlist'
};

function id() {
  return `musfy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function err(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

function parseUser(raw: string | null) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as User;
    return value?.id ? value : null;
  } catch {
    return null;
  }
}

function bytes(value: number) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function mmss(value: number) {
  const total = Math.max(0, Math.floor(value / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function App() {
  const playerRef = useRef<AudioPlayer | null>(null);
  const playerStatusSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const [booting, setBooting] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('server');
  const [banner, setBanner] = useState<{ tone: Tone; text: string } | null>(null);

  const [baseUrl, setBaseUrl] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [songs, setSongs] = useState<Song[]>([]);
  const [section, setSection] = useState<SongSection>('library');
  const [songBusyId, setSongBusyId] = useState<string | null>(null);

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistScope, setPlaylistScope] = useState<PlaylistScope>('mine');
  const [playlistName, setPlaylistName] = useState('');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [playlistBusyId, setPlaylistBusyId] = useState<string | null>(null);

  const [offlineTracks, setOfflineTracks] = useState<OfflineTrack[]>([]);
  const [offlineBusyId, setOfflineBusyId] = useState<string | null>(null);
  const [offlineProgress, setOfflineProgress] = useState('');

  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadTitle, setDownloadTitle] = useState('');
  const [downloadArtist, setDownloadArtist] = useState('');
  const [downloadMode, setDownloadMode] = useState<DownloadMode>('auto');
  const [includeVideo, setIncludeVideo] = useState(false);
  const [jobsBusy, setJobsBusy] = useState(false);

  const [playerBusy, setPlayerBusy] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState('');
  const [currentArtist, setCurrentArtist] = useState('');
  const [currentSource, setCurrentSource] = useState<Source | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  const selectedPlaylist = playlists.find((item) => item.id === selectedPlaylistId) || null;
  const normalized = normalizeBaseUrl(baseUrl);
  const currentUserId = user?.id || null;
  const offlineBytes = offlineTracks.reduce((sum, track) => sum + Number(track.sizeBytes || 0), 0);

  function toast(tone: Tone, text: string) {
    setBanner({ tone, text });
  }

  async function persistUser(next: User | null) {
    await setSetting(SETTINGS.user, next ? JSON.stringify(next) : '');
    setUser(next);
  }

  async function loadOffline() {
    setOfflineTracks(await listOfflineTracks());
  }

  async function bootstrap() {
    setBooting(true);
    try {
      await initDatabase();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false
      });
      const [storedBaseUrl, storedUser, storedDeviceId, cachedSongs, cachedPlaylists, cachedOffline] =
        await Promise.all([
          getSetting(SETTINGS.baseUrl),
          getSetting(SETTINGS.user),
          getSetting(SETTINGS.deviceId),
          getCachedSongs(),
          getCachedPlaylists(),
          listOfflineTracks()
        ]);
      const nextDeviceId = storedDeviceId || id();
      if (!storedDeviceId) await setSetting(SETTINGS.deviceId, nextDeviceId);
      const nextBaseUrl = normalizeBaseUrl(storedBaseUrl || '');
      setBaseUrl(nextBaseUrl);
      setBaseUrlInput(nextBaseUrl);
      setDeviceId(nextDeviceId);
      setUser(parseUser(storedUser));
      setSongs(cachedSongs);
      setPlaylists(cachedPlaylists);
      setOfflineTracks(cachedOffline);
      setActiveTab(nextBaseUrl ? 'library' : 'server');
    } catch (error) {
      toast('error', err(error, 'Falha ao iniciar o app.'));
    } finally {
      setBooting(false);
    }
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(timer);
  }, [banner]);

  useEffect(() => {
    return () => {
      void unload();
    };
  }, []);

  async function syncHealth(targetBaseUrl = normalized, silent = true) {
    if (!targetBaseUrl) return;
    try {
      const nextHealth = await fetchHealth(targetBaseUrl);
      setHealth(nextHealth);
      if (deviceId) {
        await registerAndroidDevice(targetBaseUrl, deviceId, `MusFy Mobile ${Platform.OS}`, currentUserId);
      }
      if (!silent) {
        toast(nextHealth.ready ? 'success' : 'info', nextHealth.ready ? 'Servidor pronto.' : 'Servidor respondeu.');
      }
    } catch (error) {
      setHealth(null);
      if (!silent) toast('error', err(error, 'Falha ao conectar com o servidor.'));
    }
  }

  async function syncSongs(targetSection = section, silent = true) {
    if (!normalized) return;
    try {
      const nextSongs = await fetchSongs(normalized, currentUserId, targetSection);
      setSongs(nextSongs);
      await cacheSongs(nextSongs);
    } catch (error) {
      if (!silent) toast('error', err(error, 'Falha ao sincronizar a biblioteca.'));
    }
  }

  async function syncPlaylists(targetScope = playlistScope, silent = true) {
    if (!normalized) return;
    try {
      const nextPlaylists = await fetchPlaylists(normalized, {
        userId: currentUserId,
        scope: targetScope,
        excludeUserId: targetScope === 'discover' ? currentUserId : null
      });
      setPlaylists(nextPlaylists);
      await cachePlaylists(nextPlaylists);
    } catch (error) {
      if (!silent) toast('error', err(error, 'Falha ao sincronizar playlists.'));
    }
  }

  async function syncJobs(silent = true) {
    if (!normalized) return;
    try {
      setJobs(await fetchDownloadJobs(normalized));
    } catch (error) {
      if (!silent) toast('error', err(error, 'Falha ao carregar a fila.'));
    }
  }

  useEffect(() => {
    if (booting || !normalized) return;
    void syncHealth();
  }, [booting, normalized, currentUserId, deviceId]);

  useEffect(() => {
    if (booting || !normalized) return;
    void syncSongs();
  }, [booting, normalized, section, currentUserId]);

  useEffect(() => {
    if (booting || !normalized) return;
    void syncPlaylists();
  }, [booting, normalized, playlistScope, currentUserId]);

  useEffect(() => {
    if (booting || !normalized) return;
    void syncJobs();
  }, [booting, normalized]);

  useEffect(() => {
    if (booting || !normalized || activeTab !== 'downloads') return;
    const timer = setInterval(() => void syncJobs(), 15000);
    return () => clearInterval(timer);
  }, [booting, normalized, activeTab]);

  async function refreshAll() {
    if (!normalized) {
      toast('info', 'Configure a URL do servidor.');
      setActiveTab('server');
      return;
    }
    setRefreshing(true);
    await Promise.allSettled([syncHealth(normalized), syncSongs(), syncPlaylists(), syncJobs(), loadOffline()]);
    setRefreshing(false);
    toast('success', 'Sincronizacao concluida.');
  }

  async function saveServer() {
    const next = normalizeBaseUrl(baseUrlInput);
    if (!next) {
      toast('error', 'Informe a URL do servidor.');
      return;
    }
    await setSetting(SETTINGS.baseUrl, next);
    setBaseUrl(next);
    setBaseUrlInput(next);
    setActiveTab('library');
    await syncHealth(next, false);
  }

  async function submitAuth() {
    if (!normalized) {
      toast('error', 'Conecte um servidor antes de autenticar.');
      return;
    }
    if (!authEmail.trim() || !authPassword.trim() || (authMode === 'register' && !authName.trim())) {
      toast('error', 'Preencha os campos obrigatorios.');
      return;
    }
    setAuthBusy(true);
    try {
      const nextUser =
        authMode === 'login'
          ? await loginUser(normalized, authEmail, authPassword)
          : await registerUser(normalized, authName, authEmail, authPassword);
      await persistUser(nextUser);
      setAuthPassword('');
      toast('success', authMode === 'login' ? 'Sessao iniciada.' : 'Conta criada.');
      await Promise.allSettled([syncHealth(), syncSongs('library'), syncPlaylists('mine')]);
    } catch (error) {
      toast('error', err(error, 'Falha ao autenticar.'));
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    await persistUser(null);
    setSection('library');
    setPlaylistScope('mine');
    toast('info', 'Sessao encerrada.');
    if (normalized) await Promise.allSettled([syncSongs('library'), syncPlaylists('mine')]);
  }

  function onStatus(status: AudioStatus) {
    if (!status.isLoaded) {
      return;
    }
    setIsPlaying(status.playing);
    setPositionMs(Math.round(Number(status.currentTime || 0) * 1000));
    setDurationMs(Math.round(Number(status.duration || 0) * 1000));
    if (status.didJustFinish) {
      setIsPlaying(false);
      setPositionMs(0);
    }
  }

  async function unload() {
    playerStatusSubscriptionRef.current?.remove();
    playerStatusSubscriptionRef.current = null;

    if (playerRef.current) {
      try {
        playerRef.current.remove();
      } finally {
        playerRef.current = null;
      }
    }
    setCurrentId(null);
    setCurrentTitle('');
    setCurrentArtist('');
    setCurrentSource(null);
    setIsPlaying(false);
    setPositionMs(0);
    setDurationMs(0);
  }

  async function playSong(song: Song) {
    const local = offlineTracks.find((track) => track.songId === song.id) || null;
    const uri = local?.localUri || (normalized ? buildAudioStreamUrl(normalized, song.id) : '');
    const source: Source = local ? 'offline' : 'stream';
    if (!uri) {
      toast('error', 'Configure o servidor para tocar esta faixa.');
      return;
    }
    setPlayerBusy(true);
    try {
      if (playerRef.current && currentId === song.id && currentSource === source) {
        const status = playerRef.current.currentStatus;
        if (status.isLoaded) {
          if (playerRef.current.playing) {
            playerRef.current.pause();
          } else {
            playerRef.current.play();
          }
          return;
        }
      }
      await unload();
      const player = createAudioPlayer(uri, { updateInterval: 500 });
      playerStatusSubscriptionRef.current = player.addListener('playbackStatusUpdate', onStatus);
      playerRef.current = player;
      player.play();
      setCurrentId(song.id);
      setCurrentTitle(song.title);
      setCurrentArtist(song.artist || '');
      setCurrentSource(source);
      setIsPlaying(true);
    } catch (error) {
      await unload();
      toast('error', err(error, 'Falha ao iniciar a reproducao.'));
    } finally {
      setPlayerBusy(false);
    }
  }

  async function playOffline(track: OfflineTrack) {
    await playSong({ id: track.songId, title: track.title, artist: track.artist });
  }

  async function toggleFav(song: Song) {
    if (!normalized || !user) {
      toast('info', 'Entre com sua conta para usar favoritos.');
      return;
    }
    setSongBusyId(song.id);
    try {
      const next = await toggleFavorite(normalized, song.id, !song.favorite, user.id);
      setSongs((current) => current.map((item) => (item.id === next.id ? { ...item, ...next } : item)));
      setPlaylists((current) =>
        current.map((playlist) => ({
          ...playlist,
          songs: playlist.songs?.map((item) => (item.id === next.id ? { ...item, ...next } : item))
        }))
      );
    } catch (error) {
      toast('error', err(error, 'Falha ao atualizar favorito.'));
    } finally {
      setSongBusyId(null);
    }
  }

  async function saveOffline(song: Song, playlistId?: string) {
    if (!normalized) {
      toast('error', 'Conecte o servidor para salvar offline.');
      return;
    }
    setOfflineBusyId(song.id);
    try {
      await downloadSongOffline(normalized, song, playlistId);
      await loadOffline();
      toast('success', `"${song.title}" salvo no aparelho.`);
    } catch (error) {
      toast('error', err(error, 'Falha ao baixar a faixa.'));
    } finally {
      setOfflineBusyId(null);
    }
  }

  async function savePlaylistOffline(playlist: Playlist) {
    if (!normalized || !playlist.songs?.length) {
      toast('info', 'Esta playlist nao possui faixas para baixar.');
      return;
    }
    setOfflineBusyId(playlist.id);
    setOfflineProgress(`Baixando 0/${playlist.songs.length}`);
    try {
      await downloadPlaylistOffline(normalized, playlist, (done, total) => setOfflineProgress(`Baixando ${done}/${total}`));
      await loadOffline();
      toast('success', `Playlist "${playlist.name}" salva offline.`);
    } catch (error) {
      toast('error', err(error, 'Falha ao baixar a playlist.'));
    } finally {
      setOfflineBusyId(null);
      setOfflineProgress('');
    }
  }

  function removeOfflineTrack(track: OfflineTrack) {
    Alert.alert('Remover offline', `Excluir "${track.title}" do aparelho?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              if (currentId === track.songId && currentSource === 'offline') await unload();
              await removeSongOffline(track);
              await loadOffline();
              toast('success', 'Arquivo removido.');
            } catch (error) {
              toast('error', err(error, 'Falha ao remover o arquivo.'));
            }
          })();
        }
      }
    ]);
  }

  async function createOrRenamePlaylist(mode: 'create' | 'rename') {
    if (!normalized) {
      toast('error', 'Conecte um servidor antes de editar playlists.');
      return;
    }
    if (!playlistName.trim()) {
      toast('error', 'Informe um nome de playlist.');
      return;
    }
    setPlaylistBusyId(mode);
    try {
      if (mode === 'create') {
        await createPlaylist(normalized, playlistName.trim(), currentUserId);
      } else if (selectedPlaylistId) {
        await renamePlaylist(normalized, selectedPlaylistId, playlistName.trim());
      }
      await syncPlaylists(playlistScope, false);
      if (mode === 'create') setPlaylistName('');
      toast('success', mode === 'create' ? 'Playlist criada.' : 'Playlist renomeada.');
    } catch (error) {
      toast('error', err(error, 'Falha ao editar playlist.'));
    } finally {
      setPlaylistBusyId(null);
    }
  }

  function removePlaylist() {
    if (!normalized || !selectedPlaylist) {
      toast('info', 'Selecione uma playlist.');
      return;
    }
    Alert.alert('Excluir playlist', `Remover "${selectedPlaylist.name}" do servidor?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setPlaylistBusyId(selectedPlaylist.id);
            try {
              await deletePlaylist(normalized, selectedPlaylist.id);
              await syncPlaylists(playlistScope, false);
              setSelectedPlaylistId(null);
              setPlaylistName('');
              toast('success', 'Playlist removida.');
            } catch (error) {
              toast('error', err(error, 'Falha ao remover playlist.'));
            } finally {
              setPlaylistBusyId(null);
            }
          })();
        }
      }
    ]);
  }

  async function addToSelectedPlaylist(song: Song) {
    if (!normalized || !selectedPlaylistId) {
      toast('info', 'Selecione uma playlist para receber a faixa.');
      setActiveTab('playlists');
      return;
    }
    setPlaylistBusyId(selectedPlaylistId);
    try {
      await addSongToPlaylist(normalized, selectedPlaylistId, song.id);
      await syncPlaylists(playlistScope, false);
      toast('success', `"${song.title}" adicionada na playlist ativa.`);
    } catch (error) {
      toast('error', err(error, 'Falha ao adicionar faixa na playlist.'));
    } finally {
      setPlaylistBusyId(null);
    }
  }

  async function removeFromPlaylist(playlistId: string, songId: string) {
    if (!normalized) return;
    setPlaylistBusyId(playlistId);
    try {
      await removeSongFromPlaylist(normalized, playlistId, songId);
      await syncPlaylists(playlistScope, false);
      toast('success', 'Faixa removida da playlist.');
    } catch (error) {
      toast('error', err(error, 'Falha ao remover faixa da playlist.'));
    } finally {
      setPlaylistBusyId(null);
    }
  }

  async function queueDownload() {
    if (!normalized) {
      toast('error', 'Conecte o servidor antes de enviar downloads.');
      return;
    }
    if (!downloadUrl.trim()) {
      toast('error', 'Informe uma URL do YouTube.');
      return;
    }
    setJobsBusy(true);
    try {
      await enqueueYoutubeDownload(normalized, {
        url: downloadUrl.trim(),
        userId: currentUserId,
        mode: downloadMode,
        includeVideo,
        title: downloadTitle.trim() || null,
        artist: downloadArtist.trim() || null
      });
      setDownloadUrl('');
      setDownloadTitle('');
      setDownloadArtist('');
      await syncJobs(false);
      setActiveTab('downloads');
      toast('success', 'Download enviado para a fila.');
    } catch (error) {
      toast('error', err(error, 'Falha ao enfileirar download.'));
    } finally {
      setJobsBusy(false);
    }
  }

  async function actOnJob(job: DownloadJob) {
    if (!normalized) return;
    setJobsBusy(true);
    try {
      if (job.status === 'running' || job.status === 'queued') {
        await pauseDownloadJob(normalized, job.id);
      } else {
        await resumeDownloadJob(normalized, job.id);
      }
      await syncJobs(false);
    } catch (error) {
      toast('error', err(error, 'Falha ao atualizar a fila.'));
    } finally {
      setJobsBusy(false);
    }
  }

  function renderServer() {
    return (
      <>
        <Card title="Conexao LAN" subtitle="Aponte o app para o backend local do MusFy.">
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.0.10:3001"
            placeholderTextColor="#6f7285"
            style={styles.input}
            value={baseUrlInput}
            onChangeText={setBaseUrlInput}
          />
          <View style={styles.row}>
            <Btn label="Salvar e testar" onPress={() => void saveServer()} />
            <Btn label="Sincronizar tudo" kind="secondary" onPress={() => void refreshAll()} />
          </View>
          <Text style={styles.meta}>Status: {health?.status || 'offline'} | ready: {health?.ready ? 'sim' : 'nao'}</Text>
          <Text style={styles.meta}>Host: {health?.host || '-'} | porta: {health?.port || '-'}</Text>
          <Text style={styles.meta}>Device ID: {deviceId || '-'}</Text>
        </Card>

        <Card title="Sessao" subtitle="Login opcional para favoritos, playlists e biblioteca pessoal.">
          {user ? (
            <>
              <Text style={styles.title}>{user.nome}</Text>
              <Text style={styles.meta}>{user.email || 'Sem email publico'}</Text>
              <Btn label="Sair" kind="ghost" onPress={() => void logout()} />
            </>
          ) : (
            <>
              <Chip items={['login', 'register']} selected={authMode} labels={{ login: 'Entrar', register: 'Criar conta' }} onPick={setAuthMode} />
              {authMode === 'register' ? (
                <TextInput
                  placeholder="Nome"
                  placeholderTextColor="#6f7285"
                  style={styles.input}
                  value={authName}
                  onChangeText={setAuthName}
                />
              ) : null}
              <TextInput
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Email"
                placeholderTextColor="#6f7285"
                style={styles.input}
                value={authEmail}
                onChangeText={setAuthEmail}
              />
              <TextInput
                secureTextEntry
                placeholder="Senha"
                placeholderTextColor="#6f7285"
                style={styles.input}
                value={authPassword}
                onChangeText={setAuthPassword}
              />
              <Btn label={authMode === 'login' ? 'Entrar' : 'Criar conta'} onPress={() => void submitAuth()} busy={authBusy} disabled={authBusy} />
            </>
          )}
        </Card>
      </>
    );
  }

  function renderLibrary() {
    return (
      <>
        <Card title="Biblioteca" subtitle="Streaming pela LAN com fallback para arquivos offline.">
          <Chip
            items={SONG_SECTIONS}
            selected={section}
            labels={SONG_LABEL}
            onPick={(next) => {
              if (next === 'favorites' && !user) {
                toast('info', 'Entre com sua conta para ver favoritos.');
                return;
              }
              setSection(next);
            }}
          />
          <Text style={styles.meta}>
            {songs.length} faixas | playlist ativa: {selectedPlaylist?.name || 'nenhuma'}
          </Text>
        </Card>

        {songs.length ? (
          songs.map((song) => {
            const local = offlineTracks.find((track) => track.songId === song.id);
            return (
              <View key={song.id} style={[styles.block, currentId === song.id && styles.blockActive]}>
                <Text style={styles.title}>{song.title}</Text>
                <Text style={styles.meta}>{song.artist || song.uploadedByUserName || 'Artista desconhecido'}</Text>
                <Text style={styles.meta}>{local ? 'Disponivel offline' : 'Streaming LAN'} {song.favorite ? '| favorita' : ''}</Text>
                <View style={styles.row}>
                  <Btn label={currentId === song.id && isPlaying ? 'Pausar' : 'Tocar'} onPress={() => void playSong(song)} disabled={playerBusy} />
                  <Btn label={song.favorite ? 'Desfavoritar' : 'Favoritar'} kind="secondary" onPress={() => void toggleFav(song)} disabled={songBusyId === song.id} />
                </View>
                <View style={styles.row}>
                  <Btn label={local ? 'Ja salvo' : 'Salvar offline'} kind="ghost" onPress={() => void saveOffline(song)} disabled={Boolean(local) || offlineBusyId === song.id} />
                  <Btn label="Add na ativa" kind="ghost" onPress={() => void addToSelectedPlaylist(song)} disabled={!selectedPlaylistId || playlistBusyId === selectedPlaylistId} />
                </View>
              </View>
            );
          })
        ) : (
          <View style={styles.block}>
            <Text style={styles.title}>Biblioteca vazia</Text>
            <Text style={styles.meta}>Sincronize o servidor para carregar as faixas.</Text>
          </View>
        )}
      </>
    );
  }

  function renderPlaylists() {
    return (
      <>
        <Card title="Playlists" subtitle="Selecione uma playlist ativa para receber faixas da biblioteca.">
          <Chip items={PLAYLIST_SCOPES} selected={playlistScope} labels={PLAYLIST_LABEL} onPick={setPlaylistScope} />
          <TextInput
            placeholder={selectedPlaylist ? 'Renomear playlist ativa' : 'Nova playlist'}
            placeholderTextColor="#6f7285"
            style={styles.input}
            value={playlistName}
            onChangeText={setPlaylistName}
          />
          <View style={styles.row}>
            <Btn label="Criar" onPress={() => void createOrRenamePlaylist('create')} busy={playlistBusyId === 'create'} />
            <Btn label="Renomear" kind="secondary" onPress={() => void createOrRenamePlaylist('rename')} disabled={!selectedPlaylistId} />
            <Btn label="Excluir" kind="ghost" onPress={removePlaylist} disabled={!selectedPlaylistId} />
          </View>
        </Card>

        {playlists.length ? (
          playlists.map((playlist) => (
            <View key={playlist.id} style={[styles.block, selectedPlaylistId === playlist.id && styles.blockActive]}>
              <Text style={styles.title}>{playlist.name}</Text>
              <Text style={styles.meta}>
                {playlist.ownerUserName || 'Sem dono visivel'} | {playlist.songs?.length || 0} faixas
              </Text>
              <View style={styles.row}>
                <Btn
                  label={selectedPlaylistId === playlist.id ? 'Ativa' : 'Selecionar'}
                  kind="secondary"
                  onPress={() => {
                    setSelectedPlaylistId(playlist.id);
                    setPlaylistName(playlist.name);
                  }}
                />
                <Btn label="Salvar offline" kind="ghost" onPress={() => void savePlaylistOffline(playlist)} disabled={offlineBusyId === playlist.id} />
              </View>
              {selectedPlaylistId === playlist.id && playlist.songs?.length ? (
                <View style={styles.subList}>
                  {playlist.songs.map((song) => (
                    <View key={song.id} style={styles.subItem}>
                      <Text style={styles.subTitle}>{song.title}</Text>
                      <Text style={styles.meta}>{song.artist || 'Artista desconhecido'}</Text>
                      <View style={styles.row}>
                        <Btn label="Tocar" kind="secondary" onPress={() => void playSong(song)} />
                        <Btn label="Salvar" kind="ghost" onPress={() => void saveOffline(song, playlist.id)} />
                        <Btn label="Remover" kind="ghost" onPress={() => void removeFromPlaylist(playlist.id, song.id)} disabled={playlistBusyId === playlist.id} />
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ))
        ) : (
          <View style={styles.block}>
            <Text style={styles.title}>Nenhuma playlist</Text>
            <Text style={styles.meta}>Crie uma lista ou mude o escopo para descobrir playlists.</Text>
          </View>
        )}

        {offlineProgress ? <Text style={styles.progress}>{offlineProgress}</Text> : null}
      </>
    );
  }

  function renderOffline() {
    return (
      <>
        <Card title="Offline" subtitle="Faixas salvas no armazenamento privado do app.">
          <Text style={styles.meta}>{offlineTracks.length} arquivos | {bytes(offlineBytes)}</Text>
        </Card>
        {offlineTracks.length ? (
          offlineTracks.map((track) => (
            <View key={track.songId} style={[styles.block, currentId === track.songId && styles.blockActive]}>
              <Text style={styles.title}>{track.title}</Text>
              <Text style={styles.meta}>{track.artist || 'Arquivo local'}</Text>
              <Text style={styles.meta}>{bytes(Number(track.sizeBytes || 0))}</Text>
              <View style={styles.row}>
                <Btn label={currentId === track.songId && isPlaying ? 'Pausar' : 'Tocar'} onPress={() => void playOffline(track)} />
                <Btn label="Remover" kind="ghost" onPress={() => removeOfflineTrack(track)} />
              </View>
            </View>
          ))
        ) : (
          <View style={styles.block}>
            <Text style={styles.title}>Nada salvo</Text>
            <Text style={styles.meta}>Baixe faixas ou playlists para habilitar o modo offline.</Text>
          </View>
        )}
      </>
    );
  }

  function renderJobs() {
    return (
      <>
        <Card title="Fila de downloads" subtitle="Envie links do YouTube para o backend processar.">
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://www.youtube.com/watch?v=..."
            placeholderTextColor="#6f7285"
            style={styles.input}
            value={downloadUrl}
            onChangeText={setDownloadUrl}
          />
          <TextInput placeholder="Titulo opcional" placeholderTextColor="#6f7285" style={styles.input} value={downloadTitle} onChangeText={setDownloadTitle} />
          <TextInput placeholder="Artista opcional" placeholderTextColor="#6f7285" style={styles.input} value={downloadArtist} onChangeText={setDownloadArtist} />
          <Chip items={DOWNLOAD_MODES} selected={downloadMode} labels={DOWNLOAD_LABEL} onPick={setDownloadMode} />
          <Pressable onPress={() => setIncludeVideo((value) => !value)} style={[styles.toggle, includeVideo && styles.toggleActive]}>
            <Text style={styles.meta}>{includeVideo ? 'Video junto: sim' : 'Video junto: nao'}</Text>
          </Pressable>
          <View style={styles.row}>
            <Btn label="Adicionar na fila" onPress={() => void queueDownload()} busy={jobsBusy} disabled={jobsBusy} />
            <Btn label="Atualizar" kind="secondary" onPress={() => void syncJobs(false)} />
          </View>
        </Card>

        {jobs.length ? (
          jobs.map((job) => (
            <View key={job.id} style={styles.block}>
              <Text style={styles.title}>{job.title || job.url || 'Download sem titulo'}</Text>
              <Text style={styles.meta}>{job.artist || job.mode || 'Fila MusFy'}</Text>
              <Text style={styles.meta}>{job.status || 'desconhecido'} | {job.stage || 'sem etapa'}</Text>
              <Text style={styles.meta}>{job.message || 'Sem mensagem adicional'}</Text>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, Math.round(Number(job.progress || 0))))}%` }]} />
              </View>
              <Btn label={job.status === 'running' || job.status === 'queued' ? 'Pausar' : 'Retomar'} onPress={() => void actOnJob(job)} kind="secondary" disabled={jobsBusy} />
            </View>
          ))
        ) : (
          <View style={styles.block}>
            <Text style={styles.title}>Fila vazia</Text>
            <Text style={styles.meta}>Cole um link acima para iniciar um novo download.</Text>
          </View>
        )}
      </>
    );
  }

  if (booting) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.boot}>
          <ActivityIndicator color="#20e36f" size="large" />
          <Text style={styles.title}>MUSFY</Text>
          <Text style={styles.meta}>Preparando cache local e player.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} tintColor="#20e36f" />}
          showsVerticalScrollIndicator={false}
        >
          <LinearGradient colors={['#1f7a43', '#10141d', '#07080c']} style={styles.hero}>
            <Text style={styles.eyebrow}>Mobile LAN player</Text>
            <Text style={styles.heroTitle}>MusFy no Android, com cache offline e fila local.</Text>
            <Text style={styles.heroBody}>Biblioteca, playlists, downloads e reproducao no mesmo app.</Text>
          </LinearGradient>

          {banner ? <View style={[styles.notice, banner.tone === 'error' && styles.noticeError, banner.tone === 'success' && styles.noticeSuccess]}><Text style={styles.noticeText}>{banner.text}</Text></View> : null}

          <Card title="Player" subtitle="Streaming do servidor ou reproducao direta dos arquivos baixados.">
            <Text style={styles.title}>{currentTitle || 'Nenhuma faixa carregada'}</Text>
            <Text style={styles.meta}>{currentArtist || 'Pronto para tocar'} {currentSource ? `| ${currentSource}` : ''}</Text>
            <Text style={styles.meta}>{mmss(positionMs)} / {mmss(durationMs)}</Text>
            <View style={styles.row}>
              <Btn
                label={isPlaying ? 'Pausar' : 'Tocar'}
                onPress={() => {
                  if (!playerRef.current || !currentId || !currentSource) return;
                  if (currentSource === 'offline') {
                    const local = offlineTracks.find((track) => track.songId === currentId);
                    if (local) void playOffline(local);
                  } else {
                    void playSong({ id: currentId, title: currentTitle, artist: currentArtist });
                  }
                }}
                disabled={!currentId || playerBusy}
              />
              <Btn label="Parar" kind="ghost" onPress={() => void unload()} disabled={!currentId} />
            </View>
          </Card>

          <View style={styles.tabs}>
            {TABS.map((tab) => (
              <Pressable key={tab} onPress={() => setActiveTab(tab)} style={[styles.tab, activeTab === tab && styles.tabActive]}>
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{TAB_LABEL[tab]}</Text>
              </Pressable>
            ))}
          </View>

          {activeTab === 'server' ? renderServer() : null}
          {activeTab === 'library' ? renderLibrary() : null}
          {activeTab === 'playlists' ? renderPlaylists() : null}
          {activeTab === 'offline' ? renderOffline() : null}
          {activeTab === 'downloads' ? renderJobs() : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Card(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{props.title}</Text>
      {props.subtitle ? <Text style={styles.cardSubtitle}>{props.subtitle}</Text> : null}
      <View style={styles.cardBody}>{props.children}</View>
    </View>
  );
}

function Btn(props: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
}) {
  const kind = props.kind || 'primary';
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={[
        styles.btn,
        kind === 'secondary' && styles.btnSecondary,
        kind === 'ghost' && styles.btnGhost,
        props.disabled && styles.btnDisabled
      ]}
    >
      {props.busy ? <ActivityIndicator color={kind === 'primary' ? '#081008' : '#eef2ff'} /> : null}
      <Text
        style={[
          styles.btnText,
          kind !== 'primary' && styles.btnTextAlt
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function Chip<T extends string>(props: {
  items: T[];
  selected: T;
  labels: Record<T, string>;
  onPick: (value: T) => void;
}) {
  return (
    <View style={styles.chips}>
      {props.items.map((item) => (
        <Pressable
          key={item}
          onPress={() => props.onPick(item)}
          style={[styles.chip, props.selected === item && styles.chipActive]}
        >
          <Text style={[styles.chipText, props.selected === item && styles.chipTextActive]}>
            {props.labels[item]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05070d' },
  flex: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40, gap: 16 },
  hero: { borderRadius: 28, padding: 24, gap: 8 },
  eyebrow: { color: '#d4f8df', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' },
  heroTitle: { color: '#f5f7fb', fontSize: 29, fontWeight: '900', lineHeight: 33 },
  heroBody: { color: '#c6cad7', fontSize: 15, lineHeight: 21 },
  notice: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#1c2432' },
  noticeError: { backgroundColor: '#3b1820' },
  noticeSuccess: { backgroundColor: '#143222' },
  noticeText: { color: '#eef2ff', fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: '#10141d',
    borderRadius: 22,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#1a2233'
  },
  cardTitle: { color: '#f5f7fb', fontSize: 19, fontWeight: '800' },
  cardSubtitle: { color: '#96a0b8', fontSize: 13, lineHeight: 19 },
  cardBody: { gap: 10 },
  input: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#253049',
    backgroundColor: '#080b12',
    color: '#f6f7fb',
    paddingHorizontal: 16,
    fontSize: 15
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#0d1119',
    borderWidth: 1,
    borderColor: '#1f2737'
  },
  tabActive: { backgroundColor: '#f4ede1', borderColor: '#f4ede1' },
  tabText: { color: '#cad0dd', fontWeight: '700' },
  tabTextActive: { color: '#111318' },
  block: {
    backgroundColor: '#0f131c',
    borderRadius: 22,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#1a2233'
  },
  blockActive: { borderColor: '#b7ff47' },
  subList: { gap: 10 },
  subItem: {
    backgroundColor: '#080b12',
    borderRadius: 18,
    padding: 12,
    gap: 8
  },
  title: { color: '#f5f7fb', fontSize: 17, fontWeight: '800' },
  subTitle: { color: '#f5f7fb', fontSize: 15, fontWeight: '700' },
  meta: { color: '#96a0b8', fontSize: 13, lineHeight: 18 },
  progress: { color: '#b7ff47', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  toggle: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#27314a',
    backgroundColor: '#0f131c'
  },
  toggleActive: { borderColor: '#b7ff47', backgroundColor: '#16220a' },
  bar: { height: 10, borderRadius: 999, backgroundColor: '#131a28', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999, backgroundColor: '#b7ff47' },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  btn: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#b7ff47',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  btnSecondary: { backgroundColor: '#1f2b42' },
  btnGhost: { backgroundColor: '#121826', borderWidth: 1, borderColor: '#27314a' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#09110a', fontSize: 14, fontWeight: '800' },
  btnTextAlt: { color: '#eef2ff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#101722',
    borderWidth: 1,
    borderColor: '#27314a'
  },
  chipActive: { backgroundColor: '#b7ff47', borderColor: '#b7ff47' },
  chipText: { color: '#d4daec', fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: '#09110a' }
});

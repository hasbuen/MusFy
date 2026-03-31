import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { fetchHealth, fetchPlaylists, fetchServiceStorage, fetchSongs, registerAndroidDevice } from './src/api/client';
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
import { downloadPlaylistOffline, downloadSongOffline } from './src/storage/offline';
import type { HealthStatus, OfflineTrack, Playlist, ServiceStorage, Song } from './src/types';

type TabKey = 'server' | 'library' | 'playlists' | 'offline';

const SERVER_URL_KEY = 'server_url';
const DEVICE_ID_KEY = 'device_id';
const DEVICE_NAME_KEY = 'device_name';
const BRAND = '#22c55e';

function formatBytes(value?: number | null) {
  if (!value) return 'Tamanho desconhecido';
  const size = value / (1024 * 1024);
  return `${size.toFixed(1)} MB`;
}

function createStableId() {
  return `android-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getServerCandidates(currentValue: string) {
  const trimmed = currentValue.trim().replace(/\/+$/, '');
  const candidates = new Set<string>();

  if (trimmed) {
    candidates.add(trimmed);

    try {
      const url = new URL(trimmed);
      candidates.add(`http://${url.hostname}:3001`);
      candidates.add(`http://${url.hostname}:3000`);
    } catch {
      // Ignore invalid manual input while building candidate list.
    }
  }

  candidates.add('http://10.0.2.2:3001');
  candidates.add('http://127.0.0.1:3001');
  candidates.add('http://localhost:3001');

  return [...candidates];
}

function getPlaylistCover(playlist: Playlist) {
  return playlist.songs?.find((song) => song.thumbnail)?.thumbnail || null;
}

function getSongSubtitle(song: Song) {
  const parts = [song.artist || 'Artista desconhecido'];
  if (song.uploadedByUserName) {
    parts.push(`por ${song.uploadedByUserName}`);
  }
  return parts.join(' · ');
}

function getStorageLabel(serviceStorage: ServiceStorage) {
  const sqlite = serviceStorage.sqlite?.ready ? 'SQLite pronto' : 'SQLite aguardando';
  const redis = serviceStorage.redis?.mode ? `Redis ${serviceStorage.redis.mode}` : 'Redis sem status';
  return `${sqlite} · ${redis}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('server');
  const [serverUrl, setServerUrlState] = useState('http://192.168.0.10:3001');
  const [songs, setSongs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [offlineTracks, setOfflineTracks] = useState<OfflineTrack[]>([]);
  const [serviceStorage, setServiceStorage] = useState<ServiceStorage>({});
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState('Conecte o app ao servidor MusFy da sua rede.');
  const [isBooting, setIsBooting] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string>('');
  const [deviceName, setDeviceName] = useState('MusFy Android');

  const summary = useMemo(
    () => ({
      songs: songs.length,
      playlists: playlists.length,
      offline: offlineTracks.length
    }),
    [offlineTracks.length, playlists.length, songs.length]
  );

  const hydrateLocalState = async () => {
    const [savedServerUrl, cachedSongs, cachedPlaylists, savedOfflineTracks, savedDeviceId, savedDeviceName] = await Promise.all([
      getSetting(SERVER_URL_KEY),
      getCachedSongs(),
      getCachedPlaylists(),
      listOfflineTracks(),
      getSetting(DEVICE_ID_KEY),
      getSetting(DEVICE_NAME_KEY)
    ]);

    if (savedServerUrl) {
      setServerUrlState(savedServerUrl);
    }

    const resolvedDeviceId = savedDeviceId || createStableId();
    const resolvedDeviceName = savedDeviceName || 'MusFy Android';

    await Promise.all([setSetting(DEVICE_ID_KEY, resolvedDeviceId), setSetting(DEVICE_NAME_KEY, resolvedDeviceName)]);

    setDeviceId(resolvedDeviceId);
    setDeviceName(resolvedDeviceName);
    setSongs(cachedSongs);
    setPlaylists(cachedPlaylists);
    setOfflineTracks(savedOfflineTracks);

    return {
      savedServerUrl: savedServerUrl || '',
      resolvedDeviceId,
      resolvedDeviceName
    };
  };

  const syncServer = async (
    explicitUrl?: string,
    explicitDeviceId?: string,
    explicitDeviceName?: string,
    shouldPersist = true
  ) => {
    const baseUrl = (explicitUrl || serverUrl).trim().replace(/\/+$/, '');
    if (!baseUrl) {
      setStatusMessage('Informe a URL do servidor MusFy.');
      return false;
    }

    const resolvedDeviceId = explicitDeviceId || deviceId || createStableId();
    const resolvedDeviceName = explicitDeviceName || deviceName || 'MusFy Android';

    setIsSyncing(true);
    setStatusMessage('Sincronizando biblioteca, playlists e status do servidor...');

    try {
      if (shouldPersist) {
        await setSetting(SERVER_URL_KEY, baseUrl);
      }

      const nextHealth = await fetchHealth(baseUrl);
      const [remoteSongs, remotePlaylists, storage] = await Promise.all([
        fetchSongs(baseUrl),
        fetchPlaylists(baseUrl),
        fetchServiceStorage(baseUrl).catch(() => nextHealth.storage || {})
      ]);

      await Promise.all([
        cacheSongs(remoteSongs),
        cachePlaylists(remotePlaylists),
        registerAndroidDevice(baseUrl, resolvedDeviceId, resolvedDeviceName),
        setSetting(DEVICE_ID_KEY, resolvedDeviceId),
        setSetting(DEVICE_NAME_KEY, resolvedDeviceName)
      ]);

      setDeviceId(resolvedDeviceId);
      setDeviceName(resolvedDeviceName);
      setServerUrlState(baseUrl);
      setSongs(remoteSongs);
      setPlaylists(remotePlaylists);
      setServiceStorage(storage);
      setHealth(nextHealth);
      setStatusMessage(
        nextHealth.ok
          ? `Servidor conectado em ${baseUrl}. Biblioteca sincronizada com ${remoteSongs.length} faixas e ${remotePlaylists.length} playlists.`
          : `Servidor respondeu em ${baseUrl}, mas sem status OK.`
      );
      return nextHealth.ok;
    } catch (error: any) {
      setStatusMessage(`Falha ao sincronizar com ${baseUrl}: ${error?.message || 'erro desconhecido'}`);
      return false;
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        await initDatabase();
        const localState = await hydrateLocalState();
        if (localState.savedServerUrl) {
          await syncServer(localState.savedServerUrl, localState.resolvedDeviceId, localState.resolvedDeviceName, false);
        }
      } catch (error: any) {
        setStatusMessage(error?.message || 'Falha ao inicializar o MusFy Mobile.');
      } finally {
        setIsBooting(false);
      }
    })();
  }, []);

  const persistServerUrl = async (value: string) => {
    setServerUrlState(value);
    await setSetting(SERVER_URL_KEY, value);
  };

  const refreshOfflineTracks = async () => {
    setOfflineTracks(await listOfflineTracks());
  };

  const discoverServer = async () => {
    setIsDiscovering(true);
    setStatusMessage('Procurando o servidor MusFy nas URLs mais prováveis...');

    try {
      for (const candidate of getServerCandidates(serverUrl)) {
        const connected = await syncServer(candidate, deviceId, deviceName);
        if (connected) {
          setStatusMessage(`Servidor MusFy encontrado automaticamente em ${candidate}.`);
          return;
        }
      }

      setStatusMessage('Nenhum servidor MusFy respondeu automaticamente. Confira o IP do computador e tente de novo.');
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleSongOffline = async (song: Song) => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      setStatusMessage('Defina a URL do servidor antes de baixar offline.');
      return;
    }

    setDownloadingId(song.id);
    setStatusMessage(`Baixando "${song.title}" para o cache offline do Android...`);

    try {
      await downloadSongOffline(baseUrl, song);
      await refreshOfflineTracks();
      setStatusMessage(`"${song.title}" ficou salva offline no aparelho.`);
      setActiveTab('offline');
    } catch (error: any) {
      setStatusMessage(error?.message || 'Falha ao baixar faixa offline.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePlaylistOffline = async (playlist: Playlist) => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      setStatusMessage('Defina a URL do servidor antes de baixar uma playlist.');
      return;
    }

    setDownloadingId(playlist.id);
    try {
      await downloadPlaylistOffline(baseUrl, playlist, (done, total) => {
        setStatusMessage(`Baixando playlist "${playlist.name}" (${done}/${total})...`);
      });
      await refreshOfflineTracks();
      setStatusMessage(`Playlist "${playlist.name}" salva offline.`);
      setActiveTab('offline');
    } catch (error: any) {
      setStatusMessage(error?.message || 'Falha ao baixar playlist offline.');
    } finally {
      setDownloadingId(null);
    }
  };

  const renderServerTab = () => (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <View>
          <Text style={styles.panelEyebrow}>Servidor local</Text>
          <Text style={styles.panelTitle}>Host do MusFy</Text>
        </View>
        <View style={styles.badgeMuted}>
          <Text style={styles.badgeMutedLabel}>{health?.ok ? 'Online' : 'Offline'}</Text>
        </View>
      </View>

      <Text style={styles.panelText}>Use o mesmo host do desktop para sincronizar biblioteca, playlists e cache offline.</Text>

      <TextInput
        value={serverUrl}
        onChangeText={(value) => void persistServerUrl(value)}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="http://192.168.0.10:3001"
        placeholderTextColor="#6b7280"
        style={styles.searchInput}
      />

      <View style={styles.actionColumn}>
        <Pressable onPress={() => void syncServer()} style={styles.primaryAction}>
          <Text style={styles.primaryActionLabel}>{isSyncing ? 'Sincronizando...' : 'Sincronizar agora'}</Text>
        </Pressable>
        <Pressable onPress={() => void discoverServer()} style={styles.secondaryAction}>
          <Text style={styles.secondaryActionLabel}>{isDiscovering ? 'Buscando...' : 'Localizar servidor'}</Text>
        </Pressable>
      </View>

      <View style={styles.metricsGrid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Host</Text>
          <Text style={styles.metricValue}>{health?.service || 'MusFy local'}</Text>
          <Text style={styles.metricText}>{health?.mode ? `modo ${health.mode}` : serverUrl}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Dispositivo</Text>
          <Text style={styles.metricValue}>{deviceName}</Text>
          <Text style={styles.metricText}>{deviceId || 'Gerando identificador local'}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Armazenamento</Text>
          <Text style={styles.metricValue}>{getStorageLabel(serviceStorage)}</Text>
          <Text style={styles.metricText}>{serviceStorage.sqlite?.path || 'Sem caminho reportado ainda'}</Text>
        </View>
      </View>

      <View style={styles.noticeCard}>
        <Text style={styles.noticeText}>{statusMessage}</Text>
      </View>
    </View>
  );

  const renderLibraryTab = () => (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <View>
          <Text style={styles.panelEyebrow}>Sua biblioteca</Text>
          <Text style={styles.panelTitle}>Faixas do host</Text>
        </View>
        <View style={styles.badgeMuted}>
          <Text style={styles.badgeMutedLabel}>{songs.length} faixas</Text>
        </View>
      </View>

      {songs.length ? (
        songs.map((song) => (
          <View key={song.id} style={styles.songCard}>
            <View style={styles.songArtworkShell}>
              {song.thumbnail ? <Image source={{ uri: song.thumbnail }} style={styles.songArtwork} /> : <View style={styles.songArtworkFallback} />}
            </View>
            <View style={styles.songMeta}>
              <Text numberOfLines={1} style={styles.songTitle}>{song.title}</Text>
              <Text numberOfLines={2} style={styles.songSubtitle}>{getSongSubtitle(song)}</Text>
            </View>
            <Pressable onPress={() => void handleSongOffline(song)} style={styles.iconAction}>
              <Text style={styles.iconActionLabel}>{downloadingId === song.id ? '...' : 'Salvar'}</Text>
            </Pressable>
          </View>
        ))
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Nenhuma faixa sincronizada</Text>
          <Text style={styles.emptyText}>Use a aba Host para conectar o mobile no mesmo servidor do desktop.</Text>
        </View>
      )}
    </View>
  );

  const renderPlaylistTab = () => (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <View>
          <Text style={styles.panelEyebrow}>Sua home</Text>
          <Text style={styles.panelTitle}>Playlists</Text>
        </View>
        <View style={styles.badgeMuted}>
          <Text style={styles.badgeMutedLabel}>{playlists.length} listas</Text>
        </View>
      </View>

      {playlists.length ? (
        playlists.map((playlist) => {
          const cover = getPlaylistCover(playlist);
          return (
            <View key={playlist.id} style={styles.playlistCard}>
              <View style={styles.playlistCoverShell}>
                {cover ? <Image source={{ uri: cover }} style={styles.playlistCover} /> : <View style={styles.playlistCoverFallback} />}
                <View style={styles.playlistOverlay} />
                <View style={styles.playlistCopy}>
                  <Text style={styles.playlistEyebrow}>Sua playlist</Text>
                  <Text style={styles.playlistName}>{playlist.name}</Text>
                  <Text style={styles.playlistMeta}>{playlist.songs?.length || 0} faixas</Text>
                </View>
              </View>
              <Pressable onPress={() => void handlePlaylistOffline(playlist)} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionLabel}>{downloadingId === playlist.id ? 'Baixando...' : 'Baixar playlist'}</Text>
              </Pressable>
            </View>
          );
        })
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Nenhuma playlist disponível</Text>
          <Text style={styles.emptyText}>As playlists do desktop aparecem aqui depois da sincronização com o host.</Text>
        </View>
      )}
    </View>
  );

  const renderOfflineTab = () => (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <View>
          <Text style={styles.panelEyebrow}>Sessão offline</Text>
          <Text style={styles.panelTitle}>Guardado no aparelho</Text>
        </View>
        <View style={styles.badgePositive}>
          <Text style={styles.badgePositiveLabel}>{offlineTracks.length} salvas</Text>
        </View>
      </View>

      {offlineTracks.length ? (
        offlineTracks.map((track) => (
          <View key={track.songId} style={styles.songCard}>
            <View style={styles.songArtworkFallback} />
            <View style={styles.songMeta}>
              <Text numberOfLines={1} style={styles.songTitle}>{track.title}</Text>
              <Text numberOfLines={2} style={styles.songSubtitle}>{track.artist || 'Sem artista'} · {formatBytes(track.sizeBytes)}</Text>
              <Text numberOfLines={1} style={styles.songPath}>{track.localUri}</Text>
            </View>
          </View>
        ))
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Nada offline ainda</Text>
          <Text style={styles.emptyText}>Baixe faixas ou playlists para repetir o comportamento do desktop mesmo sem conexão.</Text>
        </View>
      )}
    </View>
  );

  const renderActiveTab = () => {
    if (activeTab === 'library') return renderLibraryTab();
    if (activeTab === 'playlists') return renderPlaylistTab();
    if (activeTab === 'offline') return renderOfflineTab();
    return renderServerTab();
  };

  if (isBooting) {
    return (
      <SafeAreaView style={styles.bootScreen}>
        <StatusBar style="light" />
        <View style={styles.bootPanel}>
          <Text style={styles.bootBrand}>MUSFY</Text>
          <Text style={styles.bootText}>Abrindo sua sessão móvel com a mesma base do desktop.</Text>
          <ActivityIndicator color={BRAND} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerShell}>
          <View style={styles.brandColumn}>
            <Text style={styles.brand}>MUSFY</Text>
            <Text style={styles.brandCaption}>Sua sessão, sua biblioteca, seu player.</Text>
          </View>
          <View style={styles.actionPills}>
            <View style={styles.topPill}><Text style={styles.topPillLabel}>Host</Text></View>
            <View style={styles.topPill}><Text style={styles.topPillLabel}>Android</Text></View>
          </View>
        </View>

        <View style={styles.searchShell}>
          <TextInput
            value={serverUrl}
            onChangeText={(value) => void persistServerUrl(value)}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Busque pelo host do MusFy ou edite a URL manualmente"
            placeholderTextColor="#6b7280"
            style={styles.headerSearch}
          />
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>MUSFY MOBILE</Text>
          <Text style={styles.heroTitle}>A mesma estética do desktop, adaptada para a mão.</Text>
          <Text style={styles.heroText}>Paleta escura, verde de marca, superfícies em vidro fosco e cartões largos para biblioteca, playlists e sessão offline.</Text>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{summary.songs}</Text>
              <Text style={styles.summaryLabel}>Faixas</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{summary.playlists}</Text>
              <Text style={styles.summaryLabel}>Playlists</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{summary.offline}</Text>
              <Text style={styles.summaryLabel}>Offline</Text>
            </View>
          </View>
        </View>

        <View style={styles.sidebarCard}>
          <Text style={styles.sidebarTitle}>Navegação</Text>
          <View style={styles.tabRow}>
            {(['server', 'library', 'playlists', 'offline'] as TabKey[]).map((tab) => (
              <Pressable key={tab} onPress={() => setActiveTab(tab)} style={[styles.tab, activeTab === tab && styles.tabActive]}>
                <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>{tab === 'server' ? 'Host' : tab === 'library' ? 'Biblioteca' : tab === 'playlists' ? 'Playlists' : 'Offline'}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {renderActiveTab()}
      </ScrollView>

      <View style={styles.playerDock}>
        <View style={styles.playerThumb} />
        <View style={styles.playerInfo}>
          <Text style={styles.playerTitle}>{health?.ok ? 'Servidor pronto para tocar' : 'Conecte o host do MusFy'}</Text>
          <Text numberOfLines={1} style={styles.playerSubtitle}>{statusMessage}</Text>
        </View>
        <View style={styles.playerBadge}>
          <Text style={styles.playerBadgeLabel}>{offlineTracks.length} offline</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505'
  },
  content: {
    padding: 18,
    paddingBottom: 126,
    gap: 16
  },
  bootScreen: {
    flex: 1,
    backgroundColor: '#050505',
    justifyContent: 'center',
    padding: 24
  },
  bootPanel: {
    borderRadius: 34,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(11,11,11,0.96)',
    padding: 28,
    gap: 18
  },
  bootBrand: {
    color: BRAND,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1
  },
  bootText: {
    color: '#a1a1aa',
    fontSize: 15,
    lineHeight: 24
  },
  headerShell: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12
  },
  brandColumn: {
    flex: 1,
    gap: 6
  },
  brand: {
    color: BRAND,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -1
  },
  brandCaption: {
    color: '#71717a',
    fontSize: 13,
    lineHeight: 20
  },
  actionPills: {
    flexDirection: 'row',
    gap: 8
  },
  topPill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)'
  },
  topPillLabel: {
    color: '#e4e4e7',
    fontSize: 12,
    fontWeight: '700'
  },
  searchShell: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111111',
    paddingHorizontal: 18
  },
  headerSearch: {
    height: 56,
    color: '#fafafa',
    fontSize: 15
  },
  heroCard: {
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0b0b0b',
    padding: 22,
    gap: 12
  },
  heroEyebrow: {
    color: '#86efac',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 3
  },
  heroTitle: {
    color: '#fafafa',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -1
  },
  heroText: {
    color: '#a1a1aa',
    fontSize: 14,
    lineHeight: 22
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4
  },
  summaryCard: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 14
  },
  summaryValue: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900'
  },
  summaryLabel: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 4
  },
  sidebarCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#101010',
    padding: 16,
    gap: 14
  },
  sidebarTitle: {
    color: '#fafafa',
    fontSize: 18,
    fontWeight: '800'
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  tab: {
    minWidth: '47%',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)'
  },
  tabActive: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff'
  },
  tabLabel: {
    color: '#d4d4d8',
    fontSize: 14,
    fontWeight: '700'
  },
  tabLabelActive: {
    color: '#09090b'
  },
  panel: {
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0b0b0b',
    padding: 18,
    gap: 16
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
  },
  panelEyebrow: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.4,
    textTransform: 'uppercase'
  },
  panelTitle: {
    color: '#fafafa',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -1,
    marginTop: 6
  },
  panelText: {
    color: '#a1a1aa',
    fontSize: 14,
    lineHeight: 22
  },
  badgeMuted: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)'
  },
  badgeMutedLabel: {
    color: '#e4e4e7',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase'
  },
  badgePositive: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.24)'
  },
  badgePositiveLabel: {
    color: '#bbf7d0',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase'
  },
  searchInput: {
    height: 54,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#141414',
    color: '#fafafa',
    paddingHorizontal: 16,
    fontSize: 15
  },
  actionColumn: {
    gap: 10
  },
  primaryAction: {
    borderRadius: 22,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND
  },
  primaryActionLabel: {
    color: '#03130a',
    fontSize: 15,
    fontWeight: '900'
  },
  secondaryAction: {
    borderRadius: 22,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)'
  },
  secondaryActionLabel: {
    color: '#fafafa',
    fontSize: 14,
    fontWeight: '700'
  },
  metricsGrid: {
    gap: 12
  },
  metricCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111111',
    padding: 16,
    gap: 6
  },
  metricLabel: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase'
  },
  metricValue: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800'
  },
  metricText: {
    color: '#a1a1aa',
    fontSize: 12,
    lineHeight: 18
  },
  noticeCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.18)',
    backgroundColor: 'rgba(15,50,31,0.34)',
    padding: 16
  },
  noticeText: {
    color: '#d4d4d8',
    fontSize: 13,
    lineHeight: 20
  },
  songCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#121212',
    padding: 14
  },
  songArtworkShell: {
    height: 62,
    width: 62,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#1b1b1b'
  },
  songArtwork: {
    height: '100%',
    width: '100%'
  },
  songArtworkFallback: {
    height: 62,
    width: 62,
    borderRadius: 18,
    backgroundColor: '#1b1b1b'
  },
  songMeta: {
    flex: 1,
    gap: 4
  },
  songTitle: {
    color: '#fafafa',
    fontSize: 16,
    fontWeight: '800'
  },
  songSubtitle: {
    color: '#a1a1aa',
    fontSize: 12,
    lineHeight: 18
  },
  songPath: {
    color: '#52525b',
    fontSize: 11
  },
  iconAction: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(34,197,94,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.22)'
  },
  iconActionLabel: {
    color: '#bbf7d0',
    fontSize: 12,
    fontWeight: '800'
  },
  playlistCard: {
    gap: 12
  },
  playlistCoverShell: {
    height: 212,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#121212',
    justifyContent: 'flex-end'
  },
  playlistCover: {
    ...StyleSheet.absoluteFillObject
  },
  playlistCoverFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#161616'
  },
  playlistOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.34)'
  },
  playlistCopy: {
    padding: 18,
    gap: 6
  },
  playlistEyebrow: {
    color: '#e4e4e7',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase'
  },
  playlistName: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -1
  },
  playlistMeta: {
    color: '#d4d4d8',
    fontSize: 13
  },
  emptyCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#111111',
    padding: 18,
    gap: 8
  },
  emptyTitle: {
    color: '#fafafa',
    fontSize: 18,
    fontWeight: '800'
  },
  emptyText: {
    color: '#a1a1aa',
    fontSize: 13,
    lineHeight: 20
  },
  playerDock: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(7,7,7,0.96)',
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  playerThumb: {
    height: 48,
    width: 48,
    borderRadius: 16,
    backgroundColor: '#1a1a1a'
  },
  playerInfo: {
    flex: 1,
    gap: 3
  },
  playerTitle: {
    color: '#fafafa',
    fontSize: 14,
    fontWeight: '800'
  },
  playerSubtitle: {
    color: '#71717a',
    fontSize: 11
  },
  playerBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.06)'
  },
  playerBadgeLabel: {
    color: '#fafafa',
    fontSize: 11,
    fontWeight: '800'
  }
});

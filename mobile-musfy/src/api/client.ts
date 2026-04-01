import type {
  AndroidApkInfo,
  DownloadJob,
  DownloadMode,
  HealthStatus,
  Playlist,
  PlaylistScope,
  ServiceStorage,
  Song,
  SongSection,
  User
} from '../types';

const REQUEST_TIMEOUT_MS = 12000;

export function normalizeBaseUrl(baseUrl: string) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function looksLikeMojibake(value: string) {
  return /(?:Ã.|Â.|ï¿½)/.test(value);
}

function repairTextEncoding(value: string | null | undefined) {
  const input = String(value || '');
  if (!input || !looksLikeMojibake(input)) {
    return input;
  }

  try {
    const escaped = typeof escape === 'function' ? escape(input) : input;
    const repaired = decodeURIComponent(escaped);
    if (!repaired || repaired.includes('\u0000')) {
      return input;
    }

    const inputSignals = (input.match(/(?:Ã.|Â.|ï¿½)/g) || []).length;
    const repairedSignals = (repaired.match(/(?:Ã.|Â.|ï¿½)/g) || []).length;
    return repairedSignals < inputSignals ? repaired : input;
  } catch {
    return input;
  }
}

function sanitizeDeepText<T>(value: T): T {
  if (typeof value === 'string') {
    return repairTextEncoding(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDeepText(entry)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, sanitizeDeepText(entry)])
    ) as T;
  }

  return value;
}

async function readJson<T>(input: RequestInfo, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal
    });

    const rawText = await response.text();
    const payload = rawText ? sanitizeDeepText(JSON.parse(rawText)) : null;

    if (!response.ok) {
      const message =
        typeof payload?.error === 'string'
          ? payload.error
          : typeof payload?.message === 'string'
            ? payload.message
            : `HTTP ${response.status}`;
      throw new Error(repairTextEncoding(message));
    }

    return payload as T;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      throw new Error('Tempo limite ao conectar com o servidor MusFy');
    }

    if (error instanceof SyntaxError) {
      throw new Error('Resposta inválida do servidor MusFy');
    }

    if (error instanceof Error) {
      throw new Error(repairTextEncoding(error.message));
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readMutation<T>(
  input: RequestInfo,
  init: RequestInit,
  fallbackMessage: string
) {
  const payload = await readJson<T>(input, init);
  if (!payload) {
    throw new Error(fallbackMessage);
  }
  return payload;
}

export function buildAudioStreamUrl(baseUrl: string, songId: string) {
  return `${normalizeBaseUrl(baseUrl)}/reproduzir-musica/${songId}`;
}

export function buildVideoStreamUrl(baseUrl: string, songId: string) {
  return `${normalizeBaseUrl(baseUrl)}/reproduzir-video/${songId}`;
}

export async function fetchHealth(baseUrl: string) {
  const payload = await readJson<{
    ok?: boolean;
    ready?: boolean;
    status?: string;
    service?: string;
    mode?: string;
    host?: string;
    port?: number;
    storage?: ServiceStorage | null;
  }>(`${normalizeBaseUrl(baseUrl)}/health`);

  return {
    ok: payload.ok ?? payload.status === 'ok',
    ready: payload.ready ?? payload.ok ?? null,
    status: payload.status ?? (payload.ok ? 'ok' : null),
    service: payload.service ?? null,
    mode: payload.mode ?? null,
    host: payload.host ?? null,
    port: payload.port ?? null,
    storage: payload.storage ?? null
  } satisfies HealthStatus;
}

export async function fetchSongs(baseUrl: string, userId?: string | null, section: SongSection = 'library') {
  const searchParams = new URLSearchParams({ section });
  if (userId) searchParams.set('userId', userId);
  return await readJson<Song[]>(`${normalizeBaseUrl(baseUrl)}/enviar-musica?${searchParams.toString()}`);
}

export async function fetchPlaylists(
  baseUrl: string,
  options?: {
    userId?: string | null;
    scope?: PlaylistScope;
    excludeUserId?: string | null;
  }
) {
  const searchParams = new URLSearchParams();
  if (options?.userId) searchParams.set('userId', options.userId);
  if (options?.scope) searchParams.set('scope', options.scope);
  if (options?.excludeUserId) searchParams.set('excludeUserId', options.excludeUserId);
  const suffix = searchParams.toString();
  return await readJson<Playlist[]>(`${normalizeBaseUrl(baseUrl)}/playlists${suffix ? `?${suffix}` : ''}`);
}

export async function fetchServiceStorage(baseUrl: string) {
  const payload = await readJson<{ storage?: ServiceStorage }>(`${normalizeBaseUrl(baseUrl)}/service/storage`);
  return payload.storage || {};
}

export async function fetchAndroidApkInfo(baseUrl: string) {
  return await readJson<AndroidApkInfo>(`${normalizeBaseUrl(baseUrl)}/android/apk-info`);
}

export async function registerAndroidDevice(baseUrl: string, deviceId: string, deviceName: string, userId?: string | null) {
  return await readJson(`${normalizeBaseUrl(baseUrl)}/devices/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      deviceId,
      deviceName,
      userId: userId || undefined,
      platform: 'android'
    })
  });
}

export async function loginUser(baseUrl: string, email: string, senha: string) {
  const payload = await readMutation<{ success?: boolean; usuario?: User }>(
    `${normalizeBaseUrl(baseUrl)}/auth/login`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, senha })
    },
    'Servidor MusFy não retornou usuário válido no login'
  );

  if (!payload.usuario) {
    throw new Error('Servidor MusFy não retornou usuário válido no login');
  }

  return payload.usuario;
}

export async function registerUser(baseUrl: string, nome: string, email: string, senha: string) {
  const payload = await readMutation<{ success?: boolean; usuario?: User }>(
    `${normalizeBaseUrl(baseUrl)}/auth/register`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ nome, email, senha })
    },
    'Servidor MusFy não retornou usuário válido no cadastro'
  );

  if (!payload.usuario) {
    throw new Error('Servidor MusFy não retornou usuário válido no cadastro');
  }

  return payload.usuario;
}

export async function toggleFavorite(baseUrl: string, songId: string, favorite: boolean, userId?: string | null) {
  const payload = await readMutation<{ success?: boolean; music?: Song }>(
    `${normalizeBaseUrl(baseUrl)}/musicas/${songId}/favorito`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        favorite,
        userId: userId || undefined
      })
    },
    'Servidor MusFy não retornou a faixa atualizada'
  );

  if (!payload.music) {
    throw new Error('Servidor MusFy não retornou a faixa atualizada');
  }

  return payload.music;
}

export async function createPlaylist(baseUrl: string, name: string, userId?: string | null) {
  const payload = await readMutation<{ success?: boolean; playlist?: Playlist }>(
    `${normalizeBaseUrl(baseUrl)}/playlists`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        userId: userId || undefined
      })
    },
    'Servidor MusFy não retornou a playlist criada'
  );

  if (!payload.playlist) {
    throw new Error('Servidor MusFy não retornou a playlist criada');
  }

  return sanitizeDeepText(payload.playlist);
}

export async function renamePlaylist(baseUrl: string, playlistId: string, name: string) {
  const payload = await readMutation<{ success?: boolean; playlist?: Playlist }>(
    `${normalizeBaseUrl(baseUrl)}/playlists/${playlistId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name })
    },
    'Servidor MusFy não retornou a playlist renomeada'
  );

  if (!payload.playlist) {
    throw new Error('Servidor MusFy não retornou a playlist renomeada');
  }

  return sanitizeDeepText(payload.playlist);
}

export async function deletePlaylist(baseUrl: string, playlistId: string) {
  return await readJson<{ success?: boolean; removed?: Playlist }>(
    `${normalizeBaseUrl(baseUrl)}/playlists/${playlistId}`,
    {
      method: 'DELETE'
    }
  );
}

export async function addSongToPlaylist(baseUrl: string, playlistId: string, musicId: string) {
  return await readJson<{ success?: boolean; playlist?: Playlist }>(
    `${normalizeBaseUrl(baseUrl)}/playlists/${playlistId}/musicas`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ musicId })
    }
  );
}

export async function removeSongFromPlaylist(baseUrl: string, playlistId: string, musicId: string) {
  return await readJson<{ success?: boolean; playlist?: Playlist }>(
    `${normalizeBaseUrl(baseUrl)}/playlists/${playlistId}/musicas/${musicId}`,
    {
      method: 'DELETE'
    }
  );
}

export async function fetchDownloadJobs(baseUrl: string) {
  return await readJson<DownloadJob[]>(`${normalizeBaseUrl(baseUrl)}/downloads/status`);
}

export async function pauseDownloadJob(baseUrl: string, jobId: string) {
  return await readJson<{ success?: boolean; job?: DownloadJob }>(
    `${normalizeBaseUrl(baseUrl)}/downloads/${jobId}/pause`,
    {
      method: 'POST'
    }
  );
}

export async function resumeDownloadJob(baseUrl: string, jobId: string) {
  return await readJson<{ success?: boolean; job?: DownloadJob }>(
    `${normalizeBaseUrl(baseUrl)}/downloads/${jobId}/resume`,
    {
      method: 'POST'
    }
  );
}

export async function enqueueYoutubeDownload(
  baseUrl: string,
  payload: {
    url: string;
    userId?: string | null;
    mode?: DownloadMode;
    includeVideo?: boolean;
    targetPlaylistId?: string | null;
    title?: string | null;
    artist?: string | null;
    playlistTitle?: string | null;
  }
) {
  return await readJson<{ success?: boolean; queued?: boolean; job?: DownloadJob }>(
    `${normalizeBaseUrl(baseUrl)}/downloads/enqueue`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );
}

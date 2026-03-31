import type { HealthStatus, Playlist, ServiceStorage, Song } from '../types';

const REQUEST_TIMEOUT_MS = 12000;

async function readJson<T>(input: RequestInfo, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Tempo limite ao conectar com o servidor MusFy');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchHealth(baseUrl: string) {
  const payload = await readJson<{
    ok?: boolean;
    status?: string;
    service?: string;
    mode?: string;
    host?: string;
    port?: number;
    runtime?: { sqlite?: unknown; redis?: unknown };
    storage?: ServiceStorage | null;
  }>(`${baseUrl}/health`);

  return {
    ok: payload.ok ?? payload.status === 'ok',
    status: payload.status ?? (payload.ok ? 'ok' : null),
    service: payload.service ?? null,
    mode: payload.mode ?? null,
    host: payload.host ?? null,
    port: payload.port ?? null,
    storage: payload.storage ?? null
  } satisfies HealthStatus;
}

export async function fetchSongs(baseUrl: string) {
  return await readJson<Song[]>(`${baseUrl}/enviar-musica?section=library`);
}

export async function fetchPlaylists(baseUrl: string) {
  return await readJson<Playlist[]>(`${baseUrl}/playlists`);
}

export async function fetchServiceStorage(baseUrl: string) {
  const payload = await readJson<{ storage?: ServiceStorage }>(`${baseUrl}/service/storage`);
  return payload.storage || {};
}

export async function registerAndroidDevice(baseUrl: string, deviceId: string, deviceName: string) {
  return await readJson(`${baseUrl}/devices/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      deviceId,
      deviceName,
      platform: 'android'
    })
  });
}

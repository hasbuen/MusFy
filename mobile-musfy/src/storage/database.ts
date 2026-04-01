import * as SQLite from 'expo-sqlite';
import type { OfflineTrack, Playlist, Song } from '../types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('musfy-mobile.db');
  }
  return dbPromise;
}

export async function initDatabase() {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS cached_songs (
      id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cached_playlists (
      id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offline_tracks (
      song_id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      artist TEXT,
      thumbnail TEXT,
      local_uri TEXT NOT NULL,
      mime_type TEXT,
      saved_at TEXT NOT NULL,
      size_bytes INTEGER
    );
    CREATE TABLE IF NOT EXISTS offline_playlist_items (
      playlist_id TEXT NOT NULL,
      song_id TEXT NOT NULL,
      PRIMARY KEY (playlist_id, song_id)
    );
  `);
}

export async function getSetting(key: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

export async function cacheSongs(songs: Song[]) {
  const db = await getDb();
  const updatedAt = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM cached_songs');
    for (const song of songs) {
      await db.runAsync('INSERT INTO cached_songs (id, payload, updated_at) VALUES (?, ?, ?)', [
        song.id,
        JSON.stringify(song),
        updatedAt
      ]);
    }
  });
}

export async function getCachedSongs() {
  const db = await getDb();
  const rows = await db.getAllAsync<{ payload: string }>('SELECT payload FROM cached_songs ORDER BY updated_at DESC');
  return rows.map((row) => JSON.parse(row.payload) as Song);
}

export async function cachePlaylists(playlists: Playlist[]) {
  const db = await getDb();
  const updatedAt = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM cached_playlists');
    for (const playlist of playlists) {
      await db.runAsync('INSERT INTO cached_playlists (id, payload, updated_at) VALUES (?, ?, ?)', [
        playlist.id,
        JSON.stringify(playlist),
        updatedAt
      ]);
    }
  });
}

export async function getCachedPlaylists() {
  const db = await getDb();
  const rows = await db.getAllAsync<{ payload: string }>('SELECT payload FROM cached_playlists ORDER BY updated_at DESC');
  return rows.map((row) => JSON.parse(row.payload) as Playlist);
}

export async function saveOfflineTrack(track: OfflineTrack, playlistId?: string) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO offline_tracks (song_id, title, artist, thumbnail, local_uri, mime_type, saved_at, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(song_id) DO UPDATE SET
       title = excluded.title,
       artist = excluded.artist,
       thumbnail = excluded.thumbnail,
       local_uri = excluded.local_uri,
       mime_type = excluded.mime_type,
       saved_at = excluded.saved_at,
       size_bytes = excluded.size_bytes`,
    [
      track.songId,
      track.title,
      track.artist || null,
      track.thumbnail || null,
      track.localUri,
      track.mimeType || null,
      track.savedAt,
      track.sizeBytes || null
    ]
  );

  if (playlistId) {
    await db.runAsync(
      'INSERT OR IGNORE INTO offline_playlist_items (playlist_id, song_id) VALUES (?, ?)',
      [playlistId, track.songId]
    );
  }
}

export async function listOfflineTracks() {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    song_id: string;
    title: string;
    artist: string | null;
    thumbnail: string | null;
    local_uri: string;
    mime_type: string | null;
    saved_at: string;
    size_bytes: number | null;
  }>('SELECT * FROM offline_tracks ORDER BY saved_at DESC');

  return rows.map((row) => ({
    songId: row.song_id,
    title: row.title,
    artist: row.artist,
    thumbnail: row.thumbnail,
    localUri: row.local_uri,
    mimeType: row.mime_type,
    savedAt: row.saved_at,
    sizeBytes: row.size_bytes
  })) as OfflineTrack[];
}

export async function getOfflineTrack(songId: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    song_id: string;
    title: string;
    artist: string | null;
    thumbnail: string | null;
    local_uri: string;
    mime_type: string | null;
    saved_at: string;
    size_bytes: number | null;
  }>('SELECT * FROM offline_tracks WHERE song_id = ?', [songId]);

  if (!row) return null;

  return {
    songId: row.song_id,
    title: row.title,
    artist: row.artist,
    thumbnail: row.thumbnail,
    localUri: row.local_uri,
    mimeType: row.mime_type,
    savedAt: row.saved_at,
    sizeBytes: row.size_bytes
  } satisfies OfflineTrack;
}

export async function removeOfflineTrack(songId: string) {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM offline_playlist_items WHERE song_id = ?', [songId]);
    await db.runAsync('DELETE FROM offline_tracks WHERE song_id = ?', [songId]);
  });
}

import { Directory, File, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { removeOfflineTrack, saveOfflineTrack } from './database';
import type { OfflineTrack, Playlist, Song } from '../types';

function getOfflineDirectory() {
  const directory = new Directory(Paths.document, 'musfy-offline');
  if (!directory.exists) {
    directory.create({ idempotent: true, intermediates: true });
  }
  return directory;
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function getExtensionFromResponse(song: Song, contentType: string | null, disposition: string | null) {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  const fileName = match?.[1] || '';
  const fromName = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';

  if (fromName) return fromName;
  if (contentType?.includes('mpeg')) return '.mp3';
  if (contentType?.includes('mp4')) return '.m4a';
  if (contentType?.includes('wav')) return '.wav';
  if (contentType?.includes('flac')) return '.flac';
  if (contentType?.includes('ogg')) return '.opus';
  return song.audioMimeType?.includes('mpeg') ? '.mp3' : '.opus';
}

function getTrackFileName(song: Song, contentType: string | null, disposition: string | null) {
  return `${sanitizeFilePart(song.id)}${getExtensionFromResponse(song, contentType, disposition)}`;
}

export async function downloadSongOffline(baseUrl: string, song: Song, playlistId?: string) {
  const outputDir = getOfflineDirectory();
  const response = await expoFetch(`${baseUrl}/download-musica/${song.id}`);

  if (!response.ok) {
    throw new Error(`Falha ao baixar "${song.title}" para offline`);
  }

  const contentType = response.headers.get('content-type');
  const disposition = response.headers.get('content-disposition');
  const output = new File(outputDir, getTrackFileName(song, contentType, disposition));
  output.write(await response.bytes());

  const track: OfflineTrack = {
    songId: song.id,
    title: song.title,
    artist: song.artist || null,
    thumbnail: song.thumbnail || null,
    localUri: output.uri,
    mimeType: contentType || song.audioMimeType || 'audio/ogg',
    savedAt: new Date().toISOString(),
    sizeBytes: output.size
  };

  await saveOfflineTrack(track, playlistId);
  return track;
}

export async function downloadPlaylistOffline(baseUrl: string, playlist: Playlist, onProgress?: (done: number, total: number) => void) {
  const songs = playlist.songs || [];
  let completed = 0;

  for (const song of songs) {
    await downloadSongOffline(baseUrl, song, playlist.id);
    completed += 1;
    onProgress?.(completed, songs.length);
  }
}

export async function removeSongOffline(track: OfflineTrack) {
  const file = new File(track.localUri);
  if (file.exists) {
    file.delete();
  }

  await removeOfflineTrack(track.songId);
}

export interface AudioPlaybackUrlOptions {
  songId: string;
  baseUrl: string;
  getOfflineBlob: () => Promise<Blob | null | undefined>;
  createObjectUrl: (blob: Blob) => string;
  releaseObjectUrl: () => void;
  onOfflineCacheError?: (error: unknown) => void;
}

export function buildLocalAudioPlaybackUrl(baseUrl: string, songId: string) {
  return `${baseUrl.replace(/\/$/, '')}/reproduzir-musica/${encodeURIComponent(songId)}`;
}

export function buildLocalVideoPlaybackUrl(baseUrl: string, songId: string) {
  return `${baseUrl.replace(/\/$/, '')}/reproduzir-video/${encodeURIComponent(songId)}`;
}

export async function resolveAudioPlaybackUrl(options: AudioPlaybackUrlOptions) {
  try {
    const offlineBlob = await options.getOfflineBlob();
    if (offlineBlob) {
      options.releaseObjectUrl();
      return options.createObjectUrl(offlineBlob);
    }
  } catch (error) {
    options.onOfflineCacheError?.(error);
  }

  return buildLocalAudioPlaybackUrl(options.baseUrl, options.songId);
}

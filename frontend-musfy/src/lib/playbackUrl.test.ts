import { describe, expect, it, vi } from 'vitest';
import { buildLocalAudioPlaybackUrl, buildLocalVideoPlaybackUrl, resolveAudioPlaybackUrl } from './playbackUrl';

describe('playbackUrl', () => {
  it('builds encoded local streaming URLs for audio and video', () => {
    expect(buildLocalAudioPlaybackUrl('http://127.0.0.1:3333/', 'song 1')).toBe(
      'http://127.0.0.1:3333/reproduzir-musica/song%201'
    );
    expect(buildLocalVideoPlaybackUrl('http://127.0.0.1:3333', 'video/1')).toBe(
      'http://127.0.0.1:3333/reproduzir-video/video%2F1'
    );
  });

  it('prefers an offline blob and releases the previous object URL before creating a new one', async () => {
    const blob = new Blob(['audio']);
    const releaseObjectUrl = vi.fn();
    const createObjectUrl = vi.fn(() => 'blob:musfy-audio');

    const url = await resolveAudioPlaybackUrl({
      songId: 'abc',
      baseUrl: 'http://localhost:3333',
      getOfflineBlob: async () => blob,
      createObjectUrl,
      releaseObjectUrl
    });

    expect(url).toBe('blob:musfy-audio');
    expect(releaseObjectUrl).toHaveBeenCalledOnce();
    expect(createObjectUrl).toHaveBeenCalledWith(blob);
  });

  it('falls back to local streaming when the offline cache is empty', async () => {
    const url = await resolveAudioPlaybackUrl({
      songId: 'abc',
      baseUrl: 'http://localhost:3333',
      getOfflineBlob: async () => null,
      createObjectUrl: vi.fn(),
      releaseObjectUrl: vi.fn()
    });

    expect(url).toBe('http://localhost:3333/reproduzir-musica/abc');
  });

  it('falls back to local streaming when offline cache lookup throws', async () => {
    const onOfflineCacheError = vi.fn();

    const url = await resolveAudioPlaybackUrl({
      songId: 'abc',
      baseUrl: 'http://localhost:3333/',
      getOfflineBlob: async () => {
        throw new Error('createInstance failed');
      },
      createObjectUrl: vi.fn(),
      releaseObjectUrl: vi.fn(),
      onOfflineCacheError
    });

    expect(url).toBe('http://localhost:3333/reproduzir-musica/abc');
    expect(onOfflineCacheError).toHaveBeenCalledWith(expect.any(Error));
  });
});

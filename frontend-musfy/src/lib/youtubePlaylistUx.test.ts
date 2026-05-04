import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'App.tsx'), 'utf-8');

describe('YouTube playlist UX', () => {
  it('lets users open playlist entries directly instead of only previewing the first item', () => {
    expect(appSource).toContain('buildYoutubeAnalysisForPlaylistEntry');
    expect(appSource).toContain('previewYoutubePlaylistEntry');
    expect(appSource).toContain('Dentro da playlist');
    expect(appSource).toContain('Reproduzir primeira');
    expect(appSource).toContain('Assistir ou ouvir agora');
  });
});

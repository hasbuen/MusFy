import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'App.tsx'), 'utf-8');

describe('download completion refresh', () => {
  it('refreshes library playlists automatically when queued downloads finish', () => {
    expect(appSource).toContain('completedDownloadJobIdsRef');
    expect(appSource).toContain("refreshLibraryAfterDownload('completed-job')");
    expect(appSource).toContain('loadPlaylists(currentUser)');
    expect(appSource).toContain('loadDiscoverPlaylists(currentUser)');
    expect(appSource).toContain('hasUnfinishedDownloadJobs');
  });
});

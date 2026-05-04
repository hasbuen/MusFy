import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'App.tsx'), 'utf-8');
const serverSource = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'backend-musfy', 'server.js'), 'utf-8');

describe('browser client entry', () => {
  it('exposes the desktop app through the local service and login screen', () => {
    expect(serverSource).toContain('app.use(express.static(frontendDistDir))');
    expect(serverSource).toContain("res.sendFile(path.join(frontendDistDir, 'index.html'))");
    expect(appSource).toContain('openBrowserClient');
    expect(appSource).toContain('Abrir MusFy no navegador');
  });
});

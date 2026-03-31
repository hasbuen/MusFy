import { app } from 'electron';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_SERVICE_HOST = process.env.MUSFY_SERVICE_HOST || '127.0.0.1';
const DEFAULT_SERVICE_PORT = Number(process.env.MUSFY_SERVICE_PORT || '3001');
const HEALTH_PATH = '/health';
const START_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 500;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

type ServiceConfig = {
  host: string;
  port: number;
  baseUrl: string;
  healthUrl: string;
  mode: 'managed' | 'external';
  isPackaged: boolean;
  backendEntry: string;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveBackendRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend-musfy');
  }

  return path.resolve(__dirname, '..', '..', 'backend-musfy');
}

function resolveBackendEntry() {
  return path.join(resolveBackendRoot(), 'server.js');
}

function buildServiceConfig(mode: ServiceConfig['mode']): ServiceConfig {
  const host = DEFAULT_SERVICE_HOST;
  const port = DEFAULT_SERVICE_PORT;
  const baseUrl = `http://${host}:${port}`;

  return {
    host,
    port,
    baseUrl,
    healthUrl: `${baseUrl}${HEALTH_PATH}`,
    mode,
    isPackaged: app.isPackaged,
    backendEntry: resolveBackendEntry()
  };
}

async function checkHealth(url: string) {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      return false;
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          ready?: boolean;
          storage?: {
            sqlite?: { ready?: boolean };
            redis?: { mode?: string };
          };
        }
      | null;

    if (typeof payload?.ready === 'boolean') {
      return payload.ready;
    }

    return Boolean(
      payload?.storage?.sqlite?.ready &&
        ['embedded', 'external'].includes(String(payload?.storage?.redis?.mode || ''))
    );
  } catch {
    return false;
  }
}

export class MusfyServiceController {
  private config: ServiceConfig;
  private backendHandle: { startServer?: () => unknown; stopServer?: () => Promise<void> | void } | null = null;
  private childProcess: ReturnType<typeof spawn> | null = null;

  constructor(mode: ServiceConfig['mode'] = 'managed') {
    this.config = buildServiceConfig(mode);
  }

  getConfig() {
    return { ...this.config };
  }

  getRendererConfig() {
    return {
      host: this.config.host,
      port: this.config.port,
      baseUrl: this.config.baseUrl,
      mode: this.config.mode
    };
  }

  async ensureStarted() {
    const healthy = await checkHealth(this.config.healthUrl);
    if (healthy) {
      this.config = { ...this.config, mode: 'external' };
      return this.getConfig();
    }

    if (this.config.mode === 'external') {
      await this.waitUntilHealthy();
      return this.getConfig();
    }

    await this.startManagedProcess();
    await this.waitUntilHealthy();
    return this.getConfig();
  }

  async stop() {
    if (this.childProcess && !this.childProcess.killed) {
      this.childProcess.kill();
      this.childProcess = null;
    }

    if (this.backendHandle?.stopServer) {
      await this.backendHandle.stopServer();
      this.backendHandle = null;
    }
  }

  private async startManagedProcess() {
    if (this.backendHandle || this.childProcess) {
      return;
    }

    const backendEntry = this.config.backendEntry;
    if (!fs.existsSync(backendEntry)) {
      throw new Error(`Backend do MusFy nao encontrado em ${backendEntry}`);
    }

    if (app.isPackaged) {
      const bundledNode = path.join(process.resourcesPath, 'runtime', 'node.exe');
      if (!fs.existsSync(bundledNode)) {
        throw new Error(`Runtime Node do MusFy nao encontrado em ${bundledNode}`);
      }

      this.childProcess = spawn(bundledNode, [backendEntry], {
        cwd: path.dirname(backendEntry),
        windowsHide: true,
        detached: false,
        stdio: 'ignore',
        env: {
          ...process.env,
          HOST: process.env.MUSFY_SERVICE_BIND_HOST || '0.0.0.0',
          PORT: String(this.config.port),
          MUSFY_SERVICE_MODE: 'local-service',
          MUSFY_FRONTEND_DIST: path.join(process.resourcesPath, 'frontend-dist')
        }
      });

      this.childProcess.once('exit', () => {
        this.childProcess = null;
      });

      return;
    }

    process.env.HOST = process.env.MUSFY_SERVICE_BIND_HOST || '0.0.0.0';
    process.env.PORT = String(this.config.port);
    process.env.MUSFY_SERVICE_MODE = 'local-service';

    const backendHandle = require(backendEntry);
    if (!backendHandle || typeof backendHandle.startServer !== 'function') {
      throw new Error(`Backend do MusFy nao exporta startServer em ${backendEntry}`);
    }

    backendHandle.startServer();
    this.backendHandle = backendHandle;
  }

  private async waitUntilHealthy() {
    const startedAt = Date.now();

    while (Date.now() - startedAt < START_TIMEOUT_MS) {
      if (await checkHealth(this.config.healthUrl)) {
        return;
      }

      await delay(POLL_INTERVAL_MS);
    }

    throw new Error('Servico local do MusFy nao respondeu a tempo');
  }
}

export function getLocalNetworkAddresses(port = DEFAULT_SERVICE_PORT) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface): iface is NonNullable<typeof iface> => Boolean(iface))
    .filter((iface) => iface.family === 'IPv4' && !iface.internal)
    .map((iface) => `http://${iface.address}:${port}`);
}

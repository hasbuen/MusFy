import { app } from 'electron';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_SERVICE_HOST = process.env.MUSFY_SERVICE_HOST || '127.0.0.1';
const DEFAULT_BIND_HOST = process.env.MUSFY_SERVICE_BIND_HOST || '0.0.0.0';
const DEFAULT_SERVICE_PORT = Number(process.env.MUSFY_SERVICE_PORT || '3001');
const HEALTH_PATH = '/health';
const START_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 500;
const PORT_SCAN_WINDOW = 40;

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

type SharedRuntimeState = {
  host?: string | null;
  port?: number | null;
  baseUrl?: string | null;
  source?: string | null;
  updatedAt?: string | null;
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

function resolveRuntimeStatePath() {
  if (process.platform === 'win32') {
    const programData = process.env.ProgramData || 'C:\\ProgramData';
    return path.join(programData, 'MusFy', 'service-runtime.json');
  }

  return path.join(app.getPath('userData'), 'service-runtime.json');
}

function buildServiceConfig(mode: ServiceConfig['mode'], port = DEFAULT_SERVICE_PORT, host = DEFAULT_SERVICE_HOST): ServiceConfig {
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

function readRuntimeState() {
  try {
    const file = resolveRuntimeStatePath();
    if (!fs.existsSync(file)) return null;

    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as SharedRuntimeState;
    return {
      host: parsed?.host || DEFAULT_SERVICE_HOST,
      port: Number(parsed?.port || 0) || null,
      baseUrl: parsed?.baseUrl || null,
      source: parsed?.source || null,
      updatedAt: parsed?.updatedAt || null
    } satisfies SharedRuntimeState;
  } catch {
    return null;
  }
}

function writeRuntimeState(config: ServiceConfig, source: 'managed' | 'external') {
  try {
    const file = resolveRuntimeStatePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          host: config.host,
          port: config.port,
          baseUrl: config.baseUrl,
          source,
          updatedAt: new Date().toISOString()
        } satisfies SharedRuntimeState,
        null,
        2
      ),
      'utf-8'
    );
  } catch {}
}

function resolveBackendLogPath() {
  return path.join(path.dirname(resolveRuntimeStatePath()), 'backend.log');
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

async function isPortAvailable(port: number, host = DEFAULT_BIND_HOST) {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function reserveEphemeralPort(host = DEFAULT_BIND_HOST) {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ port: 0, host }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : DEFAULT_SERVICE_PORT;
      server.close(() => resolve(port));
    });
  });
}

async function findAvailablePort(startPort = DEFAULT_SERVICE_PORT) {
  for (let offset = 0; offset < PORT_SCAN_WINDOW; offset += 1) {
    const candidate = startPort + offset;
    if (await isPortAvailable(candidate)) {
      return candidate;
    }
  }

  return await reserveEphemeralPort();
}

async function resolveHealthyConfig(defaultMode: ServiceConfig['mode']) {
  const runtime = readRuntimeState();
  const candidates = [
    runtime?.port ? buildServiceConfig('external', runtime.port, runtime.host || DEFAULT_SERVICE_HOST) : null,
    buildServiceConfig(defaultMode)
  ].filter(Boolean) as ServiceConfig[];

  const visited = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.host}:${candidate.port}`;
    if (visited.has(key)) continue;
    visited.add(key);

    if (await checkHealth(candidate.healthUrl)) {
      return candidate;
    }
  }

  return null;
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
    const healthyConfig = await resolveHealthyConfig(this.config.mode);
    if (healthyConfig) {
      this.config = { ...healthyConfig, mode: 'external' };
      writeRuntimeState(this.config, 'external');
      return this.getConfig();
    }

    if (this.config.mode === 'external') {
      const runtime = readRuntimeState();
      if (runtime?.port) {
        this.config = buildServiceConfig('external', runtime.port, runtime.host || DEFAULT_SERVICE_HOST);
      }
      await this.waitUntilHealthy();
      writeRuntimeState(this.config, 'external');
      return this.getConfig();
    }

    const port = await findAvailablePort(DEFAULT_SERVICE_PORT);
    this.config = buildServiceConfig('managed', port);

    await this.startManagedProcess();
    await this.waitUntilHealthy();
    writeRuntimeState(this.config, 'managed');
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
      const bundledNode = path.join(process.resourcesPath, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
      if (!fs.existsSync(bundledNode)) {
        throw new Error(`Runtime Node do MusFy nao encontrado em ${bundledNode}`);
      }

      if (process.platform !== 'win32') {
        fs.chmodSync(bundledNode, 0o755);
      }

      const backendDependenciesDir = path.join(path.dirname(backendEntry), 'dependencies');
      const backendLogPath = resolveBackendLogPath();
      fs.mkdirSync(path.dirname(backendLogPath), { recursive: true });
      const backendLogStream = fs.createWriteStream(backendLogPath, { flags: 'a' });

      this.childProcess = spawn(bundledNode, [backendEntry], {
        cwd: path.dirname(backendEntry),
        windowsHide: process.platform === 'win32',
        detached: false,
        stdio: ['ignore', backendLogStream, backendLogStream],
        env: {
          ...process.env,
          NODE_PATH: backendDependenciesDir,
          HOST: DEFAULT_BIND_HOST,
          PORT: String(this.config.port),
          MUSFY_SERVICE_MODE: 'local-service',
          MUSFY_FRONTEND_DIST: path.join(process.resourcesPath, 'frontend-dist')
        }
      });

      this.childProcess.once('exit', () => {
        backendLogStream.end();
        this.childProcess = null;
      });

      return;
    }

    process.env.HOST = DEFAULT_BIND_HOST;
    process.env.PORT = String(this.config.port);
    process.env.MUSFY_SERVICE_MODE = 'local-service';

    const backendHandle = require(this.config.backendEntry);
    if (!backendHandle || typeof backendHandle.startServer !== 'function') {
      throw new Error(`Backend do MusFy nao exporta startServer em ${this.config.backendEntry}`);
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

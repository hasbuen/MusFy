import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, Notification, dialog } from 'electron';
import { spawn } from 'child_process';
import type { Rectangle } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { shell } from 'electron';
import type { autoUpdater as AutoUpdaterType } from 'electron-updater';
import type { UpdateInfo } from 'builder-util-runtime';
import { MusfyServiceController, getLocalNetworkAddresses } from './service-controller';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater') as { autoUpdater: typeof AutoUpdaterType };

let mainWindow: BrowserWindow | null = null;
let miniPlayerWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let serviceController: MusfyServiceController | null = null;
let splashShownAt = 0;
let splashFallbackTimer: NodeJS.Timeout | null = null;
let rendererReady = false;
let backendReady = false;
const WINDOWS_SERVICE_NAME = 'MusFyHostService';
const GITHUB_UPDATE_OWNER = 'hasbuen';
const GITHUB_UPDATE_REPO = 'MusFy';
const DEFAULT_UPDATE_FEED_URL = `https://github.com/${GITHUB_UPDATE_OWNER}/${GITHUB_UPDATE_REPO}/releases/latest/download`;
const DEFAULT_GITHUB_RELEASES_URL = `https://github.com/${GITHUB_UPDATE_OWNER}/${GITHUB_UPDATE_REPO}/releases/latest`;
const DEFAULT_GITHUB_RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_UPDATE_OWNER}/${GITHUB_UPDATE_REPO}/releases/latest`;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INSTALLER_LAUNCH_GRACE_MS = 1800;

const MINI_PLAYER_COMPACT = { width: 560, height: 168 };
const MINI_PLAYER_VIDEO = { width: 860, height: 620 };
const MIN_SPLASH_MS = 1400;
const MAX_SPLASH_MS = 9000;
const isDev = !app.isPackaged;

type AppPreferences = {
  showSplash: boolean;
  startHiddenInTray: boolean;
  autoUpdateEnabled: boolean;
  updateFeedUrl: string;
  backupDirectory: string;
  backupFormat: 'mp3' | 'mp4' | 'avi';
};

type UpdateState =
  | 'idle'
  | 'disabled'
  | 'unconfigured'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

type UpdateStatus = {
  state: UpdateState;
  message: string;
  currentVersion: string;
  availableVersion?: string | null;
  feedUrl?: string | null;
  progress?: number | null;
  releaseName?: string | null;
  releaseNotes?: string | null;
  releaseDate?: string | null;
  releaseUrl?: string | null;
};

type GitHubReleaseSummary = {
  version: string;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  releaseUrl: string | null;
};

const defaultPreferences: AppPreferences = {
  showSplash: true,
  startHiddenInTray: false,
  autoUpdateEnabled: true,
  updateFeedUrl: '',
  backupDirectory: '',
  backupFormat: 'mp3'
};

let appPreferences: AppPreferences = { ...defaultPreferences };
let updateStatus: UpdateStatus = {
  state: 'idle',
  message: 'Atualizador pronto.',
  currentVersion: app.getVersion(),
  availableVersion: null,
  feedUrl: null,
  progress: null,
  releaseName: null,
  releaseNotes: null,
  releaseDate: null,
  releaseUrl: null
};
let autoUpdaterListenersBound = false;
let autoUpdateInterval: NodeJS.Timeout | null = null;
let lastNotifiedReleaseKey: string | null = null;
let mainWindowNeedsSurfaceRefresh = false;
let pendingInstallUpdateVersion: string | null = null;
let mainWindowReloadPending = false;

type InstallCapableAutoUpdater = typeof autoUpdater & {
  install: (isSilent?: boolean, isForceRunAfter?: boolean) => boolean;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
};

function log(...args: unknown[]) {
  console.log('[electron-main]', ...args);
}

function isServiceMode() {
  return process.argv.includes('--musfy-service') || process.env.MUSFY_SERVICE_BOOT === '1';
}

function shouldLaunchHiddenInTray() {
  if (!appPreferences.startHiddenInTray) {
    return false;
  }

  return process.argv.includes('--background') || process.env.MUSFY_AUTOSTART === '1';
}

function resolvePreferencesPath() {
  return path.join(app.getPath('userData'), 'preferences.json');
}

function loadPreferences() {
  try {
    const file = resolvePreferencesPath();
    if (!fs.existsSync(file)) {
      return { ...defaultPreferences };
    }

    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return {
      showSplash: parsed?.showSplash !== false,
      startHiddenInTray: Boolean(parsed?.startHiddenInTray),
      autoUpdateEnabled: parsed?.autoUpdateEnabled !== false,
      updateFeedUrl: String(parsed?.updateFeedUrl || '').trim(),
      backupDirectory: String(parsed?.backupDirectory || '').trim(),
      backupFormat: ['mp3', 'mp4', 'avi'].includes(String(parsed?.backupFormat || '').toLowerCase())
        ? String(parsed.backupFormat).toLowerCase() as AppPreferences['backupFormat']
        : 'mp3'
    } satisfies AppPreferences;
  } catch (error) {
    log('Falha ao carregar preferencias:', error);
    return { ...defaultPreferences };
  }
}

function savePreferences(nextPreferences: AppPreferences) {
  appPreferences = nextPreferences;
  try {
    fs.writeFileSync(resolvePreferencesPath(), JSON.stringify(nextPreferences, null, 2), 'utf-8');
  } catch (error) {
    log('Falha ao salvar preferencias:', error);
  }
}

function updatePreferences(patch: Partial<AppPreferences>) {
  const nextPreferences = {
    ...appPreferences,
    ...patch
  };
  savePreferences(nextPreferences);
  return nextPreferences;
}

function getConfiguredUpdateFeedUrl() {
  const fromEnv = String(process.env.MUSFY_UPDATES_URL || '').trim();
  if (fromEnv) return fromEnv;

  return DEFAULT_UPDATE_FEED_URL;
}

function getDefaultReleaseUrl() {
  return DEFAULT_GITHUB_RELEASES_URL;
}

function normalizeVersionLabel(value: string | null | undefined) {
  return String(value || '').trim().replace(/^v/i, '');
}

function parseVersionParts(value: string | null | undefined) {
  const normalized = normalizeVersionLabel(value);
  const stable = normalized.split('-')[0];
  if (!stable || !/^\d+(\.\d+){0,3}$/.test(stable)) {
    return null;
  }

  return stable.split('.').map((part) => Number(part));
}

function compareVersions(left: string | null | undefined, right: string | null | undefined) {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);

  if (!leftParts || !rightParts) {
    return normalizeVersionLabel(left).localeCompare(normalizeVersionLabel(right), undefined, { numeric: true });
  }

  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function isNewerVersion(candidate: string | null | undefined, current: string | null | undefined) {
  return compareVersions(candidate, current) > 0;
}

function looksLikeMojibake(value: string) {
  return /(?:Ã.|Â.|�)/.test(value);
}

function repairTextEncoding(value: string | null | undefined) {
  const input = String(value || '');
  if (!input || !looksLikeMojibake(input)) {
    return input;
  }

  try {
    const repaired = Buffer.from(input, 'latin1').toString('utf8');
    if (!repaired || repaired.includes('\u0000')) {
      return input;
    }

    const inputSignals = (input.match(/(?:Ã.|Â.|�)/g) || []).length;
    const repairedSignals = (repaired.match(/(?:Ã.|Â.|�)/g) || []).length;
    return repairedSignals < inputSignals ? repaired : input;
  } catch {
    return input;
  }
}

function sanitizeUpdateStatusValue(value: string | null | undefined) {
  const normalized = repairTextEncoding(value);
  return normalized.trim() || null;
}

function sanitizeUpdateStatusPayload(status: UpdateStatus) {
  return {
    ...status,
    message: repairTextEncoding(status.message),
    currentVersion: sanitizeUpdateStatusValue(status.currentVersion) || app.getVersion(),
    availableVersion: sanitizeUpdateStatusValue(status.availableVersion),
    feedUrl: sanitizeUpdateStatusValue(status.feedUrl),
    releaseName: sanitizeUpdateStatusValue(status.releaseName),
    releaseNotes: sanitizeUpdateStatusValue(status.releaseNotes),
    releaseDate: sanitizeUpdateStatusValue(status.releaseDate),
    releaseUrl: sanitizeUpdateStatusValue(status.releaseUrl)
  } satisfies UpdateStatus;
}

function normalizeAutoUpdateErrorMessage(error: unknown) {
  const message = repairTextEncoding(error instanceof Error ? error.message : String(error || '').trim());
  const lowered = message.toLowerCase();

  if (lowered.includes('releases.atom') || (lowered.includes('404') && lowered.includes('github.com'))) {
    return 'Nenhum release público do MusFy foi publicado ainda no GitHub Releases, ou o repositório de updates não está público.';
  }

  if (lowered.includes('latest.yml') && lowered.includes('404')) {
    return 'O release mais recente do MusFy ainda não contém o arquivo latest.yml no GitHub Releases.';
  }

  return message || 'Falha ao consultar atualizações.';
}

function notifyUpdate(title: string, body: string) {
  if (!Notification.isSupported()) return;

  try {
    new Notification({
      title,
      body,
      silent: false
    }).show();
  } catch (error) {
    log('Falha ao exibir notificacao de atualizacao:', error);
  }
}

function notifyReleaseOnce(key: string, title: string, body: string) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return;
  if (lastNotifiedReleaseKey === normalizedKey) return;

  lastNotifiedReleaseKey = normalizedKey;
  notifyUpdate(repairTextEncoding(title), repairTextEncoding(body));
}

function formatReleaseNotesForStatus(info: UpdateInfo) {
  const notes = info.releaseNotes;
  if (!notes) return null;

  if (typeof notes === 'string') {
    const normalized = repairTextEncoding(notes).trim();
    return normalized || null;
  }

  const normalized = notes
    .map((entry) => {
      const note = repairTextEncoding(String(entry.note || '')).trim();
      if (!note) return null;
      const versionLabel = entry.version ? `Versão ${entry.version}\n` : '';
      return `${versionLabel}${note}`.trim();
    })
    .filter((value): value is string => Boolean(value));

  return normalized.length > 0 ? normalized.join('\n\n') : null;
}

function getUpdateMetadata(info: UpdateInfo): Pick<UpdateStatus, 'availableVersion' | 'releaseName' | 'releaseNotes' | 'releaseDate'> {
  return {
    availableVersion: info.version || null,
    releaseName: sanitizeUpdateStatusValue(info.releaseName),
    releaseNotes: formatReleaseNotesForStatus(info),
    releaseDate: info.releaseDate || null
  };
}

async function fetchLatestGitHubRelease() {
  try {
    const response = await fetch(DEFAULT_GITHUB_RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'MusFy Desktop'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub release API ${response.status}`);
    }

    const release = (await response.json()) as Record<string, unknown>;
    const version = normalizeVersionLabel(String(release.tag_name || release.name || ''));
    if (!version) {
      return null;
    }

    return {
      version,
      releaseName: sanitizeUpdateStatusValue(String(release.name || `MusFy ${version}`)),
      releaseNotes: sanitizeUpdateStatusValue(String(release.body || '')),
      releaseDate: String(release.published_at || release.created_at || '').trim() || null,
      releaseUrl: sanitizeUpdateStatusValue(String(release.html_url || getDefaultReleaseUrl())) || getDefaultReleaseUrl()
    } satisfies GitHubReleaseSummary;
  } catch (error) {
    log('Falha ao consultar latest release via GitHub API:', error);
    return null;
  }
}

function applyGitHubReleaseMetadata(release: GitHubReleaseSummary, state: UpdateState, message: string) {
  setUpdateStatus({
    state,
    message,
    availableVersion: state === 'idle' || state === 'error' ? null : release.version,
    progress: null,
    releaseName: release.releaseName,
    releaseNotes: release.releaseNotes,
    releaseDate: release.releaseDate,
    releaseUrl: release.releaseUrl
  });
}

function applyGitHubReleaseProbe(release: GitHubReleaseSummary, reason: 'latest-tag' | 'fallback-error') {
  if (!isNewerVersion(release.version, app.getVersion())) {
    return false;
  }

  const message =
    reason === 'fallback-error'
      ? `Nova tag detectada no GitHub: v${release.version}. O pacote automático ainda não pôde ser confirmado, mas a atualização já foi publicada.`
      : `Nova tag detectada no GitHub: v${release.version}. O MusFy avisará assim que a atualização terminar de baixar.`;

  applyGitHubReleaseMetadata(release, 'available', message);
  notifyReleaseOnce(
    `github-tag:${release.version}`,
    'Nova atualização do MusFy',
    release.releaseName
      ? `${release.releaseName} já foi publicada no GitHub Releases.`
      : `A versão ${release.version} já foi publicada no GitHub Releases.`
  );
  return true;
}

function scheduleAutoUpdateChecks() {
  if (autoUpdateInterval) {
    clearInterval(autoUpdateInterval);
  }

  autoUpdateInterval = setInterval(() => {
    void checkForAppUpdates(false);
  }, AUTO_UPDATE_CHECK_INTERVAL_MS);
}

function publishUpdateStatus() {
  updateStatus = sanitizeUpdateStatusPayload({
    ...updateStatus,
    currentVersion: app.getVersion(),
    feedUrl: getConfiguredUpdateFeedUrl() || null
  });

  const targets = [mainWindow, miniPlayerWindow].filter(Boolean) as BrowserWindow[];
  for (const target of targets) {
    if (!target.isDestroyed()) {
      target.webContents.send('app:update-status', updateStatus);
    }
  }
}

function setUpdateStatus(patch: Partial<UpdateStatus>) {
  updateStatus = sanitizeUpdateStatusPayload({
    ...updateStatus,
    ...patch,
    currentVersion: app.getVersion(),
    feedUrl: patch.feedUrl !== undefined ? patch.feedUrl : getConfiguredUpdateFeedUrl() || null
  });
  publishUpdateStatus();
}

function bindAutoUpdaterListeners() {
  if (autoUpdaterListenersBound) return;
  autoUpdaterListenersBound = true;

  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus({
      state: 'checking',
      message: 'Verificando novas versões...',
      availableVersion: null,
      progress: null,
      releaseName: null,
      releaseNotes: null,
      releaseDate: null,
      releaseUrl: null
    });
  });

  autoUpdater.on('update-available', (info) => {
    const metadata = getUpdateMetadata(info);
    setUpdateStatus({
      state: 'available',
      message: `Nova versão encontrada: ${info.version}. Baixando em segundo plano...`,
      progress: 0,
      releaseUrl: getDefaultReleaseUrl(),
      ...metadata
    });
    notifyReleaseOnce(
      `available:${normalizeVersionLabel(info.version)}`,
      'Nova atualização do MusFy',
      metadata.releaseName
        ? `${metadata.releaseName} está disponível e será baixada em segundo plano.`
        : `A versão ${info.version} está disponível e será baixada em segundo plano.`
    );
  });

  autoUpdater.on('update-not-available', () => {
    setUpdateStatus({
      state: 'idle',
      message: 'Você já está na versão mais recente.',
      availableVersion: null,
      progress: null,
      releaseName: null,
      releaseNotes: null,
      releaseDate: null,
      releaseUrl: getDefaultReleaseUrl()
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    setUpdateStatus({
      state: 'downloading',
      message: `Baixando atualização... ${Math.round(progress.percent || 0)}%`,
      progress: progress.percent || 0
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    const metadata = getUpdateMetadata(info);
    pendingInstallUpdateVersion = normalizeVersionLabel(info.version);
    setUpdateStatus({
      state: 'downloaded',
      message: `A versão ${info.version} já está pronta. Clique para reiniciar e instalar.`,
      progress: 100,
      releaseUrl: getDefaultReleaseUrl(),
      ...metadata
    });
    notifyReleaseOnce(
      `downloaded:${normalizeVersionLabel(info.version)}`,
      'Atualização pronta para instalar',
      metadata.releaseName
        ? `${metadata.releaseName} já foi baixada. Reinicie o app para instalar.`
        : `A versão ${info.version} do MusFy já foi baixada. Reinicie o app para instalar.`
    );
  });

  autoUpdater.on('error', (error) => {
    pendingInstallUpdateVersion = null;
    setUpdateStatus({
      state: 'error',
      message: error?.message || 'Falha ao verificar atualizações.',
      progress: null,
      releaseName: null,
      releaseNotes: null,
      releaseDate: null,
      releaseUrl: getDefaultReleaseUrl()
    });
  });
}

async function configureAutoUpdater() {
  bindAutoUpdaterListeners();

  if (!app.isPackaged) {
    setUpdateStatus({
      state: 'disabled',
      message: 'Atualização automática só funciona no app instalado.',
      availableVersion: null,
      progress: null,
      releaseName: null,
      releaseNotes: null,
      releaseDate: null,
      releaseUrl: getDefaultReleaseUrl()
    });
    return false;
  }

  if (!appPreferences.autoUpdateEnabled) {
    setUpdateStatus({
      state: 'disabled',
      message: 'Atualização automática desativada nas configurações.',
      availableVersion: null,
      progress: null,
      releaseName: null,
      releaseNotes: null,
      releaseDate: null,
      releaseUrl: getDefaultReleaseUrl()
    });
    return false;
  }

  const feedUrl = getConfiguredUpdateFeedUrl();
  if (!feedUrl) {
    setUpdateStatus({
      state: 'unconfigured',
      message: 'Canal de atualização indisponível no momento.',
      availableVersion: null,
      progress: null,
      releaseName: null,
      releaseNotes: null,
      releaseDate: null,
      releaseUrl: getDefaultReleaseUrl()
    });
    return false;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: feedUrl
  });

  setUpdateStatus({
    state: 'idle',
    message: 'Atualizador configurado. O MusFy verifica novas versões automaticamente.',
    availableVersion: null,
    progress: null,
    feedUrl,
    releaseUrl: getDefaultReleaseUrl()
  });
  return true;
}

async function checkForAppUpdates(force = false) {
  const configured = await configureAutoUpdater();
  if (!configured) {
    return updateStatus;
  }

  if (!force && ['checking', 'downloading'].includes(updateStatus.state)) {
    return updateStatus;
  }

  const latestRelease = await fetchLatestGitHubRelease();

  try {
    await autoUpdater.checkForUpdates();

    if (latestRelease) {
      const autoUpdaterAlreadyHandling = ['available', 'downloading', 'downloaded'].includes(updateStatus.state);
      if (!autoUpdaterAlreadyHandling && applyGitHubReleaseProbe(latestRelease, 'latest-tag')) {
        return updateStatus;
      }

      if (updateStatus.state === 'idle') {
        applyGitHubReleaseMetadata(
          latestRelease,
          'idle',
          `Você já está na versão mais recente. Última tag publicada confirmada: v${latestRelease.version}.`
        );
      }
    }
  } catch (error) {
    if (latestRelease && applyGitHubReleaseProbe(latestRelease, 'fallback-error')) {
      return updateStatus;
    }

    setUpdateStatus({
      state: 'error',
      message: normalizeAutoUpdateErrorMessage(error),
      progress: null,
      availableVersion: null,
      releaseName: latestRelease?.releaseName || null,
      releaseNotes: latestRelease?.releaseNotes || null,
      releaseDate: latestRelease?.releaseDate || null,
      releaseUrl: latestRelease?.releaseUrl || getDefaultReleaseUrl()
    });
  }

  return updateStatus;
}

async function recoverFromFailedInstallUpdate(installingVersion: string | null, error: unknown) {
  log('Falha ao abrir o instalador do update:', error);
  isQuitting = false;
  createTray();

  try {
    await bootstrapServiceRuntime();
  } catch (serviceError) {
    log('Falha ao restaurar backend depois do erro no update:', serviceError);
  }

  try {
    await configureAutoUpdater();
  } catch (updaterError) {
    log('Falha ao reconfigurar updater depois do erro no update:', updaterError);
  }

  setUpdateStatus({
    state: 'downloaded',
    progress: 100,
    message: installingVersion
      ? `Falha ao abrir o instalador do MusFy ${installingVersion}. Tente novamente.`
      : 'Falha ao abrir o instalador da atualização. Tente novamente.'
  });

  await showMainWindow();
}

function getInstallCapableAutoUpdater() {
  return autoUpdater as InstallCapableAutoUpdater;
}

async function startDownloadedUpdateInstall(installingVersion: string | null) {
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let quitTimer: NodeJS.Timeout | null = null;

    const finish = (started: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      autoUpdater.off('error', handleInstallError);
      if (quitTimer) {
        clearTimeout(quitTimer);
        quitTimer = null;
      }
      resolve(started);
    };

    const handleInstallError = (error: Error) => {
      finish(false);
      void recoverFromFailedInstallUpdate(installingVersion, error);
    };

    autoUpdater.once('error', handleInstallError);

    try {
      log('Iniciando instalacao do update do MusFy via quitAndInstall.');
      getInstallCapableAutoUpdater().quitAndInstall(false, true);

      quitTimer = setTimeout(() => {
        finish(true);
      }, INSTALLER_LAUNCH_GRACE_MS);
    } catch (error) {
      finish(false);
      void recoverFromFailedInstallUpdate(installingVersion, error);
    }
  });
}

function resolveRendererPath() {
  return path.join(__dirname, '..', 'dist', 'index.html');
}

function resolveRendererUrl(search = '') {
  return `http://localhost:5173/${search ? `?${search}` : ''}`;
}

function getPreloadPath() {
  if (isDev) {
    const sourcePreload = path.join(__dirname, '..', 'electron', 'preload.cjs');
    if (fs.existsSync(sourcePreload)) {
      return sourcePreload;
    }
  }

  const preloadCjs = path.join(__dirname, 'preload.cjs');
  if (fs.existsSync(preloadCjs)) return preloadCjs;

  const preloadMjs = path.join(__dirname, 'preload.mjs');
  if (fs.existsSync(preloadMjs)) return preloadMjs;

  return path.join(__dirname, 'preload.js');
}

function getAssetPath(fileName: string) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', fileName);
  }

  return path.join(__dirname, '..', 'src', 'assets', fileName);
}

function getPreferredLogoPath() {
  const candidates = [getAssetPath('app.png'), getAssetPath('tray.png')];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function getWindowIconPath() {
  const candidates = [getAssetPath('tray.ico'), getAssetPath('app.png'), getAssetPath('tray.png')];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function getLogoDataUrl() {
  const image = nativeImage.createFromPath(getPreferredLogoPath());
  if (!image.isEmpty()) {
    return image.toDataURL();
  }

  return '';
}

function getSplashHtml() {
  const logoDataUrl = getLogoDataUrl();

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>MusFy</title>
        <style>
          html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background:
              radial-gradient(circle at top left, rgba(56, 189, 248, 0.22), transparent 38%),
              radial-gradient(circle at bottom right, rgba(34, 197, 94, 0.18), transparent 35%),
              linear-gradient(160deg, #05070b 0%, #0b1118 45%, #060606 100%);
            color: white;
            font-family: "Segoe UI", sans-serif;
          }

          .shell {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
          }

          .shell::before {
            content: "";
            position: absolute;
            inset: 18px;
            border-radius: 28px;
            border: 1px solid rgba(255,255,255,0.08);
            background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
            box-shadow: 0 30px 100px rgba(0,0,0,0.45);
          }

          .content {
            position: relative;
            z-index: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 18px;
            text-align: center;
          }

          .logo {
            width: 112px;
            height: 112px;
            border-radius: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: radial-gradient(circle at top, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
            box-shadow: 0 20px 45px rgba(34,197,94,0.16);
            animation: float 2.6s ease-in-out infinite;
          }

          img {
            width: 92px;
            height: 92px;
            object-fit: contain;
          }

          h1 {
            margin: 0;
            font-size: 42px;
            font-weight: 800;
            letter-spacing: 0.08em;
          }

          p {
            margin: 0;
            font-size: 13px;
            letter-spacing: 0.24em;
            text-transform: uppercase;
            color: rgba(226,232,240,0.7);
          }

          .bar {
            margin-top: 6px;
            width: 220px;
            height: 6px;
            border-radius: 999px;
            background: rgba(255,255,255,0.08);
            overflow: hidden;
          }

          .bar::after {
            content: "";
            display: block;
            width: 42%;
            height: 100%;
            border-radius: inherit;
            background: linear-gradient(90deg, #22c55e, #38bdf8);
            animation: loading 1.35s ease-in-out infinite;
          }

          @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-8px); }
          }

          @keyframes loading {
            0% { transform: translateX(-120%); }
            100% { transform: translateX(320%); }
          }
        </style>
      </head>
      <body>
        <div class="shell">
          <div class="content">
            <div class="logo">
              ${logoDataUrl ? `<img src="${logoDataUrl}" alt="MusFy" />` : '<div style="font-size:42px;font-weight:800">M</div>'}
            </div>
            <div>
              <p>Local Music Server</p>
              <h1>MusFy</h1>
            </div>
            <div class="bar"></div>
          </div>
        </div>
      </body>
    </html>
  `;
}

function getTrayIconImage() {
  const trayIco = getAssetPath('tray.ico');
  const trayPng = getAssetPath('tray.png');

  let image = process.platform === 'win32'
    ? nativeImage.createFromPath(trayIco)
    : nativeImage.createFromPath(trayPng);

  if (image.isEmpty()) {
    image = nativeImage.createFromPath(trayPng);
  }

  if (image.isEmpty()) {
    image = nativeImage.createFromPath(getPreferredLogoPath());
  }

  if (image.isEmpty()) {
    log('Icone da tray nao encontrado');
    return nativeImage.createEmpty();
  }

  return image.resize({ width: 24, height: 24, quality: 'best' });
}

async function loadWindow(window: BrowserWindow, search = '') {
  if (isDev) {
    await window.loadURL(resolveRendererUrl(search));
    return;
  }

  await window.loadFile(resolveRendererPath(), search ? { search } : undefined);
}

async function closeSplashWindow(force = false) {
  const currentSplash = splashWindow;
  if (!currentSplash) return;

  if (splashFallbackTimer) {
    clearTimeout(splashFallbackTimer);
    splashFallbackTimer = null;
  }

  if (!force) {
    const elapsed = Date.now() - splashShownAt;
    if (elapsed < MIN_SPLASH_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_SPLASH_MS - elapsed));
    }
  }

  splashWindow = null;

  if (!currentSplash.isDestroyed()) {
    currentSplash.hide();
    currentSplash.destroy();
  }
}

function createSplashWindow() {
  if (!appPreferences.showSplash || splashWindow) {
    return splashWindow;
  }

  splashWindow = new BrowserWindow({
    width: 540,
    height: 360,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: false,
    frame: false,
    transparent: false,
    show: true,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#05070b',
    icon: getWindowIconPath(),
    webPreferences: {
      contextIsolation: true,
      sandbox: false
    }
  });

  splashShownAt = Date.now();
  splashFallbackTimer = setTimeout(() => {
    log('Splash ainda aguardando renderer e servicos do backend.');
  }, MAX_SPLASH_MS);

  void splashWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(getSplashHtml())}`);
  return splashWindow;
}

function finalizeWindowReveal() {
  void closeSplashWindow(true);
  if (!mainWindow || shouldLaunchHiddenInTray()) {
    return;
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
}

function tryFinalizeStartupReveal() {
  if (!rendererReady || !backendReady) {
    return;
  }

  finalizeWindowReveal();
}

function markMainWindowSurfaceDirty() {
  mainWindowNeedsSurfaceRefresh = true;
}

function scheduleMainWindowSurfaceRefresh(reason: string) {
  const target = mainWindow;
  if (!target || target.isDestroyed()) {
    return;
  }

  const refresh = (delay: number) => {
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      if (!mainWindow.isVisible()) {
        return;
      }

      try {
        mainWindow.webContents.invalidate();
      } catch (error) {
        log(`Falha ao invalidar repaint da janela principal (${reason})`, error);
      }
    }, delay);
  };

  refresh(0);
  refresh(80);
  refresh(220);
  mainWindowNeedsSurfaceRefresh = false;
}

function recreateMainWindowForRecovery(reason: string) {
  const previousWindow = mainWindow;
  let previousBounds: Rectangle | null = null;

  if (previousWindow && !previousWindow.isDestroyed()) {
    try {
      previousBounds = previousWindow.getBounds();
      previousWindow.destroy();
    } catch (error) {
      log(`Falha ao destruir janela principal para recuperacao (${reason})`, error);
    }
  }

  mainWindow = null;
  rendererReady = false;
  createMainWindow();

  const recreatedWindow = mainWindow as BrowserWindow | null;
  if (previousBounds) {
    recreatedWindow?.setBounds(previousBounds);
  }

  log(`Janela principal recriada para recuperar renderer (${reason}).`);
}

async function ensureMainWindowRendererReady() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const currentUrl = mainWindow.webContents.getURL();
  const shouldReload =
    mainWindow.webContents.isCrashed() ||
    !currentUrl ||
    currentUrl === 'about:blank' ||
    (!rendererReady && !mainWindow.webContents.isLoadingMainFrame());

  if (!shouldReload) {
    return;
  }

  rendererReady = false;

  try {
    await loadWindow(mainWindow);
  } catch (error) {
    log('Falha ao recarregar renderer da janela principal:', error);
  }
}

async function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
  }

  if (mainWindowReloadPending) {
    recreateMainWindowForRecovery('tray-return');
  }

  await ensureMainWindowRendererReady();

  hideMiniPlayer();
  if (mainWindow?.isMinimized()) {
    mainWindow.restore();
  }
  const needsRefresh = mainWindowNeedsSurfaceRefresh || !mainWindow?.isVisible();
  mainWindow?.show();
  if (needsRefresh) {
    scheduleMainWindowSurfaceRefresh('show-main');
  }
  mainWindowReloadPending = false;
  mainWindow?.focus();
}

function showMiniPlayer() {
  if (!miniPlayerWindow) {
    createMiniPlayerWindow();
  }

  markMainWindowSurfaceDirty();
  mainWindow?.hide();
  miniPlayerWindow?.show();
  miniPlayerWindow?.focus();
}

function hideMiniPlayer() {
  miniPlayerWindow?.hide();
}

function hideToTray() {
  hideMiniPlayer();
  if (mainWindow?.isMinimized()) {
    mainWindow.restore();
  }
  mainWindowReloadPending = true;
  rendererReady = false;
  markMainWindowSurfaceDirty();
  mainWindow?.hide();
}

function createMainWindow() {
  if (mainWindow) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 940,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#050505',
    title: 'MusFy',
    icon: getWindowIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    rendererReady = false;
    log('Falha ao carregar renderer:', errorCode, errorDescription);
    finalizeWindowReveal();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindowNeedsSurfaceRefresh = false;
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererReady = false;
    log('Renderer principal saiu inesperadamente:', details.reason);
    markMainWindowSurfaceDirty();
  });

  mainWindow.on('unresponsive', () => {
    rendererReady = false;
    log('Janela principal ficou sem resposta. Renderer sera recarregado ao reabrir.');
    markMainWindowSurfaceDirty();
  });

  mainWindow.on('minimize', () => {
    if (!isQuitting) {
      hideToTray();
    }
  });

  mainWindow.on('show', () => {
    if (!isQuitting) {
      hideMiniPlayer();
      scheduleMainWindowSurfaceRefresh('window-show');
    }
  });

  mainWindow.on('restore', () => {
    if (!isQuitting) {
      hideMiniPlayer();
      scheduleMainWindowSurfaceRefresh('window-restore');
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindowReloadPending = true;
      rendererReady = false;
      markMainWindowSurfaceDirty();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void loadWindow(mainWindow).catch((error) => {
    log('Erro ao carregar main window:', error);
    finalizeWindowReveal();
  });

  return mainWindow;
}

function createMiniPlayerWindow() {
  if (miniPlayerWindow) {
    return miniPlayerWindow;
  }

  miniPlayerWindow = new BrowserWindow({
    width: MINI_PLAYER_COMPACT.width,
    height: MINI_PLAYER_COMPACT.height,
    minWidth: MINI_PLAYER_COMPACT.width,
    minHeight: MINI_PLAYER_COMPACT.height,
    maxWidth: MINI_PLAYER_VIDEO.width,
    maxHeight: MINI_PLAYER_VIDEO.height,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0b0b0b',
    title: 'MusFy Mini Player',
    icon: getWindowIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  miniPlayerWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      miniPlayerWindow?.hide();
    }
  });

  miniPlayerWindow.on('closed', () => {
    miniPlayerWindow = null;
  });

  void loadWindow(miniPlayerWindow, 'mini=1').catch((error) => {
    log('Erro ao carregar mini player:', error);
  });

  return miniPlayerWindow;
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Abrir MusFy',
      click: () => {
        hideMiniPlayer();
        void showMainWindow();
      }
    },
    {
      label: 'Mostrar Mini Player',
      click: () => {
        if (!miniPlayerWindow) {
          createMiniPlayerWindow();
        }

        if (miniPlayerWindow?.isVisible()) {
          miniPlayerWindow.hide();
        } else {
          showMiniPlayer();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function createTray() {
  if (tray) {
    return tray;
  }

  tray = new Tray(getTrayIconImage());
  tray.setToolTip('MusFy');
  tray.setContextMenu(buildTrayMenu());

  tray.on('double-click', () => {
    hideMiniPlayer();
    void showMainWindow();
  });

  tray.on('click', () => {
    if (!mainWindow) {
      createMainWindow();
    }

    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      hideMiniPlayer();
      void showMainWindow();
    }
  });

  return tray;
}

function registerIpc() {
  ipcMain.removeHandler('window:minimize-to-tray');
  ipcMain.removeHandler('window:show-mini-player');
  ipcMain.removeHandler('window:toggle-mini-player');
  ipcMain.removeHandler('window:show-main');
  ipcMain.removeHandler('window:close-mini-player');
  ipcMain.removeHandler('window:set-mini-player-mode');
  ipcMain.removeHandler('window:quit-app');
  ipcMain.removeHandler('app:get-preferences');
  ipcMain.removeHandler('app:update-preferences');
  ipcMain.removeHandler('app:get-update-status');
  ipcMain.removeHandler('app:check-for-updates');
  ipcMain.removeHandler('app:install-update');
  ipcMain.removeHandler('app:select-backup-directory');
  ipcMain.removeAllListeners('service:get-config');

  ipcMain.handle('window:minimize-to-tray', async () => {
    hideToTray();
    return true;
  });

  ipcMain.handle('window:show-mini-player', async () => {
    showMiniPlayer();
    return true;
  });

  ipcMain.handle('window:toggle-mini-player', async () => {
    if (!miniPlayerWindow) {
      createMiniPlayerWindow();
    }

    if (!miniPlayerWindow) {
      return false;
    }

    if (miniPlayerWindow.isVisible()) {
      miniPlayerWindow.hide();
      if (!mainWindow?.isVisible()) {
        await showMainWindow();
      }
      return false;
    }

    showMiniPlayer();
    return true;
  });

  ipcMain.handle('window:show-main', async () => {
    hideMiniPlayer();
    await showMainWindow();
    return true;
  });

  ipcMain.handle('window:close-mini-player', async () => {
    miniPlayerWindow?.hide();
    return true;
  });

  ipcMain.handle('window:set-mini-player-mode', async (_event, mode: 'compact' | 'video') => {
    if (!miniPlayerWindow) return false;

    const target = mode === 'video' ? MINI_PLAYER_VIDEO : MINI_PLAYER_COMPACT;
    miniPlayerWindow.setMinimumSize(target.width, target.height);
    miniPlayerWindow.setSize(target.width, target.height, true);
    miniPlayerWindow.center();
    return true;
  });

  ipcMain.handle('window:quit-app', async () => {
    isQuitting = true;
    app.quit();
    return true;
  });

  ipcMain.handle('app:get-preferences', async () => appPreferences);
  ipcMain.handle('app:update-preferences', async (_event, patch: Partial<AppPreferences>) => {
    const preferences = updatePreferences(patch || {});
    void configureAutoUpdater();
    return preferences;
  });
  ipcMain.handle('app:get-update-status', async () => {
    publishUpdateStatus();
    return updateStatus;
  });
  ipcMain.handle('app:check-for-updates', async () => {
    return await checkForAppUpdates(true);
  });
  ipcMain.handle('app:install-update', async () => {
    if (updateStatus.state !== 'downloaded') {
      return false;
    }

    const installingVersion = pendingInstallUpdateVersion || normalizeVersionLabel(updateStatus.availableVersion);
    isQuitting = true;
    setUpdateStatus({
      state: 'downloading',
      progress: 100,
      message: installingVersion
        ? `Abrindo instalador do MusFy ${installingVersion}...`
        : 'Abrindo instalador da atualização do MusFy...'
    });
    hideMiniPlayer();
    miniPlayerWindow?.destroy();
    tray?.destroy();
    tray = null;
    void closeSplashWindow(true);
    setImmediate(async () => {
      try {
        await serviceController?.stop();
      } catch (error) {
        await recoverFromFailedInstallUpdate(installingVersion, error);
        return;
      }

      try {
        const installStarted = await startDownloadedUpdateInstall(installingVersion);
        if (!installStarted) {
          return;
        }
      } catch (error) {
        await recoverFromFailedInstallUpdate(installingVersion, error);
      }
    });
    return true;
  });
  ipcMain.handle('app:select-backup-directory', async () => {
    const dialogOptions = {
      title: 'Escolha a pasta de backup do MusFy',
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return result.filePaths[0];
  });
  ipcMain.handle('app:open-external', async (_event, targetUrl: string) => {
    const safeUrl = String(targetUrl || '').trim();
    if (!safeUrl) {
      return false;
    }

    await shell.openExternal(safeUrl);
    return true;
  });
  ipcMain.on('app:renderer-ready', () => {
    rendererReady = true;
    tryFinalizeStartupReveal();
    publishUpdateStatus();
  });

  ipcMain.on('service:get-config', (event) => {
    event.returnValue = serviceController?.getRendererConfig() || null;
  });
}

function runDetached(command: string, args: string[]) {
  const child = spawn(command, args, { windowsHide: true, detached: true, stdio: 'ignore' });
  child.unref();
}

async function queryWindowsServiceExists(serviceName: string) {
  return await new Promise<boolean>((resolve) => {
    const child = spawn('sc.exe', ['query', serviceName], { windowsHide: true, stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

async function queryWindowsServiceRunning(serviceName: string) {
  return await new Promise<boolean>((resolve) => {
    let output = '';
    const child = spawn('sc.exe', ['query', serviceName], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        resolve(false);
        return;
      }

      resolve(/STATE\s*:\s*\d+\s+RUNNING/i.test(output));
    });

    child.on('error', () => resolve(false));
  });
}

async function ensureWindowsServiceRegistered() {
  if (process.platform !== 'win32' || !app.isPackaged || isServiceMode()) {
    return;
  }

  const exists = await queryWindowsServiceExists(WINDOWS_SERVICE_NAME);
  if (exists) {
    return;
  }

  const registerScript = path.join(path.dirname(process.execPath), 'Register-MusFyService.ps1');
  if (!fs.existsSync(registerScript)) {
    log('Script de registro do servico nao encontrado:', registerScript);
    return;
  }

  runDetached('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    registerScript,
    '-InstallDir',
    path.dirname(process.execPath)
  ]);
}

async function bootstrapServiceRuntime() {
  const canPreferExternal =
    process.platform === 'win32' &&
    app.isPackaged &&
    (await queryWindowsServiceExists(WINDOWS_SERVICE_NAME)) &&
    (await queryWindowsServiceRunning(WINDOWS_SERVICE_NAME));
  serviceController = new MusfyServiceController(canPreferExternal ? 'external' : 'managed');

  try {
    const config = await serviceController.ensureStarted();
    backendReady = true;
    log('Servico MusFy ativo em', config.baseUrl);
    getLocalNetworkAddresses(config.port).forEach((address) => {
      log('Acesso na rede interna:', address);
    });
  } catch (error) {
    if (!canPreferExternal) {
      throw error;
    }

    log('Servico do Windows nao respondeu a tempo. Iniciando backend gerenciado.');
    serviceController = new MusfyServiceController('managed');
    const config = await serviceController.ensureStarted();
    backendReady = true;
    log('Servico MusFy ativo em', config.baseUrl);
    getLocalNetworkAddresses(config.port).forEach((address) => {
      log('Acesso na rede interna:', address);
    });
  }
}

async function bootstrap() {
  app.setAppUserModelId('com.musfy.desktop');
  await app.whenReady();

  appPreferences = loadPreferences();
  rendererReady = false;
  backendReady = false;

  if (appPreferences.showSplash) {
    createSplashWindow();
  }

  registerIpc();
  createMainWindow();
  createTray();
  void configureAutoUpdater();
  scheduleAutoUpdateChecks();

  if (shouldLaunchHiddenInTray()) {
    await closeSplashWindow();
  }

  void bootstrapServiceRuntime()
    .then(() => {
      tryFinalizeStartupReveal();
      void ensureWindowsServiceRegistered();
      void checkForAppUpdates(false);
    })
    .catch((error) => {
      log('Falha ao iniciar servico local:', error);
      finalizeWindowReveal();
    });

  app.on('activate', () => {
    if (!mainWindow) {
      createMainWindow();
      return;
    }

    void showMainWindow();
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  void closeSplashWindow(true);
  if (autoUpdateInterval) {
    clearInterval(autoUpdateInterval);
    autoUpdateInterval = null;
  }
  tray?.destroy();
  tray = null;
  void serviceController?.stop();
});

app.on('window-all-closed', () => {
  // Mantem o app vivo por causa da tray.
});

process.on('unhandledRejection', (reason) => {
  console.error('[electron-main] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[electron-main] Uncaught Exception:', error);
});

if (!isServiceMode()) {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      void closeSplashWindow(true);
      hideMiniPlayer();
      void showMainWindow();
    });
  }
}

if (isServiceMode()) {
  void (async () => {
    await app.whenReady();
    await bootstrapServiceRuntime();
  })().catch((error) => {
    console.error('[electron-main] Falha ao iniciar servico MusFy:', error);
    app.exit(1);
  });
} else {
  void bootstrap().catch((error) => {
    console.error('[electron-main] Falha ao iniciar aplicacao:', error);
    void closeSplashWindow(true);
  });
}



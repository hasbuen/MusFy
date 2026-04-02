const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const tls = require('tls');
const cors = require('cors');
const multer = require('multer');
const { spawn } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { createRuntimeServices } = require('./runtime-services');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const SERVICE_MODE = process.env.MUSFY_SERVICE_MODE || 'standalone';
const GITHUB_RELEASE_OWNER = 'hasbuen';
const GITHUB_RELEASE_REPO = 'MusFy';
const DEFAULT_ANDROID_RELEASE_URL = `https://github.com/${GITHUB_RELEASE_OWNER}/${GITHUB_RELEASE_REPO}/releases/latest`;
const DEFAULT_ANDROID_APK_URL = `${DEFAULT_ANDROID_RELEASE_URL}/download/MusFy-Android.apk`;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.get('/health', (req, res) => {
  const storage = runtimeServices?.getServiceStorageSummary() || null;
  res.json({
    status: 'ok',
    service: 'musfy-backend',
    mode: SERVICE_MODE,
    host: HOST,
    port: PORT,
    timestamp: new Date().toISOString(),
    ready: Boolean(
      runtimeBootstrapState.ready &&
        storage?.sqlite?.ready &&
        ['embedded', 'external'].includes(String(storage?.redis?.mode || ''))
    ),
    runtime: runtimeBootstrapState,
    storage
  });
});

app.get('/service/info', (req, res) => {
  res.json({
    name: 'MusFy Local Service',
    mode: SERVICE_MODE,
    host: HOST,
    port: PORT,
    platform: process.platform,
    node: process.version,
    pid: process.pid,
    storage: runtimeServices?.getServiceStorageSummary() || null
  });
});

app.get('/service/storage', async (req, res) => {
  const recentSearches = runtimeServices ? await runtimeServices.getRecentYoutubeSearches(8) : [];
  res.json({
    storage: runtimeServices?.getServiceStorageSummary() || null,
    recentSearches
  });
});

app.get('/android/apk-info', (req, res) => {
  const apkPath = resolveAndroidApkPath();
  const fileExists = fs.existsSync(apkPath);
  const localUrls = getLocalServiceBaseUrls(PORT).map((baseUrl) => `${baseUrl}/android/musfy.apk`);
  const releaseUrl =
    (process.env.MUSFY_ANDROID_RELEASE_URL ? String(process.env.MUSFY_ANDROID_RELEASE_URL).trim() : '') ||
    DEFAULT_ANDROID_RELEASE_URL;
  const externalUrl =
    (process.env.MUSFY_ANDROID_APK_URL ? String(process.env.MUSFY_ANDROID_APK_URL).trim() : '') ||
    DEFAULT_ANDROID_APK_URL;

  res.json({
    fileExists,
    fileName: path.basename(apkPath),
    localUrls,
    preferredUrl: externalUrl || (fileExists ? localUrls[0] || null : null),
    externalUrl,
    releaseUrl,
    storagePath: fileExists ? apkPath : null
  });
});

app.get('/android/musfy.apk', (req, res) => {
  const apkPath = resolveAndroidApkPath();
  if (!fs.existsSync(apkPath)) {
    return res.status(404).json({ error: 'APK Android ainda nao disponivel no servidor local.' });
  }

  return res.download(apkPath, 'MusFy-Android.apk');
});

// =============================
// PATHS
// =============================
function resolveYtDlpPath() {
  const candidates = [
    path.join(__dirname, 'bin', 'yt-dlp.exe'),
    path.join(__dirname, 'bin', 'yt-dlp'),
    path.join(__dirname, 'yt-dlp.exe'),
    path.join(__dirname, 'yt-dlp')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[process.platform === 'win32' ? 0 : 1];
}

const YTDLP_PATH = resolveYtDlpPath();
const FFMPEG_PATH = ffmpegInstaller.path;
const NODE_RUNTIME_PATH = process.execPath;

function resolveRuntimeRootDir() {
  if (process.env.MUSFY_DATA_DIR && String(process.env.MUSFY_DATA_DIR).trim()) {
    return path.resolve(String(process.env.MUSFY_DATA_DIR).trim());
  }

  if (process.platform === 'win32' && process.env.ProgramData) {
    return path.join(process.env.ProgramData, 'MusFy');
  }

  return path.join(__dirname, 'runtime');
}

const runtimeRootDir = resolveRuntimeRootDir();
const dataDir = path.join(runtimeRootDir, 'data');
const uploadDir = path.join(runtimeRootDir, 'uploads');
const opusDir = path.join(runtimeRootDir, 'opus_files');
const videoDir = path.join(runtimeRootDir, 'video_files');
const downloadsDir = path.join(runtimeRootDir, 'downloads');
const cacheDir = path.join(runtimeRootDir, 'cache');
const dbPath = path.join(dataDir, 'database.json');
const youtubeSearchCachePath = path.join(cacheDir, 'youtube-search-cache.json');

function resolveFrontendDistDir() {
  const candidates = [
    process.env.MUSFY_FRONTEND_DIST,
    path.join(__dirname, '..', 'frontend-musfy', 'dist'),
    path.join(__dirname, '..', 'frontend-dist'),
    path.join(process.resourcesPath || '', 'frontend-dist')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0] || '';
}

const frontendDistDir = resolveFrontendDistDir();

function resolveAndroidApkPath() {
  const candidates = [
    path.join(runtimeRootDir, 'android', 'MusFy.apk'),
    path.join(downloadsDir, 'android', 'MusFy.apk'),
    path.join(downloadsDir, 'MusFy.apk')
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function getLocalServiceBaseUrls(port = PORT) {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => `http://${iface.address}:${port}`);

  return [...new Set([`http://127.0.0.1:${port}`, ...addresses])];
}

function getHostLocalNetworkKeys() {
  return [
    ...new Set(
      Object.values(os.networkInterfaces())
        .flat()
        .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
        .map((iface) => getLocalNetworkKey(iface.address))
        .filter(Boolean)
    )
  ];
}

// =============================
// GARANTE PASTAS
// =============================
[runtimeRootDir, dataDir, uploadDir, opusDir, videoDir, downloadsDir, cacheDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// =============================
// LOGS
// =============================
let logs = [];
let deviceRegistry = {};
let deviceCommandCounter = 0;
let downloadJobs = [];
const activeDownloadExecutions = new Map();
let isDownloadQueueRunning = false;
const youtubeSearchMemoryCache = new Map();
let youtubeSearchFileCache = {};
const YOUTUBE_SEARCH_TTL_MS = 1000 * 60 * 30;
const YOUTUBE_SEARCH_LIMIT = 60;
const REDIS_URL = process.env.REDIS_URL ? String(process.env.REDIS_URL).trim() : '';
let runtimeServices = null;
let runtimeBootstrapState = {
  phase: 'booting',
  ready: false,
  error: null
};

function addLog(msg) {
  const line = `[${new Date().toLocaleString('pt-BR')}] ${msg}`;
  console.log(line);
  logs.push(line);
  if (logs.length > 500) logs.shift();
  if (runtimeServices) {
    void runtimeServices.recordServiceEvent('log', String(msg));
  }
}

function createDownloadControlError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isDownloadControlError(error, code = null) {
  if (!error || typeof error !== 'object') return false;
  if (code) return error.code === code;
  return ['JOB_PAUSED', 'JOB_CANCELED'].includes(String(error.code || ''));
}

function getDownloadJob(jobId) {
  return downloadJobs.find((job) => job.id === jobId) || null;
}

function getOrCreateExecution(jobId) {
  if (!activeDownloadExecutions.has(jobId)) {
    activeDownloadExecutions.set(jobId, {
      children: new Set(),
      pauseRequested: false,
      promise: null
    });
  }

  return activeDownloadExecutions.get(jobId);
}

function clearExecution(jobId) {
  activeDownloadExecutions.delete(jobId);
}

function attachProcessToJob(jobId, child) {
  if (!jobId || !child) return child;

  const execution = getOrCreateExecution(jobId);
  execution.children.add(child);

  const detach = () => {
    const currentExecution = activeDownloadExecutions.get(jobId);
    currentExecution?.children.delete(child);
  };

  child.once('exit', detach);
  child.once('close', detach);
  return child;
}

function spawnManagedProcess(jobId, command, args, options = {}) {
  const child = spawn(command, args, options);
  return attachProcessToJob(jobId, child);
}

function assertJobNotPaused(jobId) {
  if (!jobId) return;
  const execution = activeDownloadExecutions.get(jobId);
  if (execution?.pauseRequested) {
    throw createDownloadControlError('JOB_PAUSED', 'Download pausado pelo usuario.');
  }
}

function pauseActiveDownloadJob(jobId) {
  const execution = activeDownloadExecutions.get(jobId);
  if (!execution) return false;

  execution.pauseRequested = true;
  for (const child of execution.children) {
    try {
      child.kill('SIGKILL');
    } catch (_error) {
      try {
        child.kill();
      } catch (_secondError) {
        // ignora
      }
    }
  }

  return true;
}

function resetJobItemsForResume(items = []) {
  return items.map((item) => {
    if (item.status === 'completed') {
      return {
        ...item,
        progress: 100,
        stage: item.stage || 'done',
        message: item.message || 'Concluida anteriormente'
      };
    }

    return {
      ...item,
      status: 'pending',
      progress: 0,
      stage: 'queued',
      message: ''
    };
  });
}

function queueDownloadJob(jobId, message = 'Aguardando na fila') {
  const job = getDownloadJob(jobId);
  if (!job) return null;

  updateDownloadJob(jobId, {
    status: 'queued',
    stage: 'queued',
    progress: job.mode === 'playlist' ? Math.max(0, Number(job.progress || 0)) : 0,
    message,
    items: Array.isArray(job.items) ? resetJobItemsForResume(job.items) : job.items
  });

  return getDownloadJob(jobId);
}

function findNextQueuedDownloadJob() {
  return [...downloadJobs]
    .filter((job) => job.status === 'queued')
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())[0] || null;
}

async function executeDownloadJob(jobId) {
  const existingExecution = activeDownloadExecutions.get(jobId);
  if (existingExecution?.promise) {
    return existingExecution.promise;
  }

  const job = getDownloadJob(jobId);
  if (!job) {
    throw new Error('Download nao encontrado');
  }

  const execution = getOrCreateExecution(jobId);
  execution.pauseRequested = false;

  execution.promise = (async () => {
    try {
      const url = String(job.url || '').trim();
      const userId = job.userId ? String(job.userId) : null;
      const requestedMode = String(job.mode || '').trim().toLowerCase();
      const targetPlaylistId = job.targetPlaylistId ? String(job.targetPlaylistId) : null;
      const manualArtist = String(job.artist || '').trim() || null;
      const manualTitle = String(job.title || '').trim() || null;
      const includeVideo = Boolean(job.includeVideo);

      if (!url) {
        throw new Error('URL obrigatoria');
      }

      if (userId && !findUserById(userId)) {
        throw new Error('Usuario invalido');
      }

      if (targetPlaylistId) {
        const targetPlaylist = findPlaylistById(targetPlaylistId);
        if (!targetPlaylist) {
          throw new Error('Playlist de destino invalida');
        }
        if (userId && targetPlaylist.ownerUserId && String(targetPlaylist.ownerUserId) !== String(userId)) {
          throw new Error('Playlist de destino nao pertence ao usuario ativo');
        }
      }

      updateDownloadJob(jobId, {
        status: 'running',
        stage: 'inspect',
        progress: 2,
        message: 'Analisando link'
      });

      const analysis = await inspectYoutubeUrl(url, jobId);
      assertJobNotPaused(jobId);

      const resolvedMode =
        requestedMode === 'single' || requestedMode === 'playlist' || requestedMode === 'video'
          ? requestedMode
          : analysis.kind === 'playlist'
            ? 'playlist'
            : 'single';

      updateDownloadJob(jobId, {
        mode: resolvedMode,
        progress: 8,
        stage: 'inspect',
        message:
          resolvedMode === 'video'
            ? 'Video selecionado'
            : analysis.kind === 'playlist'
              ? 'Playlist detectada'
              : 'Faixa unica detectada'
      });

      if (resolvedMode === 'playlist') {
        const restoredJob = getDownloadJob(jobId) || job;
        let destinationPlaylistId = targetPlaylistId || restoredJob.generatedPlaylistId || null;
        if (!destinationPlaylistId) {
          const autoPlaylist = ensureAutomaticPlaylist({
            playlistTitle:
              restoredJob.playlistTitle ||
              analysis.playlist?.title ||
              restoredJob.message ||
              'Playlist importada',
            requesterUserId: userId
          });
          destinationPlaylistId = autoPlaylist.id;
          updateDownloadJob(jobId, {
            generatedPlaylistId: autoPlaylist.id,
            generatedPlaylistName: autoPlaylist.name
          });
        }

        const playlistEntries = (analysis.playlist?.entries || []).map((entry, index) => {
          const previousItem =
            Array.isArray(restoredJob.items) &&
            restoredJob.items.find((item) => Number(item.index) === Number(index));
          const isCompleted = previousItem?.status === 'completed';
          return {
            index,
            title: previousItem?.title || entry.title,
            status: isCompleted ? 'completed' : 'pending',
            progress: isCompleted ? 100 : 0,
            stage: isCompleted ? 'done' : 'queued',
            message: isCompleted ? previousItem?.message || 'Concluida anteriormente' : ''
          };
        });

        const itemProgress = playlistEntries.map((item) => Number(item.progress || 0));
        const refreshPlaylistJob = (index, patch) => {
          itemProgress[index] = typeof patch.progress === 'number' ? patch.progress : itemProgress[index];
          playlistEntries[index] = {
            ...playlistEntries[index],
            ...patch,
            progress: itemProgress[index]
          };
          const average = itemProgress.reduce((sum, value) => sum + value, 0) / Math.max(1, itemProgress.length);
          updateDownloadJob(jobId, {
            stage: patch.stage || 'playlist-download',
            progress: Math.max(10, Math.min(99, average)),
            message: patch.message || 'Baixando playlist',
            items: playlistEntries
          });
        };

        const result = await downloadYoutubePlaylist({
          url,
          requesterUserId: userId,
          manualArtist,
          manualTitle,
          playlistTitleOverride: restoredJob.playlistTitle,
          targetPlaylistId: destinationPlaylistId,
          includeVideo,
          jobId,
          existingItems: Array.isArray(restoredJob.items) ? restoredJob.items : [],
          onTrackProgress: (index, patch) => refreshPlaylistJob(index, patch)
        });

        updateDownloadJob(jobId, {
          status: 'completed',
          progress: 100,
          stage: 'done',
          message: `Playlist concluida com ${result.songs.length} faixas`,
          generatedPlaylistId: result.playlist?.id || destinationPlaylistId || null,
          generatedPlaylistName: result.playlist?.name || restoredJob.generatedPlaylistName || null,
          items: playlistEntries
        });

        return {
          success: true,
          mode: 'playlist',
          jobId,
          playlist: serializePlaylistForUser(result.playlist, userId),
          songs: result.songs.map((song) => serializeMusicForUser(song, userId)),
          skippedEntries: result.skippedEntries,
          analysis
        };
      }

      const targetUrl = analysis.selectedEntry?.url || url;
      const music = await downloadSingleYoutubeTrack({
        url: targetUrl,
        requesterUserId: userId,
        manualArtist,
        manualTitle,
        includeVideo,
        downloadMode: resolvedMode,
        jobId,
        onProgress: (patch) =>
          updateDownloadJob(jobId, {
            ...patch,
            status: patch.stage === 'done' ? 'completed' : 'running'
          })
      });

      let targetPlaylist = null;
      if (targetPlaylistId) {
        targetPlaylist = appendSongToPlaylist(targetPlaylistId, music.id);
      }

      updateDownloadJob(jobId, {
        status: 'completed',
        progress: 100,
        stage: 'done',
        message: `Faixa concluida: ${music.title}`
      });

      return {
        success: true,
        mode: resolvedMode,
        jobId,
        music: serializeMusicForUser(music, userId),
        playlist: targetPlaylist ? serializePlaylistForUser(targetPlaylist, userId) : null,
        analysis
      };
    } catch (error) {
      const wasPauseRequested = Boolean(activeDownloadExecutions.get(jobId)?.pauseRequested);
      if (isDownloadControlError(error, 'JOB_PAUSED') || wasPauseRequested) {
        const pausedJob = getDownloadJob(jobId);
        updateDownloadJob(jobId, {
          status: 'paused',
          stage: 'paused',
          message: 'Download pausado',
          progress:
            pausedJob?.mode === 'playlist' ? Number(pausedJob?.progress || 0) : Number(pausedJob?.progress || 0)
        });
        return {
          success: false,
          paused: true,
          jobId
        };
      }

      updateDownloadJob(jobId, {
        status: 'error',
        stage: 'error',
        message: error.message || 'Falha no download',
        progress: 100
      });
      throw error;
    } finally {
      const currentExecution = activeDownloadExecutions.get(jobId);
      if (currentExecution) {
        currentExecution.children.clear();
      }
      clearExecution(jobId);
      setTimeout(() => {
        void processQueuedDownloadJobs();
      }, 50);
    }
  })();

  return execution.promise;
}

async function processQueuedDownloadJobs() {
  if (isDownloadQueueRunning) return;
  isDownloadQueueRunning = true;

  try {
    while (true) {
      const nextJob = findNextQueuedDownloadJob();
      if (!nextJob) break;
      try {
        await executeDownloadJob(nextJob.id);
      } catch (error) {
        addLog(`[queue] Job ${nextJob.id} falhou: ${error.message}`);
      }
    }
  } finally {
    isDownloadQueueRunning = false;
  }
}

function listDownloadJobs() {
  return [...downloadJobs]
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, 20);
}

function createDownloadJob(payload) {
  const job = {
    id: `job-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    status: 'queued',
    progress: 0,
    stage: 'queued',
    message: '',
    items: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...payload
  };

  downloadJobs.unshift(job);
  downloadJobs = listDownloadJobs();

  if (runtimeServices) {
    void runtimeServices.persistDownloadJob(job);
    void runtimeServices.publishRedisEvent('musfy:downloads', {
      type: 'created',
      jobId: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      updatedAt: job.updatedAt
    });
  }

  return job;
}

function updateDownloadJob(jobId, patch) {
  downloadJobs = downloadJobs.map((job) =>
    job.id === jobId
      ? {
          ...job,
          ...patch,
          updatedAt: new Date().toISOString()
        }
      : job
  );

  const updatedJob = downloadJobs.find((job) => job.id === jobId) || null;
  if (updatedJob && runtimeServices) {
    void runtimeServices.persistDownloadJob(updatedJob);
    void runtimeServices.publishRedisEvent('musfy:downloads', {
      type: 'updated',
      jobId: updatedJob.id,
      status: updatedJob.status,
      stage: updatedJob.stage,
      progress: updatedJob.progress,
      updatedAt: updatedJob.updatedAt
    });
  }

  return updatedJob;
}

function parseProgressPercent(text) {
  const match = String(text || '').match(/(\d+(?:\.\d+)?)%/);
  return match ? Number(match[1]) : null;
}

function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }

  const socketIp = req.socket?.remoteAddress || req.ip || '';
  return String(socketIp).replace(/^::ffff:/, '');
}

function getClientContext(req) {
  return {
    ipAddress: getRequestIp(req),
    userAgent: String(req.headers['user-agent'] || '').trim() || null
  };
}

function normalizeIpAddress(ip) {
  return String(ip || '')
    .replace(/^::ffff:/, '')
    .replace(/^\[|\]$/g, '')
    .trim();
}

function getLocalNetworkKey(ip) {
  const normalized = normalizeIpAddress(ip);
  if (!normalized) return null;

  if (normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost') {
    return 'loopback';
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
    const parts = normalized.split('.');
    return parts.slice(0, 3).join('.');
  }

  return normalized;
}

function getReachableNetworkKeys(ip) {
  const directNetwork = getLocalNetworkKey(ip);
  const reachableNetworks = new Set();

  if (directNetwork) {
    reachableNetworks.add(directNetwork);
  }

  if (directNetwork === 'loopback') {
    for (const networkKey of getHostLocalNetworkKeys()) {
      reachableNetworks.add(networkKey);
    }
  }

  return reachableNetworks;
}

function canShareDeviceAcrossContext(requestUserId, requestIpAddress, device) {
  if (!device) return false;

  const requestNetworks = getReachableNetworkKeys(requestIpAddress);
  const deviceNetworks = getReachableNetworkKeys(device.ipAddress);
  const sameNetwork =
    requestNetworks.size > 0 && [...requestNetworks].some((networkKey) => deviceNetworks.has(networkKey));

  if (!sameNetwork) {
    return false;
  }

  if (!requestUserId || !device.userId) {
    return true;
  }

  return String(device.userId) === String(requestUserId);
}

function upsertDevice({ deviceId, deviceName, userId, ipAddress, userAgent, platform }) {
  if (!deviceId) return null;

  const owner = userId ? findUserById(userId) : null;
  const existing = deviceRegistry[deviceId] || {};
  const resolvedPlatform = String(platform || existing.platform || '').trim() || null;

  deviceRegistry[deviceId] = {
    ...existing,
    deviceId,
    deviceName: String(deviceName || existing.deviceName || 'Dispositivo MusFy').trim(),
    userId: userId || existing.userId || null,
    userName: owner?.nome || owner?.login || owner?.email || existing.userName || null,
    ipAddress: ipAddress || existing.ipAddress || null,
    userAgent: userAgent || existing.userAgent || null,
    platform: resolvedPlatform,
    firstSeenAt: existing.firstSeenAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    lastCommand: existing.lastCommand || null,
    commandQueue: Array.isArray(existing.commandQueue) ? existing.commandQueue : [],
    lastAckAt: existing.lastAckAt || null,
    lastAckCommandId: existing.lastAckCommandId || 0,
    lastState: existing.lastState || null,
    lastError: existing.lastError || null
  };

  return deviceRegistry[deviceId];
}

function getActiveDevices() {
  const now = Date.now();
  return Object.values(deviceRegistry).filter((device) => {
    const lastSeen = new Date(device.lastSeenAt || 0).getTime();
    return now - lastSeen < 1000 * 45;
  });
}

function shouldLogDeviceRegister(previousDevice, nextDevice) {
  if (!previousDevice) return true;

  const lastSeen = new Date(previousDevice.lastSeenAt || 0).getTime();
  const elapsed = Date.now() - lastSeen;

  return (
    elapsed > 1000 * 60 ||
    previousDevice.userId !== nextDevice.userId ||
    previousDevice.ipAddress !== nextDevice.ipAddress ||
    previousDevice.deviceName !== nextDevice.deviceName
  );
}

function shouldLogDeviceState(previousState, nextState, errorMessage) {
  if (errorMessage) return true;
  if (!previousState) return true;

  return (
    previousState.status !== nextState.status ||
    previousState.currentSongId !== nextState.currentSongId ||
    previousState.volume !== nextState.volume
  );
}

app.get('/logs', (req, res) => {
  res.json(logs);
});

app.get('/downloads/status', (req, res) => {
  res.json(listDownloadJobs());
});

app.post('/downloads/enqueue', async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    const userId = req.body?.userId ? String(req.body.userId) : null;
    const requestedMode = String(req.body?.mode || '').trim().toLowerCase();
    const targetPlaylistId = req.body?.targetPlaylistId ? String(req.body.targetPlaylistId) : null;
    const manualArtist = String(req.body?.artist || '').trim() || null;
    const manualTitle = String(req.body?.title || '').trim() || null;
    const includeVideo = Boolean(req.body?.includeVideo);
    const playlistTitle = String(req.body?.playlistTitle || '').trim() || null;

    if (!url) {
      return res.status(400).json({ error: 'URL obrigatoria' });
    }

    const job = createDownloadJob({
      url,
      userId,
      mode: requestedMode || 'auto',
      includeVideo,
      title: manualTitle,
      artist: manualArtist,
      targetPlaylistId,
      playlistTitle,
      status: 'queued',
      stage: 'queued',
      progress: 0,
      message: 'Aguardando na fila'
    });

    void processQueuedDownloadJobs();

    return res.status(202).json({
      success: true,
      queued: true,
      job
    });
  } catch (err) {
    addLog(`[error] Falha ao adicionar download na fila: ${err.message}`);
    return res.status(500).json({ error: err.message || 'Falha ao adicionar download na fila' });
  }
});

app.post('/downloads/:id/pause', async (req, res) => {
  const job = getDownloadJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Download nao encontrado' });
  }

  if (job.status === 'paused') {
    return res.json({ success: true, job });
  }

  if (job.status === 'queued') {
    const updated = updateDownloadJob(job.id, {
      status: 'paused',
      stage: 'paused',
      message: 'Download pausado',
      items: Array.isArray(job.items) ? resetJobItemsForResume(job.items) : job.items
    });
    return res.json({ success: true, job: updated });
  }

  if (job.status !== 'running') {
    return res.status(409).json({ error: 'Somente downloads em andamento ou na fila podem ser pausados.' });
  }

  pauseActiveDownloadJob(job.id);
  const updated = updateDownloadJob(job.id, {
    status: 'paused',
    stage: 'paused',
    message: 'Pausando download...'
  });

  return res.json({ success: true, job: updated });
});

app.post('/downloads/:id/resume', async (req, res) => {
  const job = getDownloadJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Download nao encontrado' });
  }

  if (!['paused', 'error', 'queued'].includes(String(job.status || ''))) {
    return res.status(409).json({ error: 'Somente downloads pausados, com erro ou na fila podem ser retomados.' });
  }

  const updated = updateDownloadJob(job.id, {
    status: 'queued',
    stage: 'queued',
    progress: job.mode === 'playlist' ? Math.min(Number(job.progress || 0), 99) : 0,
    message: 'Aguardando retomada',
    items: Array.isArray(job.items) ? resetJobItemsForResume(job.items) : job.items
  });

  void processQueuedDownloadJobs();
  return res.json({ success: true, job: updated });
});

app.get('/youtube/history', async (req, res) => {
  const limit = Number(req.query.limit || 8);
  const recentSearches = runtimeServices ? await runtimeServices.getRecentYoutubeSearches(limit) : [];
  res.json(recentSearches);
});

app.post('/youtube/search', async (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();

    if (query.length < 2) {
      return res.status(400).json({ error: 'Digite pelo menos 2 caracteres para buscar no YouTube.' });
    }

    addLog(`[search] YouTube | termo=${query}`);
    const payload = await searchYoutube(query);
    if (runtimeServices) {
      await runtimeServices.recordYoutubeSearchRequest(
        query,
        payload?.source || 'origin',
        (payload?.results?.length || 0) + (payload?.playlists?.length || 0)
      );
    }
    return res.json(payload);
  } catch (err) {
    addLog(`[error] Falha na busca do YouTube: ${err.message}`);
    return res.status(500).json({ error: err.message || 'Falha ao buscar no YouTube.' });
  }
});

app.get('/devices', (req, res) => {
  const excludeDeviceId = req.query.excludeDeviceId ? String(req.query.excludeDeviceId) : null;
  const userId = req.query.userId ? String(req.query.userId) : null;
  const context = getClientContext(req);

  res.json(
    getActiveDevices().filter(
      (device) =>
        device.deviceId !== excludeDeviceId && canShareDeviceAcrossContext(userId, context.ipAddress, device)
    )
  );
});

app.post('/devices/register', (req, res) => {
  const { deviceId, deviceName, userId, platform } = req.body;
  const context = getClientContext(req);
  const previousDevice = deviceRegistry[deviceId] || null;
  const device = upsertDevice({
    deviceId,
    deviceName,
    userId,
    platform,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent
  });

  if (!device) {
    return res.status(400).json({ error: 'deviceId obrigatorio' });
  }

  if (shouldLogDeviceRegister(previousDevice, device)) {
    addLog(
      `🖥️ Dispositivo ativo: ${device.deviceName} | usuario=${device.userName || 'anonimo'} | ip=${device.ipAddress || 'desconhecido'}`
    );
  }

  res.json({ success: true, device });
});

app.post('/devices/:id/command', (req, res) => {
  const sourceContext = getClientContext(req);
  const sourceDeviceId = req.body.sourceDeviceId ? String(req.body.sourceDeviceId) : null;
  const sourceDeviceName = req.body.sourceDeviceName
    ? String(req.body.sourceDeviceName)
    : 'Origem desconhecida';
  const targetDevice = upsertDevice({
    deviceId: req.params.id,
    deviceName: req.body.targetDeviceName,
    userId: req.body.userId
  });

  if (!targetDevice) {
    return res.status(404).json({ error: 'Dispositivo nao encontrado' });
  }

  if (!canShareDeviceAcrossContext(req.body.userId ? String(req.body.userId) : null, sourceContext.ipAddress, targetDevice)) {
    return res.status(403).json({ error: 'Comandos remotos permitidos apenas para dispositivos do mesmo usuario na mesma rede local' });
  }

  deviceCommandCounter += 1;
  const command = {
    commandId: deviceCommandCounter,
    payload: req.body.payload || null,
    createdAt: new Date().toISOString(),
    sourceDeviceId,
    sourceDeviceName,
    sourceIpAddress: sourceContext.ipAddress
  };
  targetDevice.lastCommand = command;
  targetDevice.commandQueue.push(command);

  addLog(
    `🎛️ Comando remoto #${command.commandId}: ${req.body.payload?.type || 'desconhecido'} | origem=${sourceDeviceName} (${sourceContext.ipAddress || 'sem-ip'}) -> destino=${targetDevice.deviceName} (${targetDevice.ipAddress || 'sem-ip'})`
  );
  res.json({ success: true, commandId: deviceCommandCounter });
});

app.get('/devices/:id/command', (req, res) => {
  const context = getClientContext(req);
  const device = upsertDevice({
    deviceId: req.params.id,
    deviceName: req.query.deviceName,
    userId: req.query.userId,
    platform: req.query.platform,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent
  });

  const after = Number(req.query.after || 0);
  const requestUserId = req.query.userId ? String(req.query.userId) : null;

  if (!canShareDeviceAcrossContext(requestUserId, context.ipAddress, device)) {
    return res.status(403).json({ error: 'Acesso remoto permitido apenas para dispositivos do mesmo usuario na mesma rede local' });
  }

  const queue = Array.isArray(device?.commandQueue) ? device.commandQueue : [];
  const command = queue.find((item) => item.commandId > after) || null;

  if (!command || command.commandId <= after) {
    return res.json({ command: null });
  }

  addLog(
    `📨 Entregando comando #${command.commandId} para ${device.deviceName} | payload=${command.payload?.type || 'desconhecido'}`
  );
  res.json({ command });
});

app.post('/devices/:id/ack', (req, res) => {
  const context = getClientContext(req);
  const device = upsertDevice({
    deviceId: req.params.id,
    deviceName: req.body.deviceName,
    userId: req.body.userId,
    platform: req.body.platform,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent
  });

  if (!device) {
    return res.status(404).json({ error: 'Dispositivo nao encontrado' });
  }

  if (!canShareDeviceAcrossContext(req.body.userId ? String(req.body.userId) : null, context.ipAddress, device)) {
    return res.status(403).json({ error: 'ACK remoto permitido apenas para dispositivos do mesmo usuario na mesma rede local' });
  }

  const commandId = Number(req.body.commandId || 0);
  const status = String(req.body.status || 'received');
  const details = req.body.details ? String(req.body.details) : '';

  device.lastAckCommandId = commandId;
  device.lastAckAt = new Date().toISOString();
  device.commandQueue = (device.commandQueue || []).filter((command) => command.commandId > commandId);
  device.lastError = status === 'error' ? details || 'Erro remoto sem detalhes' : null;

  addLog(
    `✅ ACK dispositivo ${device.deviceName} para comando #${commandId} | status=${status}${details ? ` | ${details}` : ''}`
  );

  res.json({ success: true });
});

app.post('/devices/:id/state', (req, res) => {
  const context = getClientContext(req);
  const previousDevice = deviceRegistry[req.params.id] || null;
  const previousState = previousDevice?.lastState || null;
  const device = upsertDevice({
    deviceId: req.params.id,
    deviceName: req.body.deviceName,
    userId: req.body.userId,
    platform: req.body.platform,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent
  });

  if (!device) {
    return res.status(404).json({ error: 'Dispositivo nao encontrado' });
  }

  if (!canShareDeviceAcrossContext(req.body.userId ? String(req.body.userId) : null, context.ipAddress, device)) {
    return res.status(403).json({ error: 'Estado remoto permitido apenas para dispositivos do mesmo usuario na mesma rede local' });
  }

  const nextState = {
    status: req.body.status || 'idle',
    currentSongId: req.body.currentSongId || null,
    currentSongTitle: req.body.currentSongTitle || null,
    currentSongArtist: req.body.currentSongArtist || null,
    isPlaying: Boolean(req.body.isPlaying),
    currentTime: Number(req.body.currentTime || 0),
    duration: Number(req.body.duration || 0),
    volume: Number(req.body.volume || 0),
    lastUpdateAt: new Date().toISOString()
  };

  device.lastState = nextState;
  if (req.body.errorMessage) {
    device.lastError = String(req.body.errorMessage);
  }

  if (shouldLogDeviceState(previousState, nextState, req.body.errorMessage)) {
    addLog(
      `📡 Estado ${device.deviceName} | status=${nextState.status} | faixa=${nextState.currentSongTitle || 'nenhuma'} | artista=${nextState.currentSongArtist || 'n/d'}${device.lastError ? ` | erro=${device.lastError}` : ''}`
    );
  }

  res.json({ success: true });
});

// =============================
// DATABASE
// =============================
let db = {
  musicLibrary: [],
  users: [],
  playlists: []
};

function writeUtf8FileAtomically(targetPath, content, retries = 4) {
  const directory = path.dirname(targetPath);
  const tempPath = path.join(directory, `${path.basename(targetPath)}.tmp-${process.pid}`);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      fs.writeFileSync(tempPath, content, 'utf-8');
      fs.renameSync(tempPath, targetPath);
      return;
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {}

      if (!['EPERM', 'EACCES', 'EBUSY'].includes(String(error?.code || '')) || attempt === retries) {
        throw error;
      }

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * attempt);
    }
  }
}

function saveDb() {
  writeUtf8FileAtomically(dbPath, JSON.stringify(db, null, 2));
}

function loadDb() {
  if (!fs.existsSync(dbPath)) {
    saveDb();
    return;
  }

  try {
    const raw = fs.readFileSync(dbPath, 'utf-8');
    const parsed = JSON.parse(raw);

    db = {
      musicLibrary: Array.isArray(parsed.musicLibrary)
        ? parsed.musicLibrary.map(normalizeMusicRecord)
        : [],
      users: Array.isArray(parsed.users) ? parsed.users : [],
      playlists: Array.isArray(parsed.playlists)
        ? parsed.playlists.map((playlist) => ({
            ...playlist,
            ownerUserId: playlist.ownerUserId || null,
            musicIds: Array.isArray(playlist.musicIds) ? playlist.musicIds : []
          }))
        : []
    };
  } catch (err) {
    addLog(`❌ Erro ao carregar database: ${err.message}`);
    db = { musicLibrary: [], users: [], playlists: [] };
    saveDb();
  }
}

loadDb();

function loadYoutubeSearchCache() {
  if (!fs.existsSync(youtubeSearchCachePath)) {
    fs.writeFileSync(youtubeSearchCachePath, JSON.stringify({}, null, 2), 'utf-8');
    youtubeSearchFileCache = {};
    return;
  }

  try {
    const raw = fs.readFileSync(youtubeSearchCachePath, 'utf-8');
    const parsed = JSON.parse(raw);
    youtubeSearchFileCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    addLog(`[cache] Falha ao carregar cache de busca: ${err.message}`);
    youtubeSearchFileCache = {};
  }
}

function saveYoutubeSearchCache() {
  try {
    fs.writeFileSync(youtubeSearchCachePath, JSON.stringify(youtubeSearchFileCache, null, 2), 'utf-8');
  } catch (err) {
    addLog(`[cache] Falha ao salvar cache de busca: ${err.message}`);
  }
}

loadYoutubeSearchCache();

runtimeServices = createRuntimeServices({
  runtimeRootDir,
  dataDir,
  emitLog: (message) => addLog(message)
});

void runtimeServices
  .bootstrap()
  .then(async () => {
    const restoredJobs = await runtimeServices.restoreDownloadJobs(20);
    if (Array.isArray(restoredJobs) && restoredJobs.length > 0) {
      downloadJobs = restoredJobs
        .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
        .slice(0, 20);
      addLog(`[sqlite] ${downloadJobs.length} downloads recentes restaurados.`);

      let resumedJobs = 0;
      downloadJobs.forEach((job) => {
        if (job.status === 'running') {
          queueDownloadJob(job.id, 'Retomando download apos reinicio do MusFy');
          resumedJobs += 1;
          return;
        }

        if (job.status === 'queued') {
          queueDownloadJob(job.id, job.message || 'Aguardando na fila');
        }
      });

      if (resumedJobs > 0) {
        addLog(`[queue] ${resumedJobs} downloads interrompidos foram recolocados na fila.`);
      }
    }

    const storage = runtimeServices?.getServiceStorageSummary() || null;
    runtimeBootstrapState = {
      phase: 'ready',
      ready: Boolean(storage?.sqlite?.ready && ['embedded', 'external'].includes(String(storage?.redis?.mode || ''))),
      error: storage?.sqlite?.error || storage?.redis?.error || null
    };
    void processQueuedDownloadJobs();
  })
  .catch((error) => {
    runtimeBootstrapState = {
      phase: 'error',
      ready: false,
      error: error.message
    };
    addLog(`[runtime] Falha ao iniciar SQLite/Redis embarcados: ${error.message}`);
  });

// =============================
// HELPERS
// =============================
function safeFileName(name) {
  return String(name || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeTextValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateId() {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSearchQuery(query) {
  return String(query || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isFreshCacheEntry(entry, ttlMs = YOUTUBE_SEARCH_TTL_MS) {
  if (!entry?.cachedAt) return false;
  const cachedAt = new Date(entry.cachedAt).getTime();
  return Number.isFinite(cachedAt) && Date.now() - cachedAt < ttlMs;
}

function makeYoutubeThumbnailUrl(videoId) {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

function formatYoutubeDuration(secondsValue) {
  const totalSeconds = Number(secondsValue || 0);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return [hours, minutes, seconds].map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, '0'))).join(':');
  }

  return [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function extractYoutubeText(value) {
  if (!value) return '';
  if (typeof value === 'string') return cleanMetadataText(value);
  if (typeof value.simpleText === 'string') return cleanMetadataText(value.simpleText);
  if (Array.isArray(value.runs)) {
    return cleanMetadataText(
      value.runs
        .map((item) => (typeof item?.text === 'string' ? item.text : ''))
        .filter(Boolean)
        .join('')
    );
  }

  return '';
}

function parseYoutubeEntryCount(value) {
  const text = extractYoutubeText(value);
  if (!text) return null;

  const match = text.replace(/\./g, '').match(/(\d+)/);
  return match ? Number(match[1]) || null : null;
}

function extractJsonObjectFromText(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;

  const startIndex = source.indexOf('{', markerIndex);
  if (startIndex < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function extractYoutubeInitialData(html) {
  const markers = ['var ytInitialData = ', 'window["ytInitialData"] = ', 'ytInitialData = '];

  for (const marker of markers) {
    const jsonText = extractJsonObjectFromText(html, marker);
    if (!jsonText) continue;

    try {
      return JSON.parse(jsonText);
    } catch (error) {
      addLog(`[search] Falha ao interpretar ytInitialData: ${error.message}`);
    }
  }

  return null;
}

function collectYoutubeNodesByKey(value, key, acc = []) {
  if (!value || typeof value !== 'object') return acc;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectYoutubeNodesByKey(item, key, acc);
    }
    return acc;
  }

  if (value[key]) {
    acc.push(value[key]);
  }

  for (const nested of Object.values(value)) {
    collectYoutubeNodesByKey(nested, key, acc);
  }

  return acc;
}

function extractYoutubePlaylistThumbnail(renderer) {
  const candidates = [
    renderer?.thumbnails?.[0]?.thumbnails,
    renderer?.thumbnail?.thumbnails,
    renderer?.thumbnailRenderer?.playlistVideoThumbnailRenderer?.thumbnail?.thumbnails,
    renderer?.thumbnailRenderer?.playlistCustomThumbnailRenderer?.thumbnail?.thumbnails
  ];

  for (const thumbnails of candidates) {
    if (Array.isArray(thumbnails) && thumbnails.length > 0) {
      const best = thumbnails[thumbnails.length - 1];
      if (best?.url) return String(best.url).trim();
    }
  }

  return null;
}

function mapYoutubePlaylistLockup(lockup, index) {
  const contentId = String(lockup?.contentId || '').trim();
  const playlistId =
    contentId.startsWith('VL') ? contentId.slice(2) : String(lockup?.contentId || lockup?.playlistId || '').trim();
  if (!playlistId) return null;

  const metadata = lockup?.metadata?.lockupMetadataViewModel || {};
  const image =
    lockup?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources || [];

  const previewEntries = Array.isArray(metadata?.metadataLines)
    ? metadata.metadataLines
        .flatMap((line) => (Array.isArray(line?.lineRenderer?.items) ? line.lineRenderer.items : []))
        .map((item, itemIndex) => {
          const title = extractYoutubeText(item?.lineItemRenderer?.text) || '';
          return title
            ? {
                id: null,
                title,
                url: getYoutubePlaylistUrl(playlistId)
              }
            : null;
        })
        .filter(Boolean)
        .slice(0, 4)
    : [];

  const imageUrl = Array.isArray(image) && image.length > 0 ? String(image[image.length - 1]?.url || '').trim() || null : null;
  const title = extractYoutubeText(metadata?.title) || extractYoutubeText(lockup?.title) || `Playlist ${index + 1}`;
  const byline = extractYoutubeText(metadata?.subtitle) || extractYoutubeText(lockup?.subtitle) || null;

  return {
    id: playlistId,
    title,
    url: getYoutubePlaylistUrl(playlistId),
    thumbnail: imageUrl,
    channel: byline,
    entryCount: parseYoutubeEntryCount(byline) || previewEntries.length || null,
    previewEntries,
    position: index + 1
  };
}

function mapYoutubePlaylistRenderer(renderer, index) {
  const playlistId = String(renderer?.playlistId || '').trim();
  if (!playlistId) return null;

  const previewEntries = Array.isArray(renderer?.videos)
    ? renderer.videos
        .map((item, itemIndex) => {
          const video = item?.childVideoRenderer || item;
          const videoId =
            String(
              video?.navigationEndpoint?.watchEndpoint?.videoId || video?.videoId || video?.id || ''
            ).trim() || null;
          const title = extractYoutubeText(video?.title) || `Faixa ${itemIndex + 1}`;
          const url = videoId ? `${getYoutubeWatchUrl(videoId)}&list=${playlistId}` : getYoutubePlaylistUrl(playlistId);

          return {
            id: videoId,
            title,
            url
          };
        })
        .filter((entry) => entry.title)
        .slice(0, 4)
    : [];

  return {
    id: playlistId,
    title: extractYoutubeText(renderer?.title) || `Playlist ${index + 1}`,
    url: getYoutubePlaylistUrl(playlistId),
    thumbnail: extractYoutubePlaylistThumbnail(renderer),
    channel: extractYoutubeText(renderer?.shortBylineText || renderer?.longBylineText) || null,
    entryCount:
      parseYoutubeEntryCount(renderer?.videoCountText) ||
      parseYoutubeEntryCount(renderer?.videoCountShortText) ||
      previewEntries.length ||
      null,
    previewEntries,
    position: index + 1
  };
}

async function fetchYoutubeSearchInitialData(query, filter = null) {
  const queryParams = new URLSearchParams({
    search_query: query
  });

  if (filter) {
    queryParams.set('sp', filter);
  }

  const response = await fetch(`https://www.youtube.com/results?${queryParams.toString()}`, {
    headers: {
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`YouTube respondeu ${response.status} ao buscar playlists`);
  }

  const html = await response.text();
  return extractYoutubeInitialData(html);
}

async function searchYoutubePlaylistResults(query) {
  const playlistFilter = 'EgIQAw%3D%3D';
  const initialData =
    (await fetchYoutubeSearchInitialData(query, playlistFilter)) || (await fetchYoutubeSearchInitialData(query, null));
  if (!initialData) {
    throw new Error('Nao foi possivel ler playlists da busca integrada');
  }

  const playlistRenderers = collectYoutubeNodesByKey(initialData, 'playlistRenderer');
  const playlistLockups = collectYoutubeNodesByKey(initialData, 'lockupViewModel');
  const uniquePlaylists = new Map();

  for (const renderer of playlistRenderers) {
    const mapped = mapYoutubePlaylistRenderer(renderer, uniquePlaylists.size);
    if (mapped && !uniquePlaylists.has(mapped.id)) {
      uniquePlaylists.set(mapped.id, mapped);
    }
    if (uniquePlaylists.size >= 24) break;
  }

  for (const lockup of playlistLockups) {
    const mapped = mapYoutubePlaylistLockup(lockup, uniquePlaylists.size);
    if (mapped && !uniquePlaylists.has(mapped.id)) {
      uniquePlaylists.set(mapped.id, mapped);
    }
    if (uniquePlaylists.size >= 24) break;
  }

  return Array.from(uniquePlaylists.values());
}

async function searchYoutubeVideoResults(query) {
  const args = [
    '--ignore-config',
    `ytsearch${YOUTUBE_SEARCH_LIMIT}:${query}`,
    '--dump-single-json',
    '--flat-playlist',
    '--playlist-end',
    String(YOUTUBE_SEARCH_LIMIT),
    '--skip-download',
    '--no-warnings',
    '--no-check-certificate',
    '--socket-timeout',
    '20'
  ];

  if (fs.existsSync(NODE_RUNTIME_PATH)) {
    args.push('--js-runtimes', `node:${NODE_RUNTIME_PATH}`);
  }

  const payload = await new Promise((resolve, reject) => {
    const ytdlp = spawn(YTDLP_PATH, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';

    const timeout = setTimeout(() => {
      ytdlp.kill('SIGKILL');
      reject(new Error('Busca no YouTube expirou'));
    }, 20000);

    ytdlp.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
    });

    ytdlp.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Falha ao iniciar busca do YouTube: ${err.message}`));
    });

    ytdlp.on('close', (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        return reject(new Error(stderrBuffer.trim() || `Busca do YouTube finalizou com codigo ${code}`));
      }

      try {
        resolve(JSON.parse(stdoutBuffer));
      } catch (err) {
        reject(new Error(`Falha ao interpretar busca do YouTube: ${err.message}`));
      }
    });
  });

  return Array.isArray(payload?.entries)
    ? payload.entries
        .filter(Boolean)
        .slice(0, YOUTUBE_SEARCH_LIMIT)
        .map((entry, index) => {
          const videoId = String(entry.id || '').trim();
          const url = videoId ? `https://www.youtube.com/watch?v=${videoId}` : String(entry.url || '').trim();

          return {
            id: videoId || `search-${index}`,
            title: String(entry.title || 'Faixa sem titulo').trim(),
            url,
            thumbnail: makeYoutubeThumbnailUrl(videoId),
            channel: String(entry.channel || entry.uploader || entry.uploader_id || '').trim() || null,
            duration: formatYoutubeDuration(entry.duration),
            durationSeconds: Number(entry.duration || 0) || null,
            position: index + 1
          };
        })
    : [];
}

function parseRedisValue(buffer) {
  const text = buffer.toString('utf8');

  if (!text) return null;
  if (text.startsWith('+')) return text.slice(1).trim();
  if (text.startsWith('-')) throw new Error(text.slice(1).trim());
  if (text.startsWith(':')) return Number(text.slice(1).trim());

  if (text.startsWith('$-1')) {
    return null;
  }

  if (text.startsWith('$')) {
    const firstBreak = text.indexOf('\r\n');
    const size = Number(text.slice(1, firstBreak));
    if (size < 0) return null;
    return text.slice(firstBreak + 2, firstBreak + 2 + size);
  }

  return text.trim();
}

function sendRedisCommand(args) {
  if (!REDIS_URL) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const redisUrl = new URL(REDIS_URL);
    const isTls = redisUrl.protocol === 'rediss:';
    const port = Number(redisUrl.port || (isTls ? 6380 : 6379));
    const connector = isTls ? tls.connect : net.connect;
    const socket = connector({
      host: redisUrl.hostname,
      port,
      servername: isTls ? redisUrl.hostname : undefined
    });

    const chunks = [];
    const command = `*${args.length}\r\n${args.map((arg) => `$${Buffer.byteLength(String(arg))}\r\n${String(arg)}\r\n`).join('')}`;

    socket.setTimeout(5000);

    socket.on('connect', () => {
      if (redisUrl.password) {
        const authArgs = redisUrl.username
          ? ['AUTH', redisUrl.username, redisUrl.password]
          : ['AUTH', redisUrl.password];
        const authCommand = `*${authArgs.length}\r\n${authArgs.map((arg) => `$${Buffer.byteLength(String(arg))}\r\n${String(arg)}\r\n`).join('')}`;
        socket.write(authCommand);
      }

      socket.write(command);
    });

    socket.on('data', (chunk) => {
      chunks.push(chunk);
      const payload = Buffer.concat(chunks);
      try {
        const parsed = parseRedisValue(payload);
        socket.end();
        resolve(parsed);
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Redis timeout'));
    });

    socket.on('error', (error) => {
      reject(error);
    });
  });
}

async function getRedisCacheValue(key) {
  if (!REDIS_URL) return null;

  try {
    const value = await sendRedisCommand(['GET', key]);
    return value ? JSON.parse(String(value)) : null;
  } catch (err) {
    addLog(`[redis] GET falhou para ${key}: ${err.message}`);
    return null;
  }
}

async function setRedisCacheValue(key, value, ttlSeconds) {
  if (!REDIS_URL) return;

  try {
    await sendRedisCommand(['SETEX', key, String(ttlSeconds), JSON.stringify(value)]);
  } catch (err) {
    addLog(`[redis] SETEX falhou para ${key}: ${err.message}`);
  }
}

async function robustDownload(fn, retries = 5, waitMs = 3000) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (isDownloadControlError(err)) {
        throw err;
      }

      lastError = err;
      addLog(`⚠️ Tentativa ${attempt}/${retries} falhou: ${err.message}`);

      if (attempt < retries) {
        await delay(waitMs);
      }
    }
  }

  throw lastError || new Error('Falha desconhecida no download');
}

function getVideoId(url) {
  const match = String(url || '').match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&?/]+)/
  );
  return match ? match[1] : null;
}

function isYoutubePlaylistUrl(url) {
  return /[?&]list=/.test(String(url || ''));
}

function getPlaylistId(url) {
  const match = String(url || '').match(/[?&]list=([^&]+)/);
  return match ? match[1] : null;
}

function isYoutubeDynamicMix(url, playlistId = null) {
  const normalizedUrl = String(url || '');
  const normalizedPlaylistId = String(playlistId || getPlaylistId(normalizedUrl) || '').trim().toUpperCase();
  return normalizedPlaylistId.startsWith('RD') || /[?&]start_radio=1(?:&|$)/i.test(normalizedUrl);
}

function getYoutubeWatchUrl(videoIdOrUrl) {
  const value = String(videoIdOrUrl || '').trim();
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }

  return `https://www.youtube.com/watch?v=${value}`;
}

function getYoutubePlaylistUrl(playlistIdOrUrl) {
  const rawValue = String(playlistIdOrUrl || '').trim();
  const playlistId = getPlaylistId(rawValue) || rawValue;
  if (!playlistId) return rawValue;
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}

function parseArtistAndTitle(value) {
  const raw = safeFileName(value || '');
  if (!raw) {
    return { artist: null, title: '' };
  }

  const separators = [' - ', ' – ', ' — ', ' | ', ': '];
  for (const separator of separators) {
    if (raw.includes(separator)) {
      const [artistPart, ...titleParts] = raw.split(separator);
      const artist = safeFileName(artistPart);
      const title = safeFileName(titleParts.join(separator));

      if (artist && title) {
        return { artist, title };
      }
    }
  }

  return { artist: null, title: raw };
}

function looksGenericArtist(value) {
  const normalized = safeFileName(value || '').toLowerCase();
  return !normalized || ['arquivo', 'youtube', 'audio', 'artista desconhecido'].includes(normalized);
}

function looksGenericTitle(value) {
  const normalized = safeFileName(value || '');
  if (!normalized) return true;

  const lower = normalized.toLowerCase();
  return (
    /^youtube\s+[a-z0-9_-]{6,}$/i.test(normalized) ||
    /^\d+$/.test(normalized) ||
    ['arquivo', 'audio', 'musica', 'youtube'].includes(lower)
  );
}

function cleanMetadataText(value) {
  return safeTextValue(value)
    .replace(/\s*\[[^\]]+\]\s*/g, ' ')
    .replace(/\s*\([^)]+\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetadataFromCandidates(candidates) {
  for (const candidate of candidates) {
    const cleaned = cleanMetadataText(candidate);
    if (!cleaned) continue;

    const parsed = parseArtistAndTitle(cleaned);
    const title = cleanMetadataText(parsed.title || cleaned);
    const artist = cleanMetadataText(parsed.artist || '');

    if (!looksGenericTitle(title)) {
      return {
        title,
        artist: looksGenericArtist(artist) ? null : artist
      };
    }
  }

  const fallback = cleanMetadataText(candidates.find(Boolean) || '');
  return {
    title: fallback || 'Musica sem titulo',
    artist: null
  };
}

function cleanYoutubeMetadataText(value) {
  return safeTextValue(value)
    .replace(/\.(mp3|m4a|webm|opus|mp4)$/i, '')
    .replace(/\s+-\s+topic$/i, '')
    .replace(/\s+vevo$/i, '')
    .replace(/\s*\[((official|audio|video|music|lyrics?|lyric video|visualizer|legendado|clipe|ao vivo|live|hd|4k)[^\]]*)\]\s*/gi, ' ')
    .replace(/\s*\(((official|audio|video|music|lyrics?|lyric video|visualizer|legendado|clipe|ao vivo|live|hd|4k)[^)]*)\)\s*/gi, ' ')
    .replace(/\s+\|\s+(official|audio|video|music|lyrics?|lyric video|visualizer|legendado|clipe|ao vivo|live|hd|4k).*$/gi, '')
    .replace(/\s+-\s+(official|audio|video|music|lyrics?|lyric video|visualizer|legendado|clipe|ao vivo|live|hd|4k).*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseYoutubeArtistAndTitle(value) {
  const raw = cleanYoutubeMetadataText(value);
  if (!raw) {
    return { artist: null, title: '' };
  }

  const separatorMatch = raw.match(/(.+?)\s(?:-|–|—|\||:)\s(.+)/);
  if (!separatorMatch) {
    return { artist: null, title: raw };
  }

  return {
    artist: cleanYoutubeMetadataText(separatorMatch[1]),
    title: cleanYoutubeMetadataText(separatorMatch[2])
  };
}

function looksGenericYoutubeArtist(value) {
  const normalized = cleanYoutubeMetadataText(value).toLowerCase();
  return (
    !normalized ||
    ['arquivo', 'youtube', 'audio', 'artista desconhecido', 'unknown artist', 'youtube audio'].includes(normalized)
  );
}

function extractYoutubeMetadataFromCandidates(candidates) {
  for (const candidate of candidates) {
    const cleaned = cleanYoutubeMetadataText(candidate);
    if (!cleaned) continue;

    const parsed = parseYoutubeArtistAndTitle(cleaned);
    const title = cleanYoutubeMetadataText(parsed.title || cleaned);
    const artist = cleanYoutubeMetadataText(parsed.artist || '');

    if (!looksGenericTitle(title)) {
      return {
        title,
        artist: looksGenericYoutubeArtist(artist) ? null : artist
      };
    }
  }

  const fallback = cleanYoutubeMetadataText(candidates.find(Boolean) || '');
  return {
    title: fallback || 'Musica sem titulo',
    artist: null
  };
}

function resolveYoutubeTrackMetadata(metadata, fallbackId) {
  const extracted = extractYoutubeMetadataFromCandidates([
    metadata.track,
    metadata.altTitle,
    metadata.title,
    metadata.fullTitle,
    metadata.id ? `YouTube ${metadata.id}` : '',
    fallbackId ? `YouTube ${fallbackId}` : ''
  ]);

  const directArtist = cleanYoutubeMetadataText(
    metadata.artist ||
      metadata.creator ||
      metadata.channel ||
      metadata.uploader
  );

  const resolvedTitle = cleanYoutubeMetadataText(
    extracted.title ||
      metadata.track ||
      metadata.altTitle ||
      metadata.title ||
      metadata.fullTitle ||
      ''
  );

  let resolvedArtist = cleanYoutubeMetadataText(extracted.artist || directArtist || '');
  if (looksGenericYoutubeArtist(resolvedArtist)) {
    resolvedArtist = null;
  }

  return {
    title: looksGenericTitle(resolvedTitle) ? 'Musica sem titulo' : resolvedTitle,
    artist: resolvedArtist
  };
}

function normalizeMusicRecord(music) {
  const fallback = parseYoutubeArtistAndTitle(music.title);
  const favoritedByUserIds = Array.isArray(music.favoritedByUserIds)
    ? music.favoritedByUserIds.map(String)
    : music.favorite && music.ownerUserId
      ? [String(music.ownerUserId)]
      : [];
  const uploadedByUserId = music.uploadedByUserId || music.ownerUserId || null;

  return {
    ...music,
    title: cleanYoutubeMetadataText(music.title || fallback.title || 'Musica sem titulo'),
    artist: cleanYoutubeMetadataText(music.artist || '') || fallback.artist || null,
    path: music.path || null,
    audioMimeType: music.audioMimeType || null,
    videoPath: music.videoPath || null,
    videoMimeType: music.videoMimeType || null,
    hasVideo: Boolean(music.videoPath),
    ownerUserId: music.ownerUserId || null,
    uploadedByUserId,
    favoritedByUserIds,
    favorite: Boolean(music.favorite)
  };
}

function isMusicFavoritedByUser(music, userId) {
  if (!userId) return false;
  return Array.isArray(music.favoritedByUserIds) && music.favoritedByUserIds.includes(String(userId));
}

function serializeMusicForUser(music, userId) {
  const normalized = normalizeMusicRecord(music);
  const uploader = normalized.uploadedByUserId ? findUserById(normalized.uploadedByUserId) : null;

  return {
    ...normalized,
    uploadedByUserName: uploader?.nome || uploader?.login || uploader?.email || null,
    favorite: isMusicFavoritedByUser(normalized, userId)
  };
}

function serializePlaylistForUser(playlist, userId) {
  const owner = playlist.ownerUserId ? findUserById(playlist.ownerUserId) : null;

  return {
    ...playlist,
    ownerUserName: owner?.nome || owner?.login || owner?.email || null,
    songs: (playlist.musicIds || [])
      .map((id) => findMusicById(id))
      .filter(Boolean)
      .map((music) => serializeMusicForUser(music, userId))
  };
}

function getYtDlpSingleArgs(url, baseFile) {
  const args = [
    url,
    '-f',
    'bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio/bestaudio/best',
    '-N',
    '8',
    '--concurrent-fragments',
    '8',
    '--retries',
    '999',
    '--fragment-retries',
    '999',
    '--extractor-retries',
    '999',
    '--file-access-retries',
    '999',
    '--retry-sleep',
    'fragment:exp=1:20',
    '--retry-sleep',
    'http:exp=1:20',
    '--continue',
    '--newline',
    '--ignore-errors',
    '--no-abort-on-error',
    '--no-check-certificate',
    '--socket-timeout',
    '30',
    '--add-metadata',
    '--embed-metadata',
    '--no-playlist',
    '--force-overwrites',
    '-o',
    `${baseFile}.%(ext)s`
  ];

  if (fs.existsSync(NODE_RUNTIME_PATH)) {
    args.push('--js-runtimes', `node:${NODE_RUNTIME_PATH}`);
  }

  return appendYtDlpCookieFileArgs(args);
}

function getYtDlpMetadataArgs(url) {
  const args = [
    url,
    '--dump-single-json',
    '--skip-download',
    '--no-playlist',
    '--no-check-certificate',
    '--socket-timeout',
    '30'
  ];

  if (fs.existsSync(NODE_RUNTIME_PATH)) {
    args.push('--js-runtimes', `node:${NODE_RUNTIME_PATH}`);
  }

  return appendYtDlpCookieFileArgs(args);
}

function isTruthyEnvFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function isYtDlpBrowserCookiesExplicitlyEnabled() {
  return (
    isTruthyEnvFlag(process.env.MUSFY_YTDLP_ALLOW_BROWSER_COOKIES) ||
    Boolean(String(process.env.MUSFY_YTDLP_COOKIE_BROWSER || '').trim()) ||
    Boolean(String(process.env.MUSFY_YTDLP_COOKIE_BROWSERS || '').trim())
  );
}

function shouldRetryYtDlpWithBrowserCookies(message) {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('sign in to confirm you') ||
    normalized.includes("not a bot") ||
    normalized.includes('--cookies-from-browser') ||
    normalized.includes('cookies for the authentication')
  );
}

function getYtDlpCookieBrowserCandidates() {
  const configured = String(process.env.MUSFY_YTDLP_COOKIE_BROWSERS || '').trim();
  if (configured) {
    return [...new Set(configured.split(',').map((entry) => entry.trim()).filter(Boolean))];
  }

  if (!isYtDlpBrowserCookiesExplicitlyEnabled()) {
    return [];
  }

  const detectedBrowser = resolveYtDlpCookieBrowserWithWindowsProfileFallback();
  return detectedBrowser ? [detectedBrowser] : [];
}

function buildYtDlpAttemptPlans(baseArgs) {
  if (resolveYtDlpCookiesFilePath()) {
    return [{ label: 'default', args: [...baseArgs] }];
  }

  return [
    { label: 'default', args: [...baseArgs] },
    ...getYtDlpCookieBrowserCandidates().map((browser) => ({
      label: `cookies:${browser}`,
      args: [...baseArgs, '--cookies-from-browser', browser]
    }))
  ];
}

let resolvedYtDlpCookieBrowser = null;
let resolvedYtDlpCookieBrowserChecked = false;
let resolvedYtDlpCookiesFilePath = null;
let resolvedYtDlpCookiesFileChecked = false;

function getYtDlpCookieProbeDirs(localAppData, appData) {
  return [
    { browser: 'edge', dir: localAppData ? path.join(localAppData, 'Microsoft', 'Edge', 'User Data') : '' },
    { browser: 'chrome', dir: localAppData ? path.join(localAppData, 'Google', 'Chrome', 'User Data') : '' },
    { browser: 'brave', dir: localAppData ? path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data') : '' },
    { browser: 'firefox', dir: appData ? path.join(appData, 'Mozilla', 'Firefox', 'Profiles') : '' }
  ];
}

function hasChromiumCookiesDatabase(userDataDir) {
  if (!userDataDir || !fs.existsSync(userDataDir)) {
    return false;
  }

  const candidateDirs = ['Default'];
  try {
    const discovered = fs
      .readdirSync(userDataDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^Profile\s+\d+$/i.test(entry.name))
      .map((entry) => entry.name);
    candidateDirs.push(...discovered);
  } catch (_error) {
    return false;
  }

  return candidateDirs.some((profileName) => {
    const profileDir = path.join(userDataDir, profileName);
    return (
      fs.existsSync(path.join(profileDir, 'Network', 'Cookies')) ||
      fs.existsSync(path.join(profileDir, 'Cookies'))
    );
  });
}

function hasFirefoxCookiesDatabase(profilesDir) {
  if (!profilesDir || !fs.existsSync(profilesDir)) {
    return false;
  }

  try {
    return fs
      .readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .some((entry) => fs.existsSync(path.join(profilesDir, entry.name, 'cookies.sqlite')));
  } catch (_error) {
    return false;
  }
}

function hasYtDlpCookieDatabase(browser, dir) {
  if (!dir) {
    return false;
  }

  if (browser === 'firefox') {
    return hasFirefoxCookiesDatabase(dir);
  }

  return hasChromiumCookiesDatabase(dir);
}

function resolveYtDlpCookiesFilePath() {
  if (resolvedYtDlpCookiesFileChecked) {
    return resolvedYtDlpCookiesFilePath;
  }

  resolvedYtDlpCookiesFileChecked = true;
  const configuredPath = String(process.env.MUSFY_YTDLP_COOKIES_FILE || '').trim();
  const candidates = [
    configuredPath,
    path.join(dataDir, 'youtube-cookies.txt'),
    path.join(dataDir, 'cookies.txt'),
    path.join(runtimeRootDir, 'youtube-cookies.txt')
  ].filter(Boolean);

  const match = candidates.find((candidate) => fs.existsSync(candidate));
  resolvedYtDlpCookiesFilePath = match || null;
  if (resolvedYtDlpCookiesFilePath) {
    addLog(`[yt] Cookies externos habilitados via arquivo: ${path.basename(resolvedYtDlpCookiesFilePath)}`);
  }

  return resolvedYtDlpCookiesFilePath;
}

function resolveWindowsUserProfileCandidates() {
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (profileDir) => {
    const normalized = String(profileDir || '').trim();
    if (!normalized || seen.has(normalized) || !fs.existsSync(normalized)) {
      return;
    }

    seen.add(normalized);
    candidates.push(normalized);
  };

  pushCandidate(process.env.MUSFY_INTERACTIVE_USERPROFILE || '');
  pushCandidate(process.env.MUSFY_COOKIE_USERPROFILE || '');
  pushCandidate(process.env.USERPROFILE || '');

  const systemDrive = String(process.env.SystemDrive || 'C:').trim() || 'C:';
  const usersRoot = path.join(systemDrive, 'Users');
  if (!fs.existsSync(usersRoot)) {
    return candidates;
  }

  const blockedNames = new Set([
    'all users',
    'default',
    'default user',
    'defaultuser0',
    'public',
    'systemprofile',
    'wdagutilityaccount'
  ]);

  const discovered = fs
    .readdirSync(usersRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !blockedNames.has(entry.name.toLowerCase()))
    .map((entry) => {
      const profileDir = path.join(usersRoot, entry.name);
      let modifiedAt = 0;
      try {
        modifiedAt = fs.statSync(profileDir).mtimeMs || 0;
      } catch (_error) {
        modifiedAt = 0;
      }

      return { profileDir, modifiedAt };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt);

  discovered.forEach((entry) => pushCandidate(entry.profileDir));
  return candidates;
}

function tryResolveYtDlpBrowserFromProfile(profileDir) {
  const normalizedProfile = String(profileDir || '').trim();
  if (!normalizedProfile) {
    return null;
  }

  const localAppData = path.join(normalizedProfile, 'AppData', 'Local');
  const appData = path.join(normalizedProfile, 'AppData', 'Roaming');
  const match = getYtDlpCookieProbeDirs(localAppData, appData).find(
    (entry) => entry.dir && hasYtDlpCookieDatabase(entry.browser, entry.dir)
  );
  if (!match) {
    return null;
  }

  return {
    browser: match.browser,
    profileDir: normalizedProfile,
    localAppData,
    appData
  };
}

function resolveYtDlpCookieBrowser() {
  if (resolvedYtDlpCookieBrowserChecked) {
    return resolvedYtDlpCookieBrowser;
  }

  resolvedYtDlpCookieBrowserChecked = true;
  const forcedBrowser = String(process.env.MUSFY_YTDLP_COOKIE_BROWSER || '').trim();
  if (forcedBrowser) {
    resolvedYtDlpCookieBrowser = forcedBrowser;
    return resolvedYtDlpCookieBrowser;
  }

  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  const appData = String(process.env.APPDATA || '').trim();
  const match = getYtDlpCookieProbeDirs(localAppData, appData).find(
    (entry) => entry.dir && hasYtDlpCookieDatabase(entry.browser, entry.dir)
  );
  resolvedYtDlpCookieBrowser = match?.browser || null;
  if (resolvedYtDlpCookieBrowser) {
    addLog(`[yt] Cookies automáticos habilitados via navegador: ${resolvedYtDlpCookieBrowser}`);
  }

  return resolvedYtDlpCookieBrowser;
}

function resolveYtDlpCookieBrowserWithWindowsProfileFallback() {
  if (resolveYtDlpCookiesFilePath()) {
    return null;
  }

  if (!isYtDlpBrowserCookiesExplicitlyEnabled()) {
    return null;
  }

  const browser = resolveYtDlpCookieBrowser();
  if (browser || process.platform !== 'win32') {
    return browser;
  }

  const profileMatch = resolveWindowsUserProfileCandidates()
    .map((profileDir) => tryResolveYtDlpBrowserFromProfile(profileDir))
    .find(Boolean);

  if (!profileMatch) {
    return null;
  }

  const driveRoot = path.parse(profileMatch.profileDir).root.replace(/[\\/]+$/, '');
  process.env.USERPROFILE = profileMatch.profileDir;
  process.env.HOMEDRIVE = driveRoot;
  process.env.HOMEPATH = profileMatch.profileDir.slice(driveRoot.length) || '\\';
  process.env.LOCALAPPDATA = profileMatch.localAppData;
  process.env.APPDATA = profileMatch.appData;
  resolvedYtDlpCookieBrowser = profileMatch.browser;
  resolvedYtDlpCookieBrowserChecked = true;
  addLog(`[yt] Perfil de navegador real detectado para cookies: ${path.basename(profileMatch.profileDir)}`);
  addLog(`[yt] Cookies automaticos habilitados via navegador: ${resolvedYtDlpCookieBrowser}`);
  return resolvedYtDlpCookieBrowser;
}

function appendYtDlpCookieFileArgs(args) {
  const normalizedArgs = args.includes('--ignore-config') ? [...args] : ['--ignore-config', ...args];
  const cookiesFile = resolveYtDlpCookiesFilePath();
  if (!cookiesFile) {
    return normalizedArgs;
  }

  return [...normalizedArgs, '--cookies', cookiesFile];
}

function appendYtDlpBrowserCookiesArgs(args) {
  const browser = resolveYtDlpCookieBrowserWithWindowsProfileFallback();
  if (!browser) {
    return args;
  }

  return [...args, '--cookies-from-browser', browser];
}

async function searchYoutube(query) {
  const normalizedQuery = normalizeSearchQuery(query);
  const cacheKey = `youtube-search:${normalizedQuery}`;
  const memoryEntry = youtubeSearchMemoryCache.get(cacheKey);

  if (isFreshCacheEntry(memoryEntry)) {
    return { ...memoryEntry, source: 'memory' };
  }

  const hotCache = runtimeServices ? await runtimeServices.getHotYoutubeSearchCache(cacheKey) : { entry: null, source: null };
  if (isFreshCacheEntry(hotCache?.entry)) {
    youtubeSearchMemoryCache.set(cacheKey, hotCache.entry);
    return { ...hotCache.entry, source: hotCache.source || 'sqlite' };
  }

  const fileEntry = youtubeSearchFileCache[cacheKey];
  if (isFreshCacheEntry(fileEntry)) {
    youtubeSearchMemoryCache.set(cacheKey, fileEntry);
    return { ...fileEntry, source: 'disk' };
  }

  const [videosResult, playlistsResult] = await Promise.allSettled([
    searchYoutubeVideoResults(query),
    searchYoutubePlaylistResults(query)
  ]);

  if (videosResult.status !== 'fulfilled') {
    throw videosResult.reason;
  }

  if (playlistsResult.status !== 'fulfilled') {
    addLog(`[search] Playlists nao puderam ser agrupadas: ${playlistsResult.reason?.message || playlistsResult.reason}`);
  }

  const results = videosResult.value;
  const playlists = playlistsResult.status === 'fulfilled' ? playlistsResult.value : [];

  const cacheEntry = {
    query,
    normalizedQuery,
    cachedAt: new Date().toISOString(),
    results,
    playlists
  };

  youtubeSearchMemoryCache.set(cacheKey, cacheEntry);
  youtubeSearchFileCache[cacheKey] = cacheEntry;
  saveYoutubeSearchCache();

  if (runtimeServices) {
    await runtimeServices.cacheYoutubeSearch(cacheKey, cacheEntry, Math.floor(YOUTUBE_SEARCH_TTL_MS / 1000));
  }

  return {
    ...cacheEntry,
    source: runtimeServices?.getActiveRedisUrl() ? 'origin+redis' : runtimeServices ? 'origin+sqlite' : 'origin'
  };
}

async function fetchYoutubeSingleMetadata(url, jobId = null) {
  const attempts = buildYtDlpAttemptPlans(getYtDlpMetadataArgs(url));
  let lastError = null;

  for (const attemptPlan of attempts) {
    try {
      if (attemptPlan.label !== 'default') {
        addLog(`[meta] Repetindo consulta com cookies do navegador: ${attemptPlan.label}`);
      }

      return await new Promise((resolve, reject) => {
        const ytdlp = spawnManagedProcess(jobId, YTDLP_PATH, attemptPlan.args, {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdoutBuffer = '';
        let stderrBuffer = '';
        const timeout = setTimeout(() => {
          ytdlp.kill('SIGKILL');
          reject(new Error('Consulta de metadados do YouTube expirou'));
        }, 20000);

        ytdlp.stdout.on('data', (data) => {
          stdoutBuffer += data.toString();
        });

        ytdlp.stderr.on('data', (data) => {
          const text = data.toString();
          stderrBuffer += text;
          const lines = text.split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            addLog(`[meta] yt-dlp: ${line}`);
          }
        });

        ytdlp.on('error', (err) => {
          clearTimeout(timeout);
          reject(new Error(`Falha ao consultar metadados do YouTube: ${err.message}`));
        });

        ytdlp.on('close', (code) => {
          clearTimeout(timeout);

          try {
            assertJobNotPaused(jobId);
          } catch (error) {
            return reject(error);
          }

          if (code !== 0) {
            const stderrSummary = stderrBuffer
              .split(/\r?\n/)
              .filter(Boolean)
              .slice(-6)
              .join(' | ');
            return reject(
              new Error(`yt-dlp falhou ao consultar metadados (code ${code})${stderrSummary ? `: ${stderrSummary}` : ''}`)
            );
          }

          const jsonMatch = stdoutBuffer.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            return reject(new Error('yt-dlp nao retornou JSON de metadados'));
          }

          try {
            const parsed = JSON.parse(jsonMatch[0]);
            resolve({
              id: parsed?.id || '',
              title: parsed?.title || '',
              track: parsed?.track || '',
              artist: parsed?.artist || '',
              uploader: parsed?.uploader || '',
              creator: parsed?.creator || '',
              channel: parsed?.channel || '',
              fullTitle: parsed?.fulltitle || '',
              altTitle: parsed?.alt_title || ''
            });
          } catch (err) {
            reject(new Error(`Falha ao interpretar metadados do YouTube: ${err.message}`));
          }
        });
      });
    } catch (error) {
      lastError = error;
      if (attemptPlan.label === 'default' && shouldRetryYtDlpWithBrowserCookies(error?.message || '')) {
        addLog('[meta] YouTube exigiu autenticacao adicional. Tentando ler cookies do navegador.');
        continue;
      }

      if (attemptPlan.label !== 'default') {
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error('Falha ao consultar metadados do YouTube');
}

function cleanupFileIfExists(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    addLog(`[warn] Falha ao remover arquivo temporario ${path.basename(filePath || '')}: ${err.message}`);
  }
}

async function normalizeVideoForPlayback(inputPath, outputPath, jobId = null) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      '-ac',
      '2',
      outputPath
    ];

    addLog(`[video] Normalizando video para playback | origem=${path.basename(inputPath)}`);
    const ffmpeg = spawnManagedProcess(jobId, FFMPEG_PATH, args, { windowsHide: true });

    ffmpeg.stdout.on('data', (data) => {
      const text = data.toString().trim();
      if (text) addLog(`📄 ffmpeg video: ${text}`);
    });

    ffmpeg.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) addLog(`⚠️ ffmpeg video: ${text}`);
    });

    ffmpeg.on('error', (err) => reject(err));

    ffmpeg.on('close', (code) => {
      try {
        assertJobNotPaused(jobId);
      } catch (error) {
        return reject(error);
      }
      if (code !== 0) {
        return reject(new Error(`ffmpeg do video finalizou com código ${code}`));
      }

      if (!fs.existsSync(outputPath)) {
        return reject(new Error('Arquivo de video final nao foi gerado'));
      }

      resolve();
    });
  });
}

function getYtDlpVideoArgs(url, baseFile) {
  const args = [
    url,
    '-f',
    'bv*[vcodec^=avc1][height<=720][ext=mp4]+ba[acodec^=mp4a]/b[vcodec^=avc1][height<=720][ext=mp4]/bv*[vcodec^=avc1][height<=720]+ba/b[height<=720]/best',
    '-N',
    '4',
    '--concurrent-fragments',
    '4',
    '--retries',
    '200',
    '--fragment-retries',
    '200',
    '--extractor-retries',
    '200',
    '--file-access-retries',
    '200',
    '--continue',
    '--newline',
    '--ignore-errors',
    '--no-abort-on-error',
    '--socket-timeout',
    '30',
    '--no-check-certificate',
    '--merge-output-format',
    'mp4',
    '--no-playlist',
    '--force-overwrites',
    '-o',
    `${baseFile}.%(ext)s`
  ];

  if (fs.existsSync(NODE_RUNTIME_PATH)) {
    args.push('--js-runtimes', `node:${NODE_RUNTIME_PATH}`);
  }

  return appendYtDlpCookieFileArgs(args);
}

async function inspectYoutubeUrl(url, jobId = null) {
  const normalizedUrl = String(url || '').trim();
  const videoId = getVideoId(normalizedUrl);
  const playlistId = getPlaylistId(normalizedUrl);
  const playlistHint = isYoutubePlaylistUrl(normalizedUrl);

  if (isYoutubeDynamicMix(normalizedUrl, playlistId)) {
    addLog(`[inspect] Mix/radio dinamico detectado; tratando como faixa unica | list=${playlistId || 'sem-list'}`);
    return {
      kind: 'single',
      url: normalizedUrl,
      videoId,
      playlistId,
      hasPlaylist: false,
      selectedEntry: videoId
        ? {
            id: videoId,
            url: getYoutubeWatchUrl(videoId),
            title: null
          }
        : null,
      playlist: null
    };
  }

  if (!playlistHint) {
    return {
      kind: 'single',
      url: normalizedUrl,
      videoId,
      playlistId: null,
      hasPlaylist: false,
      selectedEntry: videoId
        ? {
            id: videoId,
            url: getYoutubeWatchUrl(videoId),
            title: null
          }
        : null,
      playlist: null
    };
  }

  let playlistData = null;
  try {
    playlistData = await fetchYoutubePlaylistData(normalizedUrl, jobId);
  } catch (error) {
    if (videoId) {
      addLog(`[warn] Falha ao inspecionar playlist; fallback para faixa unica | motivo=${error.message}`);
      return {
        kind: 'single',
        url: normalizedUrl,
        videoId,
        playlistId,
        hasPlaylist: false,
        selectedEntry: {
          id: videoId,
          url: getYoutubeWatchUrl(videoId),
          title: null
        },
        playlist: null
      };
    }
    throw error;
  }

  const { playlistJson, entries } = playlistData;
  const playlistTitle = cleanMetadataText(
    playlistJson?.title || playlistJson?.playlist_title || `Playlist ${playlistId || ''}`
  );
  const selectedEntry =
    entries.find((entry) => entry.id && videoId && entry.id === videoId) ||
    entries.find((entry) => entry.url === normalizedUrl) ||
    entries[0] ||
    null;

  return {
    kind: entries.length > 1 ? 'playlist' : 'single',
    url: normalizedUrl,
    videoId,
    playlistId,
    hasPlaylist: true,
    selectedEntry: selectedEntry
      ? {
          id: selectedEntry.id || videoId || null,
          url: selectedEntry.url || normalizedUrl,
          title: selectedEntry.title || null
        }
      : videoId
        ? {
            id: videoId,
            url: getYoutubeWatchUrl(videoId),
            title: null
          }
        : null,
    playlist: {
      id: playlistId || playlistJson?.id || null,
      title: playlistTitle || 'Playlist do YouTube',
      entryCount: entries.length,
      entries: entries.slice(0, 12)
    }
  };
}

async function cleanupGeneratedFilesByPrefix(prefix) {
  try {
    const files = fs.readdirSync(opusDir).filter((file) => file.startsWith(prefix));
    for (const file of files) {
      const fullPath = path.join(opusDir, file);
      try {
        fs.unlinkSync(fullPath);
      } catch (err) {
        addLog(`⚠️ Falha ao limpar arquivo temporario ${file}: ${err.message}`);
      }
    }
  } catch (err) {
    addLog(`⚠️ Falha ao listar arquivos temporarios para limpeza: ${err.message}`);
  }
}

async function downloadSingleYoutubeTrack({
  url,
  requesterUserId,
  manualArtist,
  manualTitle,
  albumTitle,
  includeVideo = false,
  downloadMode = 'single',
  onProgress = null,
  jobId = null
}) {
  if (!fs.existsSync(YTDLP_PATH)) {
    throw new Error(`yt-dlp nao encontrado em ${YTDLP_PATH}`);
  }

  const id = generateId();
  const prefix = `yt-${id}`;
  const baseFile = path.join(opusDir, prefix);
  const finalFile = `${baseFile}.opus`;
  const videoId = getVideoId(url);

  let metadata = {
    id: videoId || '',
    title: '',
    track: '',
    artist: '',
    uploader: '',
    creator: '',
    channel: '',
    fullTitle: '',
    altTitle: ''
  };
  const isVideoOnlyDownload = downloadMode === 'video';
  const shouldKeepVideo = includeVideo || isVideoOnlyDownload;

  try {
    const preFetchedMetadata = await fetchYoutubeSingleMetadata(url, jobId);
    metadata = {
      ...metadata,
      ...(preFetchedMetadata || {})
    };
    addLog(
      `[meta] Metadados resolvidos | titulo=${metadata.title || 'n/d'} | artista=${
        metadata.artist || metadata.creator || metadata.channel || metadata.uploader || 'n/d'
      }`
    );
  } catch (err) {
    addLog(`[warn] Falha ao consultar metadados antes do download: ${err.message}`);
  }

  if (!isVideoOnlyDownload) {
    const args = getYtDlpSingleArgs(url, baseFile);
    if (typeof onProgress === 'function') {
      onProgress({ stage: 'audio-download', progress: 4, message: 'Preparando download de audio' });
    }

    await robustDownload(
    async (attempt) => {
      await cleanupGeneratedFilesByPrefix(prefix);

      await new Promise((resolve, reject) => {
        addLog(`🎯 yt-dlp iniciado | tentativa=${attempt} | bin=${YTDLP_PATH} | url=${url}`);

        const ytdlp = spawnManagedProcess(jobId, YTDLP_PATH, args, {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderrBuffer = '';
        ytdlp.stdout.on('data', (data) => {
          const text = data.toString();
          const lines = text.split(/\r?\n/).filter(Boolean);

          for (const line of lines) {
            addLog(`📄 yt-dlp: ${line}`);

            const progress = parseProgressPercent(line);
            if (progress !== null && typeof onProgress === 'function') {
              onProgress({
                stage: 'audio-download',
                progress: Math.min(68, 6 + progress * 0.62),
                message: line
              });
            }

          }
        });

        ytdlp.stderr.on('data', (data) => {
          const chunk = data.toString();
          stderrBuffer += chunk;

          const lines = chunk.split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            addLog(`⚠️ yt-dlp: ${line}`);
            const progress = parseProgressPercent(line);
            if (progress !== null && typeof onProgress === 'function') {
              onProgress({
                stage: 'audio-download',
                progress: Math.min(68, 6 + progress * 0.62),
                message: line
              });
            }
          }
        });

        ytdlp.on('error', (err) => {
          reject(new Error(`Falha ao iniciar yt-dlp: ${err.message}`));
        });

        ytdlp.on('close', (code) => {
          try {
            assertJobNotPaused(jobId);
          } catch (error) {
            return reject(error);
          }

          const files = fs
            .readdirSync(opusDir)
            .filter((file) => file.startsWith(prefix))
            .sort();

          if (files.length > 0) {
            return resolve();
          }

          if (code !== 0) {
            const stderrSummary = stderrBuffer
              .split(/\r?\n/)
              .filter(Boolean)
              .slice(-6)
              .join(' | ');

            return reject(
              new Error(
                `Erro no download do YouTube (code ${code})${stderrSummary ? `: ${stderrSummary}` : ''}`
              )
            );
          }

          if (!metadata.title && !metadata.track && !metadata.fullTitle) {
            return reject(new Error('yt-dlp finalizou sem gerar metadados nem arquivo'));
          }

          reject(new Error('Arquivo de audio nao foi gerado'));
        });
      });
    },
      5,
      3000
    );
  } else if (typeof onProgress === 'function') {
    onProgress({ stage: 'video-download', progress: 8, message: 'Preparando download de video' });
  }

  if (!isVideoOnlyDownload) {
    const files = fs
      .readdirSync(opusDir)
      .filter((file) => file.startsWith(prefix))
      .sort((a, b) => a.localeCompare(b));

    if (!files.length) {
      throw new Error('Arquivo de audio nao foi gerado');
    }

    const sourceCandidates = files
      .map((file) => path.join(opusDir, file))
      .filter((file) => path.resolve(file) !== path.resolve(finalFile));
    const sourceFile =
      sourceCandidates.find((file) => /\.(webm|m4a|mp4|mp3|ogg|opus)$/i.test(file)) || sourceCandidates[0];

    if (!sourceFile || !fs.existsSync(sourceFile)) {
      throw new Error('Arquivo bruto do YouTube nao foi localizado para conversao');
    }

    cleanupFileIfExists(finalFile);
    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'convert',
        progress: shouldKeepVideo ? 74 : 100,
        message: 'Convertendo audio para OPUS 16k'
      });
    }
    addLog(`[convert] Iniciando conversao para OPUS 16k | origem=${path.basename(sourceFile)}`);
    await convertToOpus(sourceFile, finalFile, jobId);
    cleanupFileIfExists(sourceFile);

    const leftovers = fs
      .readdirSync(opusDir)
      .filter((file) => file.startsWith(prefix) && path.resolve(path.join(opusDir, file)) !== path.resolve(finalFile));
    leftovers.forEach((file) => cleanupFileIfExists(path.join(opusDir, file)));

    if (!fs.existsSync(finalFile)) {
      throw new Error('Arquivo OPUS final nao foi gerado');
    }
  }

  let finalVideoFile = null;
  if (shouldKeepVideo) {
    if (typeof onProgress === 'function') {
      onProgress({ stage: 'video-download', progress: 84, message: 'Baixando video para o player' });
    }
    const videoPrefix = `${prefix}-video`;
    const videoBaseFile = path.join(videoDir, videoPrefix);
    const videoArgs = getYtDlpVideoArgs(url, videoBaseFile);

    await robustDownload(
      async (attempt) => {
        try {
          const files = fs.readdirSync(videoDir).filter((file) => file.startsWith(videoPrefix));
          files.forEach((file) => cleanupFileIfExists(path.join(videoDir, file)));
        } catch {}

        await new Promise((resolve, reject) => {
          addLog(`[video] yt-dlp video iniciado | tentativa=${attempt} | url=${url}`);
        const ytdlp = spawnManagedProcess(jobId, YTDLP_PATH, videoArgs, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
          });

          let stderrBuffer = '';

          ytdlp.stdout.on('data', (data) => {
            const text = data.toString();
            const lines = text.split(/\r?\n/).filter(Boolean);
            lines.forEach((line) => {
              addLog(`📄 yt-dlp video: ${line}`);
              const progress = parseProgressPercent(line);
              if (progress !== null && typeof onProgress === 'function') {
                onProgress({
                  stage: 'video-download',
                  progress: Math.min(98, 84 + progress * 0.14),
                  message: line
                });
              }
            });
          });

          ytdlp.stderr.on('data', (data) => {
            const text = data.toString();
            stderrBuffer += text;
            const lines = text.split(/\r?\n/).filter(Boolean);
            lines.forEach((line) => {
              addLog(`⚠️ yt-dlp video: ${line}`);
              const progress = parseProgressPercent(line);
              if (progress !== null && typeof onProgress === 'function') {
                onProgress({
                  stage: 'video-download',
                  progress: Math.min(98, 84 + progress * 0.14),
                  message: line
                });
              }
            });
          });

          ytdlp.on('error', (err) => reject(new Error(`Falha ao iniciar yt-dlp video: ${err.message}`)));

          ytdlp.on('close', (code) => {
            try {
              assertJobNotPaused(jobId);
            } catch (error) {
              return reject(error);
            }

            const generated = fs
              .readdirSync(videoDir)
              .filter((file) => file.startsWith(videoPrefix))
              .map((file) => path.join(videoDir, file))
              .filter((file) => fs.existsSync(file));

            if (generated.length > 0) {
              [finalVideoFile] = generated.sort((a, b) => a.localeCompare(b));
              return resolve();
            }

            if (code !== 0) {
              const stderrSummary = stderrBuffer
                .split(/\r?\n/)
                .filter(Boolean)
                .slice(-4)
                .join(' | ');
              return reject(
                new Error(`Erro no download do video (code ${code})${stderrSummary ? `: ${stderrSummary}` : ''}`)
              );
            }

            return reject(new Error('Arquivo de video nao foi gerado'));
          });
        });
      },
      2,
      1500
    );

    if (finalVideoFile && fs.existsSync(finalVideoFile)) {
      const normalizedVideoFile = path.join(videoDir, `${videoPrefix}-final.mp4`);
      cleanupFileIfExists(normalizedVideoFile);

      if (typeof onProgress === 'function') {
        onProgress({ stage: 'video-convert', progress: 96, message: 'Convertendo video para playback no Electron' });
      }

      await normalizeVideoForPlayback(finalVideoFile, normalizedVideoFile, jobId);
      cleanupFileIfExists(finalVideoFile);
      finalVideoFile = normalizedVideoFile;
    }
  }

  if (isVideoOnlyDownload) {
    if (!finalVideoFile || !fs.existsSync(finalVideoFile)) {
      throw new Error('Arquivo de video nao foi gerado');
    }

    cleanupFileIfExists(finalFile);
    if (typeof onProgress === 'function') {
      onProgress({ stage: 'convert', progress: 96, message: 'Extraindo audio interno do video' });
    }
    addLog(`[convert] Extraindo trilha de audio do video | origem=${path.basename(finalVideoFile)}`);
    await convertToOpus(finalVideoFile, finalFile, jobId);

    if (!fs.existsSync(finalFile)) {
      throw new Error('Arquivo OPUS final nao foi gerado a partir do video');
    }
  }

  const resolvedMetadata = resolveYoutubeTrackMetadata(metadata, videoId || id);
  const resolvedTitle = cleanYoutubeMetadataText(
    manualTitle || resolvedMetadata.title || metadata.title || `YouTube ${videoId || id}`
  );
  const resolvedArtist = cleanYoutubeMetadataText(
    manualArtist || resolvedMetadata.artist || metadata.artist || metadata.creator || metadata.channel || metadata.uploader
  );

  const newMusic = {
    id,
    title: resolvedTitle,
    artist: looksGenericYoutubeArtist(resolvedArtist) ? null : resolvedArtist || null,
    albumTitle: cleanMetadataText(albumTitle || ''),
    thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/0.jpg` : null,
    path: finalFile,
    audioMimeType: getMediaContentType(finalFile),
    videoPath: finalVideoFile,
    videoMimeType: finalVideoFile ? getMediaContentType(finalVideoFile) : null,
    createdAt: new Date().toISOString(),
    source: 'youtube',
    favorite: false,
    favoritedByUserIds: requesterUserId ? [String(requesterUserId)] : [],
    youtubeUrl: url,
    uploadedByUserId: requesterUserId || null,
    ownerUserId: null
  };

  db.musicLibrary.unshift(normalizeMusicRecord(newMusic));
  saveDb();

  addLog(`✅ Música adicionada: ${newMusic.title}`);

  if (typeof onProgress === 'function') {
    onProgress({
      stage: 'done',
      progress: 100,
      message: isVideoOnlyDownload ? 'Video concluido' : shouldKeepVideo ? 'Audio e video concluidos' : 'Faixa concluida'
    });
  }

  return newMusic;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runNext() {
    const currentIndex = index;
    index += 1;

    if (currentIndex >= items.length) return;

    results[currentIndex] = await worker(items[currentIndex], currentIndex);
    await runNext();
  }

  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () =>
    runNext()
  );
  await Promise.all(runners);
  return results;
}

async function downloadYoutubePlaylist({
  url,
  requesterUserId,
  manualArtist,
  manualTitle,
  playlistTitleOverride,
  targetPlaylistId = null,
  includeVideo = false,
  onTrackProgress = null,
  jobId = null,
  existingItems = []
}) {
  const { playlistJson, entries } = await fetchYoutubePlaylistData(url, jobId);

  if (!entries.length) {
    throw new Error('Nenhuma faixa valida foi encontrada na playlist');
  }

  const playlistTitle = cleanMetadataText(
    playlistTitleOverride ||
      playlistJson?.title ||
      playlistJson?.playlist_title ||
      playlistJson?.channel ||
      'Playlist importada'
  );

  addLog(`[playlist] ${playlistTitle} | faixas=${entries.length}`);

  const concurrency = Math.max(1, Math.min(3, os.cpus()?.length >= 8 ? 3 : 2, entries.length));
  addLog(`[download] Iniciando importacao paralela | concorrencia=${concurrency}`);

  const playlist = ensureAutomaticPlaylist({
    playlistId: targetPlaylistId,
    playlistTitle,
    requesterUserId
  });
  const existingItemsByIndex = new Map(
    Array.isArray(existingItems) ? existingItems.map((item) => [Number(item.index), item]) : []
  );
  const completed = [];
  const skippedEntries = [];

  await mapWithConcurrency(entries, concurrency, async (entry, index) => {
    try {
      assertJobNotPaused(jobId);
      const existingItem = existingItemsByIndex.get(index);
      if (existingItem?.status === 'completed') {
        const existingSong = findMusicByYoutubeUrl(entry.url);
        if (existingSong) {
          appendSongToPlaylist(playlist.id, existingSong.id);
          completed.push(existingSong);
        }
        if (typeof onTrackProgress === 'function') {
          onTrackProgress(index, {
            title: existingItem.title || entry.title || entry.id || `Faixa ${index + 1}`,
            status: 'completed',
            stage: 'done',
            progress: 100,
            message: 'Faixa ja concluida anteriormente'
          });
        }
        return existingSong || null;
      }

      addLog(
        `[download] ${index + 1}/${entries.length} | iniciando ${entry.title || entry.id || 'faixa'}`
      );
      if (typeof onTrackProgress === 'function') {
        onTrackProgress(index, {
          title: entry.title || entry.id || `Faixa ${index + 1}`,
          status: 'running',
          stage: 'audio-download',
          progress: 4,
          message: `Iniciando ${entry.title || entry.id || 'faixa'}`
        });
      }

      const song = await downloadSingleYoutubeTrack({
        url: entry.url,
        requesterUserId,
        manualArtist,
        manualTitle: null,
        albumTitle: playlistTitle,
        includeVideo,
        jobId,
        onProgress: (patch) => {
          if (typeof onTrackProgress === 'function') {
            onTrackProgress(index, {
              ...patch,
              title: entry.title || entry.id || `Faixa ${index + 1}`,
              status: patch.stage === 'done' ? 'completed' : 'running'
            });
          }
        }
      });

      completed.push(song);
      appendSongToPlaylist(playlist.id, song.id);
      addLog(`[download] ${index + 1}/${entries.length} | concluido ${song.title}`);
      if (typeof onTrackProgress === 'function') {
        onTrackProgress(index, {
          title: song.title,
          status: 'completed',
          stage: 'done',
          progress: 100,
          message: `${song.title} concluida`
        });
      }
      return song;
    } catch (error) {
      if (isDownloadControlError(error, 'JOB_PAUSED')) {
        if (typeof onTrackProgress === 'function') {
          onTrackProgress(index, {
            title: entry.title || entry.id || `Faixa ${index + 1}`,
            status: 'paused',
            stage: 'paused',
            progress: 0,
            message: 'Faixa pausada'
          });
        }
        throw error;
      }

      const reason = error?.message || 'Erro desconhecido';
      skippedEntries.push({
        index: index + 1,
        title: entry.title || null,
        url: entry.url,
        error: reason
      });
      addLog(`[warn] ${index + 1}/${entries.length} | ignorada ${entry.title || entry.url} | ${reason}`);
      if (typeof onTrackProgress === 'function') {
        onTrackProgress(index, {
          title: entry.title || entry.id || `Faixa ${index + 1}`,
          status: 'error',
          stage: 'error',
          progress: 100,
          message: reason,
          error: reason
        });
      }
      return null;
    }
  });

  const playlistAfter = findPlaylistById(playlist.id) || playlist;

  if (!completed.length && !(playlistAfter.musicIds || []).length) {
    throw new Error('Nenhuma faixa da playlist foi baixada com sucesso');
  }

  playlistAfter.updatedAt = new Date().toISOString();
  saveDb();

  addLog(
    `[playlist] Finalizada ${playlistAfter.name} | baixadas=${completed.length} | ignoradas=${skippedEntries.length}`
  );

  return {
    playlist: playlistAfter,
    songs: completed,
    skippedEntries
  };
}

function findUserById(id) {
  return db.users.find((user) => String(user.id) === String(id));
}

function findUserByLogin(login) {
  return db.users.find(
    (user) => String(user.login || '').toLowerCase() === String(login || '').toLowerCase()
  );
}

function findUserByEmail(email) {
  return db.users.find(
    (user) => String(user.email || '').toLowerCase() === String(email || '').toLowerCase()
  );
}

function getScopedMusicLibrary(userId, section = 'library') {
  const normalizedLibrary = db.musicLibrary.map((music) => normalizeMusicRecord(music));

  if (section === 'explore') {
    return normalizedLibrary.map((music) => serializeMusicForUser(music, userId));
  }

  if (!userId) {
    return normalizedLibrary.map((music) => serializeMusicForUser(music, null));
  }

  if (section === 'favorites') {
    return normalizedLibrary
      .filter((music) => isMusicFavoritedByUser(music, userId))
      .map((music) => serializeMusicForUser(music, userId));
  }

  return normalizedLibrary
    .filter((music) => music.ownerUserId === userId || isMusicFavoritedByUser(music, userId))
    .map((music) => serializeMusicForUser(music, userId));
}

function getScopedPlaylists(userId) {
  if (!userId) return db.playlists;
  return db.playlists.filter((playlist) => playlist.ownerUserId === userId);
}

function findMusicById(id) {
  return db.musicLibrary.find((m) => String(m.id) === String(id));
}

function findPlaylistById(id) {
  return db.playlists.find((p) => String(p.id) === String(id));
}

function findMusicByYoutubeUrl(url) {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) return null;

  return (
    db.musicLibrary.find((song) => String(song.youtubeUrl || '').trim() === normalizedUrl) || null
  );
}

function appendSongToPlaylist(playlistId, songId) {
  const playlist = findPlaylistById(playlistId);
  if (!playlist) return null;

  if (!Array.isArray(playlist.musicIds)) {
    playlist.musicIds = [];
  }

  if (!playlist.musicIds.includes(songId)) {
    playlist.musicIds.push(songId);
    playlist.updatedAt = new Date().toISOString();
    saveDb();
  }

  return playlist;
}

function ensureAutomaticPlaylist({ playlistId = null, playlistTitle, requesterUserId = null }) {
  const existingPlaylist = playlistId ? findPlaylistById(playlistId) : null;
  if (existingPlaylist) {
    return existingPlaylist;
  }

  const playlist = {
    id: generateId(),
    name: cleanMetadataText(playlistTitle || 'Playlist importada'),
    ownerUserId: requesterUserId || null,
    musicIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.playlists.unshift(playlist);
  saveDb();
  return playlist;
}

function getMediaContentType(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();

  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mkv') return 'video/x-matroska';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg' || ext === '.opus') return 'audio/ogg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.flac') return 'audio/flac';

  return 'application/octet-stream';
}

async function fetchYoutubePlaylistData(playlistUrl, jobId = null) {
  if (!fs.existsSync(YTDLP_PATH)) {
    throw new Error(`yt-dlp nao encontrado em ${YTDLP_PATH}`);
  }

  const canonicalPlaylistUrl = getYoutubePlaylistUrl(playlistUrl);

  const attempts = [
    {
      label: 'rapida',
      args: [
        canonicalPlaylistUrl,
        '--flat-playlist',
        '--dump-single-json',
        '--ignore-errors',
        '--no-abort-on-error',
        '--retries',
        '50',
        '--extractor-retries',
        '50',
        '--socket-timeout',
        '30',
        '--no-check-certificate',
        '--yes-playlist'
      ]
    },
    {
      label: 'fallback',
      args: [
        canonicalPlaylistUrl,
        '--flat-playlist',
        '--dump-single-json',
        '--ignore-errors',
        '--no-abort-on-error',
        '--lazy-playlist',
        '--retries',
        '50',
        '--extractor-retries',
        '50',
        '--socket-timeout',
        '30',
        '--no-check-certificate',
        '--yes-playlist'
      ]
    }
  ];

  attempts.forEach((attempt) => {
    attempt.args = appendYtDlpCookieFileArgs(attempt.args);
  });

  if (fs.existsSync(NODE_RUNTIME_PATH)) {
    attempts[0].args.splice(1, 0, '--js-runtimes', `node:${NODE_RUNTIME_PATH}`);
  }

  let lastError = null;

  for (const attempt of attempts) {
    try {
      addLog(`📚 Consulta playlist (${attempt.label}) iniciada`);

      const raw = await robustDownload(
        () =>
          new Promise((resolve, reject) => {
            const ytdlp = spawnManagedProcess(jobId, YTDLP_PATH, attempt.args, {
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';
            let settled = false;
            const timeout = setTimeout(() => {
              if (settled) return;
              settled = true;
              ytdlp.kill('SIGKILL');
              reject(new Error(`Timeout na leitura da playlist (${attempt.label})`));
            }, attempt.label === 'rapida' ? 8000 : 12000);

            ytdlp.stdout.on('data', (data) => {
              stdout += data.toString();
            });

            ytdlp.stderr.on('data', (data) => {
              const text = data.toString();
              stderr += text;

              const lines = text.split(/\r?\n/).filter(Boolean);
              for (const line of lines) {
                addLog(`⚠️ yt-dlp playlist: ${line}`);
              }
            });

            ytdlp.on('error', (err) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              reject(new Error(`Falha ao iniciar yt-dlp playlist: ${err.message}`));
            });

            ytdlp.on('close', (code) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              try {
                assertJobNotPaused(jobId);
              } catch (error) {
                return reject(error);
              }
              if (code !== 0 && !stdout.trim()) {
                return reject(new Error(stderr || `Erro na leitura da playlist (code ${code})`));
              }
              resolve(stdout);
            });
          }),
        3,
        2000
      );

      const playlistJson = JSON.parse(String(raw || '{}'));
      const rawEntries = Array.isArray(playlistJson.entries) ? playlistJson.entries : [];
      const seen = new Set();

      const entries = rawEntries
        .map((entry) => {
          const videoId = String(entry?.id || '').trim();
          const url = getYoutubeWatchUrl(entry?.url || videoId);
          const title = cleanMetadataText(entry?.title || videoId || 'faixa sem titulo');

          return {
            id: videoId || null,
            url,
            title
          };
        })
        .filter((entry) => {
          const key = entry.id || entry.url;
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });

      return {
        playlistJson,
        entries
      };
    } catch (error) {
      lastError = error;
      addLog(`⚠️ Falha na consulta playlist (${attempt.label}): ${error.message}`);
    }
  }

  throw lastError || new Error('Nao foi possivel consultar a playlist do YouTube');
}

async function convertToOpus(inputPath, outputPath, jobId = null) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-map_metadata',
      '-1',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'libopus',
      '-b:a',
      '16k',
      '-application',
      'audio',
      '-vbr',
      'off',
      '-compression_level',
      '10',
      outputPath
    ];

    addLog('[convert] Convertendo para OPUS 16k mono...');
    const ffmpeg = spawnManagedProcess(jobId, FFMPEG_PATH, args, { windowsHide: true });

    ffmpeg.stdout.on('data', (data) => {
      const text = data.toString().trim();
      if (text) addLog(`📄 ffmpeg: ${text}`);
    });

    ffmpeg.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) addLog(`⚠️ ffmpeg: ${text}`);
    });

    ffmpeg.on('error', (err) => reject(err));

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg finalizou com código ${code}`));
      }

      if (!fs.existsSync(outputPath)) {
        return reject(new Error('Arquivo OPUS não gerado'));
      }

      resolve();
    });
  });
}

function streamMediaFile(req, res, filePath) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const contentType = getMediaContentType(filePath);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('ETag', `"${stat.size}-${Number(stat.mtimeMs)}"`);

  if (req.method === 'HEAD') {
    res.setHeader('Content-Length', fileSize);
    return res.status(200).end();
  }

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize
    });

    return stream.pipe(res);
  }

  res.setHeader('Content-Length', fileSize);
  fs.createReadStream(filePath).pipe(res);
}

// =============================
// MULTER
// =============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '.mp3');
    const base = safeFileName(path.basename(file.originalname || 'musica', ext));
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 250 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];
    const ext = path.extname(file.originalname || '').toLowerCase();

    if (!allowedExts.includes(ext)) {
      return cb(new Error('Formato não suportado'));
    }

    cb(null, true);
  }
});

// =============================
// ROOT
// =============================
app.get('/', (req, res) => {
  if (fs.existsSync(frontendDistDir)) {
    return res.sendFile(path.join(frontendDistDir, 'index.html'));
  }

  res.json({ ok: true, nome: 'MusFy Backend' });
});

// =============================
// USUÁRIOS
// =============================
app.get('/usuarios', (req, res) => {
  res.json(
    db.users.map((user) => ({
      id: user.id,
      nome: user.nome,
      login: user.login || null,
      email: user.email || null,
      criadoEm: user.criadoEm
    }))
  );
});

app.post('/usuarios', (req, res) => {
  try {
    const { nome, email } = req.body;

    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
    if (normalizedEmail && findUserByEmail(normalizedEmail)) {
      return res.status(409).json({ error: 'Já existe usuário com este email' });
    }

    const user = {
      id: generateId(),
      nome: String(nome).trim(),
      email: normalizedEmail,
      criadoEm: new Date().toISOString()
    };

    db.users.unshift(user);
    saveDb();
    addLog(`👤 Usuário criado: ${user.nome}`);

    res.status(201).json({ success: true, usuario: user });
  } catch (err) {
    addLog(`❌ Erro ao criar usuário: ${err.message}`);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

app.post('/auth/register', (req, res) => {
  try {
    const { nome, email, senha } = req.body;

    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    if (!senha || String(senha).trim().length < 3) {
      return res.status(400).json({ error: 'Senha deve ter ao menos 3 caracteres' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (findUserByEmail(normalizedEmail)) {
      return res.status(409).json({ error: 'Já existe usuário com este email' });
    }

    const user = {
      id: generateId(),
      nome: String(nome).trim(),
      email: normalizedEmail,
      senha: String(senha).trim(),
      criadoEm: new Date().toISOString()
    };

    db.users.unshift(user);
    saveDb();

    addLog(`👤 Usuário registrado: ${user.nome}`);

    res.status(201).json({
      success: true,
      usuario: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        criadoEm: user.criadoEm
      }
    });
  } catch (err) {
    addLog(`❌ Erro ao registrar usuário: ${err.message}`);
    res.status(500).json({ error: 'Erro ao registrar usuário' });
  }
});

app.post('/auth/login', (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    const user = findUserByEmail(email);
    if (!user || user.senha !== String(senha)) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    res.json({
      success: true,
      usuario: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        criadoEm: user.criadoEm
      }
    });
  } catch (err) {
    addLog(`❌ Erro ao autenticar usuário: ${err.message}`);
    res.status(500).json({ error: 'Erro ao autenticar usuário' });
  }
});

// =============================
// MÚSICAS - LISTAR
// =============================
app.get('/enviar-musica', (req, res) => {
  const userId = req.query.userId ? String(req.query.userId) : null;
  const section = req.query.section ? String(req.query.section) : 'library';
  res.json(getScopedMusicLibrary(userId, section));
});

app.get('/musicas', (req, res) => {
  const userId = req.query.userId ? String(req.query.userId) : null;
  const section = req.query.section ? String(req.query.section) : 'library';
  res.json(getScopedMusicLibrary(userId, section));
});

// =============================
// RECEBER MÚSICA LOCAL
// =============================
app.post('/receber-musica', upload.single('musica'), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ error: 'Arquivo obrigatório no campo "musica"' });
    }

    const inputPath = req.file.path;
    const originalName = req.file.originalname || 'musica.mp3';
    const titleBase = safeFileName(
      path.basename(originalName, path.extname(originalName))
    );

    const id = generateId();
    const outputPath = path.join(opusDir, `${id}.opus`);
    const ownerUserId = req.body.userId ? String(req.body.userId) : null;

    if (ownerUserId && !findUserById(ownerUserId)) {
      return res.status(400).json({ error: 'Usuário inválido' });
    }

    addLog(`📥 Upload recebido: ${originalName}`);

    await convertToOpus(inputPath, outputPath);

    const newMusic = {
      id,
      title: titleBase,
      artist: null,
      originalName,
      thumbnail: null,
      path: outputPath,
      createdAt: new Date().toISOString(),
      source: 'upload',
      favorite: false,
      uploadedByUserId: ownerUserId,
      ownerUserId
    };

    db.musicLibrary.unshift(normalizeMusicRecord(newMusic));
    saveDb();

    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    } catch (e) {
      addLog(`⚠️ Falha ao apagar upload temporário: ${e.message}`);
    }

    addLog(`✅ Música adicionada: ${newMusic.title}`);

    res.status(201).json({
      success: true,
      music: serializeMusicForUser(newMusic, ownerUserId)
    });
  } catch (err) {
    addLog(`❌ Erro em /receber-musica: ${err.message}`);
    res.status(500).json({ error: err.message || 'Erro ao receber música' });
  }
});

// =============================
// BAIXAR DO YOUTUBE
// =============================
app.post('/baixar-youtube/analisar', async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();

    if (!url) {
      return res.status(400).json({ error: 'URL obrigatoria' });
    }

    addLog(`[inspect] Analisando link do YouTube | url=${url}`);
    const analysis = await inspectYoutubeUrl(url);

    return res.json({
      success: true,
      analysis
    });
  } catch (err) {
    addLog(`[error] Falha ao analisar link do YouTube: ${err.message}`);
    return res.status(500).json({ error: err.message || 'Falha ao analisar link do YouTube' });
  }
});

app.post('/baixar-youtube', async (req, res, next) => {
  try {
    const url = String(req.body?.url || '').trim();
    const userId = req.body?.userId ? String(req.body.userId) : null;
    const requestedMode = String(req.body?.mode || '').trim().toLowerCase();
    const targetPlaylistId = req.body?.targetPlaylistId ? String(req.body.targetPlaylistId) : null;
    const manualArtist = String(req.body?.artist || '').trim() || null;
    const manualTitle = String(req.body?.title || '').trim() || null;
    const includeVideo = Boolean(req.body?.includeVideo);

    if (!url) {
      return res.status(400).json({ error: 'URL obrigatoria' });
    }

    if (userId && !findUserById(userId)) {
      return res.status(400).json({ error: 'Usuario invalido' });
    }

    if (targetPlaylistId) {
      const targetPlaylist = findPlaylistById(targetPlaylistId);
      if (!targetPlaylist) {
        return res.status(400).json({ error: 'Playlist de destino invalida' });
      }
      if (userId && targetPlaylist.ownerUserId && String(targetPlaylist.ownerUserId) !== String(userId)) {
        return res.status(403).json({ error: 'Playlist de destino nao pertence ao usuario ativo' });
      }
    }

    const job = createDownloadJob({
      url,
      userId,
      mode: requestedMode || 'auto',
      includeVideo,
      title: manualTitle || null,
      artist: manualArtist || null,
      targetPlaylistId,
      playlistTitle: req.body?.playlistTitle ? String(req.body.playlistTitle).trim() : null,
      status: 'queued',
      stage: 'queued',
      progress: 0,
      message: 'Aguardando inicio'
    });

    if (req.body?.enqueue === true) {
      void processQueuedDownloadJobs();
      return res.status(202).json({ success: true, queued: true, job });
    }

    const result = await executeDownloadJob(job.id);
    if (result?.paused) {
      return res.status(409).json({ error: 'Download pausado pelo usuario.', jobId: job.id, paused: true });
    }

    return res.json(result);
  } catch (err) {
    addLog(`[error] Erro em /baixar-youtube: ${err.message}`);
    return res.status(500).json({ error: err.message || 'Erro ao baixar audio do YouTube' });
  }
});

app.post('/baixar-youtube-legacy', async (req, res) => {
  return res.status(410).json({
    error: 'Endpoint legado desativado. Use /baixar-youtube para o fluxo embarcado sem Python.'
  });
});

// =============================
// REPRODUZIR
// =============================
app.get('/reproduzir-musica/:id', (req, res) => {
  try {
    const music = findMusicById(req.params.id);

    if (!music || !music.path || !fs.existsSync(music.path)) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }

    streamMediaFile(req, res, music.path);
  } catch (err) {
    addLog(`❌ Erro ao reproduzir música: ${err.message}`);
    res.status(500).json({ error: 'Erro ao reproduzir música' });
  }
});

app.get('/reproduzir-video/:id', (req, res) => {
  try {
    const music = findMusicById(req.params.id);

    if (!music || !music.videoPath || !fs.existsSync(music.videoPath)) {
      return res.status(404).json({ error: 'Video nao encontrado' });
    }

    streamMediaFile(req, res, music.videoPath);
  } catch (err) {
    addLog(`Erro ao reproduzir video: ${err.message}`);
    res.status(500).json({ error: 'Erro ao reproduzir video' });
  }
});

// =============================
// DOWNLOAD OFFLINE
// =============================
app.get('/download-musica/:id', (req, res) => {
  try {
    const music = findMusicById(req.params.id);

    if (!music || !music.path || !fs.existsSync(music.path)) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }

    const extension = path.extname(music.path || '') || '.bin';
    const downloadName = `${safeFileName(music.title || 'musica')}${extension}`;

    res.setHeader('Content-Type', getMediaContentType(music.path));
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);

    fs.createReadStream(music.path).pipe(res);
  } catch (err) {
    addLog(`❌ Erro ao baixar música: ${err.message}`);
    res.status(500).json({ error: 'Erro ao baixar música' });
  }
});

app.get('/download-video/:id', (req, res) => {
  try {
    const music = findMusicById(req.params.id);

    if (!music || !music.videoPath || !fs.existsSync(music.videoPath)) {
      return res.status(404).json({ error: 'Video nao encontrado' });
    }

    const extension = path.extname(music.videoPath || '') || '.mp4';
    const downloadName = `${safeFileName(music.title || 'video')}${extension}`;

    res.setHeader('Content-Type', getMediaContentType(music.videoPath));
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);

    fs.createReadStream(music.videoPath).pipe(res);
  } catch (err) {
    addLog(`Erro ao baixar video: ${err.message}`);
    res.status(500).json({ error: 'Erro ao baixar video' });
  }
});

// =============================
// RENOMEAR MÚSICA
// =============================
app.patch('/musicas/:id', (req, res) => {
  try {
    const music = findMusicById(req.params.id);

    if (!music) {
      return res.status(404).json({ error: 'Música não encontrada' });
    }

    const { title } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Novo nome inválido' });
    }

    music.title = String(title).trim();
    music.updatedAt = new Date().toISOString();

    saveDb();
    addLog(`✏️ Música renomeada: ${music.id} -> ${music.title}`);

    res.json({ success: true, music });
  } catch (err) {
    addLog(`❌ Erro ao renomear música: ${err.message}`);
    res.status(500).json({ error: 'Erro ao renomear música' });
  }
});

// =============================
// FAVORITOS
// =============================
app.patch('/musicas/:id/favorito', (req, res) => {
  try {
    const music = findMusicById(req.params.id);

    if (!music) {
      return res.status(404).json({ error: 'Música não encontrada' });
    }

    const favorite =
      typeof req.body.favorite === 'boolean'
        ? req.body.favorite
        : !isMusicFavoritedByUser(music, req.body.userId ? String(req.body.userId) : null);
    const userId = req.body.userId ? String(req.body.userId) : null;

    if (userId && !findUserById(userId)) {
      return res.status(400).json({ error: 'Usuario invalido' });
    }

    if (!Array.isArray(music.favoritedByUserIds)) {
      music.favoritedByUserIds = [];
    }

    if (userId) {
      if (favorite) {
        if (!music.favoritedByUserIds.includes(userId)) {
          music.favoritedByUserIds.push(userId);
        }
      } else {
        music.favoritedByUserIds = music.favoritedByUserIds.filter((id) => id !== userId);
      }
    }

    music.favorite = favorite;
    music.updatedAt = new Date().toISOString();

    saveDb();
    addLog(`❤️ Favorito atualizado: ${music.title} -> ${favorite}`);

    res.json({ success: true, music: serializeMusicForUser(music, userId) });
  } catch (err) {
    addLog(`❌ Erro ao atualizar favorito: ${err.message}`);
    res.status(500).json({ error: 'Erro ao atualizar favorito' });
  }
});

// =============================
// EXCLUIR MÚSICA
// =============================
app.delete('/musicas/:id', (req, res) => {
  try {
    const index = db.musicLibrary.findIndex((m) => String(m.id) === String(req.params.id));

    if (index === -1) {
      return res.status(404).json({ error: 'Música não encontrada' });
    }

    const music = db.musicLibrary[index];
    const requesterUserId =
      req.query.userId ? String(req.query.userId) : req.body?.userId ? String(req.body.userId) : null;

    if (!requesterUserId || !findUserById(requesterUserId)) {
      return res.status(400).json({ error: 'Usuario invalido' });
    }

    const ownerId = music.uploadedByUserId || music.ownerUserId || null;
    if (!ownerId || String(ownerId) !== String(requesterUserId)) {
      return res.status(403).json({ error: 'Somente o usuario que baixou/enviou esta faixa pode removê-la da plataforma' });
    }

    if (music.path && fs.existsSync(music.path)) {
      try {
        fs.unlinkSync(music.path);
      } catch (e) {
        addLog(`⚠️ Falha ao remover arquivo físico: ${e.message}`);
      }
    }

    if (music.videoPath && fs.existsSync(music.videoPath)) {
      try {
        fs.unlinkSync(music.videoPath);
      } catch (e) {
        addLog(`⚠️ Falha ao remover arquivo de video: ${e.message}`);
      }
    }

    db.playlists = db.playlists.map((playlist) => ({
      ...playlist,
      musicIds: Array.isArray(playlist.musicIds)
        ? playlist.musicIds.filter((id) => id !== music.id)
        : []
    }));

    db.musicLibrary.splice(index, 1);
    saveDb();

    addLog(`🗑️ Música removida: ${music.title}`);
    res.json({ success: true, removed: music });
  } catch (err) {
    addLog(`❌ Erro ao excluir música: ${err.message}`);
    res.status(500).json({ error: 'Erro ao excluir música' });
  }
});

// =============================
// PLAYLISTS
// =============================
app.get('/playlists', (req, res) => {
  const userId = req.query.userId ? String(req.query.userId) : null;
  const scope = req.query.scope ? String(req.query.scope) : 'mine';
  const excludeUserId = req.query.excludeUserId ? String(req.query.excludeUserId) : null;

  const sourcePlaylists =
    scope === 'discover'
      ? db.playlists.filter(
          (playlist) =>
            Boolean(playlist.ownerUserId) &&
            playlist.ownerUserId !== excludeUserId &&
            (playlist.musicIds || []).length > 0
        )
      : getScopedPlaylists(userId);

  const playlistsWithSongs = sourcePlaylists.map((playlist) => serializePlaylistForUser(playlist, userId));

  res.json(playlistsWithSongs);
});

app.post('/playlists', (req, res) => {
  try {
    const { name, userId } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nome da playlist é obrigatório' });
    }

    const playlist = {
      id: generateId(),
      name: String(name).trim(),
      createdAt: new Date().toISOString(),
      musicIds: [],
      ownerUserId: userId ? String(userId) : null
    };

    db.playlists.unshift(playlist);
    saveDb();

    addLog(`🎼 Playlist criada: ${playlist.name}`);
    res.status(201).json({ success: true, playlist });
  } catch (err) {
    addLog(`❌ Erro ao criar playlist: ${err.message}`);
    res.status(500).json({ error: 'Erro ao criar playlist' });
  }
});

app.patch('/playlists/:id', (req, res) => {
  try {
    const playlist = findPlaylistById(req.params.id);

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist não encontrada' });
    }

    const { name } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nome inválido' });
    }

    playlist.name = String(name).trim();
    playlist.updatedAt = new Date().toISOString();

    saveDb();
    addLog(`🎼 Playlist renomeada: ${playlist.name}`);

    res.json({ success: true, playlist });
  } catch (err) {
    addLog(`❌ Erro ao editar playlist: ${err.message}`);
    res.status(500).json({ error: 'Erro ao editar playlist' });
  }
});

app.delete('/playlists/:id', (req, res) => {
  try {
    const index = db.playlists.findIndex((p) => String(p.id) === String(req.params.id));

    if (index === -1) {
      return res.status(404).json({ error: 'Playlist não encontrada' });
    }

    const removed = db.playlists[index];
    db.playlists.splice(index, 1);
    saveDb();

    addLog(`🗑️ Playlist removida: ${removed.name}`);
    res.json({ success: true, removed });
  } catch (err) {
    addLog(`❌ Erro ao excluir playlist: ${err.message}`);
    res.status(500).json({ error: 'Erro ao excluir playlist' });
  }
});

app.post('/playlists/:id/musicas', (req, res) => {
  try {
    const playlist = findPlaylistById(req.params.id);
    const { musicId } = req.body;

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist não encontrada' });
    }

    const music = findMusicById(musicId);
    if (!music) {
      return res.status(404).json({ error: 'Música não encontrada' });
    }

    if (!Array.isArray(playlist.musicIds)) playlist.musicIds = [];
    if (!playlist.musicIds.includes(musicId)) {
      playlist.musicIds.push(musicId);
    }

    playlist.updatedAt = new Date().toISOString();
    saveDb();

    addLog(`➕ Música adicionada à playlist ${playlist.name}: ${music.title}`);
    res.json({ success: true, playlist });
  } catch (err) {
    addLog(`❌ Erro ao adicionar música na playlist: ${err.message}`);
    res.status(500).json({ error: 'Erro ao adicionar música na playlist' });
  }
});

app.delete('/playlists/:id/musicas/:musicId', (req, res) => {
  try {
    const playlist = findPlaylistById(req.params.id);

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist não encontrada' });
    }

    playlist.musicIds = (playlist.musicIds || []).filter(
      (id) => String(id) !== String(req.params.musicId)
    );
    playlist.updatedAt = new Date().toISOString();

    saveDb();
    addLog(`➖ Música removida da playlist ${playlist.name}`);

    res.json({ success: true, playlist });
  } catch (err) {
    addLog(`❌ Erro ao remover música da playlist: ${err.message}`);
    res.status(500).json({ error: 'Erro ao remover música da playlist' });
  }
});

if (fs.existsSync(frontendDistDir)) {
  app.use(express.static(frontendDistDir));

  app.get(/^(?!\/(logs|devices|usuarios|auth|enviar-musica|musicas|receber-musica|baixar-youtube|reproduzir-musica|reproduzir-video|download-musica|download-video|playlists)).*/, (req, res) => {
    res.sendFile(path.join(frontendDistDir, 'index.html'));
  });
}

// =============================
// HANDLER DE ERROS
// =============================
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    addLog(`❌ MulterError: ${err.message}`);
    return res.status(400).json({ error: err.message });
  }

  if (err) {
    addLog(`❌ Erro geral: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }

  next();
});

// =============================
// START
// =============================
let httpServer = null;

function startServer() {
  if (httpServer) {
    return httpServer;
  }

  httpServer = app.listen(PORT, HOST, () => {
    addLog(`🔥 Backend rodando em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    addLog(`🎯 yt-dlp detectado em: ${YTDLP_PATH}`);
    addLog(`💾 Dados do MusFy em: ${runtimeRootDir}`);

    const networkAddresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
      .map((iface) => iface.address);

    networkAddresses.forEach((address) => {
      addLog(`🌐 Rede interna: http://${address}:${PORT}`);
    });
  });

  return httpServer;
}

function stopServer() {
  return new Promise((resolve, reject) => {
    if (!httpServer) {
      Promise.resolve(runtimeServices?.shutdown()).finally(resolve);
      return;
    }

    httpServer.close((err) => {
      if (err) {
        reject(err);
        return;
      }

      httpServer = null;
      Promise.resolve(runtimeServices?.shutdown())
        .then(() => resolve())
        .catch(reject);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  stopServer
};

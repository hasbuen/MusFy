const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const { spawn } = require('child_process');

let sqlJsModulePromise = null;

function loadSqlJsModule() {
  if (!sqlJsModulePromise) {
    sqlJsModulePromise = Promise.resolve().then(() => require('sql.js'));
  }

  return sqlJsModulePromise;
}

function createRuntimeServices({ runtimeRootDir, dataDir, emitLog }) {
  const sqliteDbPath = path.join(dataDir, 'musfy.sqlite');
  const redisWorkingDir = path.join(runtimeRootDir, 'redis');
  const externalRedisUrl = process.env.REDIS_URL ? String(process.env.REDIS_URL).trim() : '';

  let sqliteModule = null;
  let sqliteDb = null;
  let sqliteInitPromise = null;
  let sqliteErrorMessage = null;
  let embeddedRedisProcess = null;
  let embeddedRedisExitHandler = null;
  let embeddedRedisErrorMessage = null;
  let redisInitPromise = null;
  let activeRedisUrl = externalRedisUrl;
  let embeddedRedisInfo = externalRedisUrl
    ? { mode: 'external', url: externalRedisUrl, host: null, port: null, binaryPath: null }
    : { mode: 'disabled', url: null, host: null, port: null, binaryPath: null };

  fs.mkdirSync(redisWorkingDir, { recursive: true });

  function log(message) {
    if (typeof emitLog === 'function') {
      emitLog(message);
      return;
    }

    console.log(`[runtime] ${message}`);
  }

  function resolveSqliteWasmPath() {
    const packageEntry = require.resolve('sql.js');
    const packageDir = path.dirname(packageEntry);
    const candidates = [
      path.join(packageDir, 'sql-wasm.wasm'),
      path.join(packageDir, 'dist', 'sql-wasm.wasm'),
      path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return 'sql-wasm.wasm';
  }

  function isSqliteCorruptionError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return (
      message.includes('file is not a database') ||
      message.includes('database disk image is malformed') ||
      message.includes('not a database')
    );
  }

  function backupCorruptedSqlite(error) {
    if (!fs.existsSync(sqliteDbPath)) {
      return false;
    }

    const backupPath = `${sqliteDbPath}.corrupt-${Date.now()}`;
    fs.renameSync(sqliteDbPath, backupPath);
    log(`[sqlite] Banco auxiliar corrompido movido para ${backupPath}: ${error.message}`);
    return true;
  }

  function markEmbeddedRedisStopped(code, signal) {
    embeddedRedisProcess = null;
    activeRedisUrl = externalRedisUrl || null;
    embeddedRedisErrorMessage =
      code !== null && code !== undefined
        ? `Redis embarcado encerrou com codigo ${code}`
        : signal
          ? `Redis embarcado encerrado por sinal ${signal}`
          : 'Redis embarcado encerrou sem detalhe';
    embeddedRedisInfo = {
      mode: externalRedisUrl ? 'external' : 'error',
      url: activeRedisUrl || null,
      host: null,
      port: null,
      binaryPath: embeddedRedisInfo?.binaryPath || resolveEmbeddedRedisBinaryPath(),
      error: embeddedRedisErrorMessage
    };
    log(`[redis] ${embeddedRedisErrorMessage}`);
  }

  function persistSqlite() {
    if (!sqliteDb) return;
    const binary = sqliteDb.export();
    fs.writeFileSync(sqliteDbPath, Buffer.from(binary));
  }

  function runSqliteMigrations() {
    sqliteDb.run(`
      CREATE TABLE IF NOT EXISTS youtube_search_cache (
        query_key TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        cached_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS youtube_search_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        source TEXT,
        result_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS download_jobs (
        job_id TEXT PRIMARY KEY,
        status TEXT,
        stage TEXT,
        progress REAL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS service_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        payload TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  async function ensureSqliteReady() {
    if (sqliteDb) {
      return sqliteDb;
    }

    if (!sqliteInitPromise) {
      sqliteInitPromise = loadSqlJsModule()
        .then((initSqlJs) =>
          initSqlJs({
            locateFile: () => resolveSqliteWasmPath()
          })
        )
        .then((SQL) => {
          sqliteModule = SQL;
          const initialBuffer = fs.existsSync(sqliteDbPath) ? fs.readFileSync(sqliteDbPath) : null;
          try {
            sqliteDb = initialBuffer?.length ? new sqliteModule.Database(initialBuffer) : new sqliteModule.Database();
          } catch (error) {
            if (!initialBuffer?.length || !isSqliteCorruptionError(error)) {
              throw error;
            }

            backupCorruptedSqlite(error);
            sqliteDb = new sqliteModule.Database();
          }
          runSqliteMigrations();
          persistSqlite();
          sqliteErrorMessage = null;
          return sqliteDb;
        })
        .catch((error) => {
          sqliteInitPromise = null;
          sqliteErrorMessage = error.message;
          throw error;
        });
    }

    return sqliteInitPromise;
  }

  async function withSqlite(handler, fallbackValue = null) {
    try {
      const db = await ensureSqliteReady();
      return await handler(db);
    } catch (error) {
      console.error('[runtime-services] SQLite failure:', error);
      return fallbackValue;
    }
  }

  async function saveYoutubeSearchCache(key, cacheEntry) {
    return withSqlite((db) => {
      db.run(
        `INSERT OR REPLACE INTO youtube_search_cache (query_key, query, cached_at, payload)
         VALUES (?, ?, ?, ?)`,
        [key, cacheEntry.query, cacheEntry.cachedAt, JSON.stringify(cacheEntry)]
      );
      persistSqlite();
      return true;
    }, false);
  }

  async function getYoutubeSearchCache(key) {
    return withSqlite((db) => {
      const stmt = db.prepare(
        'SELECT payload FROM youtube_search_cache WHERE query_key = ? LIMIT 1',
        [key]
      );

      try {
        if (!stmt.step()) {
          return null;
        }

        const row = stmt.getAsObject();
        return row?.payload ? JSON.parse(String(row.payload)) : null;
      } finally {
        stmt.free();
      }
    }, null);
  }

  async function recordYoutubeSearchRequest(query, source, resultCount) {
    return withSqlite((db) => {
      db.run(
        `INSERT INTO youtube_search_history (query, source, result_count, created_at)
         VALUES (?, ?, ?, ?)`,
        [query, source || null, Number(resultCount || 0), new Date().toISOString()]
      );
      persistSqlite();
      return true;
    }, false);
  }

  async function getRecentYoutubeSearches(limit = 8) {
    return withSqlite((db) => {
      const stmt = db.prepare(
        `SELECT query,
                MAX(created_at) AS lastSearchedAt,
                COUNT(*) AS totalHits,
                MAX(source) AS lastSource
         FROM youtube_search_history
         GROUP BY query
         ORDER BY lastSearchedAt DESC
         LIMIT ?`,
        [Number(limit || 8)]
      );

      const rows = [];
      try {
        while (stmt.step()) {
          const row = stmt.getAsObject();
          rows.push({
            query: String(row.query || ''),
            lastSearchedAt: String(row.lastSearchedAt || ''),
            totalHits: Number(row.totalHits || 0),
            lastSource: row.lastSource ? String(row.lastSource) : null
          });
        }
      } finally {
        stmt.free();
      }

      return rows;
    }, []);
  }

  async function persistDownloadJob(job) {
    if (!job?.id) return false;

    return withSqlite((db) => {
      db.run(
        `INSERT OR REPLACE INTO download_jobs (job_id, status, stage, progress, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          job.id,
          job.status || null,
          job.stage || null,
          Number(job.progress || 0),
          JSON.stringify(job),
          job.updatedAt || new Date().toISOString()
        ]
      );
      persistSqlite();
      return true;
    }, false);
  }

  async function restoreDownloadJobs(limit = 20) {
    return withSqlite((db) => {
      const stmt = db.prepare(
        `SELECT payload
         FROM download_jobs
         ORDER BY updated_at DESC
         LIMIT ?`,
        [Number(limit || 20)]
      );

      const rows = [];
      try {
        while (stmt.step()) {
          const row = stmt.getAsObject();
          if (row?.payload) {
            rows.push(JSON.parse(String(row.payload)));
          }
        }
      } finally {
        stmt.free();
      }

      return rows;
    }, []);
  }

  async function recordServiceEvent(category, message, payload = null) {
    return withSqlite((db) => {
      db.run(
        `INSERT INTO service_events (category, message, payload, created_at)
         VALUES (?, ?, ?, ?)`,
        [category || 'runtime', message, payload ? JSON.stringify(payload) : null, new Date().toISOString()]
      );
      persistSqlite();
      return true;
    }, false);
  }

  function resolveEmbeddedRedisBinaryPath() {
    const binaryName = process.platform === 'win32' ? 'memurai.exe' : 'redis-server';
    const candidates = [
      path.join(__dirname, 'bin', 'redis', binaryName),
      path.join(process.cwd(), 'bin', 'redis', binaryName)
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0];
  }

  function getFreePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        server.close(() => resolve(port));
      });
    });
  }

  function readRedisLogTail(redisLogPath) {
    try {
      if (!fs.existsSync(redisLogPath)) return '';
      const content = fs.readFileSync(redisLogPath, 'utf8');
      return content.slice(-4000);
    } catch (_error) {
      return '';
    }
  }

  function cleanupRedisPersistence(redisLogPath) {
    const targets = [
      path.join(redisWorkingDir, 'appendonlydir'),
      path.join(redisWorkingDir, 'musfy-cache.rdb'),
      path.join(redisWorkingDir, 'musfy-cache.aof'),
      redisLogPath
    ];

    for (const target of targets) {
      try {
        if (!fs.existsSync(target)) continue;
        fs.rmSync(target, { recursive: true, force: true });
      } catch (_error) {
        // ignora
      }
    }
  }

  async function ensureRedisReady(allowRecovery = true) {
    if (redisInitPromise) {
      return redisInitPromise;
    }

    if (activeRedisUrl) {
      if (embeddedRedisInfo?.mode === 'external') {
        return activeRedisUrl;
      }

      if (embeddedRedisProcess && embeddedRedisProcess.exitCode === null) {
        return activeRedisUrl;
      }

      activeRedisUrl = externalRedisUrl || null;
      embeddedRedisProcess = null;
      if (externalRedisUrl) {
        embeddedRedisInfo = { mode: 'external', url: externalRedisUrl, host: null, port: null, binaryPath: null };
        return activeRedisUrl;
      }
    }

    if (embeddedRedisProcess && embeddedRedisProcess.exitCode === null) {
      return activeRedisUrl;
    }

    embeddedRedisProcess = null;

    const binaryPath = resolveEmbeddedRedisBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      embeddedRedisInfo = { mode: 'missing', url: null, host: null, port: null, binaryPath };
      log(`[redis] Binario embarcado nao encontrado em ${binaryPath}`);
      return null;
    }

    const port = await getFreePort();
    const host = '127.0.0.1';
    const redisLogPath = path.join(redisWorkingDir, 'musfy-redis.log');
    const args = [
      '--bind',
      host,
      '--port',
      String(port),
      '--dir',
      redisWorkingDir,
      '--dbfilename',
      'musfy-cache.rdb',
      '--appendonly',
      'yes',
      '--appendfilename',
      'musfy-cache.aof',
      '--save',
      '60',
      '1',
      '--logfile',
      redisLogPath
    ];

    redisInitPromise = (async () => {
      try {
        await new Promise((resolve, reject) => {
          let settled = false;
          const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error('Timeout ao iniciar Redis embarcado.'));
          }, 15000);

          embeddedRedisProcess = spawn(binaryPath, args, {
            cwd: path.dirname(binaryPath),
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
          });

          embeddedRedisExitHandler = (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(new Error(`Redis embarcado finalizou antes de responder. Codigo: ${code}`));
          };

          embeddedRedisProcess.once('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(error);
          });

          embeddedRedisProcess.once('exit', embeddedRedisExitHandler);
          embeddedRedisProcess.stdout?.on('data', (chunk) => {
            const message = chunk.toString('utf8').trim();
            if (message) {
              log(`[redis] ${message}`);
            }
          });
          embeddedRedisProcess.stderr?.on('data', (chunk) => {
            const message = chunk.toString('utf8').trim();
            if (message) {
              log(`[redis] ${message}`);
            }
          });

          const tryPing = async () => {
            if (settled) return;
            try {
              activeRedisUrl = `redis://${host}:${port}`;
              await sendRedisCommand(['PING']);
              settled = true;
              clearTimeout(timeout);
              embeddedRedisProcess.removeListener('exit', embeddedRedisExitHandler);
              embeddedRedisExitHandler = null;
              embeddedRedisProcess.on('exit', (code, signal) => {
                markEmbeddedRedisStopped(code, signal);
              });
              resolve();
              return;
            } catch (_error) {
              setTimeout(tryPing, 250);
            }
          };

          setTimeout(tryPing, 250);
        });
      } catch (error) {
        activeRedisUrl = externalRedisUrl || null;
        const redisLogTail = readRedisLogTail(redisLogPath);
        const isCorruptedAof = /Bad file format reading the append only file/i.test(redisLogTail);

        if (embeddedRedisProcess) {
          try {
            embeddedRedisProcess.kill('SIGKILL');
          } catch (_killError) {
            // ignora
          }
        }
        embeddedRedisProcess = null;
        embeddedRedisExitHandler = null;

        if (allowRecovery && isCorruptedAof) {
          log('[redis] AOF corrompido detectado. Limpando persistencia local e tentando subir novamente.');
          cleanupRedisPersistence(redisLogPath);
          redisInitPromise = null;
          return ensureRedisReady(false);
        }

        embeddedRedisErrorMessage = error.message;
        embeddedRedisInfo = {
          mode: externalRedisUrl ? 'external' : 'error',
          url: activeRedisUrl || null,
          host: null,
          port: null,
          binaryPath,
          error: redisLogTail ? `${error.message} | ${redisLogTail.split(/\r?\n/).filter(Boolean).slice(-1)[0]}` : error.message
        };
        log(`[redis] Falha ao iniciar cache embarcado: ${error.message}`);
        return activeRedisUrl || null;
      }

      activeRedisUrl = `redis://${host}:${port}`;
      embeddedRedisErrorMessage = null;
      embeddedRedisInfo = {
        mode: 'embedded',
        url: activeRedisUrl,
        host,
        port,
        binaryPath
      };
      log(`[redis] Cache local embarcado ativo em ${activeRedisUrl}`);
      return activeRedisUrl;
    })();

    try {
      return await redisInitPromise;
    } finally {
      redisInitPromise = null;
    }
  }

  function parseRedisValue(buffer) {
    const text = buffer.toString('utf8');
    if (!text) return null;
    if (text.startsWith('+')) return text.slice(1).trim();
    if (text.startsWith('-')) throw new Error(text.slice(1).trim());
    if (text.startsWith(':')) return Number(text.slice(1).trim());
    if (text.startsWith('$-1')) return null;

    if (text.startsWith('$')) {
      const firstBreak = text.indexOf('\r\n');
      const size = Number(text.slice(1, firstBreak));
      if (size < 0) return null;
      return text.slice(firstBreak + 2, firstBreak + 2 + size);
    }

    return text.trim();
  }

  async function sendRedisCommand(args) {
    const redisUrl = activeRedisUrl;
    if (!redisUrl) return null;

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(redisUrl);
      const isTls = parsedUrl.protocol === 'rediss:';
      const connector = isTls ? tls.connect : net.connect;
      const socket = connector({
        host: parsedUrl.hostname,
        port: Number(parsedUrl.port || (isTls ? 6380 : 6379)),
        servername: isTls ? parsedUrl.hostname : undefined
      });
      const chunks = [];
      const command = `*${args.length}\r\n${args
        .map((arg) => `$${Buffer.byteLength(String(arg))}\r\n${String(arg)}\r\n`)
        .join('')}`;

      socket.setTimeout(5000);

      socket.on('connect', () => {
        if (parsedUrl.password) {
          const authArgs = parsedUrl.username
            ? ['AUTH', parsedUrl.username, parsedUrl.password]
            : ['AUTH', parsedUrl.password];
          const authCommand = `*${authArgs.length}\r\n${authArgs
            .map((arg) => `$${Buffer.byteLength(String(arg))}\r\n${String(arg)}\r\n`)
            .join('')}`;
          socket.write(authCommand);
        }

        socket.write(command);
      });

      socket.on('data', (chunk) => {
        chunks.push(chunk);
        try {
          const parsed = parseRedisValue(Buffer.concat(chunks));
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

      socket.on('error', reject);
    });
  }

  async function getRedisJson(key) {
    if (!activeRedisUrl) {
      await ensureRedisReady();
    }
    if (!activeRedisUrl) return null;
    try {
      const value = await sendRedisCommand(['GET', key]);
      return value ? JSON.parse(String(value)) : null;
    } catch (error) {
      console.error(`[runtime-services] Redis GET failed for ${key}:`, error);
      if (embeddedRedisInfo?.mode === 'embedded' || embeddedRedisInfo?.mode === 'error') {
        await ensureRedisReady();
      }
      return null;
    }
  }

  async function setRedisJson(key, value, ttlSeconds) {
    if (!activeRedisUrl) {
      await ensureRedisReady();
    }
    if (!activeRedisUrl) return false;
    try {
      await sendRedisCommand(['SETEX', key, String(ttlSeconds), JSON.stringify(value)]);
      return true;
    } catch (error) {
      console.error(`[runtime-services] Redis SETEX failed for ${key}:`, error);
      if (embeddedRedisInfo?.mode === 'embedded' || embeddedRedisInfo?.mode === 'error') {
        await ensureRedisReady();
      }
      return false;
    }
  }

  async function publishRedisEvent(channel, payload) {
    if (!activeRedisUrl) {
      await ensureRedisReady();
    }
    if (!activeRedisUrl) return false;
    try {
      await sendRedisCommand(['PUBLISH', channel, JSON.stringify(payload)]);
      return true;
    } catch (error) {
      console.error(`[runtime-services] Redis PUBLISH failed for ${channel}:`, error);
      if (embeddedRedisInfo?.mode === 'embedded' || embeddedRedisInfo?.mode === 'error') {
        await ensureRedisReady();
      }
      return false;
    }
  }

  async function cacheYoutubeSearch(key, cacheEntry, ttlSeconds) {
    await Promise.allSettled([
      saveYoutubeSearchCache(key, cacheEntry),
      setRedisJson(key, cacheEntry, ttlSeconds)
    ]);
  }

  async function getHotYoutubeSearchCache(key) {
    const redisEntry = await getRedisJson(key);
    if (redisEntry) {
      return { entry: redisEntry, source: embeddedRedisInfo?.mode === 'embedded' ? 'redis-embedded' : 'redis' };
    }

    const sqliteEntry = await getYoutubeSearchCache(key);
    if (sqliteEntry) {
      return { entry: sqliteEntry, source: 'sqlite' };
    }

    return { entry: null, source: null };
  }

  function getServiceStorageSummary() {
    return {
      sqlite: {
        path: sqliteDbPath,
        ready: Boolean(sqliteDb),
        error: sqliteErrorMessage || null
      },
      redis: {
        ...embeddedRedisInfo,
        url: activeRedisUrl || embeddedRedisInfo?.url || null,
        error: embeddedRedisErrorMessage || embeddedRedisInfo?.error || null
      }
    };
  }

  async function bootstrap() {
    const [sqliteResult, redisResult] = await Promise.allSettled([ensureSqliteReady(), ensureRedisReady()]);

    if (sqliteResult.status === 'rejected') {
      sqliteErrorMessage = sqliteResult.reason?.message || String(sqliteResult.reason || 'Falha no SQLite');
      console.error('[runtime-services] SQLite bootstrap failed:', sqliteResult.reason);
    }

    if (redisResult.status === 'rejected') {
      embeddedRedisErrorMessage = redisResult.reason?.message || String(redisResult.reason || 'Falha no Redis');
      console.error('[runtime-services] Redis bootstrap failed:', redisResult.reason);
    }

    return getServiceStorageSummary();
  }

  async function shutdown() {
    if (embeddedRedisProcess) {
      const processToStop = embeddedRedisProcess;
      embeddedRedisProcess = null;
      embeddedRedisErrorMessage = null;
      activeRedisUrl = externalRedisUrl || null;
      await new Promise((resolve) => {
        processToStop.once('exit', () => resolve());
        processToStop.kill('SIGTERM');
        setTimeout(() => {
          try {
            processToStop.kill('SIGKILL');
          } catch (_error) {
            // ignora
          }
          resolve();
        }, 5000);
      });
    }
  }

  return {
    bootstrap,
    shutdown,
    getServiceStorageSummary,
    getActiveRedisUrl: () => activeRedisUrl,
    getHotYoutubeSearchCache,
    cacheYoutubeSearch,
    recordYoutubeSearchRequest,
    getRecentYoutubeSearches,
    persistDownloadJob,
    restoreDownloadJobs,
    recordServiceEvent,
    publishRedisEvent
  };
}

module.exports = {
  createRuntimeServices
};

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_GITHUB_OWNER = 'hasbuen';
const DEFAULT_GITHUB_REPO = 'MusFy';
const REQUIRED_ARTIFACTS = ['latest.yml', 'MusFy-Setup.exe', 'MusFy-Setup.exe.blockmap'];
const DEFAULT_ANDROID_APK_ASSET_NAME = 'MusFy-Android.apk';
const DEFAULT_GITHUB_MAX_ATTEMPTS = 4;
const DEFAULT_GITHUB_RETRY_DELAY_MS = 2500;

const frontendRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(frontendRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[release] ${message}`);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const requestedVersion = resolveRequestedVersion(args);
  const owner = String(args.owner || process.env.MUSFY_GITHUB_OWNER || DEFAULT_GITHUB_OWNER).trim();
  const repo = String(args.repo || process.env.MUSFY_GITHUB_REPO || DEFAULT_GITHUB_REPO).trim();
  const tag = String(args.tag || process.env.MUSFY_RELEASE_TAG || `v${requestedVersion}`).trim();
  const releaseName = String(
    args.name || process.env.MUSFY_RELEASE_NAME || `MusFy ${requestedVersion}`
  ).trim();
  const token = String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  const draft = asBoolean(args.draft, false);
  const prerelease = asBoolean(args.prerelease, false);
  const buildOnly = asBoolean(args['build-only'], false);
  const skipBuild = asBoolean(args['skip-build'], false);
  const outputDir = path.join(frontendRoot, 'release', 'github', requestedVersion);
  const relativeOutputDir = path.relative(frontendRoot, outputDir).replace(/\\/g, '/');
  const releaseNotes = resolveReleaseNotes({
    args,
    requestedVersion,
    tag
  });

  console.log(`[release] repo: ${owner}/${repo}`);
  console.log(`[release] tag: ${tag}`);
  console.log(`[release] versao: ${requestedVersion}`);
  console.log(`[release] saida: ${outputDir}`);

  if (!skipBuild) {
    cleanOutputDir(outputDir);
    runBuild(requestedVersion, relativeOutputDir);
  }

  const androidApkArtifact = prepareAndroidApkArtifact({
    args,
    outputDir
  });

  applyReleaseMetadata(outputDir, {
    releaseName,
    releaseNotes
  });

  const artifacts = collectArtifacts(outputDir, requestedVersion, androidApkArtifact ? [androidApkArtifact] : []);
  console.log(`[release] artefatos prontos: ${artifacts.map((artifact) => artifact.name).join(', ')}`);

  if (buildOnly) {
    console.log('[release] build-only ativo, upload para o GitHub ignorado.');
    return;
  }

  if (!token) {
    fail('Defina GH_TOKEN ou GITHUB_TOKEN antes de subir o release no GitHub.');
  }

  const release = await createOrUpdateRelease({
    owner,
    repo,
    tag,
    releaseName,
    releaseNotes,
    draft,
    prerelease,
    token
  });

  await uploadArtifacts({
    owner,
    repo,
    release,
    artifacts,
    token
  });

  console.log(`[release] release publicado: ${release.html_url}`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      fail(`Argumento invalido: ${arg}`);
    }

    const separatorIndex = arg.indexOf('=');
    if (separatorIndex >= 0) {
      const key = arg.slice(2, separatorIndex);
      const value = arg.slice(separatorIndex + 1);
      parsed[key] = value;
      continue;
    }

    const key = arg.slice(2);
    const nextArg = argv[index + 1];
    if (nextArg && !nextArg.startsWith('--')) {
      parsed[key] = nextArg;
      index += 1;
      continue;
    }

    parsed[key] = true;
  }

  return parsed;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function isValidSemver(version) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version);
}

function resolveRequestedVersion(args) {
  const requestedVersion = String(
    args.version || process.env.MUSFY_RELEASE_VERSION || packageJson.version || ''
  ).trim();

  if (!requestedVersion) {
    fail('Informe a versao com --version x.y.z ou defina MUSFY_RELEASE_VERSION.');
  }

  if (!isValidSemver(requestedVersion)) {
    fail(`Versao invalida: "${requestedVersion}". Use semver, por exemplo 1.2.3.`);
  }

  if (requestedVersion === '0.0.0') {
    fail('A versao 0.0.0 nao serve para update. Use --version x.y.z para publicar um release real.');
  }

  return requestedVersion;
}

function resolveReleaseNotes({ args, requestedVersion, tag }) {
  const inlineNotes = String(args.notes || process.env.MUSFY_RELEASE_NOTES || '').trim();
  if (inlineNotes) return inlineNotes;

  const defaultNotesFile = path.join(frontendRoot, 'release-notes', `${requestedVersion}.md`);
  const notesFile = String(
    args['notes-file'] ||
      process.env.MUSFY_RELEASE_NOTES_FILE ||
      (fs.existsSync(defaultNotesFile) ? defaultNotesFile : '')
  ).trim();
  if (notesFile) {
    const resolvedNotesFile = path.resolve(frontendRoot, notesFile);
    if (!fs.existsSync(resolvedNotesFile)) {
      fail(`Arquivo de notas nao encontrado: ${resolvedNotesFile}`);
    }

    return fs.readFileSync(resolvedNotesFile, 'utf8').trim();
  }

  return [
    `Release automatizado do MusFy ${requestedVersion}.`,
    '',
    `Tag: ${tag}`,
    `Artefatos: ${REQUIRED_ARTIFACTS.join(', ')}`,
    `Gerado em: ${new Date().toISOString()}`
  ].join('\n');
}

function applyReleaseMetadata(targetDir, { releaseName, releaseNotes }) {
  const latestYmlPath = path.join(targetDir, 'latest.yml');
  if (!fs.existsSync(latestYmlPath)) {
    fail(`Arquivo latest.yml nao encontrado em ${latestYmlPath}`);
  }

  let latestYml = fs.readFileSync(latestYmlPath, 'utf8').replace(/\r\n/g, '\n');
  latestYml = removeYamlEntry(latestYml, 'releaseName');
  latestYml = removeYamlEntry(latestYml, 'releaseNotes', true).trimEnd();

  const normalizedReleaseNotes = String(releaseNotes || '').trim();
  latestYml = [
    latestYml,
    `releaseName: ${toYamlQuotedValue(releaseName)}`,
    'releaseNotes: |-',
    ...normalizedReleaseNotes.split('\n').map((line) => `  ${line}`)
  ].join('\n');

  fs.writeFileSync(latestYmlPath, `${latestYml}\n`, 'utf8');
}

function removeYamlEntry(source, key, block = false) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = block
    ? new RegExp(`^${escapedKey}:\\s*\\|[-+]?\\n(?: {2}.*(?:\\n|$))*`, 'm')
    : new RegExp(`^${escapedKey}:\\s*.*(?:\\n|$)`, 'm');
  return source.replace(pattern, '');
}

function toYamlQuotedValue(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function cleanOutputDir(targetDir) {
  const normalizedFrontendRoot = path.resolve(frontendRoot);
  const normalizedTargetDir = path.resolve(targetDir);
  const releaseRoot = path.join(normalizedFrontendRoot, 'release');

  if (!normalizedTargetDir.startsWith(releaseRoot)) {
    fail(`Saida fora da pasta esperada de release: ${normalizedTargetDir}`);
  }

  fs.rmSync(normalizedTargetDir, { recursive: true, force: true });
}

function runBuild(version, outputDirectory) {
  runCommand(process.execPath, ['build/windows/prepare-runtime.cjs'], 'prepare-runtime');
  runCommand(getNpmCommand(), ['exec', '--', 'tsc'], 'tsc');
  runCommand(getNpmCommand(), ['exec', '--', 'vite', 'build'], 'vite build');
  runCommand(
    getNpmCommand(),
    [
      'exec',
      '--',
      'electron-builder',
      '--publish',
      'never',
      `--config.directories.output=${outputDirectory}`,
      `--config.extraMetadata.version=${version}`
    ],
    'electron-builder'
  );
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runCommand(command, commandArgs, label) {
  console.log(`[release] executando ${label}...`);
  const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  const result = spawnSync(command, commandArgs, {
    cwd: frontendRoot,
    stdio: 'inherit',
    shell: useShell,
    env: {
      ...process.env
    }
  });

  if (result.error) {
    fail(`Falha ao iniciar ${label}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`Falha em ${label}${result.status == null ? '.' : ` (exit ${result.status}).`}`);
  }
}

function collectArtifacts(targetDir, version, extraArtifacts = []) {
  if (!fs.existsSync(targetDir)) {
    fail(`Pasta de release nao encontrada: ${targetDir}`);
  }

  const artifacts = REQUIRED_ARTIFACTS.map((fileName) => {
    const filePath = path.join(targetDir, fileName);
    if (!fs.existsSync(filePath)) {
      fail(`Artefato obrigatorio ausente: ${filePath}`);
    }

    return {
      name: fileName,
      filePath,
      contentType: getContentType(fileName),
      size: fs.statSync(filePath).size
    };
  });

  const latestYml = fs.readFileSync(path.join(targetDir, 'latest.yml'), 'utf8');
  if (!latestYml.includes(`version: ${version}`)) {
    fail(`latest.yml foi gerado sem a versao esperada ${version}.`);
  }

  return [...artifacts, ...collectOptionalLinuxArtifacts(targetDir, version), ...extraArtifacts];
}

function collectOptionalLinuxArtifacts(targetDir, version) {
  return [
    `MusFy-Linux-${version}.AppImage`,
    `MusFy-Linux-${version}.tar.gz`,
    'latest-linux.yml'
  ]
    .map((fileName) => {
      const filePath = path.join(targetDir, fileName);
      if (!fs.existsSync(filePath)) return null;

      return {
        name: fileName,
        filePath,
        contentType: getContentType(fileName),
        size: fs.statSync(filePath).size
      };
    })
    .filter(Boolean);
}

function prepareAndroidApkArtifact({ args, outputDir }) {
  if (asBoolean(args['skip-android-apk'], false)) {
    console.log('[release] skip-android-apk ativo, asset mobile nao sera publicado.');
    return null;
  }

  const sourcePath = resolveAndroidApkSource(args);
  if (!sourcePath) {
    fail(
      'APK Android nao encontrado. Gere o release APK antes de publicar ou informe --android-apk caminho/do/app-release.apk.'
    );
  }

  const targetPath = path.join(outputDir, DEFAULT_ANDROID_APK_ASSET_NAME);
  fs.copyFileSync(sourcePath, targetPath);

  return {
    name: DEFAULT_ANDROID_APK_ASSET_NAME,
    filePath: targetPath,
    contentType: 'application/vnd.android.package-archive',
    size: fs.statSync(targetPath).size
  };
}

function resolveAndroidApkSource(args) {
  const explicitPath = String(args['android-apk'] || process.env.MUSFY_ANDROID_APK_PATH || '').trim();
  const defaultPath = path.resolve(
    frontendRoot,
    '..',
    'mobile-musfy',
    'android',
    'app',
    'build',
    'outputs',
    'apk',
    'release',
    'app-release.apk'
  );
  const candidates = [explicitPath, defaultPath].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(frontendRoot, candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}

function getContentType(fileName) {
  if (fileName.endsWith('.yml')) return 'text/yaml; charset=utf-8';
  if (fileName.endsWith('.AppImage')) return 'application/x-executable';
  if (fileName.endsWith('.tar.gz')) return 'application/gzip';
  if (fileName.endsWith('.blockmap')) return 'application/octet-stream';
  if (fileName.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  return 'application/octet-stream';
}

async function createOrUpdateRelease({
  owner,
  repo,
  tag,
  releaseName,
  releaseNotes,
  draft,
  prerelease,
  token
}) {
  const releaseByTagUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  let existingRelease = null;

  try {
    existingRelease = await githubRequest(releaseByTagUrl, {
      method: 'GET',
      token,
      expectedStatus: [200]
    });
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  if (!existingRelease) {
    console.log('[release] criando release no GitHub...');
    return githubRequest(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      token,
      expectedStatus: [201],
      body: {
        tag_name: tag,
        name: releaseName,
        body: releaseNotes,
        draft,
        prerelease
      }
    });
  }

  console.log('[release] release existente encontrado, atualizando metadados...');
  return githubRequest(`https://api.github.com/repos/${owner}/${repo}/releases/${existingRelease.id}`, {
    method: 'PATCH',
    token,
    expectedStatus: [200],
    body: {
      name: releaseName,
      body: releaseNotes,
      draft,
      prerelease
    }
  });
}

async function uploadArtifacts({ owner, repo, release, artifacts, token }) {
  const currentRelease = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/releases/${release.id}`,
    {
      method: 'GET',
      token,
      expectedStatus: [200]
    }
  );

  const existingAssets = Array.isArray(currentRelease.assets) ? currentRelease.assets : [];
  for (const artifact of artifacts) {
    const previousAsset = existingAssets.find((asset) => asset.name === artifact.name);
    if (previousAsset) {
      console.log(`[release] removendo asset antigo: ${artifact.name}`);
      await githubRequest(
        `https://api.github.com/repos/${owner}/${repo}/releases/assets/${previousAsset.id}`,
        {
          method: 'DELETE',
          token,
          expectedStatus: [204]
        }
      );
    }

    const uploadUrl = currentRelease.upload_url.replace(/\{[^}]+\}$/, '');
    console.log(`[release] enviando ${artifact.name} (${formatBytes(artifact.size)})...`);
    await uploadArtifactWithRetries({
      owner,
      repo,
      releaseId: currentRelease.id,
      uploadUrl,
      artifact,
      token
    });
  }
}

async function uploadArtifactWithRetries({ owner, repo, releaseId, uploadUrl, artifact, token }) {
  let attempt = 0;

  while (attempt < DEFAULT_GITHUB_MAX_ATTEMPTS) {
    attempt += 1;

    try {
      await uploadArtifactRequest({
        uploadUrl,
        artifact,
        token
      });
      return;
    } catch (error) {
      const remoteAsset = await findReleaseAssetByName({ owner, repo, releaseId, token, name: artifact.name }).catch(
        () => null
      );

      if (remoteAsset && Number(remoteAsset.size) === artifact.size) {
        console.log(`[release] asset confirmado apos falha de rede: ${artifact.name}`);
        return;
      }

      if (remoteAsset) {
        console.log(`[release] asset inconsistente detectado, removendo e reenviando: ${artifact.name}`);
        await githubRequest(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${remoteAsset.id}`, {
          method: 'DELETE',
          token,
          expectedStatus: [204]
        });
      }

      if (attempt >= DEFAULT_GITHUB_MAX_ATTEMPTS) {
        throw error;
      }
      console.log(
        `[release] upload falhou para ${artifact.name}. Nova tentativa ${attempt + 1}/${DEFAULT_GITHUB_MAX_ATTEMPTS} em ${DEFAULT_GITHUB_RETRY_DELAY_MS} ms...`
      );
      await wait(DEFAULT_GITHUB_RETRY_DELAY_MS * attempt);
    }
  }
}

async function uploadArtifactRequest({ uploadUrl, artifact, token }) {
  const targetUrl = `${uploadUrl}?name=${encodeURIComponent(artifact.name)}`;

  if (process.platform === 'win32') {
    return uploadArtifactWithCurl({
      targetUrl,
      artifact,
      token
    });
  }

  const fileBuffer = fs.readFileSync(artifact.filePath);
  return githubRequest(targetUrl, {
    method: 'POST',
    token,
    expectedStatus: [201],
    rawBody: fileBuffer,
    maxAttempts: 1,
    extraHeaders: {
      'Content-Type': artifact.contentType,
      'Content-Length': String(fileBuffer.length)
    }
  });
}

async function uploadArtifactWithCurl({ targetUrl, artifact, token }) {
  const curlCommand = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const result = spawnSync(
    curlCommand,
    [
      '--silent',
      '--show-error',
      '--fail-with-body',
      '--location',
      '--http1.1',
      '--retry',
      '5',
      '--retry-all-errors',
      '--retry-delay',
      '2',
      '--connect-timeout',
      '30',
      '--request',
      'POST',
      '--header',
      'Accept: application/vnd.github+json',
      '--header',
      `Authorization: Bearer ${token}`,
      '--header',
      'X-GitHub-Api-Version: 2022-11-28',
      '--header',
      `Content-Type: ${artifact.contentType}`,
      '--header',
      `Content-Length: ${artifact.size}`,
      '--data-binary',
      `@${artifact.filePath}`,
      targetUrl
    ],
    {
      cwd: frontendRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || '').trim() || `curl exit ${result.status}`;
    throw new Error(message);
  }

  return tryParseJson(String(result.stdout || '').trim());
}

async function findReleaseAssetByName({ owner, repo, releaseId, token, name }) {
  const release = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/releases/${releaseId}`, {
    method: 'GET',
    token,
    expectedStatus: [200]
  });

  const assets = Array.isArray(release.assets) ? release.assets : [];
  return assets.find((asset) => asset.name === name) || null;
}

async function githubRequest(url, { method, token, expectedStatus, body, rawBody, extraHeaders, maxAttempts }) {
  const totalAttempts = Math.max(1, Number(maxAttempts || DEFAULT_GITHUB_MAX_ATTEMPTS));
  let lastError = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(rawBody ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
          ...(extraHeaders || {})
        },
        body: rawBody || (body ? JSON.stringify(body) : undefined)
      });

      const responseText = await response.text();
      const responseData = tryParseJson(responseText);

      if (!response.ok || (expectedStatus && !expectedStatus.includes(response.status))) {
        const error = new Error(
          `[${response.status}] ${extractGithubErrorMessage(responseData, responseText)}`
        );
        error.status = response.status;
        error.responseData = responseData;

        if (attempt < totalAttempts && shouldRetryGithubStatus(response.status)) {
          console.log(
            `[release] GitHub respondeu ${response.status}. Nova tentativa ${attempt + 1}/${totalAttempts} em ${DEFAULT_GITHUB_RETRY_DELAY_MS} ms...`
          );
          await wait(DEFAULT_GITHUB_RETRY_DELAY_MS * attempt);
          lastError = error;
          continue;
        }

        throw error;
      }

      return responseData;
    } catch (error) {
      lastError = error;
      if (attempt >= totalAttempts || !shouldRetryGithubError(error)) {
        throw error;
      }

      console.log(
        `[release] falha de rede ao comunicar com o GitHub. Nova tentativa ${attempt + 1}/${totalAttempts} em ${DEFAULT_GITHUB_RETRY_DELAY_MS} ms...`
      );
      await wait(DEFAULT_GITHUB_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
}

function tryParseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractGithubErrorMessage(responseData, responseText) {
  if (responseData?.message) return responseData.message;
  if (typeof responseText === 'string' && responseText.trim()) return responseText.trim();
  return 'Falha ao comunicar com a API do GitHub.';
}

function isNotFoundError(error) {
  return Boolean(error && typeof error === 'object' && error.status === 404);
}

function shouldRetryGithubStatus(status) {
  return status === 408 || status === 409 || status === 423 || status === 429 || status >= 500;
}

function shouldRetryGithubError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const message = String(error.message || '').toLowerCase();
  return (
    !('status' in error) ||
    message.includes('fetch failed') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('enotfound') ||
    message.includes('socket') ||
    message.includes('network')
  );
}

function formatBytes(value) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function fail(message) {
  throw new Error(message);
}

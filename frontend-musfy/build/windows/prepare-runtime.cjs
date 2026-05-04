const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const frontendRoot = path.resolve(__dirname, '..', '..');
const projectRoot = path.resolve(frontendRoot, '..');
const backendRoot = path.join(projectRoot, 'backend-musfy');
const windowsBuildDir = path.join(frontendRoot, 'build', 'windows');
const backendBundleDir = path.join(frontendRoot, 'build', 'backend-musfy');

const sourceNode = process.execPath;
const runtimeDir = path.join(frontendRoot, 'build', 'runtime');
const targetNode = path.join(runtimeDir, process.platform === 'win32' ? 'node.exe' : 'node');
const serviceHostSource = path.join(windowsBuildDir, 'MusFyServiceHost.cs');
const serviceHostTarget = path.join(windowsBuildDir, 'MusFyServiceHost.exe');
const redisSourceDir = path.join(
  backendRoot,
  'node_modules',
  '.cache',
  'redis-memory-server',
  'redis-binaries',
  'stable'
);
const redisTargetDir = path.join(backendRoot, 'bin', 'redis');
const assetsDir = path.join(frontendRoot, 'src', 'assets');
const buildDir = path.join(frontendRoot, 'build');

fs.mkdirSync(runtimeDir, { recursive: true });
fs.copyFileSync(sourceNode, targetNode);
console.log(`[prepare-runtime] Copied ${sourceNode} -> ${targetNode}`);

function resolveCscPath() {
  const candidates = [
    process.env.WINDIR ? path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe') : null,
    process.env.WINDIR ? path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe') : null
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function buildWindowsServiceHost() {
  if (process.platform !== 'win32') {
    fs.mkdirSync(path.dirname(serviceHostTarget), { recursive: true });
    fs.writeFileSync(serviceHostTarget, 'Windows service host is only used by the Windows package.\n');
    return;
  }

  const cscPath = resolveCscPath();
  if (!cscPath) {
    throw new Error('Nao foi possivel localizar o compilador csc.exe para gerar o host do servico Windows.');
  }

  const compileResult = spawnSync(
    cscPath,
    [
      '/nologo',
      '/target:exe',
      `/out:${serviceHostTarget}`,
      '/reference:System.ServiceProcess.dll',
      '/reference:System.dll',
      serviceHostSource
    ],
    {
      stdio: 'inherit',
      windowsHide: true
    }
  );

  if (compileResult.status !== 0) {
    throw new Error(`Falha ao compilar ${path.basename(serviceHostSource)}.`);
  }

  console.log(`[prepare-runtime] Built Windows service host -> ${serviceHostTarget}`);
}

buildWindowsServiceHost();

function copyBackendRuntime() {
  const includedRootEntries = new Set([
    'server.js',
    'runtime-services.js',
    'package.json',
    'bin'
  ]);
  const excludedNames = new Set([
    '.cache',
    '.bin',
    'nodemon',
    'data',
    'downloads',
    'uploads',
    'opus_files',
    'video_files'
  ]);
  const excludedRootEntries = new Set(['ffmpeg']);

  fs.rmSync(backendBundleDir, { recursive: true, force: true });
  fs.cpSync(backendRoot, backendBundleDir, {
    recursive: true,
    force: true,
    filter(source) {
      const relative = path.relative(backendRoot, source);
      if (!relative) return true;

      const parts = relative.split(path.sep);
      if (!includedRootEntries.has(parts[0])) return false;
      if (excludedRootEntries.has(parts[0])) return false;
      if (parts.some((part) => excludedNames.has(part))) return false;

      return true;
    }
  });

  const sourceModulesDir = path.join(backendRoot, 'node_modules');
  const bundledModulesDir = path.join(backendBundleDir, 'dependencies');
  fs.cpSync(sourceModulesDir, bundledModulesDir, {
    recursive: true,
    force: true,
    filter(source) {
      const relative = path.relative(sourceModulesDir, source);
      if (!relative) return true;

      const parts = relative.split(path.sep);
      return !parts.some((part) => excludedNames.has(part));
    }
  });

  const expressDir = path.join(bundledModulesDir, 'express');
  if (!fs.existsSync(expressDir)) {
    throw new Error(`Backend runtime incompleto: express nao encontrado em ${expressDir}`);
  }

  console.log(`[prepare-runtime] Copied backend runtime -> ${backendBundleDir}`);
}

copyBackendRuntime();

if (fs.existsSync(redisSourceDir)) {
  fs.mkdirSync(redisTargetDir, { recursive: true });
  fs.cpSync(redisSourceDir, redisTargetDir, { recursive: true, force: true });
  console.log(`[prepare-runtime] Copied embedded Redis binaries -> ${redisTargetDir}`);
} else {
  console.warn(`[prepare-runtime] Embedded Redis binaries not found at ${redisSourceDir}`);
}

function generateInstallerSidebar(targetName) {
  const sourceImage = path.join(assetsDir, 'app.png');
  const targetImage = path.join(buildDir, targetName);
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    `$src = '${sourceImage.replace(/\\/g, '\\\\')}'`,
    `$dest = '${targetImage.replace(/\\/g, '\\\\')}'`,
    '$img = [System.Drawing.Image]::FromFile($src)',
    '$bmp = New-Object System.Drawing.Bitmap 164, 314',
    '$graphics = [System.Drawing.Graphics]::FromImage($bmp)',
    "$graphics.Clear([System.Drawing.Color]::FromArgb(6, 10, 16))",
    "$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality",
    "$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
    "$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality",
    '$graphics.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(20, 56, 189, 248))), 0, 0, 164, 90)',
    '$graphics.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(26, 34, 197, 94))), 0, 228, 164, 86)',
    '$graphics.DrawImage($img, 22, 52, 120, 120)',
    "$titleFont = New-Object System.Drawing.Font('Segoe UI', 24, [System.Drawing.FontStyle]::Bold)",
    "$subtitleFont = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Regular)",
    "$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)",
    "$softBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(196, 226, 232, 240))",
    "$graphics.DrawString('MusFy', $titleFont, $whiteBrush, 22, 195)",
    "$graphics.DrawString('Seu servidor local de musica', $subtitleFont, $softBrush, 24, 238)",
    '$bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Bmp)',
    '$graphics.Dispose()',
    '$bmp.Dispose()',
    '$img.Dispose()'
  ].join('; ');

  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'inherit',
    windowsHide: true
  });

  if (result.status !== 0) {
    console.warn(`[prepare-runtime] Failed to generate ${targetName}`);
  } else {
    console.log(`[prepare-runtime] Generated ${targetImage}`);
  }
}

if (process.platform === 'win32') {
  generateInstallerSidebar('installerSidebar.bmp');
  generateInstallerSidebar('uninstallerSidebar.bmp');
}

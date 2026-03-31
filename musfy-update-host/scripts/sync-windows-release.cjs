const fs = require('fs');
const path = require('path');

const hostRoot = path.resolve(__dirname, '..');
const targetDir = path.join(hostRoot, 'public', 'windows');
const requiredFiles = ['latest.yml', 'MusFy.exe', 'MusFy.exe.blockmap'];
const sourceArg = process.argv[2];
const defaultReleaseRoot = path.resolve(hostRoot, '..', 'frontend-musfy', 'release', 'github');

function parseVersion(value) {
  const match = String(value).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return match.slice(1).map((part) => Number(part));
}

function compareVersions(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] || 0;
    const right = b[index] || 0;
    if (left !== right) return left - right;
  }

  return 0;
}

function resolveLatestReleaseDir() {
  if (!fs.existsSync(defaultReleaseRoot)) {
    console.error(`Pasta de releases nao encontrada: ${defaultReleaseRoot}`);
    process.exit(1);
  }

  const candidates = fs
    .readdirSync(defaultReleaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, version: parseVersion(entry.name) }))
    .filter((entry) => entry.version);

  if (candidates.length === 0) {
    console.error(`Nenhuma release semver encontrada em ${defaultReleaseRoot}`);
    process.exit(1);
  }

  candidates.sort((left, right) => compareVersions(left.version, right.version));
  return path.join(defaultReleaseRoot, candidates[candidates.length - 1].name);
}

const sourceDir = sourceArg ? path.resolve(hostRoot, sourceArg) : resolveLatestReleaseDir();

if (!fs.existsSync(sourceDir)) {
  console.error(`Pasta de release nao encontrada: ${sourceDir}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

console.log(`[sync] origem: ${sourceDir}`);

for (const fileName of requiredFiles) {
  const sourceFile = path.join(sourceDir, fileName);
  if (!fs.existsSync(sourceFile)) {
    console.error(`Arquivo obrigatorio ausente: ${sourceFile}`);
    process.exit(1);
  }

  const targetFile = path.join(targetDir, fileName);
  fs.copyFileSync(sourceFile, targetFile);
  console.log(`[sync] ${fileName}`);
}

console.log(`[sync] Canal Windows pronto em ${targetDir}`);

const fs = require('fs');
const path = require('path');

const sourceArg = process.argv[2];

if (!sourceArg) {
  console.error('Uso: node scripts/sync-windows-release.cjs <pasta-release>');
  process.exit(1);
}

const hostRoot = path.resolve(__dirname, '..');
const sourceDir = path.resolve(hostRoot, sourceArg);
const targetDir = path.join(hostRoot, 'public', 'windows');
const requiredFiles = ['latest.yml', 'MusFy.exe', 'MusFy.exe.blockmap'];

if (!fs.existsSync(sourceDir)) {
  console.error(`Pasta de release não encontrada: ${sourceDir}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

for (const fileName of requiredFiles) {
  const sourceFile = path.join(sourceDir, fileName);
  if (!fs.existsSync(sourceFile)) {
    console.error(`Arquivo obrigatório ausente: ${sourceFile}`);
    process.exit(1);
  }

  const targetFile = path.join(targetDir, fileName);
  fs.copyFileSync(sourceFile, targetFile);
  console.log(`[sync] ${fileName}`);
}

console.log(`[sync] Canal Windows pronto em ${targetDir}`);

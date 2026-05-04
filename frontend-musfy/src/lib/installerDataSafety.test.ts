import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const nsisScriptPath = path.join(repoRoot, 'build', 'nsis', 'service-installer.nsh');
const electronBuilderConfigPath = path.join(repoRoot, 'electron-builder.json5');
const prepareRuntimeScriptPath = path.join(repoRoot, 'build', 'windows', 'prepare-runtime.cjs');
const serviceHostSourcePath = path.join(repoRoot, 'build', 'windows', 'MusFyServiceHost.cs');

describe('installer data safety', () => {
  it('does not ask electron-builder to delete app data on uninstall', () => {
    const config = fs.readFileSync(electronBuilderConfigPath, 'utf-8');

    expect(config).toContain('"deleteAppDataOnUninstall": false');
    expect(config).not.toContain('"deleteAppDataOnUninstall": true');
  });

  it('does not delete user-generated MusFy data from NSIS cleanup', () => {
    const script = fs.readFileSync(nsisScriptPath, 'utf-8');
    const removeFilesMacro = script.match(/!macro RemoveMusFyFiles[\s\S]*?!macroend/)?.[0] || '';

    expect(removeFilesMacro).not.toContain('RMDir /r "$APPDATA\\MusFy"');
    expect(removeFilesMacro).not.toContain('RMDir /r "$LOCALAPPDATA\\MusFy"');
    expect(removeFilesMacro).not.toContain('RMDir /r "$APPDATA\\frontend-musfy"');
    expect(removeFilesMacro).not.toContain('%ProgramData%\\MusFy');
  });

  it('backs up and restores ProgramData during updates before the legacy uninstaller can delete it', () => {
    const script = fs.readFileSync(nsisScriptPath, 'utf-8');

    expect(script).toContain('!macro BackupMusFyUserDataForUpdate');
    expect(script).toContain('!macro RestoreMusFyUserDataForUpdate');
    expect(script).toContain('${If} ${isUpdated}');
    expect(script).toContain('robocopy "%ProgramData%\\MusFy" "$PLUGINSDIR\\musfy-user-data-backup\\ProgramData"');
    expect(script).toContain('robocopy "$PLUGINSDIR\\musfy-user-data-backup\\ProgramData" "%ProgramData%\\MusFy"');
  });

  it('skips custom data cleanup when NSIS is running as an update', () => {
    const script = fs.readFileSync(nsisScriptPath, 'utf-8');
    const uninstallMacro = script.match(/!macro customUnInstall[\s\S]*?!macroend/)?.[0] || '';

    expect(uninstallMacro).toContain('${IfNot} ${isUpdated}');
    expect(uninstallMacro).toContain('dados do usuario preservados');
  });

  it('packages backend dependencies from a prepared runtime folder', () => {
    const config = fs.readFileSync(electronBuilderConfigPath, 'utf-8');
    const prepareRuntime = fs.readFileSync(prepareRuntimeScriptPath, 'utf-8');

    expect(config).toContain('"from": "build/backend-musfy"');
    expect(config).not.toContain('"from": "../backend-musfy"');
    expect(prepareRuntime).toContain('copyBackendRuntime');
    expect(prepareRuntime).toContain("path.join(backendBundleDir, 'dependencies')");
    expect(prepareRuntime).toContain("path.join(bundledModulesDir, 'express')");
    expect(prepareRuntime).not.toContain("'ffmpeg'\\n  ]");
  });

  it('uses platform-specific runtime names for desktop packages', () => {
    const serviceController = fs.readFileSync(path.join(repoRoot, 'electron', 'service-controller.ts'), 'utf-8');
    const prepareRuntime = fs.readFileSync(prepareRuntimeScriptPath, 'utf-8');

    expect(serviceController).toContain("process.platform === 'win32' ? 'node.exe' : 'node'");
    expect(prepareRuntime).toContain("process.platform === 'win32' ? 'node.exe' : 'node'");
  });

  it('points the Windows service host to bundled backend dependencies', () => {
    const serviceHost = fs.readFileSync(serviceHostSourcePath, 'utf-8');

    expect(serviceHost).toContain('NODE_PATH');
    expect(serviceHost).toContain('Path.Combine(resourcesDir, "backend-musfy", "dependencies")');
  });
});

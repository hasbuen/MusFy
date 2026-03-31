$ErrorActionPreference = 'Stop'

function Write-Step($message) {
  Write-Host "[MusFy] $message" -ForegroundColor Cyan
}

function New-Shortcut {
  param(
    [string]$ShortcutPath,
    [string]$TargetPath,
    [string]$IconLocation
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = Split-Path $TargetPath
  $shortcut.IconLocation = $IconLocation
  $shortcut.Save()
}

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments
  exit 0
}

$sourceDir = Split-Path -Parent $PSScriptRoot
$installDir = Join-Path $env:ProgramFiles 'MusFy'
$serviceName = 'MusFyHostService'
$serviceHost = Join-Path $installDir 'MusFyServiceHost.exe'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MusFy.lnk'
$startMenuDir = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\MusFy'
$startMenuShortcut = Join-Path $startMenuDir 'MusFy.lnk'

Write-Step 'Preparando instalacao do MusFy...'
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null

Write-Step 'Parando servico antigo, se existir...'
cmd.exe /c "sc stop $serviceName" | Out-Null
Start-Sleep -Seconds 2
cmd.exe /c "sc delete $serviceName" | Out-Null

Write-Step 'Copiando arquivos para Program Files...'
robocopy $sourceDir $installDir /E /R:1 /W:1 /NFL /NDL /NJH /NJS /XF MusFySetup.cmd Install-MusFy.ps1 | Out-Null

Write-Step 'Criando atalhos...'
New-Shortcut -ShortcutPath $desktopShortcut -TargetPath (Join-Path $installDir 'MusFy.exe') -IconLocation (Join-Path $installDir 'resources\assets\tray.ico')
New-Shortcut -ShortcutPath $startMenuShortcut -TargetPath (Join-Path $installDir 'MusFy.exe') -IconLocation (Join-Path $installDir 'resources\assets\tray.ico')

Write-Step 'Registrando servico local do MusFy...'
cmd.exe /c "sc create $serviceName binPath= `"`"$serviceHost`"`" displayname= `"`"MusFy Local Service`"`" start= auto" | Out-Null
cmd.exe /c "sc description $serviceName `"`"Servico local do MusFy para downloads, biblioteca e streaming.`"`"" | Out-Null
cmd.exe /c "sc config $serviceName start= delayed-auto" | Out-Null
cmd.exe /c "sc start $serviceName" | Out-Null

Write-Step 'Iniciando MusFy...'
Start-Process (Join-Path $installDir 'MusFy.exe')

Write-Host ''
Write-Host 'MusFy instalado com sucesso.' -ForegroundColor Green
Write-Host "Pasta: $installDir"
Write-Host ''
Read-Host 'Pressione Enter para fechar'

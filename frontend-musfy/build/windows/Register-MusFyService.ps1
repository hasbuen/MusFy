$ErrorActionPreference = 'Stop'

param(
  [string]$InstallDir = $(Split-Path -Parent $PSScriptRoot)
)

function Ensure-Admin {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    return $true
  }

  $args = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -InstallDir `"$InstallDir`""
  Start-Process powershell.exe -Verb RunAs -ArgumentList $args | Out-Null
  return $false
}

if (-not (Ensure-Admin)) {
  exit 0
}

$serviceName = 'MusFyHostService'
$legacyServiceNames = @('MusFyService')
$serviceHost = Join-Path $InstallDir 'MusFyServiceHost.exe'

if (-not (Test-Path $serviceHost)) {
  throw "Host do servico nao encontrado em $serviceHost"
}

foreach ($legacyName in ($legacyServiceNames + $serviceName)) {
  cmd.exe /c "sc stop $legacyName" | Out-Null
  Start-Sleep -Milliseconds 800
  cmd.exe /c "sc delete $legacyName" | Out-Null
  Start-Sleep -Milliseconds 800
}

cmd.exe /c "sc create $serviceName binPath= `"`"$serviceHost`"`" DisplayName= `"`"MusFy Local Service`"`" start= auto" | Out-Null
cmd.exe /c "sc description $serviceName `"`"Servico local do MusFy para downloads, biblioteca e streaming.`"`"" | Out-Null
cmd.exe /c "sc config $serviceName start= delayed-auto" | Out-Null
cmd.exe /c "sc start $serviceName" | Out-Null

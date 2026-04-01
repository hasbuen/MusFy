@echo off
set MUSFY_SERVICE_BOOT=1
set HOST=0.0.0.0
for /f %%i in ('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$preferred=3001; $chosen=$null; for($p=$preferred; $p -lt ($preferred + 40); $p++){ try { $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $p); $listener.Server.ExclusiveAddressUse = $true; $listener.Start(); $listener.Stop(); $chosen = $p; break } catch { if($listener){ try { $listener.Stop() } catch {} } } }; if(-not $chosen){ $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, 0); $listener.Start(); $chosen = $listener.LocalEndpoint.Port; $listener.Stop() }; Write-Output $chosen"') do set PORT=%%i
set MUSFY_SERVICE_MODE=local-service
set MUSFY_FRONTEND_DIST=%~dp0resources\frontend-dist
"%~dp0resources\runtime\node.exe" "%~dp0resources\backend-musfy\server.js"

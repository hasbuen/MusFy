@echo off
set MUSFY_SERVICE_BOOT=1
set HOST=0.0.0.0
set PORT=3001
set MUSFY_SERVICE_MODE=local-service
set MUSFY_FRONTEND_DIST=%~dp0resources\frontend-dist
"%~dp0resources\runtime\node.exe" "%~dp0resources\backend-musfy\server.js"

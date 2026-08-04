@echo off
title ML Ofertas Bot - Painel de Controle
cls
echo ========================================================
echo   🛒 ML Ofertas Bot - Iniciando Painel Visual...
echo ========================================================
echo.
cd /d "%~dp0"
echo [INFO] Liberando porta 3000 de execucoes anteriores...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1
node dist/server.js --open || npx tsx src/server.ts --open
pause

@echo off
title ML Ofertas Bot - Painel de Controle
cls
echo ========================================================
echo   🛒 ML Ofertas Bot - Iniciando Painel Visual...
echo ========================================================
echo.
cd /d "%~dp0"
node dist/server.js || npx tsx src/server.ts
pause

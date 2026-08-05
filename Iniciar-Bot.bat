@echo off
title ML Ofertas Bot - Painel de Controle
cls
echo ========================================================
echo   🛒 ML Ofertas Bot - Iniciando Painel Visual...
echo ========================================================
echo.
cd /d "%~dp0"
echo [INFO] Liberando porta 3000 de execucoes anteriores...
echo [INFO] Compilando arquivos de codigo (npm run build)...
call npm run build
if errorlevel 1 (
  echo [ERRO] O build falhou. O bot nao sera iniciado com dist desatualizado.
  pause
  exit /b 1
)
node dist/server.js --open || npx tsx src/server.ts --open
pause

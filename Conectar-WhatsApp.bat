@echo off
title ML Ofertas Bot - Conectar WhatsApp
cls
echo ========================================================
echo   📱 Vincular WhatsApp Web - Chrome
echo ========================================================
echo.
cd /d "%~dp0"
npx tsx src/wa-connect.ts
pause

@echo off
title Conectar Instagram - ML Ofertas Bot
echo ========================================================
echo   📸 Abrindo Chrome no Instagram para Login...
echo ========================================================
echo.
echo Apos realizar o login no Instagram nesta janela, a sua
echo sessao ficara salva para postagens automaticas!
echo.
"C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%~dp0.ig-profile" "https://www.instagram.com"

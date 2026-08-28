@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Parar Painel de Tarefas
cd /d "%~dp0"

set PORTA=3000
if exist ".env" (
    for /f "tokens=2 delims==" %%p in ('findstr /b "PORT=" .env') do set PORTA=%%p
)

echo Procurando processo usando a porta !PORTA!...
echo.

set ENCONTROU=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":!PORTA! " ^| findstr "LISTENING"') do (
    set ENCONTROU=1
    echo Encontrado processo com PID %%a na porta !PORTA!. Finalizando...
    taskkill /F /PID %%a >nul 2>nul
    if !errorlevel! equ 0 (
        echo [OK] Processo finalizado.
    ) else (
        echo [ERRO] Nao foi possivel finalizar o processo %%a. Tente fechar manualmente
        echo        pelo Gerenciador de Tarefas ^(procure por "Node.js"^).
    )
)

if !ENCONTROU! equ 0 (
    echo Nenhum processo encontrado usando a porta !PORTA!.
    echo O servidor provavelmente ja esta parado.
)

echo.
pause

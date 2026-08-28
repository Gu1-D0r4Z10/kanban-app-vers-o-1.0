@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Painel de Tarefas - Ambiente de Teste
cd /d "%~dp0"

echo ================================================
echo   Painel de Tarefas - Iniciando ambiente local
echo ================================================
echo.

REM ---------- Passo 1: Node.js ----------
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao foi encontrado no seu computador.
    echo.
    echo Baixe e instale a versao LTS em: https://nodejs.org
    echo Depois de instalar, fecha esta janela e clique de novo neste arquivo.
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js encontrado:
node -v
echo.

REM ---------- Passo 2: arquivo .env ----------
if not exist ".env" (
    echo Criando arquivo de configuracao .env...
    copy ".env.example" ".env" >nul
    echo [OK] Arquivo .env criado com valores padrao.
    echo.
)

REM ---------- Passo 3: dependencias (sempre verificadas de verdade) ----------
echo Verificando se todas as dependencias estao funcionando...
node scripts\healthcheck.js >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Todas as dependencias ja estao prontas.
    echo.
) else (
    echo Algumas dependencias precisam ser instaladas/reinstaladas.
    echo Isso pode levar um minuto na primeira vez...
    echo.
    call npm install > npm-install.log 2>&1
    if !errorlevel! neq 0 (
        echo.
        echo [ERRO] A instalacao das dependencias falhou.
        echo Detalhes completos foram salvos em: npm-install.log
        echo.
        echo Abrindo as ultimas linhas do log abaixo:
        echo ------------------------------------------------
        powershell -command "Get-Content npm-install.log -Tail 25"
        echo ------------------------------------------------
        echo.
        pause
        exit /b 1
    )
    echo [OK] Dependencias instaladas.
    echo.
    echo Verificando novamente...
    node scripts\healthcheck.js
    if !errorlevel! neq 0 (
        echo.
        echo [ERRO] Ainda ha um problema apos a instalacao. Veja as mensagens acima.
        echo Se precisar de ajuda, copie toda esta tela e envie para quem te ajudou
        echo a montar este sistema.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Tudo certo agora.
    echo.
)

REM ---------- Passo 4: pasta monitorada (indexacao reversa) ----------
if not exist "watched-files" (
    mkdir "watched-files"
)

REM ---------- Passo 5: iniciar o servidor ----------
echo ================================================
echo Iniciando o servidor...
echo.
echo Assim que aparecer o endereco abaixo, acesse no navegador:
echo   http://localhost:3000
echo.
echo (A planilha "planilha.xlsx", se existir na pasta do projeto, e
echo  importada automaticamente na primeira vez que o Controle de
echo  Empresas estiver vazio - nao precisa fazer mais nada.)
echo.
echo Para PARAR o servidor, feche esta janela ou pressione Ctrl+C.
echo ================================================
echo.

call npm start

echo.
echo O servidor foi encerrado.
pause

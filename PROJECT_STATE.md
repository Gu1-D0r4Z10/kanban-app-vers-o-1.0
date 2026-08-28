# Estado do Projeto — Painel de Tarefas / Controle de Empresas

> Como usar este arquivo: suba ele **junto com o zip mais recente do projeto**
> no início de uma conversa nova (ou como conhecimento de um Project do
> Claude.ai). Isso dá ao Claude o contexto completo sem precisar do
> histórico da conversa antiga.

## O que é

Sistema local (Node.js + Express + SQLite embutido do próprio Node —
`node:sqlite`, sem dependências nativas frágeis) para um escritório de
contabilidade: quadro Kanban de tarefas + Controle de Empresas + gestão de
diretórios de clientes no servidor. Front-end em HTML/CSS/JS puro, sem
build step. Sincronização em tempo real via WebSocket.

## Stack técnico
- Back-end: Node.js 22+, Express, `node:sqlite` (não usa better-sqlite3 —
  foi removido de propósito por causar crashes nativos em certas versões
  do Node no Windows)
- Front-end: HTML/CSS/JS vanilla (`public/app.js`, `public/companies.js`,
  `public/directories.js`), sem framework
- Tempo real: `ws` (WebSocket) + `chokidar` (monitora pasta de arquivos)
- Importação de planilha: `xlsx` (SheetJS)

## Funcionalidades já prontas
- Quadro Kanban (tarefas, prioridade, responsável, recorrência, tipo de
  tarefa, competência mês/ano com seletor visual, arquivo obrigatório para
  concluir, vínculo com empresa)
- Login com permissões (admin/membro)
- Upload de arquivos + indexação reversa de pasta do servidor
- Controle de Empresas (importado de planilha, ficha completa com
  obrigações fiscais e parcelamentos, edição inline, nunca sobrescreve
  edições do site ao reimportar)
- Aba Diretórios: navega a pasta monitorada, cria estrutura padronizada de
  pastas por empresa (`código - razão_social - filial`, com espaços ao
  redor dos traços), modelo de pastas editável
- Modo escuro, redesign visual completo (sidebar, paleta roxa, cards estilo
  "Dayily")
- Importação de responsáveis e tarefas a partir da aba "Empresas" da
  planilha (preserva vínculo real empresa → responsável → prazo → status;
  não inventa nome de tarefa já que a planilha não tem essa coluna — usa
  título neutro "Obrigação mensal")
- Filtro de empresas no quadro restrito às que têm tarefa vinculada

## Em andamento / não finalizado na última sessão
Estava sendo implementado quando a conversa mudou de assunto:
- ✅ Feito: ajuste de espaçamento no nome das pastas (`123 - empresa - 0002`)
- ❌ Pendente: botão/rota para **criar as pastas de TODAS as empresas de
  uma vez** (hoje só existe criação uma-a-uma pela aba Diretórios)
- ❌ Pendente: testar e empacotar essa última leva de mudanças (importação
  de usuários/tarefas + filtro de empresas + seletor de competência) —
  o código foi escrito e testado com dados simulados, mas o zip final
  ainda não foi gerado nesta sessão

## Fases do escopo maior ainda não implementadas (Fase 3)
Empresas-modelo por regime tributário (com tarefas padrão), desconsideração
de tarefa com aprovação do administrador, Dashboard com gráficos/filtros,
transferência de tarefas em massa.

## Como rodar
`iniciar-teste.bat` (Windows) — detecta dependências, instala se precisar,
sobe o servidor. Ver `README.md` completo no projeto para detalhes,
solução de problemas, e documentação de cada funcionalidade.

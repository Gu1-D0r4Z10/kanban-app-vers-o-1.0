# Painel de Tarefas (Kanban) — Sistema Local para Equipe

Aplicação completa (front-end + back-end + banco de dados) para rodar **inteiramente
dentro do servidor da empresa**, sem depender de nenhum serviço externo na nuvem.

## O que este sistema faz

- Quadro Kanban (A Fazer / Em Andamento / Concluído) com arrastar-e-soltar
- Login com email e senha, com dois papéis de usuário: **admin** e **membro**
- Gerenciamento de usuários (criar, remover, trocar senha/papel) — só admin
- Upload e download de arquivos anexados a cada tarefa, **armazenados fisicamente
  no próprio servidor** (pasta `uploads/`)
- Banco de dados **SQLite** — um único arquivo local (`db/kanban.db`), sem precisar
  instalar MySQL/Postgres separado
- Acessível por qualquer computador da rede interna via IP do servidor
  (ex: `http://192.168.0.10:3000`)
- **Sincronia em tempo real** — quando alguém cria, move ou exclui uma tarefa,
  ou anexa um arquivo, todas as telas abertas em outros computadores se
  atualizam automaticamente (via WebSocket), sem precisar dar F5
- **Indexação reversa de arquivos** — o sistema monitora uma pasta do
  servidor (configurável) e detecta automaticamente arquivos que já existem
  lá (colocados fora do site, por exemplo via rede compartilhada), deixando-os
  disponíveis para vincular a qualquer tarefa, sem duplicar o arquivo em disco
- **Controle de Empresas** — importa os dados da sua planilha de controle
  (aba "Empresas") para dentro do sistema: lista com busca, filtros por
  status/estado/tributação/responsável, edição direto na tela, alertas de
  prazo vencendo/vencido, e um painel resumo com totais por status. Pode ser
  importada direto pela tela (upload de .xlsx) ou automaticamente ao ligar
  o servidor
- **Ficha completa da empresa** — clique em "📋 Ficha" em qualquer empresa
  para ver, num só lugar: dados gerais, todas as obrigações fiscais
  (Municipais, Estaduais, Federais, Anuais) e os parcelamentos ativos e
  encerrados, com observações
- **Tarefas recorrentes/periódicas** — marque uma tarefa para se repetir
  (diária, semanal, mensal ou anual, a cada N unidades). Ao mover para
  "Concluído", a próxima ocorrência é criada automaticamente em "A Fazer"
- **Aba Diretórios** — navega pela pasta monitorada do servidor, cria a
  estrutura padronizada de pastas por empresa (matriz/filial), com modelo
  de pastas totalmente editável, e mostra qual empresa cada pasta pertence
- **Modo escuro** — botão no topo da tela, preferência salva

## Vincular tarefa a uma empresa

No modal de tarefa, o campo **"Empresa"** busca por código ou nome — comece
digitando o código (ex: `123`) e escolha da lista que aparece. Ao selecionar:

- Se o **responsável da empresa** (campo "Usuário" da planilha) tiver uma
  conta correspondente no sistema, ela é **preenchida automaticamente** no
  campo Responsável (só quando ainda estiver vazio — não sobrescreve uma
  escolha manual)
- Se não houver conta correspondente, aparece um aviso informativo com o
  nome da pessoa, para você decidir manualmente
- O campo **"Nome/padrão esperado do arquivo"** ganha uma lista de
  sugestões que muda de acordo com o **tipo de tarefa** e o **regime
  tributário** da empresa (ex: Imposto + Simples Nacional sugere "DAS";
  Declaração + Lucro Presumido sugere "ECF"/"ECD"/"DCTF") — é só um atalho,
  o campo de texto ao lado continua livre para digitar qualquer coisa
- O card da tarefa no quadro mostra um selo 🏢 com o código da empresa

## Fases futuras (ainda não implementadas)

O escopo completo do sistema é maior do que o que está pronto hoje.
Ficaram para as próximas fases: empresas-modelo por regime tributário
(com tarefas padrão), importação de usuários e tarefas de planilha,
transferência de tarefas em massa, desconsideração de tarefa com aprovação
do administrador, e um Dashboard com gráficos e filtros interativos.

## Requisitos no servidor

- **Node.js** versão 22 ou superior instalado no servidor da empresa
  (baixe em https://nodejs.org — a versão "LTS" — caso ainda não tenha)
- Uma porta livre na rede interna (padrão: 3000)

## Passo a passo de instalação

**No Windows, o caminho mais simples é:** copie a pasta `kanban-app` para
o servidor e dê duplo clique em **`iniciar-teste.bat`**. Ele verifica o
Node.js, cria o `.env`, instala e diagnostica as dependências sozinho, e já
sobe o servidor — veja detalhes em "Solução de problemas" mais abaixo se
algo não funcionar de primeira.

Passo a passo manual (qualquer sistema operacional):

1. Copie a pasta `kanban-app` inteira para o servidor da empresa.

2. Abra um terminal dentro da pasta e instale as dependências:
   ```bash
   cd kanban-app
   npm install
   ```

3. Crie o arquivo de configuração a partir do exemplo:
   ```bash
   cp .env.example .env
   ```
   Depois edite o `.env` e ajuste, principalmente:
   - `JWT_SECRET` — troque por um texto longo e aleatório (usado para proteger os logins)
   - `ADMIN_EMAIL` e `ADMIN_PASSWORD` — credenciais do primeiro usuário administrador
   - `PORT` — porta em que o sistema vai rodar (padrão 3000)

4. (Opcional, mas recomendado) Confirme que está tudo certo antes de iniciar:
   ```bash
   npm run healthcheck
   ```

5. Inicie o servidor:
   ```bash
   npm start
   ```
   Você verá uma mensagem como:
   ```
   Painel de Tarefas rodando!
   Acesse localmente em: http://localhost:3000
   Acesse pela rede em:  http://<IP-DO-SERVIDOR>:3000
   ```

6. Descubra o IP interno do servidor (`ipconfig` no Windows ou `ip a` / `ifconfig`
   no Linux/Mac) e acesse esse endereço de qualquer computador da mesma rede,
   por exemplo: `http://192.168.0.10:3000`

7. Faça login com o email/senha de administrador definidos no `.env`. A partir
   daí, use "Gerenciar usuários" para cadastrar o restante da equipe.

## Sincronia em tempo real

Assim que o servidor sobe, ele abre um canal WebSocket em `/ws`. O front-end
conecta automaticamente e escuta eventos de tarefas e arquivos. Não precisa
configurar nada — funciona sozinho tanto em `localhost` quanto pelo IP da
rede. O indicador no topo da tela ("● em tempo real") mostra se a conexão
está ativa; se cair, ele tenta reconectar automaticamente a cada poucos
segundos.

## Indexação reversa (arquivos já existentes no servidor)

Além do upload manual pela interface, o sistema também consegue **enxergar
arquivos que já estão numa pasta do servidor** — por exemplo uma pasta de
rede compartilhada onde a equipe já guarda documentos — e permitir vincular
esses arquivos a tarefas sem duplicá-los.

1. No `.env`, defina `WATCHED_FOLDER` apontando para a pasta desejada:
   ```
   WATCHED_FOLDER=C:\Compartilhado\Projetos
   ```
   (no Linux/Mac seria algo como `/mnt/compartilhado/projetos`)

2. Ao iniciar o servidor, todo arquivo que já existir nessa pasta é indexado
   automaticamente. A partir daí, qualquer arquivo novo colocado ali —
   mesmo por fora do sistema, direto no Windows Explorer ou Finder — também
   é detectado em segundos e some da lista se for removido.

3. Dentro de uma tarefa, clique em **"🔗 Vincular arquivo já existente no
   servidor"** para escolher um desses arquivos e associá-lo à tarefa. O
   arquivo continua fisicamente no lugar original; o sistema apenas guarda
   uma referência a ele (o download busca direto do caminho original).

4. O botão **"Arquivos do servidor"** no topo mostra todos os arquivos
   indexados e permite desvincular um arquivo de uma tarefa (isso não apaga
   o arquivo do servidor, só remove a associação).

> Importante: essa pasta precisa estar acessível pelo processo Node.js que
> roda o servidor. Se for uma pasta de rede (ex: um compartilhamento SMB),
> garanta que o servidor tenha permissão de leitura contínua nela.

## Controle de Empresas (importado da sua planilha)

A aba **"Controle de Empresas"** do site é alimentada a partir da aba
"Empresas" da sua planilha `.xlsx` de controle. Assim que suas empresas
estiverem no sistema, você ganha:

- **Busca** por razão social, CNPJ ou código
- **Filtros** por status, estado, tributação e responsável
- **Edição direto na tela** (clique em "Editar" na linha): responsável,
  prazo, status/acompanhamento e procurações
- **Alertas visuais de prazo**: "Vence hoje", "Vence em breve" (próximos 3
  dias) e "Atrasado", calculados automaticamente a partir da Data Limite
- **Painel resumo** no topo com total de empresas e contagem por status
- Atualização em tempo real: se alguém editar uma empresa em outro
  computador, sua tela atualiza sozinha

### Como importar sua planilha

Duas formas, escolha a que preferir:

**Opção 1 — Direto pela tela (mais fácil, não precisa de terminal)**
1. Faça login como administrador
2. Abra a aba **"🏢 Controle de Empresas"**
3. Em "📥 Importar/atualizar da planilha", escolha o arquivo `.xlsx` e
   clique em **"Importar planilha"**

**Opção 2 — Automática ao iniciar o servidor**
Se existir um arquivo chamado `planilha.xlsx` na raiz do projeto e o
Controle de Empresas ainda estiver vazio, o sistema importa sozinho assim
que o servidor liga — não precisa fazer nada.

> O arquivo `planilha.xlsx` já vem incluído na raiz do projeto — é a
> planilha que você enviou. Quando for usar em produção, substitua esse
> arquivo pela versão mais atual (ou simplesmente use a Opção 1 pela tela).

**Opção 3 — Linha de comando** (útil para automatizar/agendar a importação)
```bash
npm run import-empresas -- "caminho/para/sua/planilha.xlsx"
```

### Atualizando com uma planilha mais recente

O site é a fonte de verdade a partir do momento em que uma empresa entra
nele. Rodar a importação de novo (com uma planilha nova ou atualizada)
**nunca sobrescreve** uma empresa que já existe no sistema — ela serve
apenas para trazer empresas que ainda não foram cadastradas (códigos novos).
Qualquer edição feita no site fica preservada, para sempre, mesmo que você
reimporte a planilha depois.

Se quiser atualizar campos de uma empresa que já existe no site, edite
direto por lá (tabela, Ficha, ou os botões "Editar" em cada seção) — não
tem mais necessidade de manter a planilha atualizada depois da importação
inicial.

### Cadastrando uma empresa nova direto pelo site

Clique em **"+ Nova Empresa"** na aba Controle de Empresas. Não precisa
estar na planilha — o sistema atribui um código novo automaticamente
(numa faixa alta, começando em 900000, para nunca colidir com códigos que
venham de uma planilha no futuro). Depois de criada, você pode preencher
obrigações fiscais e parcelamentos direto na Ficha.

### Editando obrigações e parcelamentos

Abra a **Ficha** de qualquer empresa — cada seção (Obrigações Municipais,
Estaduais, Federais, Anuais, Parcelamento Ativo, Parcelamento Encerrado)
tem um botão **"Editar"** próprio. As obrigações aceitam texto livre (ex:
"OK", "N/A", "S/M", ou qualquer outra anotação); os parcelamentos têm
campos de situação/responsável/forma de envio, checkboxes para marcar quais
tipos se aplicam, e um campo de observações.

## Ficha completa da empresa

Na aba **"🏢 Controle de Empresas"**, clique em **"📋 Ficha"** em qualquer
linha para abrir um painel único com tudo sobre aquela empresa:

- Dados gerais (responsável, prazo, procurações, envio de documentos)
- **Obrigações Municipais**: vencimento TFE, senha da prefeitura, ISS,
  escrituração, DSUP, imunidades, GBF, parcelamentos municipais
- **Obrigações Estaduais**: GUIA ICMS, DIFAL, GUIA IPI, Bloco K, SPED
  Fiscal, DeSTDA, parcelamentos estaduais
- **Obrigações Federais**: DARFs, EFD-Reinf, DAS, DCTFWeb, MIT e mais
- **Obrigações Anuais**: DEFIS, ECD, ECF, DASN-SIMEI e mais
- **Parcelamento Ativo** e **Parcelamento Encerrado**: quais tipos de
  parcelamento a empresa tem (Simples Nacional, PGFN, PMSP, etc.) e as
  observações originais da planilha (número de parcelas, datas, protocolos)

Essas informações vêm das abas "Municipais", "Estaduais", "Federais",
"Obrigações Anuais", "Parcelamentos" e "Parcelamentos Encerrados" da sua
planilha — importadas junto com o Controle de Empresas (mesma importação,
não precisa de nenhum passo extra).

## Aba Diretórios (padronização de pastas por cliente)

A aba **"📁 Diretórios"** navega pela mesma pasta que o sistema já monitora
(`WATCHED_FOLDER`, a mesma da indexação reversa) e permite:

- Navegar pelas pastas e arquivos com um caminho tipo Explorador de Arquivos
- Ver, na tela inicial, qual empresa cada pasta pertence (pelo código no
  início do nome) — pastas com código que não bate com nenhuma empresa
  aparecem marcadas como "⚠ não vinculada"
- Baixar qualquer arquivo direto pelo navegador
- Atualização em tempo real quando algo muda na pasta (por qualquer via —
  pelo site ou direto no Explorador de Arquivos do servidor)

### Criando a estrutura de pastas de um cliente

Clique em **"+ Criar pasta de cliente"**, escolha a empresa, o ano, e
(se for o caso) o número da filial. O sistema cria a pasta já com o nome
padronizado e toda a estrutura de subpastas (Fiscal/Contábil, mensal/anual).

**Nomenclatura:** `código-razão_social` (e `-filial` quando informado), por
exemplo:
```
123-empresa_exemplo_ltda-0002
```
Onde `123` é o código da empresa, `empresa_exemplo_ltda` vem da razão
social (sem acentos, em minúsculo, espaços viram `_`), e `0002` é a filial
(preenchida com zeros à esquerda quando for só números). Sem filial, o nome
fica só `123-empresa_exemplo_ltda`.

### Personalizando o modelo de pastas

Clique em **"⚙ Editar modelo de pastas"** para mudar quais subpastas são
criadas — funciona para todo mundo que ainda não tiver uma pasta própria
criada, e vale tanto para o modelo padrão (usado por toda empresa que não
tiver personalização) quanto pode futuramente ser sobrescrito por empresa
(o banco de dados já suporta isso — a tela de personalizar *por empresa*
individualmente é uma das pendências da próxima fase, mas o campo
`company_folder_templates` já existe pronto para isso).

Cada **setor** vira uma pasta de primeiro nível (ex: "01_FISCAL"). Dentro
dele:
- **Categorias mensais**: cada uma vira uma pasta com 12 subpastas (uma por
  mês) — use para documentos que chegam todo mês (notas, extratos, etc.)
- **Itens anuais**: cada um vira uma única subpasta — use para obrigações
  que só acontecem uma vez por ano (declarações, balanço, etc.)

As alterações no modelo só afetam pastas criadas **depois** da mudança —
pastas já criadas não são renomeadas ou reorganizadas automaticamente.

## Tarefas recorrentes/periódicas

Ao criar ou editar uma tarefa, o campo **"Recorrência"** permite escolher:
Diariamente, Semanalmente, Mensalmente ou Anualmente — e "a cada quantas"
unidades (ex: a cada 2 semanas). Tarefas recorrentes mostram um selo 🔁 no
card.

Quando uma tarefa recorrente é movida para **"Concluído"**, o sistema cria
automaticamente a próxima ocorrência em **"A Fazer"**, com o prazo já
calculado a partir do prazo anterior. Um aviso aparece na tela confirmando.
A tarefa concluída permanece no quadro como histórico; a nova é uma tarefa
separada.

## Solução de problemas

**O servidor não inicia / a janela fecha sem explicação:**

A forma mais fácil de descobrir o motivo é rodar o diagnóstico manualmente:
```bash
npm run healthcheck
```
Ele testa cada dependência (incluindo o banco de dados) e diz exatamente
qual está com problema e como corrigir — em vez de um erro técnico confuso.
O `iniciar-teste.bat` já roda essa verificação sozinho toda vez que é
aberto, mas rodar manualmente ajuda a ver a mensagem completa.

Causas mais comuns:

- **Faltam dependências / pasta `node_modules` desatualizada** — apague a
  pasta `node_modules` e rode `npm install` de novo. O `iniciar-teste.bat`
  agora detecta isso sozinho e reinstala automaticamente quando necessário.
- **Porta 3000 já em uso** (geralmente porque uma instância anterior do
  servidor ficou rodando em segundo plano) — rode `parar-servidor.bat`
  para liberar a porta, ou troque `PORT=3000` para outro valor no `.env`.
- **Versão do Node muito antiga** — o banco de dados usa o módulo
  `node:sqlite`, embutido no próprio Node a partir da versão 22. Instale a
  versão LTS mais recente em nodejs.org se a sua for anterior a essa.
- **Arquivos do projeto foram atualizados com o servidor ainda rodando** —
  pare o servidor (Ctrl+C ou `parar-servidor.bat`) e rode
  `iniciar-teste.bat` de novo. O Node não recarrega sozinho quando os
  arquivos mudam.

> Nota técnica: o banco de dados deste sistema usa o `node:sqlite`, que faz
> parte do próprio Node.js — não é uma biblioteca externa que precisa ser
> compilada ou baixada separadamente. Isso evita os travamentos nativos que
> aconteciam com bibliotecas de banco de dados de terceiros em certas
> combinações de versão do Node/Windows.

**"Não aparece nada" numa aba específica:**
O sistema agora mostra a mensagem de erro real na tela em vez de ficar em
branco silenciosamente. Se aparecer algo como "Cannot find module" ou um
erro de rede, geralmente um `npm run healthcheck` + reiniciar o servidor
resolve.

## Mantendo o sistema rodando continuamente

Rodar com `npm start` mantém o processo ativo apenas enquanto o terminal estiver
aberto. Para manter o sistema no ar continuamente (inclusive após reiniciar o
servidor), recomenda-se usar um gerenciador de processos, por exemplo o **PM2**:

```bash
npm install -g pm2
pm2 start server.js --name kanban-app
pm2 save
pm2 startup
```

## Acesso por HTTPS (opcional, recomendado)

Por padrão o sistema roda em HTTP simples (`http://192.168.x.x:3000`), suficiente
para uso em rede interna. Se a empresa quiser acesso por `https://`, é necessário
colocar um proxy reverso na frente (ex: **Nginx** ou **Caddy**) com um certificado
SSL — isso pode ser configurado pela equipe de TI da empresa; o sistema em si já
funciona normalmente atrás de qualquer proxy reverso.

## Backup

Os dados ficam em dois lugares dentro da pasta do projeto:
- `db/kanban.db` — banco de dados (usuários e tarefas)
- `uploads/` — arquivos anexados às tarefas

Faça backup periódico dessas duas coisas.

## Estrutura do projeto

```
kanban-app/
├── server.js               # ponto de entrada do servidor
├── iniciar-teste.bat       # inicia tudo (diagnostica e instala sozinho)
├── parar-servidor.bat      # libera a porta se um processo ficou travado
├── db/init.js               # criação das tabelas + usuário admin inicial
├── lib/                      # lógica de importação e padronização de pastas (compartilhada)
├── middleware/auth.js        # login/permissões (JWT)
├── scripts/
│   ├── healthcheck.js         # diagnóstico das dependências
│   └── import-empresas.js     # importação da planilha via terminal
├── routes/
│   ├── auth.js               # login
│   ├── users.js              # gerenciamento de usuários (admin)
│   ├── tasks.js               # CRUD de tarefas
│   ├── companies.js           # Controle de Empresas + ficha
│   ├── directories.js         # navegação/criação de pastas
│   └── files.js                # upload/download de arquivos
├── public/                # front-end (HTML/CSS/JS puro, sem build)
│   ├── login.html
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── companies.js
│   └── directories.js
└── uploads/                # arquivos anexados (criado automaticamente)
```

## Permissões

| Ação                                  | Membro | Admin |
|----------------------------------------|:------:|:-----:|
| Ver e mover tarefas                    | ✅     | ✅    |
| Criar tarefas                          | ✅     | ✅    |
| Excluir tarefa (própria)               | ✅     | ✅    |
| Excluir tarefa (de outra pessoa)       | ❌     | ✅    |
| Anexar/baixar arquivos                 | ✅     | ✅    |
| Remover arquivo (próprio)              | ✅     | ✅    |
| Remover arquivo (de outra pessoa)      | ❌     | ✅    |
| Criar/remover usuários                 | ❌     | ✅    |
| Importar planilha de empresas          | ❌     | ✅    |
| Cadastrar/editar empresas               | ✅     | ✅    |
| Excluir empresa                          | ❌     | ✅    |
| Navegar/baixar arquivos em Diretórios    | ✅     | ✅    |
| Criar pasta de cliente                   | ✅     | ✅    |
| Editar modelo padrão de pastas           | ❌     | ✅    |

## Segurança — ajustes recomendados antes de usar com dados sensíveis

- Troque `JWT_SECRET` e a senha padrão do admin antes do primeiro uso real
- Use HTTPS via proxy reverso se o acesso sair da rede interna
- Faça backup regular de `db/kanban.db` e da pasta `uploads/`

# GestãoMHZR — Sistema de Gestão de Tarefas

CRM interno de tarefas, equipe e financeiro (boletos/contratos) com portal para
empresas clientes. Front-end estático (HTML + CSS + JS puro) com banco de dados
e autenticação no **Supabase**.

## Arquitetura

- `index.html` — login e cadastro de empresa cliente (Supabase Auth).
- `app.html` — aplicação (dashboard, tarefas, kanban, equipe, financeiro, portal…).
- `js/data.js` — camada de dados: em `DB.init()` tudo que o usuário pode ver é
  carregado do Supabase para um cache em memória; leituras são síncronas e cada
  alteração é enviada ao servidor em segundo plano.
- `js/supabase-config.js` — URL + anon key do projeto (preencher, ver abaixo).
- `supabase/migrations/` — schema do banco (tabelas, RLS, RPCs, seed).

Papéis: `admin` e `employee` (equipe interna) e `company` (portal da empresa,
vê somente os próprios boletos/contrato). A segurança é garantida por policies
RLS no banco — não apenas pela interface.

## Configuração (uma vez)

1. **Criar o projeto** em [supabase.com](https://supabase.com) (org da equipe →
   New project). Guarde a senha do banco.
2. **Aplicar a migration**: Dashboard → SQL Editor → cole o conteúdo de
   `supabase/migrations/20260816120000_init_sistema_gestao.sql` → Run.
3. **Desativar confirmação de e-mail** (o cadastro do portal loga direto):
   Dashboard → Authentication → Sign In / Providers → Email → desmarque
   **Confirm email** → Save.
4. **Preencher `js/supabase-config.js`** com a URL e a chave **anon public**
   (Dashboard → Settings → API). A anon key é pública por design; quem manda é
   a RLS.
5. Abrir `index.html` e entrar com o admin inicial:
   **murillo@empresa.com / admin123** — e **trocar a senha imediatamente** em
   Configurações → Meu Perfil.

## Migrando dados da versão antiga (localStorage)

No navegador que tinha os dados reais, logue como admin e use
Configurações → Banco de Dados → **“Enviar dados antigos deste navegador”**.
Isso envia empresas, boletos, equipes e tarefas. Usuários não são migrados —
recadastre-os na tela Equipe (defina novas senhas) e os acessos de portal na
tela Financeiro → Empresas → botão de chave.

## Ambiente de teste local

Antes de subir para produção, teste tudo numa cópia local do Supabase
(precisa de Node e do Docker Desktop aberto):

1. `npx supabase start` — sobe banco, login e Storage no Docker, aplica
   **todas** as migrations em ordem e carrega `supabase/seed.sql`
   (usuários e tarefas de teste). Painel do banco: http://127.0.0.1:54323
2. `node scripts/dev-server.js` — abre o sistema em http://localhost:5500.
   Em `localhost` o `js/supabase-config.js` usa o banco **local** (aparece o
   selo "AMBIENTE DE TESTE"); em qualquer outro endereço, o de produção.
3. Logins de teste (senha `teste123`): `bruno@teste.com` (Funcionário 2),
   `carla@teste.com` (Funcionária), `diego@teste.com` (Funcionário 2),
   `cliente.casa@teste.com` (portal). Admin: `murillo@empresa.com` / `admin123`.

4. Telegram (opcional): `node scripts/mock-telegram.mjs` (imita a API do
   Telegram na porta 5600; `GET http://127.0.0.1:5600/calls` mostra as
   mensagens "enviadas") e, em outro terminal,
   `npx supabase functions serve --env-file supabase/functions/.env.local`
   com o arquivo `.env.local` contendo
   `TELEGRAM_BOT_TOKEN=123456:TESTE-LOCAL` e
   `TELEGRAM_API_BASE=http://host.docker.internal:5600`.

- `npx supabase db reset` recria o banco local do zero (migrations + seed).
- `npx supabase stop` desliga os containers.
- O seed **nunca** vai para produção: lá as migrations são rodadas à mão no
  SQL Editor, e o `seed.sql` não faz parte delas.

## Telegram (bot dos grupos de clientes)

- Código: `supabase/functions/telegram/index.ts` (Edge Function, arquivo
  único) + migration `20261031160000_telegram.sql`.
- Publicar: Supabase → Edge Functions → Deploy a new function → Via editor,
  nome `telegram`, colar o arquivo; em Settings da função, **desligar
  "Verify JWT"**. Em Edge Functions → Secrets, criar `TELEGRAM_BOT_TOKEN`
  (token do @BotFather).
- Ativar: CRM → Configurações → Telegram → endereço do sistema →
  **Salvar e ativar bot** (registra o webhook e os comandos).
- Vincular: Financeiro → Empresas → 📣 (grupo do cliente) ou Configurações →
  Telegram → Grupo da equipe. O CRM gera `/vincular@bot CÓDIGO` para colar
  no grupo.
- Login sem senha (clientes): no portal, **📱 Conectar Telegram** liga a conta
  do Telegram ao representante (uma vez). Depois o portal abre pelo bot
  (`telegram.html`, Mini App) — a função confere a assinatura do Telegram
  antes de criar a sessão. Equipe continua com e-mail e senha.

## Regras de banco

- Nunca edite uma migration já aplicada — crie uma nova
  (`supabase/migrations/AAAA MM DD HHMMSS_descricao.sql`, timestamp real).
- Tabelas novas precisam de GRANT + policies RLS (use a migration inicial como
  modelo).

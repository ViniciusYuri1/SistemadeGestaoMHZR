-- ============================================================================
-- Meta Ads: métricas das campanhas por cliente/unidade e alertas.
--
--   meta_ad_accounts     contas de anúncio ligadas a uma empresa (unidade),
--                        com os limites de alerta de cada conta.
--   meta_campaigns       campanhas (status, orçamento) — última leitura.
--   meta_insights_daily  métricas por campanha e dia (investimento, alcance,
--                        cliques, leads, conversas).
--   meta_alerts          alertas gerados (no máximo 1 por tipo/campanha/dia),
--                        avisados no grupo da equipe no Telegram.
--
-- A Edge Function "meta-sync" lê a API do Meta (token de Usuário do sistema)
-- e grava tudo por meta_ingest(). pg_cron sincroniza a cada hora.
--
-- Leitura: equipe vê tudo; representante do cliente vê as contas das
-- unidades em que tem a permissão "Ver campanhas". Nenhum dado existente é
-- alterado.
-- ============================================================================

create table if not exists public.meta_ad_accounts (
  id               uuid primary key default gen_random_uuid(),
  account_id       text not null unique,               -- act_123...
  company_id       text not null references public.companies(id) on delete cascade,
  name             text,
  currency         text,
  active           boolean not null default true,
  account_status   integer,
  disable_reason   integer,
  amount_spent     numeric,
  balance          numeric,
  spend_cap        numeric,
  cpl_max          numeric,                            -- alerta: custo por lead acima de
  spend_pct_alert  integer default 120,                -- alerta: gasto do dia acima de X% do orçamento
  last_sync_at     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  created_by       text default auth.uid()::text
);
create index if not exists meta_ad_accounts_company_idx on public.meta_ad_accounts (company_id);

create table if not exists public.meta_campaigns (
  campaign_id      text primary key,
  account_id       text not null,
  name             text,
  status           text,
  effective_status text,
  objective        text,
  daily_budget     numeric,
  lifetime_budget  numeric,
  start_time       timestamptz,
  issues           jsonb,
  updated_at       timestamptz not null default now()
);
create index if not exists meta_campaigns_account_idx on public.meta_campaigns (account_id);

create table if not exists public.meta_insights_daily (
  campaign_id    text not null,
  date           date not null,
  account_id     text not null,
  spend          numeric not null default 0,
  impressions    bigint not null default 0,
  reach          bigint not null default 0,
  clicks         bigint not null default 0,
  leads          integer not null default 0,
  conversations  integer not null default 0,
  actions        jsonb,
  updated_at     timestamptz not null default now(),
  primary key (campaign_id, date)
);
create index if not exists meta_insights_account_date_idx on public.meta_insights_daily (account_id, date);

create table if not exists public.meta_alerts (
  id          bigint generated always as identity primary key,
  account_id  text not null,
  company_id  text,
  kind        text not null,
  ref         text not null default '',
  day         date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  message     text not null,
  created_at  timestamptz not null default now(),
  unique (account_id, kind, ref, day)
);

-- API: somente leitura (gravações pelas funções)
revoke all on public.meta_ad_accounts, public.meta_campaigns, public.meta_insights_daily, public.meta_alerts from anon;
revoke insert, update, delete, truncate on public.meta_ad_accounts, public.meta_campaigns, public.meta_insights_daily, public.meta_alerts from authenticated;
grant select on public.meta_ad_accounts, public.meta_campaigns, public.meta_insights_daily, public.meta_alerts to authenticated;

alter table public.meta_ad_accounts enable row level security;
alter table public.meta_campaigns enable row level security;
alter table public.meta_insights_daily enable row level security;
alter table public.meta_alerts enable row level security;

create or replace function public.meta_visible_accounts()
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(account_id), '{}') from public.meta_ad_accounts
   where active and (public.is_staff() or company_id = any (public.my_company_ids('campaigns')));
$$;
revoke execute on function public.meta_visible_accounts() from public, anon;
grant execute on function public.meta_visible_accounts() to authenticated;

drop policy if exists meta_ad_accounts_select on public.meta_ad_accounts;
create policy meta_ad_accounts_select on public.meta_ad_accounts for select to authenticated
  using (public.is_staff() or (active and company_id = any (public.my_company_ids('campaigns'))));
drop policy if exists meta_campaigns_select on public.meta_campaigns;
create policy meta_campaigns_select on public.meta_campaigns for select to authenticated
  using (account_id = any (public.meta_visible_accounts()));
drop policy if exists meta_insights_select on public.meta_insights_daily;
create policy meta_insights_select on public.meta_insights_daily for select to authenticated
  using (account_id = any (public.meta_visible_accounts()));
drop policy if exists meta_alerts_select on public.meta_alerts;
create policy meta_alerts_select on public.meta_alerts for select to authenticated
  using (public.is_staff());

-- Chave que o pg_cron usa para chamar a sincronização
insert into private.settings (key, value)
values ('meta_sync_key', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Admin (CRM)
-- ---------------------------------------------------------------------------

create or replace function public.meta_link_account(p_company_id text, p_account_id text, p_name text default null, p_currency text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_acc text := btrim(coalesce(p_account_id, ''));
  v_id  uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores.';
  end if;
  if v_acc !~ '^(act_)?[0-9]{3,}$' then
    raise exception 'ID da conta de anúncios inválido (ex.: act_1234567890).';
  end if;
  if v_acc !~ '^act_' then v_acc := 'act_' || v_acc; end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Empresa não encontrada.';
  end if;
  insert into public.meta_ad_accounts (account_id, company_id, name, currency, active)
  values (v_acc, p_company_id, p_name, p_currency, true)
  on conflict (account_id) do update
    set company_id = excluded.company_id, active = true,
        name = coalesce(excluded.name, meta_ad_accounts.name),
        currency = coalesce(excluded.currency, meta_ad_accounts.currency)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.meta_update_account(p_id uuid, p_cpl_max numeric, p_spend_pct_alert integer, p_active boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores.';
  end if;
  update public.meta_ad_accounts
     set cpl_max = nullif(p_cpl_max, 0), spend_pct_alert = nullif(p_spend_pct_alert, 0), active = coalesce(p_active, active)
   where id = p_id;
end;
$$;

revoke execute on function public.meta_link_account(text, text, text, text) from public, anon;
revoke execute on function public.meta_update_account(uuid, numeric, integer, boolean) from public, anon;
grant execute on function public.meta_link_account(text, text, text, text) to authenticated;
grant execute on function public.meta_update_account(uuid, numeric, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Alertas
-- ---------------------------------------------------------------------------

create or replace function public.meta_raise_alert(p_acc public.meta_ad_accounts, p_kind text, p_ref text, p_message text)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_id   bigint;
  v_name text;
begin
  insert into public.meta_alerts (account_id, company_id, kind, ref, message)
  values (p_acc.account_id, p_acc.company_id, p_kind, coalesce(p_ref, ''), p_message)
  on conflict (account_id, kind, ref, day) do nothing
  returning id into v_id;
  if v_id is null then
    return 0;
  end if;
  select data ->> 'name' into v_name from public.companies where id = p_acc.company_id;
  perform public.telegram_enqueue('meta_alert', p_acc.account_id, array[p_acc.company_id], false, true,
    '⚠️ <b>Meta Ads — ' || public.tg_esc(coalesce(v_name, p_acc.name, p_acc.account_id)) || '</b>' || E'\n' || public.tg_esc(p_message),
    'Ver campanhas', '/app.html#/campaigns');
  return 1;
end;
$$;

create or replace function public.meta_money(p numeric, p_currency text)
returns text
language sql immutable
as $$
  select case when coalesce(p_currency, 'BRL') = 'BRL' then 'R$ ' else coalesce(p_currency, '') || ' ' end
         || replace(replace(replace(to_char(round(coalesce(p, 0), 2), 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.');
$$;

create or replace function public.meta_evaluate_alerts(p_account_id text)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  a      public.meta_ad_accounts;
  r      record;
  n      integer := 0;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_yday  date := v_today - 1;
  v_budget numeric;
  v_spent  numeric;
begin
  select * into a from public.meta_ad_accounts where account_id = p_account_id;
  if not found or not a.active then return 0; end if;

  -- Situação da conta (pagamento, bloqueio)
  if a.account_status is not null and a.account_status <> 1 then
    n := n + public.meta_raise_alert(a, 'account_status', a.account_status::text,
      'Conta de anúncios com problema: ' || case a.account_status
        when 2 then 'conta desativada pelo Meta'
        when 3 then 'pagamento pendente — os anúncios param até regularizar'
        when 7 then 'em análise de risco pelo Meta'
        when 8 then 'liquidação de pagamento pendente'
        when 9 then 'em período de carência de pagamento'
        when 100 then 'encerramento pendente'
        when 101 then 'conta encerrada'
        else 'status ' || a.account_status end || '.');
  end if;

  -- Limite de gastos da conta quase atingido
  if coalesce(a.spend_cap, 0) > 0 and coalesce(a.amount_spent, 0) >= a.spend_cap * 0.9 then
    n := n + public.meta_raise_alert(a, 'spend_cap', '',
      format('Limite de gastos da conta quase atingido: %s de %s.', public.meta_money(a.amount_spent, a.currency), public.meta_money(a.spend_cap, a.currency)));
  end if;

  -- Campanhas ativas reprovadas / com problema
  for r in
    select * from public.meta_campaigns
     where account_id = a.account_id and status = 'ACTIVE'
       and effective_status in ('DISAPPROVED', 'WITH_ISSUES', 'PENDING_BILLING_INFO')
  loop
    n := n + public.meta_raise_alert(a, 'campaign_issue', r.campaign_id,
      format('Campanha "%s" %s.', r.name, case r.effective_status
        when 'DISAPPROVED' then 'reprovada pelo Meta'
        when 'PENDING_BILLING_INFO' then 'parada aguardando dados de pagamento'
        else 'com problemas de veiculação' end));
  end loop;

  -- Campanha ativa (iniciada antes de ontem) sem nenhuma impressão ontem
  for r in
    select c.* from public.meta_campaigns c
     where c.account_id = a.account_id and c.effective_status = 'ACTIVE'
       and (c.start_time is null or (c.start_time at time zone 'America/Sao_Paulo')::date < v_yday)
       and coalesce((select i.impressions from public.meta_insights_daily i where i.campaign_id = c.campaign_id and i.date = v_yday), 0) = 0
  loop
    n := n + public.meta_raise_alert(a, 'no_delivery', r.campaign_id,
      format('Campanha "%s" está ativa mas não teve entrega ontem.', r.name));
  end loop;

  -- Custo por lead de ontem acima do limite
  if a.cpl_max is not null then
    for r in
      select i.*, c.name from public.meta_insights_daily i
        join public.meta_campaigns c on c.campaign_id = i.campaign_id
       where i.account_id = a.account_id and i.date = v_yday and i.spend > 0
         and ((i.leads > 0 and i.spend / i.leads > a.cpl_max) or (i.leads = 0 and i.spend >= a.cpl_max))
    loop
      n := n + public.meta_raise_alert(a, 'cpl_above', r.campaign_id,
        case when r.leads > 0
          then format('Custo por lead ontem na campanha "%s": %s (limite %s).', r.name, public.meta_money(r.spend / r.leads, a.currency), public.meta_money(a.cpl_max, a.currency))
          else format('Campanha "%s" gastou %s ontem sem nenhum lead (limite por lead %s).', r.name, public.meta_money(r.spend, a.currency), public.meta_money(a.cpl_max, a.currency)) end);
    end loop;
  end if;

  -- Gasto de hoje acima de X% do orçamento diário das campanhas ativas
  if a.spend_pct_alert is not null then
    select sum(daily_budget) into v_budget from public.meta_campaigns
     where account_id = a.account_id and effective_status = 'ACTIVE' and daily_budget > 0;
    select sum(spend) into v_spent from public.meta_insights_daily where account_id = a.account_id and date = v_today;
    if coalesce(v_budget, 0) > 0 and coalesce(v_spent, 0) > v_budget * a.spend_pct_alert / 100.0 then
      n := n + public.meta_raise_alert(a, 'overspend', '',
        format('Gasto de hoje %s passou de %s%% do orçamento diário (%s).', public.meta_money(v_spent, a.currency), a.spend_pct_alert, public.meta_money(v_budget, a.currency)));
    end if;
  end if;

  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Gravação vinda da Edge Function (service_role)
-- ---------------------------------------------------------------------------

create or replace function public.meta_ingest(p_account_id text, p_account jsonb, p_campaigns jsonb, p_insights jsonb, p_error text default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  a public.meta_ad_accounts;
  v_lead_types text[] := array['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead'];
begin
  select * into a from public.meta_ad_accounts where account_id = p_account_id;
  if not found then return 0; end if;

  if p_error is not null then
    update public.meta_ad_accounts set last_error = p_error, last_sync_at = now() where id = a.id;
    return public.meta_raise_alert(a, 'sync_error', '', 'Falha ao ler a conta no Meta: ' || p_error);
  end if;

  update public.meta_ad_accounts
     set name = coalesce(p_account ->> 'name', name),
         currency = coalesce(p_account ->> 'currency', currency),
         account_status = (p_account ->> 'account_status')::integer,
         disable_reason = (p_account ->> 'disable_reason')::integer,
         amount_spent = round((p_account ->> 'amount_spent')::numeric / 100, 2),
         balance = round((p_account ->> 'balance')::numeric / 100, 2),
         spend_cap = round(nullif((p_account ->> 'spend_cap')::numeric, 0) / 100, 2),
         last_sync_at = now(), last_error = null
   where id = a.id;

  insert into public.meta_campaigns (campaign_id, account_id, name, status, effective_status, objective, daily_budget, lifetime_budget, start_time, issues, updated_at)
  select c ->> 'id', p_account_id, c ->> 'name', c ->> 'status', c ->> 'effective_status', c ->> 'objective',
         round((c ->> 'daily_budget')::numeric / 100, 2), round((c ->> 'lifetime_budget')::numeric / 100, 2),
         (c ->> 'start_time')::timestamptz, c -> 'issues_info', now()
    from jsonb_array_elements(coalesce(p_campaigns, '[]')) c
  on conflict (campaign_id) do update
    set name = excluded.name, status = excluded.status, effective_status = excluded.effective_status,
        objective = excluded.objective, daily_budget = excluded.daily_budget, lifetime_budget = excluded.lifetime_budget,
        start_time = excluded.start_time, issues = excluded.issues, updated_at = now(), account_id = excluded.account_id;

  insert into public.meta_insights_daily (campaign_id, date, account_id, spend, impressions, reach, clicks, leads, conversations, actions, updated_at)
  select i ->> 'campaign_id', (i ->> 'date_start')::date, p_account_id,
         coalesce((i ->> 'spend')::numeric, 0), coalesce((i ->> 'impressions')::bigint, 0),
         coalesce((i ->> 'reach')::bigint, 0), coalesce((i ->> 'clicks')::bigint, 0),
         coalesce((select max((x ->> 'value')::numeric) from jsonb_array_elements(coalesce(i -> 'actions', '[]')) x
                    where x ->> 'action_type' = any (v_lead_types)), 0)::integer,
         coalesce((select sum((x ->> 'value')::numeric) from jsonb_array_elements(coalesce(i -> 'actions', '[]')) x
                    where x ->> 'action_type' = 'onsite_conversion.messaging_conversation_started_7d'), 0)::integer,
         i -> 'actions', now()
    from jsonb_array_elements(coalesce(p_insights, '[]')) i
  on conflict (campaign_id, date) do update
    set spend = excluded.spend, impressions = excluded.impressions, reach = excluded.reach, clicks = excluded.clicks,
        leads = excluded.leads, conversations = excluded.conversations, actions = excluded.actions, updated_at = now();

  return public.meta_evaluate_alerts(p_account_id);
end;
$$;

create or replace function public.meta_sync_key()
returns text
language sql stable security definer
set search_path = public
as $$
  select value from private.settings where key = 'meta_sync_key';
$$;

-- Dispara a sincronização (pg_cron)
create or replace function public.meta_kick_sync()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_url text := public.telegram_setting('functions_url');
begin
  if v_url is null or not exists (select 1 from public.meta_ad_accounts where active) then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/meta-sync?action=sync',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', public.meta_sync_key()),
    timeout_milliseconds := 60000);
exception when others then
  raise warning 'meta_kick_sync: %', sqlerrm;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'meta_raise_alert(public.meta_ad_accounts, text, text, text)', 'meta_evaluate_alerts(text)',
    'meta_ingest(text, jsonb, jsonb, jsonb, text)', 'meta_sync_key()', 'meta_kick_sync()']
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

select cron.schedule('meta-sync', '7 * * * *', 'select public.meta_kick_sync()');

-- ============================================================================
-- Integração com o Telegram: grupos por cliente/unidade e grupo da equipe.
--
--   telegram_link_codes  códigos de uso único (24 h) gerados pelo admin no
--                        CRM; no grupo, alguém envia /vincular CODIGO.
--   telegram_chats       grupos vinculados (company_id = unidade do cliente;
--                        kind = 'team' para o grupo interno da equipe).
--   notification_outbox  fila de mensagens. Gatilhos no histórico das
--                        tarefas (task_events) enfileiram os avisos; a Edge
--                        Function "telegram" envia, com novas tentativas.
--   private.settings     endereço das funções e do sistema (fora da API).
--
-- Envio imediato via pg_net; pg_cron reenvia pendentes a cada 5 minutos e
-- gera os lembretes diários (09:00 de Brasília).
--
-- Nenhum dado existente é alterado.
-- ============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.settings (
  key    text primary key,
  value  text
);

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table if not exists public.telegram_link_codes (
  code          text primary key,
  kind          text not null check (kind in ('client', 'team')),
  company_id    text references public.companies(id) on delete cascade,
  created_by    text default auth.uid()::text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '24 hours',
  used_at       timestamptz,
  used_chat_id  bigint,
  check ((kind = 'client') = (company_id is not null))
);

create table if not exists public.telegram_chats (
  id            uuid primary key default gen_random_uuid(),
  chat_id       bigint not null unique,
  kind          text not null check (kind in ('client', 'team')),
  company_id    text references public.companies(id) on delete cascade,
  title         text,
  active        boolean not null default true,
  linked_at     timestamptz not null default now(),
  linked_by     text,
  unlinked_at   timestamptz,
  check ((kind = 'client') = (company_id is not null))
);
create index if not exists telegram_chats_company_idx on public.telegram_chats (company_id) where active;

create table if not exists public.notification_outbox (
  id               bigint generated always as identity primary key,
  chat_id          bigint not null,
  kind             text not null,
  ref              text,
  text             text not null,
  button_text      text,
  button_url       text,
  status           text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts         integer not null default 0,
  last_error       text,
  created_at       timestamptz not null default now(),
  next_attempt_at  timestamptz not null default now(),
  claimed_at       timestamptz,
  sent_at          timestamptz
);
create index if not exists notification_outbox_pending_idx on public.notification_outbox (next_attempt_at) where status in ('pending', 'sending');

-- API: admin só lê (para a tela de configuração). Gravações pelas funções.
revoke all on public.telegram_link_codes, public.telegram_chats, public.notification_outbox from anon;
revoke insert, update, delete, truncate on public.telegram_link_codes, public.telegram_chats, public.notification_outbox from authenticated;
grant select on public.telegram_link_codes, public.telegram_chats, public.notification_outbox to authenticated;

alter table public.telegram_link_codes enable row level security;
alter table public.telegram_chats enable row level security;
alter table public.notification_outbox enable row level security;

drop policy if exists telegram_link_codes_select on public.telegram_link_codes;
create policy telegram_link_codes_select on public.telegram_link_codes for select to authenticated using (public.is_admin());
drop policy if exists telegram_chats_select on public.telegram_chats;
create policy telegram_chats_select on public.telegram_chats for select to authenticated using (public.is_admin());
drop policy if exists notification_outbox_select on public.notification_outbox;
create policy notification_outbox_select on public.notification_outbox for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Configuração (admin, pelo CRM)
-- ---------------------------------------------------------------------------

create or replace function public.telegram_setting(p_key text)
returns text
language sql stable security definer
set search_path = public
as $$
  select value from private.settings where key = p_key;
$$;
revoke execute on function public.telegram_setting(text) from public, anon, authenticated;

create or replace function public.set_telegram_config(p_functions_url text, p_app_url text, p_bot_username text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores.';
  end if;
  insert into private.settings (key, value) values
    ('functions_url', nullif(rtrim(btrim(coalesce(p_functions_url, '')), '/'), '')),
    ('app_url',       nullif(rtrim(btrim(coalesce(p_app_url, '')), '/'), ''))
  on conflict (key) do update set value = excluded.value;
  if p_bot_username is not null then
    insert into private.settings (key, value) values ('bot_username', nullif(btrim(p_bot_username), ''))
    on conflict (key) do update set value = excluded.value;
  end if;
end;
$$;

create or replace function public.get_telegram_config()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores.';
  end if;
  return coalesce((select jsonb_object_agg(key, value) from private.settings), '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Códigos de vinculação e vínculos (admin)
-- ---------------------------------------------------------------------------

create or replace function public.create_telegram_link_code(p_company_id text default null)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_bytes    bytea;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem vincular grupos.';
  end if;
  if p_company_id is not null and not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Empresa não encontrada.';
  end if;
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.telegram_link_codes where code = v_code);
  end loop;
  insert into public.telegram_link_codes (code, kind, company_id)
  values (v_code, case when p_company_id is null then 'team' else 'client' end, p_company_id);
  return v_code;
end;
$$;

create or replace function public.telegram_admin_unlink(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores.';
  end if;
  update public.telegram_chats set active = false, unlinked_at = now() where id = p_id;
end;
$$;

revoke execute on function public.set_telegram_config(text, text, text) from public, anon;
revoke execute on function public.get_telegram_config() from public, anon;
revoke execute on function public.create_telegram_link_code(text) from public, anon;
revoke execute on function public.telegram_admin_unlink(uuid) from public, anon;
grant execute on function public.set_telegram_config(text, text, text) to authenticated;
grant execute on function public.get_telegram_config() to authenticated;
grant execute on function public.create_telegram_link_code(text) to authenticated;
grant execute on function public.telegram_admin_unlink(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Chamadas da Edge Function (somente service_role)
-- ---------------------------------------------------------------------------

create or replace function public.telegram_link_chat(p_code text, p_chat_id bigint, p_title text, p_user text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_code  public.telegram_link_codes;
  v_name  text;
begin
  select * into v_code from public.telegram_link_codes
   where code = upper(btrim(coalesce(p_code, ''))) and used_at is null and expires_at > now()
   for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  insert into public.telegram_chats (chat_id, kind, company_id, title, active, linked_at, linked_by, unlinked_at)
  values (p_chat_id, v_code.kind, v_code.company_id, p_title, true, now(), p_user, null)
  on conflict (chat_id) do update
    set kind = excluded.kind, company_id = excluded.company_id, title = excluded.title,
        active = true, linked_at = now(), linked_by = excluded.linked_by, unlinked_at = null;

  update public.telegram_link_codes set used_at = now(), used_chat_id = p_chat_id where code = v_code.code;

  select data ->> 'name' into v_name from public.companies where id = v_code.company_id;
  return jsonb_build_object('ok', true, 'kind', v_code.kind, 'company', v_name);
end;
$$;

create or replace function public.telegram_chat_left(p_chat_id bigint)
returns void
language sql security definer
set search_path = public
as $$
  update public.telegram_chats set active = false, unlinked_at = now() where chat_id = p_chat_id and active;
$$;

create or replace function public.telegram_chat_migrated(p_old bigint, p_new bigint)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.telegram_chats where chat_id = p_new) then
    return;
  end if;
  update public.telegram_chats set chat_id = p_new where chat_id = p_old;
  update public.notification_outbox set chat_id = p_new where chat_id = p_old and status in ('pending', 'sending');
end;
$$;

-- Texto do /pendentes: materiais aguardando aprovação do grupo
create or replace function public.telegram_pending_text(p_chat_id bigint)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_chat  public.telegram_chats;
  v_lines text;
begin
  select * into v_chat from public.telegram_chats where chat_id = p_chat_id and active;
  if not found then
    return null;
  end if;
  select string_agg(format('• %s%s — desde %s',
                           public.tg_esc(t.data ->> 'title'),
                           case when v_chat.kind = 'team' then ' (' || public.tg_esc(array_to_string(array(
                             select c.data ->> 'name' from public.companies c where c.id = any (public.task_company_ids(t.data))), ', ')) || ')' else '' end,
                           to_char(a.requested_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')), E'\n' order by a.requested_at)
    into v_lines
    from public.task_approvals a
    join public.tasks t on t.id = a.task_id
   where a.status = 'pending'
     and (v_chat.kind = 'team' or v_chat.company_id = any (public.task_company_ids(t.data)));
  return coalesce('⏳ <b>Aguardando aprovação</b>' || E'\n' || v_lines, '✅ Nenhum material aguardando aprovação.');
end;
$$;

-- Fila: pega um lote para envio (evita envio em dobro com SKIP LOCKED)
create or replace function public.telegram_claim_outbox(p_limit integer default 25)
returns setof public.notification_outbox
language sql security definer
set search_path = public
as $$
  update public.notification_outbox o
     set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
   where o.id in (
     select id from public.notification_outbox
      where (status = 'pending' and next_attempt_at <= now())
         or (status = 'sending' and claimed_at < now() - interval '5 minutes')
      order by id
      limit p_limit
      for update skip locked)
  returning o.*;
$$;

create or replace function public.telegram_outbox_result(p_id bigint, p_ok boolean, p_error text default null, p_retry_after integer default null, p_chat_gone boolean default false)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_row public.notification_outbox;
begin
  select * into v_row from public.notification_outbox where id = p_id;
  if not found then return; end if;
  if p_ok then
    update public.notification_outbox set status = 'sent', sent_at = now(), last_error = null where id = p_id;
  elsif p_chat_gone or v_row.attempts >= 5 then
    update public.notification_outbox set status = 'failed', last_error = p_error where id = p_id;
    if p_chat_gone then
      perform public.telegram_chat_left(v_row.chat_id);
    end if;
  else
    update public.notification_outbox
       set status = 'pending', last_error = p_error,
           next_attempt_at = now() + make_interval(secs => coalesce(p_retry_after, 60 * v_row.attempts * v_row.attempts))
     where id = p_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Montagem e enfileiramento das mensagens
-- ---------------------------------------------------------------------------

create or replace function public.tg_esc(p text)
returns text
language sql immutable
as $$
  select replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

create or replace function public.telegram_enqueue(p_kind text, p_ref text, p_company_ids text[], p_to_clients boolean, p_to_team boolean,
                                                   p_text text, p_button_text text default null, p_button_path text default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_app  text := public.telegram_setting('app_url');
  v_url  text := case when v_app is not null and p_button_path is not null then v_app || p_button_path end;
  v_n    integer;
begin
  insert into public.notification_outbox (chat_id, kind, ref, text, button_text, button_url)
  select distinct c.chat_id, p_kind, p_ref, p_text, case when v_url is not null then p_button_text end, v_url
    from public.telegram_chats c
   where c.active
     and ((p_to_clients and c.kind = 'client' and c.company_id = any (coalesce(p_company_ids, '{}')))
       or (p_to_team and c.kind = 'team'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Avisos a partir do histórico das tarefas
create or replace function public.telegram_on_task_event()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_task      public.tasks;
  v_cos       text[];
  v_title     text;
  v_cos_names text;
  v_actor     text;
  d           jsonb := new.data;
begin
  if new.type not in ('approval_requested', 'approval_decided', 'status_changed') then
    return null;
  end if;
  if new.type = 'status_changed' and (d ->> 'to') is distinct from 'concluida' then
    return null;
  end if;

  select * into v_task from public.tasks where id = new.task_id;
  if not found then return null; end if;
  v_cos := public.task_company_ids(v_task.data);
  v_title := public.tg_esc(v_task.data ->> 'title');
  v_cos_names := public.tg_esc(array_to_string(array(select c.data ->> 'name' from public.companies c where c.id = any (v_cos)), ', '));
  v_actor := public.tg_esc((select p.data ->> 'name' from public.profiles p where p.id::text = new.actor));

  if new.type = 'approval_requested' then
    perform public.telegram_enqueue('approval_requested', new.task_id, v_cos, true, false,
      '📝 <b>Novo material para aprovação</b>' || E'\n' || '<b>' || v_title || '</b>'
      || case when jsonb_typeof(d -> 'files') = 'array' and jsonb_array_length(d -> 'files') > 0
              then E'\n📎 ' || public.tg_esc(array_to_string(array(select jsonb_array_elements_text(d -> 'files')), ', ')) else '' end
      || case when coalesce(d ->> 'message', '') <> '' then E'\n💬 ' || public.tg_esc(d ->> 'message') else '' end
      || E'\n\nAbra o portal para ver o material e aprovar ou pedir ajustes.',
      'Ver e aprovar', '/app.html#/portal');

  elsif new.type = 'approval_decided' then
    if d ->> 'decision' = 'approved' then
      perform public.telegram_enqueue('approval_decided', new.task_id, v_cos, true, false,
        '✅ <b>Material aprovado</b>' || E'\n' || v_title
        || case when (d ->> 'onBehalf')::boolean then E'\nAprovação registrada pela equipe.' else E'\nAprovado por ' || coalesce(v_actor, 'cliente') || '. Obrigado!' end,
        'Abrir portal', '/app.html#/portal');
      perform public.telegram_enqueue('approval_decided', new.task_id, v_cos, false, true,
        '✅ <b>' || coalesce(nullif(v_cos_names, ''), 'Cliente') || '</b> aprovou o material' || E'\n' || '<b>' || v_title || '</b>'
        || case when (d ->> 'onBehalf')::boolean then E'\n(registrado por ' || coalesce(v_actor, 'equipe') || ')' else E'\nPor ' || coalesce(v_actor, 'cliente') end,
        'Abrir no CRM', '/app.html#/tasks');
    else
      perform public.telegram_enqueue('approval_decided', new.task_id, v_cos, true, false,
        '✏️ <b>Ajustes solicitados</b>' || E'\n' || v_title || E'\n' || '“' || public.tg_esc(d ->> 'reason') || '”'
        || E'\nA equipe já foi avisada e vai enviar uma nova versão.',
        'Abrir portal', '/app.html#/portal');
      perform public.telegram_enqueue('approval_decided', new.task_id, v_cos, false, true,
        '✏️ <b>' || coalesce(nullif(v_cos_names, ''), 'Cliente') || '</b> pediu ajustes' || E'\n' || '<b>' || v_title || '</b>'
        || E'\n' || '“' || public.tg_esc(d ->> 'reason') || '”'
        || case when (d ->> 'onBehalf')::boolean then E'\n(registrado por ' || coalesce(v_actor, 'equipe') || ')' else E'\nPor ' || coalesce(v_actor, 'cliente') end,
        'Abrir no CRM', '/app.html#/tasks');
    end if;

  else -- concluída sem passar pela aprovação (a aprovação já avisou)
    if exists (select 1 from public.task_events e
                where e.task_id = new.task_id and e.type = 'approval_decided' and e.created_at = new.created_at) then
      return null;
    end if;
    perform public.telegram_enqueue('task_done', new.task_id, v_cos, true, false,
      '🎉 <b>Tarefa concluída</b>' || E'\n' || v_title, 'Abrir portal', '/app.html#/portal');
  end if;
  return null;
end;
$$;

drop trigger if exists telegram_on_task_event on public.task_events;
create trigger telegram_on_task_event after insert on public.task_events
  for each row execute function public.telegram_on_task_event();

-- Lembretes diários
create or replace function public.telegram_enqueue_reminders()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  r      record;
  v_n    integer := 0;
  v_team integer := 0;
  v_list text;
begin
  -- Clientes: materiais esperando há mais de 20 h
  for r in
    select c.chat_id,
           string_agg('• ' || public.tg_esc(t.data ->> 'title') || ' (há ' ||
                      greatest(1, extract(day from now() - a.requested_at)::int) || ' dia(s))', E'\n' order by a.requested_at) as lines
      from public.telegram_chats c
      join public.task_approvals a on a.status = 'pending' and a.requested_at < now() - interval '20 hours'
      join public.tasks t on t.id = a.task_id and c.company_id = any (public.task_company_ids(t.data))
     where c.active and c.kind = 'client'
     group by c.chat_id
  loop
    insert into public.notification_outbox (chat_id, kind, text, button_text, button_url)
    values (r.chat_id, 'reminder_client',
            '⏰ <b>Lembrete: material aguardando aprovação</b>' || E'\n' || r.lines,
            case when public.telegram_setting('app_url') is not null then 'Ver e aprovar' end,
            case when public.telegram_setting('app_url') is not null then public.telegram_setting('app_url') || '/app.html#/portal' end);
    v_n := v_n + 1;
  end loop;

  -- Equipe: atrasadas, vencendo hoje e aprovações paradas
  select concat_ws(E'\n\n',
           (select '🔴 <b>Atrasadas</b>' || E'\n' || string_agg('• ' || public.tg_esc(t.data ->> 'title') || ' — ' || to_char((t.data ->> 'dueDate')::date, 'DD/MM'), E'\n' order by t.data ->> 'dueDate')
              from (select * from public.tasks
                     where coalesce(data ->> 'status', '') <> 'concluida' and coalesce((data ->> 'archived')::boolean, false) = false
                       and data ->> 'dueDate' ~ '^\d{4}-\d{2}-\d{2}$' and (data ->> 'dueDate') < to_char(current_date, 'YYYY-MM-DD')
                     order by data ->> 'dueDate' limit 15) t),
           (select '🟡 <b>Vencem hoje</b>' || E'\n' || string_agg('• ' || public.tg_esc(t.data ->> 'title'), E'\n')
              from public.tasks t
             where coalesce(t.data ->> 'status', '') <> 'concluida' and coalesce((t.data ->> 'archived')::boolean, false) = false
               and (t.data ->> 'dueDate') = to_char(current_date, 'YYYY-MM-DD')),
           (select '⏳ <b>Aprovações paradas há mais de 2 dias</b>' || E'\n' || string_agg('• ' || public.tg_esc(t.data ->> 'title'), E'\n')
              from public.task_approvals a join public.tasks t on t.id = a.task_id
             where a.status = 'pending' and a.requested_at < now() - interval '2 days'))
    into v_list;

  if coalesce(v_list, '') <> '' then
    insert into public.notification_outbox (chat_id, kind, text, button_text, button_url)
    select c.chat_id, 'digest_team', '📋 <b>Resumo do dia</b>' || E'\n\n' || v_list,
           case when public.telegram_setting('app_url') is not null then 'Abrir o CRM' end,
           case when public.telegram_setting('app_url') is not null then public.telegram_setting('app_url') || '/app.html#/tasks' end
      from public.telegram_chats c where c.active and c.kind = 'team';
    get diagnostics v_team = row_count;
  end if;
  return v_n + v_team;
end;
$$;

-- Dispara o envio (pg_net). Nunca derruba a transação de quem chamou.
create or replace function public.telegram_kick_dispatch()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_url text := public.telegram_setting('functions_url');
begin
  if v_url is null then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/telegram?action=dispatch',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000);
exception when others then
  raise warning 'telegram_kick_dispatch: %', sqlerrm;
end;
$$;

create or replace function public.telegram_outbox_kick()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.telegram_kick_dispatch();
  return null;
end;
$$;

drop trigger if exists telegram_outbox_kick on public.notification_outbox;
create trigger telegram_outbox_kick after insert on public.notification_outbox
  for each statement execute function public.telegram_outbox_kick();

do $$
declare
  f text;
begin
  foreach f in array array[
    'telegram_link_chat(text, bigint, text, text)', 'telegram_chat_left(bigint)', 'telegram_chat_migrated(bigint, bigint)',
    'telegram_pending_text(bigint)', 'telegram_claim_outbox(integer)', 'telegram_outbox_result(bigint, boolean, text, integer, boolean)',
    'telegram_enqueue(text, text, text[], boolean, boolean, text, text, text)', 'telegram_enqueue_reminders()',
    'telegram_kick_dispatch()']
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- Agendamentos (o nome torna a chamada idempotente)
select cron.schedule('telegram-dispatch', '*/5 * * * *', 'select public.telegram_kick_dispatch()');
select cron.schedule('telegram-reminders', '0 12 * * *', 'select public.telegram_enqueue_reminders()');

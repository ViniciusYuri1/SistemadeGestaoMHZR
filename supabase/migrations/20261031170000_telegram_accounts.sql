-- ============================================================================
-- Login sem senha pelo Telegram (Mini App) para representantes de clientes.
--
-- 1. Logado no portal (e-mail e senha), o representante clica em "Conectar
--    Telegram": gera um token de uso único (15 min) e abre o bot com
--    /start c_<token>. O bot liga a conta do Telegram ao perfil.
-- 2. Depois, o portal abre dentro do Telegram (Mini App). A Edge Function
--    confere a assinatura do Telegram (initData) e devolve uma sessão só
--    para a conta ligada. Um link vazado não abre nada: sem a assinatura do
--    Telegram da própria pessoa não há login.
--
-- Só contas de portal (role 'company') entram pelo Telegram; a equipe
-- continua com e-mail e senha. Nenhum dado existente é alterado.
-- ============================================================================

create table if not exists public.telegram_accounts (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  tg_user_id   bigint not null unique,
  tg_username  text,
  tg_name      text,
  linked_at    timestamptz not null default now()
);

create table if not exists public.telegram_connect_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes',
  used_at     timestamptz
);

revoke all on public.telegram_accounts, public.telegram_connect_tokens from anon;
revoke insert, update, delete, truncate on public.telegram_accounts from authenticated;
revoke all on public.telegram_connect_tokens from authenticated;
grant select on public.telegram_accounts to authenticated;

alter table public.telegram_accounts enable row level security;
alter table public.telegram_connect_tokens enable row level security;

drop policy if exists telegram_accounts_select on public.telegram_accounts;
create policy telegram_accounts_select on public.telegram_accounts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Nome do bot para o portal montar o link (qualquer usuário logado)
create or replace function public.telegram_public_info()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object('bot_username', public.telegram_setting('bot_username'));
$$;

create or replace function public.create_telegram_connect_token()
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if coalesce(public.app_role(), '') <> 'company' then
    raise exception 'O login pelo Telegram é para contas do portal do cliente.';
  end if;
  delete from public.telegram_connect_tokens where user_id = auth.uid() and used_at is null;
  v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
  insert into public.telegram_connect_tokens (token, user_id) values (v_token, auth.uid());
  return v_token;
end;
$$;

create or replace function public.telegram_disconnect_me()
returns void
language sql security definer
set search_path = public
as $$
  delete from public.telegram_accounts where user_id = auth.uid();
$$;

-- Admin desconecta o Telegram de um representante (ex.: celular perdido)
create or replace function public.telegram_admin_disconnect(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores.';
  end if;
  delete from public.telegram_accounts where user_id = p_user_id;
end;
$$;

revoke execute on function public.telegram_public_info() from public, anon;
revoke execute on function public.create_telegram_connect_token() from public, anon;
revoke execute on function public.telegram_disconnect_me() from public, anon;
revoke execute on function public.telegram_admin_disconnect(uuid) from public, anon;
grant execute on function public.telegram_public_info() to authenticated;
grant execute on function public.create_telegram_connect_token() to authenticated;
grant execute on function public.telegram_disconnect_me() to authenticated;
grant execute on function public.telegram_admin_disconnect(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Chamadas da Edge Function (somente service_role)
-- ---------------------------------------------------------------------------

create or replace function public.telegram_connect_user(p_token text, p_tg_user_id bigint, p_username text, p_name text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_tok  public.telegram_connect_tokens;
  v_name text;
begin
  select * into v_tok from public.telegram_connect_tokens
   where token = p_token and used_at is null and expires_at > now()
   for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  update public.telegram_connect_tokens set used_at = now() where token = p_token;

  -- Uma conta do Telegram liga a um único perfil (e vice-versa)
  delete from public.telegram_accounts where tg_user_id = p_tg_user_id and user_id <> v_tok.user_id;
  insert into public.telegram_accounts (user_id, tg_user_id, tg_username, tg_name)
  values (v_tok.user_id, p_tg_user_id, p_username, p_name)
  on conflict (user_id) do update
    set tg_user_id = excluded.tg_user_id, tg_username = excluded.tg_username,
        tg_name = excluded.tg_name, linked_at = now();

  select data ->> 'name' into v_name from public.profiles where id = v_tok.user_id;
  return jsonb_build_object('ok', true, 'name', v_name);
end;
$$;

-- Quem é este usuário do Telegram? (só contas de portal)
create or replace function public.telegram_login_lookup(p_tg_user_id bigint)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object('user_id', p.id, 'email', u.email, 'name', p.data ->> 'name')
    from public.telegram_accounts a
    join public.profiles p on p.id = a.user_id and p.role = 'company'
    join auth.users u on u.id = p.id
   where a.tg_user_id = p_tg_user_id;
$$;

revoke execute on function public.telegram_connect_user(text, bigint, text, text) from public, anon, authenticated;
revoke execute on function public.telegram_login_lookup(bigint) from public, anon, authenticated;
grant execute on function public.telegram_connect_user(text, bigint, text, text) to service_role;
grant execute on function public.telegram_login_lookup(bigint) to service_role;

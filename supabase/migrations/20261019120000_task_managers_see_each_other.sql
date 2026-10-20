-- ============================================================================
-- "Funcionário 2" (employee com a permissão "tasks:manage") passa a ver as
-- tarefas cujo responsável também é Funcionário 2. Funcionários comuns
-- continuam vendo só as próprias tarefas (e as que encaminharam/participaram).
--
-- Como a permissão fica em profiles.data.permissions e cada usuário pode
-- atualizar o próprio perfil, o trigger de proteção passa a impedir que
-- alguém que não seja admin altere essa lista (evita autoconcessão).
--
-- Não altera nem apaga dados.
-- ============================================================================

create or replace function public.is_task_manager(p_user text default null)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select role = 'employee' and coalesce(data -> 'permissions', '[]'::jsonb) ? 'tasks:manage'
    from public.profiles
    where id::text = coalesce(p_user, auth.uid()::text)
  ), false);
$$;

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role
      or new.company_id is distinct from old.company_id
      or (new.data -> 'permissions') is distinct from (old.data -> 'permissions'))
     and not public.is_admin() then
    raise exception 'Apenas administradores podem alterar papel, empresa ou permissões de um perfil.';
  end if;
  return new;
end;
$$;

drop policy if exists tasks_select on public.tasks;

create policy tasks_select on public.tasks for select to authenticated
  using (
    public.is_admin()
    or (data ->> 'assignee') = auth.uid()::text
    or (data -> 'participants') ? auth.uid()::text
    or (data -> 'companyIds') ? public.my_company()
    or (public.is_task_manager() and public.is_task_manager(data ->> 'assignee'))
  );

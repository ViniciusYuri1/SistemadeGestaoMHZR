-- ============================================================================
-- Representantes de clientes com acesso a uma ou mais unidades.
--
-- company_members liga um usuário de portal (role 'company') a uma unidade
-- (companies) com permissões por área. A empresa "principal" do perfil
-- (profiles.company_id) continua valendo como acesso total enquanto não
-- houver uma linha explícita para ela — assim os acessos de portal que já
-- existem seguem funcionando exatamente como antes.
--
-- As policies de empresas, boletos e tarefas passam a usar my_company_ids(),
-- mantendo o isolamento entre clientes no banco. Nenhum dado é alterado.
-- ============================================================================

create table if not exists public.company_members (
  user_id             uuid not null references public.profiles(id) on delete cascade,
  company_id          text not null references public.companies(id) on delete cascade,
  can_view_tasks      boolean not null default true,
  can_approve         boolean not null default false,
  can_view_financial  boolean not null default false,
  can_view_campaigns  boolean not null default false,
  created_at          timestamptz not null default now(),
  created_by          text default auth.uid()::text,
  primary key (user_id, company_id)
);

create index if not exists company_members_company_idx on public.company_members (company_id);

grant select, insert, update, delete on public.company_members to authenticated;

alter table public.company_members enable row level security;

drop policy if exists company_members_select on public.company_members;
create policy company_members_select on public.company_members for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists company_members_write on public.company_members;
create policy company_members_write on public.company_members for all to authenticated
  using (public.is_admin())
  with check (
    public.is_admin()
    and exists (select 1 from public.profiles p where p.id = company_members.user_id and p.role = 'company')
  );

-- Unidades que o usuário logado (de portal) acessa. p_perm: 'tasks',
-- 'approve', 'financial', 'campaigns' ou null (qualquer acesso).
create or replace function public.my_company_ids(p_perm text default null)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct s.cid), '{}'::text[])
  from (
    select m.company_id as cid
      from public.company_members m
      join public.profiles p on p.id = m.user_id and p.role = 'company'
     where m.user_id = auth.uid()
       and case p_perm
             when 'tasks'     then m.can_view_tasks
             when 'approve'   then m.can_approve
             when 'financial' then m.can_view_financial
             when 'campaigns' then m.can_view_campaigns
             else true
           end
    union
    select p.company_id
      from public.profiles p
     where p.id = auth.uid() and p.role = 'company' and p.company_id is not null
       and not exists (
         select 1 from public.company_members m
          where m.user_id = p.id and m.company_id = p.company_id
       )
  ) s;
$$;

revoke execute on function public.my_company_ids(text) from public, anon;
grant execute on function public.my_company_ids(text) to authenticated;

-- Empresas: o representante enxerga todas as unidades a que tem acesso.
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (public.is_staff() or id = any (public.my_company_ids()));

-- Boletos: só com permissão de financeiro.
drop policy if exists boletos_select on public.boletos;
create policy boletos_select on public.boletos for select to authenticated
  using (public.is_staff() or (data ->> 'companyId') = any (public.my_company_ids('financial')));

-- Tarefas: mesmas regras da migration 20261019, trocando a empresa única
-- pela lista de unidades com permissão de ver tarefas.
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    public.is_admin()
    or (data ->> 'assignee') = auth.uid()::text
    or (data -> 'participants') ? auth.uid()::text
    or (data -> 'companyIds') ?| public.my_company_ids('tasks')
    or (public.is_task_manager() and public.is_task_manager(data ->> 'assignee'))
  );

-- ============================================================================
-- Tarefas passam a poder ser vinculadas a mais de uma empresa.
--
-- O campo data.companyId (texto) vira data.companyIds (array jsonb).
-- Tarefas existentes são convertidas; a política de leitura do portal
-- passa a liberar a tarefa para qualquer empresa presente no array.
-- ============================================================================

update public.tasks
set data = (data - 'companyId') || jsonb_build_object(
  'companyIds',
  case
    when coalesce(data ->> 'companyId', '') <> '' then jsonb_build_array(data ->> 'companyId')
    else '[]'::jsonb
  end
)
where not (data ? 'companyIds');

drop index if exists public.tasks_company_idx;
create index tasks_company_ids_idx on public.tasks using gin ((data -> 'companyIds'));

drop policy if exists tasks_select on public.tasks;

create policy tasks_select on public.tasks for select to authenticated
  using (
    public.is_admin()
    or (data ->> 'assignee') = auth.uid()::text
    or (data -> 'companyIds') ? public.my_company()
  );

-- ============================================================================
-- Encaminhamento de tarefas entre funcionários.
--
-- Quando uma tarefa é encaminhada, o responsável (assignee) muda. Quem já
-- participou dela fica registrado em data.participants e continua podendo
-- ler (acompanhar/comentar). Sem isso, o próprio encaminhamento falharia:
-- o upsert relê a linha e ela deixaria de ser visível para quem encaminhou.
--
-- Não altera nem apaga dados; só troca a política de leitura.
-- ============================================================================

drop policy if exists tasks_select on public.tasks;

create policy tasks_select on public.tasks for select to authenticated
  using (
    public.is_admin()
    or (data ->> 'assignee') = auth.uid()::text
    or (data -> 'participants') ? auth.uid()::text
    or (data -> 'companyIds') ? public.my_company()
  );

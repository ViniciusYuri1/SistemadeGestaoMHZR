-- ============================================================================
-- Aprovação de materiais pelo cliente.
--
-- Cada "rodada" de aprovação é uma linha em task_approvals: a equipe escolhe
-- os arquivos, que passam a ficar visíveis ao cliente, e a tarefa vai para
-- "Aguardando aprovação". O representante com permissão de aprovar decide:
--   aprovado          → tarefa "Concluída"
--   ajustes (motivo)  → tarefa "Em ajustes"
--
-- Gravações só pelas funções abaixo (security definer): a API não permite
-- inserir, alterar nem apagar rodadas diretamente, então a decisão do
-- cliente fica registrada de forma definitiva. Cada passo também entra no
-- histórico permanente (task_events).
--
-- Nenhum dado existente é alterado.
-- ============================================================================

create table if not exists public.task_approvals (
  id            uuid primary key default gen_random_uuid(),
  task_id       text not null,
  file_ids      uuid[] not null default '{}',
  message       text,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by  text default auth.uid()::text,
  requested_at  timestamptz not null default now(),
  decided_by    text,
  decided_at    timestamptz,
  reason        text,
  on_behalf     boolean not null default false
);

create index if not exists task_approvals_task_idx on public.task_approvals (task_id, requested_at);
-- No máximo uma rodada aberta por tarefa.
create unique index if not exists task_approvals_one_pending
  on public.task_approvals (task_id) where status = 'pending';

-- O Supabase concede tudo por padrão em tabelas novas; aqui a API só lê.
revoke all on public.task_approvals from anon;
revoke insert, update, delete, truncate on public.task_approvals from authenticated;
grant select on public.task_approvals to authenticated;

alter table public.task_approvals enable row level security;

-- Lê quem enxerga a tarefa (a subconsulta respeita a RLS de tasks).
drop policy if exists task_approvals_select on public.task_approvals;
create policy task_approvals_select on public.task_approvals for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_approvals.task_id));

-- ---------------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------------

create or replace function public.task_company_ids(p_data jsonb)
returns text[]
language sql immutable
as $$
  select case
    when jsonb_typeof(p_data -> 'companyIds') = 'array' and jsonb_array_length(p_data -> 'companyIds') > 0
      then array(select jsonb_array_elements_text(p_data -> 'companyIds'))
    when coalesce(p_data ->> 'companyId', '') <> ''
      then array[p_data ->> 'companyId']
    else '{}'::text[]
  end;
$$;

-- Troca o status no documento da tarefa, com as mesmas regras do app
-- (concluir marca completedAt; sair de concluída limpa a data).
create or replace function public.task_data_with_status(p_data jsonb, p_status text)
returns jsonb
language sql immutable
as $$
  select p_data
    || jsonb_build_object('status', p_status, 'updatedAt', to_char(current_date, 'YYYY-MM-DD'))
    || case
         when p_status = 'concluida' and coalesce(p_data ->> 'status', '') <> 'concluida'
           then jsonb_build_object('completedAt', to_char(current_date, 'YYYY-MM-DD'))
         when p_status <> 'concluida'
           then jsonb_build_object('completedAt', null, 'archived', false)
         else '{}'::jsonb
       end;
$$;

-- ---------------------------------------------------------------------------
-- Equipe: enviar material para aprovação
-- ---------------------------------------------------------------------------

create or replace function public.request_task_approval(p_task_id text, p_file_ids uuid[], p_message text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_task      public.tasks;
  v_files     uuid[];
  v_names     text[];
  v_cancelled uuid;
  v_id        uuid;
  v_from      text;
begin
  if not public.is_staff() then
    raise exception 'Apenas a equipe pode solicitar aprovação.';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Tarefa não encontrada.';
  end if;
  if cardinality(public.task_company_ids(v_task.data)) = 0 then
    raise exception 'Vincule a tarefa a uma empresa cliente antes de pedir aprovação.';
  end if;

  select coalesce(array_agg(f.id order by f.created_at), '{}'), coalesce(array_agg(f.name order by f.created_at), '{}')
    into v_files, v_names
    from public.task_files f
   where f.task_id = p_task_id and f.removed_at is null and f.id = any (coalesce(p_file_ids, '{}'));
  if cardinality(v_files) = 0 then
    raise exception 'Selecione ao menos um arquivo para enviar ao cliente.';
  end if;

  -- Um novo envio substitui a rodada que estava aberta.
  update public.task_approvals
     set status = 'cancelled', decided_at = now(), decided_by = auth.uid()::text
   where task_id = p_task_id and status = 'pending'
  returning id into v_cancelled;

  insert into public.task_approvals (task_id, file_ids, message, requested_by)
  values (p_task_id, v_files, nullif(btrim(coalesce(p_message, '')), ''), auth.uid()::text)
  returning id into v_id;

  update public.task_files set shared_with_client = true where id = any (v_files);

  v_from := v_task.data ->> 'status';
  update public.tasks
     set data = public.task_data_with_status(data, 'aguardando_aprovacao')
   where id = p_task_id;

  insert into public.task_events (task_id, actor, type, visibility, data)
  values (p_task_id, auth.uid()::text, 'approval_requested', 'client',
          jsonb_build_object('approvalId', v_id, 'fileIds', to_jsonb(v_files), 'files', to_jsonb(v_names),
                             'message', nullif(btrim(coalesce(p_message, '')), ''), 'replaces', v_cancelled));
  if v_from is distinct from 'aguardando_aprovacao' then
    insert into public.task_events (task_id, actor, type, visibility, data)
    values (p_task_id, auth.uid()::text, 'status_changed', 'client',
            jsonb_build_object('from', v_from, 'to', 'aguardando_aprovacao'));
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cliente (ou a equipe, registrando em nome dele): aprovar / pedir ajustes
-- ---------------------------------------------------------------------------

create or replace function public.decide_task_approval(p_approval_id uuid, p_decision text, p_reason text default null)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_appr      public.task_approvals;
  v_task      public.tasks;
  v_staff     boolean := public.is_staff();
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
  v_status    text;
  v_from      text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decisão inválida.';
  end if;
  if p_decision = 'rejected' and coalesce(length(v_reason), 0) < 3 then
    raise exception 'Descreva o que precisa ser ajustado.';
  end if;

  select * into v_appr from public.task_approvals where id = p_approval_id for update;
  if not found then
    raise exception 'Solicitação de aprovação não encontrada.';
  end if;
  select * into v_task from public.tasks where id = v_appr.task_id for update;
  if not found then
    raise exception 'Tarefa não encontrada.';
  end if;

  -- Equipe só registra em nome do cliente se gerencia tarefas (admin ou
  -- Funcionário 2), como na tela.
  if v_staff and not (public.is_admin() or public.is_task_manager()) then
    raise exception 'Apenas administradores e Funcionário 2 podem registrar a decisão do cliente.';
  end if;
  if not v_staff and not (public.task_company_ids(v_task.data) && public.my_company_ids('approve')) then
    raise exception 'Você não tem permissão para aprovar materiais desta unidade.';
  end if;
  if v_appr.status <> 'pending' then
    raise exception 'Esta solicitação já foi respondida ou substituída por um envio mais recente.';
  end if;

  update public.task_approvals
     set status = p_decision, decided_at = now(), decided_by = auth.uid()::text,
         reason = v_reason, on_behalf = v_staff
   where id = p_approval_id;

  -- Aprovado vai para "aprovada" (a equipe ainda finaliza/publica e conclui).
  v_status := case when p_decision = 'approved' then 'aprovada' else 'ajustes' end;
  v_from := v_task.data ->> 'status';
  update public.tasks
     set data = public.task_data_with_status(data, v_status)
   where id = v_task.id;

  insert into public.task_events (task_id, actor, type, visibility, data)
  values (v_task.id, auth.uid()::text, 'approval_decided', 'client',
          jsonb_build_object('approvalId', p_approval_id, 'decision', p_decision, 'reason', v_reason, 'onBehalf', v_staff));
  if v_from is distinct from v_status then
    insert into public.task_events (task_id, actor, type, visibility, data)
    values (v_task.id, auth.uid()::text, 'status_changed', 'client',
            jsonb_build_object('from', v_from, 'to', v_status));
  end if;

  -- Aparece em "Atividades recentes" da equipe.
  insert into public.activities (id, data)
  values ('act_appr_' || replace(p_approval_id::text, '-', ''),
          jsonb_build_object(
            'id', 'act_appr_' || replace(p_approval_id::text, '-', ''),
            'user', auth.uid()::text,
            'text', case when p_decision = 'approved'
                         then format('aprovou o material da tarefa "%s"', v_task.data ->> 'title')
                         else format('pediu ajustes na tarefa "%s"', v_task.data ->> 'title') end
                    || case when v_staff then ' (registrado pela equipe)' else '' end,
            'date', to_char(current_date, 'YYYY-MM-DD')))
  on conflict (id) do nothing;

  return v_status;
end;
$$;

revoke execute on function public.request_task_approval(text, uuid[], text) from public, anon;
grant execute on function public.request_task_approval(text, uuid[], text) to authenticated;
revoke execute on function public.decide_task_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_task_approval(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Coerência entre o status da tarefa e a rodada de aprovação.
--
-- O app grava o documento inteiro da tarefa; uma tela aberta há tempo
-- poderia devolver "Aguardando aprovação" depois que o cliente já decidiu.
-- Regras:
--   * só entra em "Aguardando aprovação" com uma rodada aberta (pelo botão
--     "Solicitar aprovação"); senão o status anterior é mantido;
--   * se a equipe tira a tarefa de "Aguardando aprovação", a rodada aberta é
--     cancelada (o cliente deixa de ver os botões de decisão).
-- ---------------------------------------------------------------------------

create or replace function public.guard_task_approval_status()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_old text := old.data ->> 'status';
  v_new text := new.data ->> 'status';
  v_pending uuid;
begin
  if v_old is not distinct from v_new then
    return new;
  end if;

  select id into v_pending from public.task_approvals
   where task_id = new.id and status = 'pending';

  if v_new = 'aguardando_aprovacao' and v_pending is null then
    new.data := new.data || jsonb_build_object(
      'status', old.data -> 'status',
      'completedAt', coalesce(old.data -> 'completedAt', 'null'::jsonb),
      'archived', coalesce(old.data -> 'archived', 'false'::jsonb));
    return new;
  end if;

  if v_old = 'aguardando_aprovacao' and v_pending is not null then
    update public.task_approvals
       set status = 'cancelled', decided_at = now(), decided_by = auth.uid()::text
     where id = v_pending;
    insert into public.task_events (task_id, actor, type, visibility, data)
    values (new.id, auth.uid()::text, 'approval_cancelled', 'client',
            jsonb_build_object('approvalId', v_pending, 'to', v_new));
  end if;

  return new;
end;
$$;

drop trigger if exists guard_task_approval_status on public.tasks;
create trigger guard_task_approval_status before update on public.tasks
  for each row execute function public.guard_task_approval_status();

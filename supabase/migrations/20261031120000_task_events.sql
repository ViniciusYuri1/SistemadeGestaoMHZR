-- ============================================================================
-- Histórico permanente das tarefas (task_events).
--
-- Cada linha é um acontecimento: criação, troca de status, encaminhamento,
-- comentário, edição de campos, arquivamento e (nas próximas etapas)
-- solicitações e decisões de aprovação. Só aceita inserção: não há policy de
-- update/delete, então o histórico não pode ser alterado nem apagado pela API.
--
-- visibility = 'client' marca os eventos que o cliente da tarefa pode ver;
-- 'internal' fica restrito à equipe.
--
-- O histórico que já existe dentro das tarefas (comentários, encaminhamentos
-- e a data de criação) é copiado para cá. Nada é removido das tarefas.
-- ============================================================================

create table if not exists public.task_events (
  id          uuid primary key default gen_random_uuid(),
  task_id     text not null,
  created_at  timestamptz not null default now(),
  actor       text default auth.uid()::text,
  type        text not null,
  visibility  text not null default 'internal' check (visibility in ('internal', 'client')),
  data        jsonb not null default '{}'::jsonb
);

create index if not exists task_events_task_idx on public.task_events (task_id, created_at);

grant select, insert on public.task_events to authenticated;

alter table public.task_events enable row level security;

-- Lê quem enxerga a tarefa (a subconsulta respeita a RLS de tasks);
-- clientes só veem os eventos marcados como 'client'.
drop policy if exists task_events_select on public.task_events;
create policy task_events_select on public.task_events for select to authenticated
  using (
    exists (select 1 from public.tasks t where t.id = task_events.task_id)
    and (public.is_staff() or visibility = 'client')
  );

-- Equipe registra eventos em nome próprio, só de tarefas que enxerga.
drop policy if exists task_events_insert on public.task_events;
create policy task_events_insert on public.task_events for insert to authenticated
  with check (
    public.is_staff()
    and actor = auth.uid()::text
    and exists (select 1 from public.tasks t where t.id = task_events.task_id)
  );

-- ---------------------------------------------------------------------------
-- Cópia do histórico existente (idempotente: só roda para tarefas que ainda
-- não têm nenhum evento).
-- ---------------------------------------------------------------------------

create or replace function pg_temp.safe_ts(p text, p_fallback timestamptz)
returns timestamptz
language plpgsql
as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}' then
    return p_fallback;
  end if;
  return p::timestamptz;
exception when others then
  return p_fallback;
end;
$$;

do $$
begin
  if exists (select 1 from public.task_events) then
    return;
  end if;

  insert into public.task_events (task_id, created_at, actor, type, visibility, data)
  select t.id,
         pg_temp.safe_ts(t.data ->> 'createdAt', t.updated_at),
         null,
         'created',
         'client',
         jsonb_build_object('title', t.data ->> 'title', 'backfill', true)
    from public.tasks t;

  insert into public.task_events (task_id, created_at, actor, type, visibility, data)
  select t.id,
         pg_temp.safe_ts(c ->> 'date', t.updated_at),
         c ->> 'author',
         'comment',
         'internal',
         jsonb_build_object('text', c ->> 'text', 'backfill', true)
    from public.tasks t
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(t.data -> 'comments') = 'array' then t.data -> 'comments' else '[]'::jsonb end
    ) c;

  insert into public.task_events (task_id, created_at, actor, type, visibility, data)
  select t.id,
         pg_temp.safe_ts(h ->> 'date', t.updated_at),
         coalesce(h ->> 'by', h ->> 'from'),
         'forwarded',
         'internal',
         jsonb_build_object('from', h ->> 'from', 'to', h ->> 'to', 'note', h ->> 'note', 'backfill', true)
    from public.tasks t
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(t.data -> 'handoffs') = 'array' then t.data -> 'handoffs' else '[]'::jsonb end
    ) h;
end;
$$;

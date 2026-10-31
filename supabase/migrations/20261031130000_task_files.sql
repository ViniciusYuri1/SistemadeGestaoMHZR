-- ============================================================================
-- Arquivos reais das tarefas (artes, imagens, vídeos, PDFs) com versões.
--
-- Os binários ficam no Storage, bucket privado "task-files", no caminho
-- <task_id>/<uuid>-<nome>. A tabela task_files guarda os metadados e as
-- versões: arquivos do mesmo material compartilham group_id e cada envio
-- incrementa version.
--
-- Quem lê um arquivo = quem enxerga a linha em task_files, que por sua vez
-- exige enxergar a tarefa (RLS de tasks). Clientes só veem arquivos com
-- shared_with_client = true (marcados ao solicitar aprovação).
--
-- Não há policy de DELETE (nem na tabela nem no Storage): "remover" é um
-- soft delete (removed_at), preservando o histórico de versões.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('task-files', 'task-files', false)
on conflict (id) do nothing;

create table if not exists public.task_files (
  id                  uuid primary key default gen_random_uuid(),
  task_id             text not null,
  group_id            uuid not null,
  version             integer not null default 1,
  name                text not null,
  path                text not null unique,
  mime                text,
  size                bigint,
  uploaded_by         text default auth.uid()::text,
  created_at          timestamptz not null default now(),
  shared_with_client  boolean not null default false,
  removed_at          timestamptz,
  removed_by          text,
  unique (group_id, version)
);

create index if not exists task_files_task_idx on public.task_files (task_id, created_at);

grant select, insert, update on public.task_files to authenticated;

alter table public.task_files enable row level security;

drop policy if exists task_files_select on public.task_files;
create policy task_files_select on public.task_files for select to authenticated
  using (
    exists (select 1 from public.tasks t where t.id = task_files.task_id)
    and (public.is_staff() or (shared_with_client and removed_at is null))
  );

drop policy if exists task_files_insert on public.task_files;
create policy task_files_insert on public.task_files for insert to authenticated
  with check (
    public.is_staff()
    and uploaded_by = auth.uid()::text
    and exists (select 1 from public.tasks t where t.id = task_files.task_id)
  );

-- Equipe pode marcar como compartilhado / remover (soft delete).
drop policy if exists task_files_update on public.task_files;
create policy task_files_update on public.task_files for update to authenticated
  using (public.is_staff() and exists (select 1 from public.tasks t where t.id = task_files.task_id))
  with check (public.is_staff());

-- Os campos de identidade do arquivo não mudam depois do envio.
create or replace function public.protect_task_file_fields()
returns trigger
language plpgsql
as $$
begin
  if new.task_id is distinct from old.task_id or new.group_id is distinct from old.group_id
     or new.version is distinct from old.version or new.path is distinct from old.path
     or new.uploaded_by is distinct from old.uploaded_by or new.created_at is distinct from old.created_at then
    raise exception 'Os dados de envio de um arquivo não podem ser alterados.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_task_file_fields on public.task_files;
create trigger protect_task_file_fields before update on public.task_files
  for each row execute function public.protect_task_file_fields();

-- ---------------------------------------------------------------------------
-- Storage: acesso aos binários do bucket task-files
-- ---------------------------------------------------------------------------

drop policy if exists task_files_objects_read on storage.objects;
create policy task_files_objects_read on storage.objects for select to authenticated
  using (
    bucket_id = 'task-files'
    and exists (select 1 from public.task_files f where f.path = storage.objects.name)
  );

drop policy if exists task_files_objects_insert on storage.objects;
create policy task_files_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-files'
    and public.is_staff()
    and exists (select 1 from public.tasks t where t.id = (storage.foldername(name))[1])
  );

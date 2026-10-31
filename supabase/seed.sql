-- ============================================================================
-- Dados de TESTE do ambiente local (supabase start / supabase db reset).
-- Nunca é aplicado em produção: lá as migrations são rodadas manualmente.
--
-- Logins (senha de todos: teste123, exceto o admin da migration inicial):
--   murillo@empresa.com / admin123   → Administrador
--   bruno@teste.com                  → Funcionário 2 (tasks:manage)
--   carla@teste.com                  → Funcionária
--   diego@teste.com                  → Funcionário 2
--   cliente.casa@teste.com           → Portal da empresa "Panobianco dos Casa"
-- ============================================================================

alter table public.profiles disable trigger protect_profile_fields;

do $$
declare
  v_admin  uuid := (select id from public.profiles where data ->> 'email' = 'murillo@empresa.com');
  v_bruno  uuid;
  v_carla  uuid;
  v_diego  uuid;
  v_client uuid;
begin
  v_bruno  := public.create_auth_user_internal('bruno@teste.com', 'teste123', '{"name":"Bruno"}');
  v_carla  := public.create_auth_user_internal('carla@teste.com', 'teste123', '{"name":"Carla"}');
  v_diego  := public.create_auth_user_internal('diego@teste.com', 'teste123', '{"name":"Diego"}');
  v_client := public.create_auth_user_internal('cliente.casa@teste.com', 'teste123', '{"name":"Rep. Panobianco dos Casa"}');

  update public.profiles set role = 'employee', data = jsonb_build_object(
    'name', 'Bruno', 'email', 'bruno@teste.com', 'position', 'Designer', 'avatar', 'BR', 'status', 'offline',
    'permissions', jsonb_build_array('tasks:own', 'tasks:manage'), 'performance', 0, 'team', 'team_1', 'createdAt', '2026-10-01')
  where id = v_bruno;

  update public.profiles set role = 'employee', data = jsonb_build_object(
    'name', 'Carla', 'email', 'carla@teste.com', 'position', 'Audiovisual', 'avatar', 'CA', 'status', 'offline',
    'permissions', jsonb_build_array('tasks:own'), 'performance', 0, 'team', 'team_1', 'createdAt', '2026-10-01')
  where id = v_carla;

  update public.profiles set role = 'employee', data = jsonb_build_object(
    'name', 'Diego', 'email', 'diego@teste.com', 'position', 'Gestor de Tráfego', 'avatar', 'DI', 'status', 'offline',
    'permissions', jsonb_build_array('tasks:own', 'tasks:manage'), 'performance', 0, 'team', 'team_1', 'createdAt', '2026-10-01')
  where id = v_diego;

  update public.profiles set role = 'company', company_id = 'co_1', data = jsonb_build_object(
    'name', 'Rep. Panobianco dos Casa', 'email', 'cliente.casa@teste.com', 'position', 'Portal Empresa', 'avatar', 'PC',
    'status', 'offline', 'permissions', jsonb_build_array('boletos:own'), 'performance', 0, 'createdAt', '2026-10-01')
  where id = v_client;

  insert into public.tasks (id, data) values
  ('task_seed_1', jsonb_build_object(
    'id', 'task_seed_1', 'title', 'Post Black Friday — carrossel', 'description', 'Carrossel com 3 cards para o feed.',
    'assignee', v_bruno::text, 'priority', 'alta', 'status', 'em_andamento', 'startDate', '2026-10-28', 'dueDate', '2026-11-05',
    'tags', jsonb_build_array('instagram', 'design'), 'checklist', jsonb_build_array(jsonb_build_object('text', 'Rascunho', 'done', true)),
    'comments', jsonb_build_array(jsonb_build_object('id', 'c1', 'author', v_admin::text, 'text', 'Usar a paleta nova da marca', 'date', '2026-10-29T13:00:00Z')),
    'attachments', jsonb_build_array(jsonb_build_object('name', 'briefing-antigo.docx', 'url', '#')),
    'handoffs', '[]'::jsonb, 'timeLogged', 2, 'archived', false, 'createdAt', '2026-10-28', 'updatedAt', '2026-10-29',
    'companyIds', jsonb_build_array('co_1', 'co_2'), 'participants', jsonb_build_array(v_admin::text, v_bruno::text))),
  ('task_seed_2', jsonb_build_object(
    'id', 'task_seed_2', 'title', 'Vídeo institucional — corte de 30s', 'description', 'Edição para Reels.',
    'assignee', v_carla::text, 'priority', 'media', 'status', 'nao_iniciada', 'startDate', '2026-10-25', 'dueDate', '2026-11-10',
    'tags', jsonb_build_array('video'), 'checklist', '[]'::jsonb, 'comments', '[]'::jsonb, 'attachments', '[]'::jsonb,
    'handoffs', jsonb_build_array(jsonb_build_object('from', v_bruno::text, 'to', v_carla::text, 'by', v_bruno::text, 'note', 'Roteiro aprovado, falta editar', 'date', '2026-10-30T18:00:00Z')),
    'timeLogged', 0, 'archived', false, 'createdAt', '2026-10-25', 'updatedAt', '2026-10-30',
    'companyIds', jsonb_build_array('co_1'), 'participants', jsonb_build_array(v_admin::text, v_bruno::text, v_carla::text))),
  ('task_seed_3', jsonb_build_object(
    'id', 'task_seed_3', 'title', 'Campanha leads — ajuste de público', 'description', 'Revisar segmentação.',
    'assignee', v_diego::text, 'priority', 'urgente', 'status', 'em_revisao', 'startDate', '2026-10-20', 'dueDate', '2026-10-30',
    'tags', jsonb_build_array('meta-ads'), 'checklist', '[]'::jsonb, 'comments', 'null'::jsonb, 'attachments', '[]'::jsonb,
    'handoffs', '[]'::jsonb, 'timeLogged', 1, 'archived', false, 'createdAt', 'data inválida', 'updatedAt', '2026-10-29',
    'companyIds', jsonb_build_array('co_6'), 'participants', jsonb_build_array(v_admin::text, v_diego::text)));
end;
$$;

-- O seed roda depois das migrations, então a cópia do histórico (task_events)
-- não alcança estas tarefas: cria os eventos iniciais como em produção.
insert into public.task_events (task_id, created_at, actor, type, visibility, data) values
  ('task_seed_1', '2026-10-28 12:00+00', null, 'created', 'client', '{"backfill": true}'),
  ('task_seed_1', '2026-10-29 13:00+00', (select id::text from public.profiles where data ->> 'email' = 'murillo@empresa.com'), 'comment', 'internal', '{"text": "Usar a paleta nova da marca", "backfill": true}'),
  ('task_seed_2', '2026-10-25 12:00+00', null, 'created', 'client', '{"backfill": true}'),
  ('task_seed_3', '2026-10-29 12:00+00', null, 'created', 'client', '{"backfill": true}');

alter table public.profiles enable trigger protect_profile_fields;

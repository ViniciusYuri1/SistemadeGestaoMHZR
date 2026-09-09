-- ============================================================================
-- Custos operacionais (Financeiro > Custos): tipo, descrição, período (mês de
-- referência) e valor. Usado para calcular o Lucro Líquido (Total Recebido
-- dos boletos - Total de Custos). Tela restrita ao admin no client, então a
-- policy também restringe leitura e escrita a admin (não a staff em geral).
-- ============================================================================

create table public.costs (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index costs_month_idx on public.costs ((data ->> 'month'));

create trigger set_updated_at before update on public.costs
  for each row execute function public.set_updated_at();

alter table public.costs enable row level security;

grant select, insert, update, delete on public.costs to authenticated;

create policy costs_all on public.costs for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Synthetic checkout: config per store, run history; fleet view columns

create table public.synthetic_checkout_configs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  start_url text not null,
  selectors jsonb not null default '{}'::jsonb,
  success_path_includes text not null default 'checkout',
  timeout_seconds int not null default 120 check (timeout_seconds > 0 and timeout_seconds <= 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index synthetic_checkout_configs_organization_id_idx
  on public.synthetic_checkout_configs (organization_id);

create table public.synthetic_checkout_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  status text not null check (status in ('success', 'failure', 'skipped')),
  step text not null,
  error_message text,
  duration_ms int,
  final_url text,
  ran_at timestamptz not null default now()
);

create index synthetic_checkout_runs_store_ran_idx
  on public.synthetic_checkout_runs (store_id, ran_at desc);

alter table public.synthetic_checkout_configs enable row level security;
alter table public.synthetic_checkout_runs enable row level security;

create policy synthetic_checkout_configs_select_member
  on public.synthetic_checkout_configs
  for select
  to authenticated
  using (organization_id in (select public.user_organization_ids()));

create policy synthetic_checkout_configs_insert_admin
  on public.synthetic_checkout_configs
  for insert
  to authenticated
  with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy synthetic_checkout_configs_update_admin
  on public.synthetic_checkout_configs
  for update
  to authenticated
  using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy synthetic_checkout_configs_delete_admin
  on public.synthetic_checkout_configs
  for delete
  to authenticated
  using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy synthetic_checkout_runs_select_member
  on public.synthetic_checkout_runs
  for select
  to authenticated
  using (organization_id in (select public.user_organization_ids()));

grant select, insert, update, delete on public.synthetic_checkout_configs to authenticated;
grant select on public.synthetic_checkout_runs to authenticated;

-- Fleet view: last synthetic run
create or replace view public.fleet_status
with (security_invoker = true) as
select
  s.id as store_id,
  s.organization_id,
  s.name as store_name,
  s.platform,
  s.base_url,
  s.enabled,
  pr.checked_at as last_checked_at,
  pr.status as last_status,
  pr.http_status as last_http_status,
  pr.duration_ms as last_duration_ms,
  pr.error_message as last_error,
  pr.region as last_region,
  i.id as open_incident_id,
  i.status as open_incident_status,
  i.opened_at as open_incident_opened_at,
  i.title as open_incident_title,
  sc.status as last_synthetic_status,
  sc.step as last_synthetic_step,
  sc.error_message as last_synthetic_error,
  sc.ran_at as last_synthetic_at,
  sc.final_url as last_synthetic_final_url
from public.stores s
left join lateral (
  select *
  from public.probe_runs pr2
  where pr2.store_id = s.id
  order by pr2.checked_at desc
  limit 1
) pr on true
left join lateral (
  select inc.*
  from public.incidents inc
  where inc.store_id = s.id
    and inc.status = 'open'
    and inc.kind = 'uptime'
  order by inc.opened_at desc
  limit 1
) i on true
left join lateral (
  select scr.status, scr.step, scr.error_message, scr.ran_at, scr.final_url
  from public.synthetic_checkout_runs scr
  where scr.store_id = s.id
  order by scr.ran_at desc
  limit 1
) sc on true;

grant select on public.fleet_status to authenticated;

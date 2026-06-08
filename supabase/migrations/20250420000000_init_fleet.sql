-- The Watcher: orgs, stores, probe runs, RLS, fleet view, signup hook

-- Extensions
create extension if not exists "pgcrypto";

-- Organizations
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Membership (links auth.users to orgs)
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_members_user_id_idx on public.organization_members (user_id);

-- Monitored stores
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  platform text not null default 'generic' check (platform in ('shopify', 'woocommerce', 'generic')),
  base_url text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index stores_organization_id_idx on public.stores (organization_id);

-- Probe results written by workers (service role); readable under RLS
create table public.probe_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  region text not null default 'default',
  status text not null check (status in ('success', 'failure', 'degraded')),
  http_status int,
  duration_ms int,
  error_message text,
  checked_at timestamptz not null default now()
);

create index probe_runs_store_id_checked_at_idx on public.probe_runs (store_id, checked_at desc);

-- Fleet view: last probe per store (security_invoker so RLS applies as the dashboard user)
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
  pr.region as last_region
from public.stores s
left join lateral (
  select *
  from public.probe_runs pr2
  where pr2.store_id = s.id
  order by pr2.checked_at desc
  limit 1
) pr on true;

-- RLS
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.stores enable row level security;
alter table public.probe_runs enable row level security;

-- Helper: orgs current user belongs to
create or replace function public.user_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where user_id = auth.uid();
$$;

grant execute on function public.user_organization_ids() to authenticated;

-- organizations: members can read
create policy organizations_select_member
  on public.organizations
  for select
  to authenticated
  using (id in (select public.user_organization_ids()));

-- organization_members: read own memberships (and peers in same org optional — keep minimal)
create policy organization_members_select_self
  on public.organization_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- stores: members of org can read
create policy stores_select_member
  on public.stores
  for select
  to authenticated
  using (organization_id in (select public.user_organization_ids()));

-- stores: owners/admins can insert
create policy stores_insert_admin
  on public.stores
  for insert
  to authenticated
  with check (
    organization_id in (
      select organization_id
      from public.organization_members
      where user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  );

-- stores: owners/admins can update
create policy stores_update_admin
  on public.stores
  for update
  to authenticated
  using (
    organization_id in (
      select organization_id
      from public.organization_members
      where user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  )
  with check (
    organization_id in (
      select organization_id
      from public.organization_members
      where user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  );

-- probe_runs: readable if store in user's org
create policy probe_runs_select_member
  on public.probe_runs
  for select
  to authenticated
  using (
    store_id in (
      select s.id
      from public.stores s
      where s.organization_id in (select public.user_organization_ids())
    )
  );

-- No insert/update/delete for authenticated on probe_runs — workers use service role

-- New Supabase Auth user → personal org + owner membership
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  org_name text;
begin
  org_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(new.email, '@', 1)
  ) || '''s workspace';

  insert into public.organizations (name)
  values (org_name)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user();

-- Grants for PostgREST
grant usage on schema public to anon, authenticated;
grant select on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant select, insert, update on public.stores to authenticated;
grant select on public.probe_runs to authenticated;
grant select on public.fleet_status to authenticated;

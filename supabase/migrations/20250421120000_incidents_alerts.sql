-- Incidents, notification channels, alert rules, delivery log; fleet view update

-- Where alerts go (Slack incoming webhook URL, etc.)
create table public.notification_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  channel_type text not null default 'slack_webhook'
    check (channel_type in ('slack_webhook')),
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index notification_channels_organization_id_idx
  on public.notification_channels (organization_id);

-- One rule per store for MVP (which channel + how many consecutive failures)
create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  notification_channel_id uuid not null references public.notification_channels (id) on delete restrict,
  failure_threshold int not null default 2 check (failure_threshold >= 1),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id)
);

create index alert_rules_organization_id_idx on public.alert_rules (organization_id);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  kind text not null default 'uptime' check (kind in ('uptime')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  title text not null,
  summary text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  acknowledged_at timestamptz,
  updated_at timestamptz not null default now()
);

create index incidents_store_status_idx on public.incidents (store_id, status);
create index incidents_organization_id_idx on public.incidents (organization_id);

create unique index incidents_one_open_uptime_per_store
  on public.incidents (store_id)
  where status = 'open' and kind = 'uptime';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  incident_id uuid references public.incidents (id) on delete set null,
  notification_channel_id uuid references public.notification_channels (id) on delete set null,
  event_type text not null check (event_type in ('opened', 'recovered', 'test')),
  delivery_status text not null check (delivery_status in ('pending', 'sent', 'failed', 'skipped')),
  provider_status int,
  error_message text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index notifications_organization_id_idx on public.notifications (organization_id);
create index notifications_incident_id_idx on public.notifications (incident_id);

alter table public.notification_channels enable row level security;
alter table public.alert_rules enable row level security;
alter table public.incidents enable row level security;
alter table public.notifications enable row level security;

-- Channels: org members read; owner/admin write
create policy notification_channels_select_member
  on public.notification_channels
  for select
  to authenticated
  using (organization_id in (select public.user_organization_ids()));

create policy notification_channels_insert_admin
  on public.notification_channels
  for insert
  to authenticated
  with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy notification_channels_update_admin
  on public.notification_channels
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

create policy notification_channels_delete_admin
  on public.notification_channels
  for delete
  to authenticated
  using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- Alert rules
create policy alert_rules_select_member
  on public.alert_rules
  for select
  to authenticated
  using (organization_id in (select public.user_organization_ids()));

create policy alert_rules_insert_admin
  on public.alert_rules
  for insert
  to authenticated
  with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy alert_rules_update_admin
  on public.alert_rules
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

create policy alert_rules_delete_admin
  on public.alert_rules
  for delete
  to authenticated
  using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- Incidents: members read; members may acknowledge / resolve (dashboard trust)
create policy incidents_select_member
  on public.incidents
  for select
  to authenticated
  using (organization_id in (select public.user_organization_ids()));

create policy incidents_update_member
  on public.incidents
  for update
  to authenticated
  using (organization_id in (select public.user_organization_ids()))
  with check (organization_id in (select public.user_organization_ids()));

-- Notifications log: read-only for members
create policy notifications_select_member
  on public.notifications
  for select
  to authenticated
  using (organization_id in (select public.user_organization_ids()));

-- Worker uses service role for inserts on incidents/notifications

-- Refresh fleet view with optional open incident
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
  i.title as open_incident_title
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
) i on true;

grant select, insert, update, delete on public.notification_channels to authenticated;
grant select, insert, update, delete on public.alert_rules to authenticated;
grant select, update on public.incidents to authenticated;
grant select on public.notifications to authenticated;

-- Recreate may not re-apply grants in all setups
grant select on public.fleet_status to authenticated;

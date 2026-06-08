-- Stitch Express checkout monitoring: run metadata, incidents, fleet view

alter table public.synthetic_checkout_runs
  add column if not exists stitch_express_is_top boolean,
  add column if not exists first_payment_method_text text;

alter table public.incidents drop constraint if exists incidents_kind_check;
alter table public.incidents
  add constraint incidents_kind_check
  check (kind in ('uptime', 'stitch_checkout'));

create unique index if not exists incidents_one_open_stitch_per_store
  on public.incidents (store_id)
  where status = 'open' and kind = 'stitch_checkout';

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
  i_uptime.id as open_incident_id,
  i_uptime.status as open_incident_status,
  i_uptime.opened_at as open_incident_opened_at,
  i_uptime.title as open_incident_title,
  sc.status as last_synthetic_status,
  sc.step as last_synthetic_step,
  sc.error_message as last_synthetic_error,
  sc.ran_at as last_synthetic_at,
  sc.final_url as last_synthetic_final_url,
  sc.stitch_express_is_top as last_stitch_express_is_top,
  sc.first_payment_method_text as last_first_payment_method_text,
  i_stitch.id as open_stitch_incident_id,
  i_stitch.title as open_stitch_incident_title,
  i_stitch.opened_at as open_stitch_incident_opened_at
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
) i_uptime on true
left join lateral (
  select inc.*
  from public.incidents inc
  where inc.store_id = s.id
    and inc.status = 'open'
    and inc.kind = 'stitch_checkout'
  order by inc.opened_at desc
  limit 1
) i_stitch on true
left join lateral (
  select
    scr.status,
    scr.step,
    scr.error_message,
    scr.ran_at,
    scr.final_url,
    scr.stitch_express_is_top,
    scr.first_payment_method_text
  from public.synthetic_checkout_runs scr
  where scr.store_id = s.id
  order by scr.ran_at desc
  limit 1
) sc on true;

grant select on public.fleet_status to authenticated;

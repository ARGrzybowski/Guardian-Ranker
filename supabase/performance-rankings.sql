begin;

create table public.guardian_performance (
  membership_id text primary key references public.guardian_index(membership_id) on delete cascade,
  rating_version text not null default 'GR-3.0',
  points bigint check (points >= 0),
  eligible boolean not null default false check (not eligible or points is not null),
  metrics jsonb not null default '[]',
  competitive_peak integer check (competitive_peak >= 0),
  commendations integer check (commendations >= 0),
  last_rated_at timestamptz,
  next_rating_at timestamptz not null default now(),
  consecutive_errors integer not null default 0
);
create index guardian_performance_due on public.guardian_performance(next_rating_at, membership_id);
create index guardian_performance_points on public.guardian_performance(points desc, membership_id)
  where eligible and rating_version = 'GR-3.0';
alter table public.guardian_performance enable row level security;
revoke all on public.guardian_performance from public, anon, authenticated;
grant all on public.guardian_performance to service_role;
grant select (membership_id, rating_version, points, eligible, metrics, commendations, last_rated_at)
  on public.guardian_performance to anon, authenticated;
create policy public_performance_snapshots on public.guardian_performance for select to anon, authenticated
using (
  rating_version = 'GR-3.0' and last_rated_at >= now() - interval '7 days'
  and exists (
    select 1 from public.guardian_index g where g.membership_id = guardian_performance.membership_id
      and g.canonical_membership_id is null and g.profile_status = 'public' and g.last_refreshed_at is not null
  )
);

create table public.guardian_performance_catalog (
  singleton boolean primary key default true check (singleton),
  payload jsonb not null
);
alter table public.guardian_performance_catalog enable row level security;
revoke all on public.guardian_performance_catalog from public, anon, authenticated;
grant all on public.guardian_performance_catalog to service_role;
insert into public.guardian_performance_catalog (payload)
select jsonb_build_object('version', payload->'version', 'activities', payload->'activities', 'checked_at', payload->'checked_at')
from public.guardian_rating_manifest where payload->>'projection_version' = '2' and payload->>'ready' = 'true';

create view public.guardian_performance_rankings with (security_invoker = true) as
select s.membership_id, g.bungie_name, s.points, s.rating_version, s.last_rated_at as last_refreshed_at,
  rank() over (order by s.points desc) as standing,
  count(*) over () as cohort_size,
  case when count(*) over () >= 30 then (100.0 * cume_dist() over (order by s.points))::numeric(6,2) end as percentile
from public.guardian_performance s join public.guardian_index g using (membership_id)
where s.eligible and s.rating_version = 'GR-3.0' and s.last_rated_at >= now() - interval '7 days'
  and g.canonical_membership_id is null and g.profile_status = 'public' and g.last_refreshed_at is not null;

create view public.guardian_performance_reports with (security_invoker = true) as
select s.membership_id, s.rating_version, s.points, s.eligible, s.metrics, s.last_rated_at,
  r.standing, r.cohort_size, r.percentile
from public.guardian_performance s join public.guardian_index g using (membership_id)
left join public.guardian_performance_rankings r using (membership_id)
where s.rating_version = 'GR-3.0' and s.last_rated_at >= now() - interval '7 days'
  and g.canonical_membership_id is null and g.profile_status = 'public' and g.last_refreshed_at is not null;

create view public.guardian_knowledge_rankings with (security_invoker = true) as
select membership_id, bungie_name, triumph_score, last_refreshed_at,
  rank() over (order by triumph_score desc) as standing,
  count(*) over () as cohort_size,
  case when count(*) over () >= 30 then (100.0 * cume_dist() over (order by triumph_score))::numeric(6,2) end as percentile
from public.guardian_index
where profile_status = 'public' and canonical_membership_id is null
  and last_refreshed_at >= now() - interval '14 days' and highest_guardian_rank >= 7 and triumph_score >= 10000;

create view public.guardian_commendation_rankings with (security_invoker = true) as
select s.membership_id, g.bungie_name, s.commendations, s.last_rated_at as last_refreshed_at,
  rank() over (order by s.commendations desc) as standing,
  count(*) over () as cohort_size,
  case when count(*) over () >= 30 then (100.0 * cume_dist() over (order by s.commendations))::numeric(6,2) end as percentile
from public.guardian_performance s join public.guardian_index g using (membership_id)
where s.rating_version = 'GR-3.0' and s.last_rated_at >= now() - interval '7 days'
  and g.profile_status = 'public' and g.canonical_membership_id is null and g.last_refreshed_at is not null
  and g.highest_guardian_rank >= 7 and s.commendations >= 500;

revoke all on public.guardian_performance_rankings, public.guardian_performance_reports,
  public.guardian_knowledge_rankings, public.guardian_commendation_rankings from public, anon, authenticated;
grant select on public.guardian_performance_rankings, public.guardian_performance_reports,
  public.guardian_knowledge_rankings, public.guardian_commendation_rankings to anon, authenticated, service_role;

create function public.get_guardian_performance_due(p_now timestamptz, p_limit integer)
returns table(membership_id text, membership_type integer, competitive_peak integer, consecutive_errors integer, last_played timestamptz)
language sql stable security invoker set search_path = '' as $$
with candidates as (
  select g.membership_id, g.membership_type, s.competitive_peak,
    coalesce(s.consecutive_errors, 0) as consecutive_errors, g.last_played,
    coalesce(s.next_rating_at, g.discovered_at) as due_at,
    coalesce(g.last_requested_at > p_now - interval '10 minutes'
      and g.last_requested_at > coalesce(s.last_rated_at, 'epoch'::timestamptz), false) as requested
  from public.guardian_index g left join public.guardian_performance s using (membership_id)
  where g.profile_status = 'public' and g.canonical_membership_id is null and g.membership_type is not null
    and (s.membership_id is null or s.next_rating_at <= p_now or
      (s.consecutive_errors = 0 and g.last_requested_at > p_now - interval '10 minutes'
        and g.last_requested_at > coalesce(s.last_rated_at, 'epoch'::timestamptz)))
)
select membership_id, membership_type, competitive_peak, consecutive_errors, last_played
from candidates order by requested desc, due_at, membership_id
limit greatest(0, least(coalesce(p_limit, 4), 20));
$$;

create function public.fail_guardian_performance(p_id text, p_next timestamptz, p_private boolean)
returns void language sql security invoker set search_path = '' as $$
insert into public.guardian_performance as existing (membership_id, next_rating_at, consecutive_errors)
values (p_id, p_next, 1)
on conflict (membership_id) do update set
  next_rating_at = excluded.next_rating_at,
  consecutive_errors = least(100, existing.consecutive_errors + 1),
  last_rated_at = case when p_private then null else existing.last_rated_at end;
$$;

revoke all on function public.get_guardian_performance_due(timestamptz, integer),
  public.fail_guardian_performance(text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.get_guardian_performance_due(timestamptz, integer),
  public.fail_guardian_performance(text, timestamptz, boolean) to service_role;

notify pgrst, 'reload schema';
commit;

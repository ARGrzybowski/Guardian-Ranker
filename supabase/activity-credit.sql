begin;

-- Keep the existing points and evidence available until the new cohort is
-- large enough to publish percentiles. New observations live beside them.
alter table public.guardian_performance
  add column precise_points numeric(18,8) check (precise_points >= 0),
  add column credit_version text,
  add column credit_eligible boolean not null default false check (not credit_eligible or precise_points is not null),
  add column credit_metrics jsonb not null default '[]',
  add column credit_rated_at timestamptz;
create index guardian_activity_points on public.guardian_performance(precise_points desc, membership_id)
  where credit_eligible and credit_version = 'GR-3.1' and precise_points is not null;
grant select (precise_points,credit_version,credit_eligible,credit_metrics,credit_rated_at)
  on public.guardian_performance to anon, authenticated;

alter policy public_performance_snapshots on public.guardian_performance
using (
  greatest(last_rated_at, credit_rated_at) >= now() - interval '7 days'
  and exists (
    select 1 from public.guardian_index g where g.membership_id = guardian_performance.membership_id
      and g.canonical_membership_id is null and g.profile_status = 'public' and g.last_refreshed_at is not null
  )
);

create view public.guardian_activity_model with (security_invoker = true) as
select case when count(*) = 30 then 'GR-3.1'::text else 'GR-3.0'::text end as rating_version
from (
  select s.membership_id
  from public.guardian_performance s join public.guardian_index g using (membership_id)
  where s.credit_eligible and s.credit_version = 'GR-3.1' and s.precise_points is not null
    and s.credit_rated_at >= now() - interval '7 days' and g.canonical_membership_id is null
    and g.profile_status = 'public' and g.last_refreshed_at is not null
  limit 30
) ready;

create view public.guardian_activity_rankings with (security_invoker = true) as
with cohort as (
  select s.membership_id, g.bungie_name, s.precise_points as points, s.credit_version as rating_version,
    s.credit_rated_at as last_refreshed_at
  from public.guardian_performance s join public.guardian_index g using (membership_id)
  where s.credit_eligible and s.precise_points is not null and s.credit_version = 'GR-3.1'
    and s.credit_rated_at >= now() - interval '7 days' and g.canonical_membership_id is null
    and g.profile_status = 'public' and g.last_refreshed_at is not null
    and (select rating_version from public.guardian_activity_model) = 'GR-3.1'
  union all
  select membership_id, bungie_name, points, rating_version, last_refreshed_at
  from public.guardian_performance_rankings
  where (select rating_version from public.guardian_activity_model) = 'GR-3.0'
)
select membership_id, bungie_name, points, rating_version, last_refreshed_at,
  rank() over (order by points desc) as standing,
  count(*) over () as cohort_size,
  case when count(*) over () >= 30 then (100.0 * cume_dist() over (order by points))::numeric(6,2) end as percentile
from cohort;

create view public.guardian_activity_reports with (security_invoker = true) as
select s.membership_id, s.credit_version as rating_version, s.precise_points as points,
  s.credit_eligible as eligible, s.credit_metrics as metrics, s.credit_rated_at as last_rated_at,
  r.standing, r.cohort_size, r.percentile
from public.guardian_performance s join public.guardian_index g using (membership_id)
left join public.guardian_activity_rankings r using (membership_id)
where s.credit_version = 'GR-3.1' and s.credit_rated_at >= now() - interval '7 days'
  and g.canonical_membership_id is null and g.profile_status = 'public' and g.last_refreshed_at is not null
  and (select rating_version from public.guardian_activity_model) = 'GR-3.1'
union all
select membership_id, rating_version, points, eligible, metrics, last_rated_at, standing, cohort_size, percentile
from public.guardian_performance_reports
where (select rating_version from public.guardian_activity_model) = 'GR-3.0';

create or replace view public.guardian_commendation_rankings with (security_invoker = true) as
select s.membership_id, g.bungie_name, s.commendations, greatest(s.last_rated_at,s.credit_rated_at) as last_refreshed_at,
  rank() over (order by s.commendations desc) as standing,
  count(*) over () as cohort_size,
  case when count(*) over () >= 30 then (100.0 * cume_dist() over (order by s.commendations))::numeric(6,2) end as percentile
from public.guardian_performance s join public.guardian_index g using (membership_id)
where greatest(s.last_rated_at,s.credit_rated_at) >= now() - interval '7 days'
  and g.profile_status = 'public' and g.canonical_membership_id is null and g.last_refreshed_at is not null
  and g.highest_guardian_rank >= 7 and s.commendations >= 500;


revoke all on public.guardian_activity_model, public.guardian_activity_rankings, public.guardian_activity_reports from public, anon, authenticated;
grant select on public.guardian_activity_model, public.guardian_activity_rankings, public.guardian_activity_reports to anon, authenticated, service_role;

create or replace function public.get_guardian_performance_due(p_now timestamptz, p_limit integer)
returns table(membership_id text, membership_type integer, competitive_peak integer, consecutive_errors integer, last_played timestamptz)
language sql stable security invoker set search_path = '' as $$
with candidates as (
  select g.membership_id, g.membership_type, s.competitive_peak,
    coalesce(s.consecutive_errors, 0) as consecutive_errors, g.last_played,
    case when s.credit_version = 'GR-3.1' then s.next_rating_at else g.discovered_at end as due_at,
    coalesce(g.last_requested_at > p_now - interval '10 minutes'
      and g.last_requested_at > coalesce(s.credit_rated_at, 'epoch'::timestamptz), false) as requested
  from public.guardian_index g left join public.guardian_performance s using (membership_id)
  where g.profile_status = 'public' and g.canonical_membership_id is null and g.membership_type is not null
    and (s.membership_id is null or s.next_rating_at <= p_now or
      (s.credit_version is distinct from 'GR-3.1' and s.consecutive_errors = 0) or
      (s.consecutive_errors = 0 and g.last_requested_at > p_now - interval '10 minutes'
        and g.last_requested_at > coalesce(s.credit_rated_at, 'epoch'::timestamptz)))
)
select membership_id, membership_type, competitive_peak, consecutive_errors, last_played
from candidates order by requested desc, due_at, membership_id
limit greatest(0, least(coalesce(p_limit, 4), 20));
$$;

create or replace function public.fail_guardian_performance(p_id text, p_next timestamptz, p_private boolean)
returns void language sql security invoker set search_path = '' as $$
insert into public.guardian_performance as existing (membership_id, next_rating_at, consecutive_errors)
values (p_id, p_next, 1)
on conflict (membership_id) do update set
  next_rating_at = excluded.next_rating_at,
  consecutive_errors = least(100, existing.consecutive_errors + 1),
  last_rated_at = case when p_private then null else existing.last_rated_at end,
  credit_rated_at = case when p_private then null else existing.credit_rated_at end;
$$;

notify pgrst, 'reload schema';
commit;

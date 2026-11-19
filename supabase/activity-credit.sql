begin;

-- Preserve earlier snapshots during deployment. Only this model participates
-- in the new standings. Knowledge and commendation eligibility is independent.
alter table public.guardian_performance add column precise_points numeric(18,8) check (precise_points >= 0);
create index guardian_activity_points on public.guardian_performance(precise_points desc, membership_id)
  where eligible and rating_version = 'GR-3.1' and precise_points is not null;
grant select (precise_points) on public.guardian_performance to anon, authenticated;

alter policy public_performance_snapshots on public.guardian_performance
using (
  rating_version in ('GR-3.0','GR-3.1') and last_rated_at >= now() - interval '7 days'
  and exists (
    select 1 from public.guardian_index g where g.membership_id = guardian_performance.membership_id
      and g.canonical_membership_id is null and g.profile_status = 'public' and g.last_refreshed_at is not null
  )
);

create view public.guardian_activity_rankings with (security_invoker = true) as
select s.membership_id, g.bungie_name, s.precise_points as points, s.rating_version, s.last_rated_at as last_refreshed_at,
  rank() over (order by s.precise_points desc) as standing,
  count(*) over () as cohort_size,
  case when count(*) over () >= 30 then (100.0 * cume_dist() over (order by s.precise_points))::numeric(6,2) end as percentile
from public.guardian_performance s join public.guardian_index g using (membership_id)
where s.eligible and s.precise_points is not null and s.rating_version = 'GR-3.1' and s.last_rated_at >= now() - interval '7 days'
  and g.canonical_membership_id is null and g.profile_status = 'public' and g.last_refreshed_at is not null;

create view public.guardian_activity_reports with (security_invoker = true) as
select s.membership_id, s.rating_version, s.precise_points as points, s.eligible, s.metrics, s.last_rated_at,
  r.standing, r.cohort_size, r.percentile
from public.guardian_performance s join public.guardian_index g using (membership_id)
left join public.guardian_activity_rankings r using (membership_id)
where s.rating_version = 'GR-3.1' and s.last_rated_at >= now() - interval '7 days'
  and g.canonical_membership_id is null and g.profile_status = 'public' and g.last_refreshed_at is not null;

create or replace view public.guardian_commendation_rankings with (security_invoker = true) as
select s.membership_id, g.bungie_name, s.commendations, s.last_rated_at as last_refreshed_at,
  rank() over (order by s.commendations desc) as standing,
  count(*) over () as cohort_size,
  case when count(*) over () >= 30 then (100.0 * cume_dist() over (order by s.commendations))::numeric(6,2) end as percentile
from public.guardian_performance s join public.guardian_index g using (membership_id)
where s.rating_version in ('GR-3.0','GR-3.1') and s.last_rated_at >= now() - interval '7 days'
  and g.profile_status = 'public' and g.canonical_membership_id is null and g.last_refreshed_at is not null
  and g.highest_guardian_rank >= 7 and s.commendations >= 500;


revoke all on public.guardian_activity_rankings, public.guardian_activity_reports from public, anon, authenticated;
grant select on public.guardian_activity_rankings, public.guardian_activity_reports to anon, authenticated, service_role;

create or replace function public.get_guardian_performance_due(p_now timestamptz, p_limit integer)
returns table(membership_id text, membership_type integer, competitive_peak integer, consecutive_errors integer, last_played timestamptz)
language sql stable security invoker set search_path = '' as $$
with candidates as (
  select g.membership_id, g.membership_type, s.competitive_peak,
    coalesce(s.consecutive_errors, 0) as consecutive_errors, g.last_played,
    case when s.rating_version = 'GR-3.1' then s.next_rating_at else g.discovered_at end as due_at,
    coalesce(g.last_requested_at > p_now - interval '10 minutes'
      and g.last_requested_at > coalesce(s.last_rated_at, 'epoch'::timestamptz), false) as requested
  from public.guardian_index g left join public.guardian_performance s using (membership_id)
  where g.profile_status = 'public' and g.canonical_membership_id is null and g.membership_type is not null
    and (s.membership_id is null or s.next_rating_at <= p_now or
      (s.rating_version <> 'GR-3.1' and s.consecutive_errors = 0) or
      (s.consecutive_errors = 0 and g.last_requested_at > p_now - interval '10 minutes'
        and g.last_requested_at > coalesce(s.last_rated_at, 'epoch'::timestamptz)))
)
select membership_id, membership_type, competitive_peak, consecutive_errors, last_played
from candidates order by requested desc, due_at, membership_id
limit greatest(0, least(coalesce(p_limit, 4), 20));
$$;

notify pgrst, 'reload schema';
commit;

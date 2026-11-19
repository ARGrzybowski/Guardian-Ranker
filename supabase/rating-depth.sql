-- Upgrade the current leaderboard atomically; GR-1.1 and GR-2.0 must not mix.
begin;
drop policy public_verified_ratings on public.guardian_account_ratings;
create policy public_verified_ratings on public.guardian_account_ratings for select to anon,authenticated
using (not provisional and rating_version='GR-2.0' and coverage=100 and last_rated_at>=now()-interval '7 days'
and exists(select 1 from public.guardian_index g where g.membership_id=guardian_account_ratings.membership_id
  and g.profile_status='public' and g.canonical_membership_id is null and g.last_refreshed_at is not null));
create or replace view public.guardian_rating_rankings with(security_invoker=true) as
select r.membership_id,g.bungie_name,r.score as account_rating,r.grade as rating_grade,
       r.rating_version,r.last_rated_at as last_refreshed_at
from public.guardian_account_ratings r join public.guardian_index g using(membership_id)
where not r.provisional and r.rating_version='GR-2.0' and r.coverage=100
and r.last_rated_at>=now()-interval '7 days' and g.profile_status='public'
and g.canonical_membership_id is null and g.last_refreshed_at is not null;

drop index public.guardian_rating_order;
create index guardian_rating_order on public.guardian_account_ratings(score desc,membership_id)
where not provisional and rating_version='GR-2.0' and coverage=100;
create or replace function public.finish_guardian_index_run(p_run_id uuid,p_status text,p_summary jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.promote_guardian_leaders();
 update public.guardian_index_runs set completed_at=now(),status=p_status,summary=p_summary where id=p_run_id and status='running';
 update public.guardian_index_metrics set
  fresh_24h_count=(select count(*) from public.guardian_rankings where last_refreshed_at>=now()-interval '1 day'),
  due_count=(select count(*) from public.guardian_index where canonical_membership_id is null and next_refresh_at<=now()),
  oldest_profile_at=(select min(last_refreshed_at) from public.guardian_rankings),
  tracked_count=(select count(*) from public.guardian_index where canonical_membership_id is null),
  indexed_count=(select count(*) from public.guardian_rankings),
  last_refreshed_at=(select max(last_refreshed_at) from public.guardian_rankings),
  last_run_at=case when p_status in('completed','partial','budget_reached') then now() else last_run_at end,
  rating_indexed_count=(select count(*) from public.guardian_rating_rankings),
  rating_due_count=(select count(*) from public.guardian_index g left join public.guardian_account_ratings r using(membership_id)
    where g.profile_status='public' and g.canonical_membership_id is null
    and(r.membership_id is null or r.next_rating_at<=now() or r.rating_version is distinct from 'GR-2.0' and r.last_error is null
      or g.last_requested_at>coalesce(r.last_rated_at,'epoch'::timestamptz) and g.last_requested_at>now()-interval '10 minutes')),
  rating_last_updated_at=(select max(last_refreshed_at) from public.guardian_rating_rankings)
 where singleton;
 update public.guardian_index_lease set owner=null,expires_at=null where singleton and owner=p_run_id;
end;
$$;

notify pgrst,'reload schema';
commit;

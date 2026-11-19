begin;
create table public.guardian_account_ratings (
  membership_id text primary key references public.guardian_index(membership_id) on delete cascade,
  score double precision check (score between 0 and 1000),
  grade text check (grade in ('D','C','B','A','S','S+')),
  rating_version text,
  coverage smallint not null default 0 check (coverage between 0 and 100),
  provisional boolean not null default true,
  lower_bound double precision check (lower_bound between 0 and 1000),
  upper_bound double precision check (upper_bound between 0 and 1000),
  last_rated_at timestamptz,
  next_rating_at timestamptz not null default now(),
  manifest_version text,
  metric_scores jsonb,
  error_count integer not null default 0,
  last_error text,
  check (lower_bound is null or upper_bound is null or lower_bound<=upper_bound),
  check (provisional or (score is not null and grade is not null and coverage=100 and last_rated_at is not null))
);
create index guardian_rating_order on public.guardian_account_ratings(score desc,membership_id)
where not provisional and rating_version='GR-1.1' and coverage=100;
create index guardian_rating_due on public.guardian_account_ratings(next_rating_at,membership_id);
alter table public.guardian_account_ratings enable row level security;
revoke all on public.guardian_account_ratings from public,anon,authenticated;
grant all on public.guardian_account_ratings to service_role;
grant select(membership_id,score,grade,rating_version,coverage,provisional,last_rated_at)
on public.guardian_account_ratings to anon,authenticated;
create policy public_verified_ratings on public.guardian_account_ratings for select to anon,authenticated
using (not provisional and rating_version='GR-1.1' and coverage=100 and last_rated_at>=now()-interval '7 days'
and exists(select 1 from public.guardian_index g where g.membership_id=guardian_account_ratings.membership_id
  and g.profile_status='public' and g.canonical_membership_id is null and g.last_refreshed_at is not null));
create view public.guardian_rating_rankings with(security_invoker=true) as
select r.membership_id,g.bungie_name,r.score as account_rating,r.grade as rating_grade,
       r.rating_version,r.last_rated_at as last_refreshed_at
from public.guardian_account_ratings r join public.guardian_index g using(membership_id)
where not r.provisional and r.rating_version='GR-1.1' and r.coverage=100
and r.last_rated_at>=now()-interval '7 days' and g.profile_status='public'
and g.canonical_membership_id is null and g.last_refreshed_at is not null;
revoke all on public.guardian_rating_rankings from public,anon,authenticated;
grant select on public.guardian_rating_rankings to anon,authenticated,service_role;

create table public.guardian_rating_manifest(singleton boolean primary key default true check(singleton),payload jsonb not null);
alter table public.guardian_rating_manifest enable row level security;
revoke all on public.guardian_rating_manifest from public,anon,authenticated;
grant all on public.guardian_rating_manifest to service_role;

create function public.get_guardian_ratings_due(p_now timestamptz,p_limit integer,p_version text)
returns setof jsonb language sql security invoker set search_path='' as $$
with leaders as (
 select membership_id from public.guardian_account_ratings where not provisional and rating_version=p_version
 order by score desc,membership_id limit 100
), candidates as (
 select g.membership_id,g.membership_type,g.last_played,coalesce(r.error_count,0) as rating_error_count,
   (g.membership_id in(select membership_id from leaders)) as is_rating_leader,
   (g.last_requested_at>coalesce(r.last_rated_at,'epoch'::timestamptz)) as requested,
   coalesce(r.next_rating_at,g.discovered_at) as due_at,
   (g.last_played>=p_now-interval '1 day' or g.membership_id in(select membership_id from leaders)
      or g.last_requested_at>coalesce(r.last_rated_at,'epoch'::timestamptz)) as urgent
 from public.guardian_index g left join public.guardian_account_ratings r using(membership_id)
 where g.profile_status='public' and g.canonical_membership_id is null and g.membership_type is not null
 and (r.membership_id is null or r.next_rating_at<=p_now or r.rating_version is distinct from p_version and r.last_error is null
   or g.last_requested_at>coalesce(r.last_rated_at,'epoch'::timestamptz) and g.last_requested_at>p_now-interval '10 minutes')
), priority as (
 select * from candidates where urgent order by requested desc nulls last,due_at,membership_id
 limit greatest(1,least(coalesce(p_limit,10),100)/2)
), fill as (
 select * from candidates c where not exists(select 1 from priority p where p.membership_id=c.membership_id)
 order by due_at,membership_id
 limit greatest(0,least(coalesce(p_limit,10),100)-(select count(*) from priority))
)
select to_jsonb(x) from(select * from priority union all select * from fill)x;
$$;
create function public.fail_guardian_rating(p_id text,p_next timestamptz,p_private boolean)
returns void language sql security invoker set search_path='' as $$
insert into public.guardian_account_ratings as existing(membership_id,next_rating_at,error_count,last_error)
values(p_id,p_next,1,case when p_private then 'No public characters' else 'Rating source request failed' end)
on conflict(membership_id) do update set next_rating_at=excluded.next_rating_at,
  error_count=existing.error_count+1,last_error=excluded.last_error,
  score=case when p_private then null else existing.score end,
  grade=case when p_private then null else existing.grade end,
  provisional=case when p_private then true else existing.provisional end,
  coverage=case when p_private then 0 else existing.coverage end;
$$;
revoke all on function public.get_guardian_ratings_due(timestamptz,integer,text),public.fail_guardian_rating(text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.get_guardian_ratings_due(timestamptz,integer,text),public.fail_guardian_rating(text,timestamptz,boolean) to service_role;

alter table public.guardian_index_metrics add column rating_indexed_count bigint not null default 0;
alter table public.guardian_index_metrics add column rating_due_count bigint not null default 0;
alter table public.guardian_index_metrics add column rating_last_updated_at timestamptz;
create or replace view public.guardian_index_status with(security_invoker=true) as
select tracked_count,indexed_count,last_refreshed_at,last_run_at,fresh_24h_count,due_count,oldest_profile_at,
       rating_indexed_count,rating_due_count,rating_last_updated_at
from public.guardian_index_metrics where singleton;

-- The handler aborts at 110 seconds; recover a killed run after three minutes
-- rather than blocking all cloud collection for twenty minutes.
create or replace function public.start_guardian_index_run()
returns uuid language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=gen_random_uuid();
begin
 update public.guardian_index_lease set owner=v_owner,expires_at=now()+interval '3 minutes'
 where singleton and(expires_at is null or expires_at<now()) and(backoff_until is null or backoff_until<=now());
 if not found then return null; end if;
 update public.guardian_index_runs set status='failed',completed_at=now(),summary=summary||'{"lease_expired":true}'::jsonb
 where status='running' and started_at<now()-interval '3 minutes';
 insert into public.guardian_index_runs(id) values(v_owner);
 return v_owner;
end;
$$;
update public.guardian_index_lease set expires_at=now()-interval '1 second'
where owner in(select id from public.guardian_index_runs where status='running' and started_at<now()-interval '3 minutes');
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
    and(r.membership_id is null or r.next_rating_at<=now() or r.rating_version is distinct from 'GR-1.1' and r.last_error is null
      or g.last_requested_at>coalesce(r.last_rated_at,'epoch'::timestamptz) and g.last_requested_at>now()-interval '10 minutes')),
  rating_last_updated_at=(select max(last_refreshed_at) from public.guardian_rating_rankings)
 where singleton;
 update public.guardian_index_lease set owner=null,expires_at=null where singleton and owner=p_run_id;
end;
$$;
notify pgrst,'reload schema';
commit;

begin;

create table public.guardian_crucible_current (
  singleton boolean primary key default true check (singleton),
  season_id text not null
);
insert into public.guardian_crucible_current (season_id) values ('monument');

create table public.guardian_crucible_progress (
  membership_id text primary key references public.guardian_index(membership_id) on delete cascade,
  scans jsonb not null
);

create table public.guardian_crucible_matches (
  membership_id text not null references public.guardian_index(membership_id) on delete cascade,
  id text not null check (id ~ '^[0-9]{1,20}$'),
  period timestamptz not null,
  kills integer check (kills >= 0),
  deaths integer check (deaths >= 0),
  primary key (membership_id,id)
);
create index guardian_crucible_match_period on public.guardian_crucible_matches(membership_id,period);

create table public.guardian_season_performance (
  membership_id text primary key references public.guardian_index(membership_id) on delete cascade,
  season_id text,
  rating_version text not null default 'GR-3.2' check (rating_version = 'GR-3.2'),
  points numeric(18,8) check (points >= 0),
  eligible boolean not null default false check (not eligible or points is not null),
  metrics jsonb not null default '[]',
  competitive_peak integer check (competitive_peak >= 0),
  commendations integer check (commendations >= 0),
  rated_at timestamptz,
  next_rating_at timestamptz not null default now(),
  consecutive_errors integer not null default 0
);
create index guardian_season_performance_cohort on public.guardian_season_performance(season_id,rated_at desc)
  where eligible;

alter table public.guardian_crucible_current enable row level security;
alter table public.guardian_crucible_progress enable row level security;
alter table public.guardian_crucible_matches enable row level security;
alter table public.guardian_season_performance enable row level security;
revoke all on public.guardian_crucible_current, public.guardian_crucible_progress, public.guardian_crucible_matches,
  public.guardian_season_performance from public, anon, authenticated;
grant select, insert, update, delete on public.guardian_crucible_current, public.guardian_crucible_progress,
  public.guardian_crucible_matches, public.guardian_season_performance to service_role;
grant select on public.guardian_crucible_current to anon, authenticated;
grant select (membership_id,season_id,rating_version,points,eligible,metrics,commendations,rated_at)
  on public.guardian_season_performance to anon, authenticated;
create policy public_crucible_current on public.guardian_crucible_current for select to anon, authenticated using (true);
create policy public_season_performance on public.guardian_season_performance for select to anon, authenticated
using (rated_at >= now() - interval '7 days' and season_id = (select c.season_id from public.guardian_crucible_current c)
  and exists (select 1 from public.guardian_index g where g.membership_id = guardian_season_performance.membership_id
    and g.canonical_membership_id is null and g.profile_status = 'public' and g.last_refreshed_at is not null));

create function public.save_guardian_crucible_progress(p_id text,p_scans jsonb,p_matches jsonb,p_seasons jsonb,p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare season_rows jsonb;
begin
  insert into public.guardian_crucible_progress(membership_id,scans) values (p_id,p_scans)
  on conflict (membership_id) do update set scans=excluded.scans;

  insert into public.guardian_crucible_matches as existing(membership_id,id,period,kills,deaths)
  select p_id,m.id,m.period,m.kills,m.deaths
  from jsonb_to_recordset(p_matches) m(id text,period timestamptz,kills integer,deaths integer)
  on conflict (membership_id,id) do update set kills=excluded.kills,deaths=excluded.deaths
  where (existing.kills is null or existing.deaths is null) and excluded.kills is not null and excluded.deaths is not null;

  update public.guardian_crucible_current c set season_id=s.id
  from jsonb_to_recordset(p_seasons) s(id text,start timestamptz,"end" timestamptz)
  where s.start <= p_now and (s."end" is null or p_now < s."end") and c.season_id is distinct from s.id;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.season_id),'[]') into season_rows
  from (
    select s.id as season_id, count(*) as matches,
      case when count(m.kills)=count(*) then sum(m.kills) end as kills,
      case when count(m.deaths)=count(*) then sum(m.deaths) end as deaths
    from jsonb_to_recordset(p_seasons) s(id text,start timestamptz,"end" timestamptz)
    join public.guardian_crucible_matches m on m.membership_id=p_id and m.period>=s.start
      and m.period<=p_now and (s."end" is null or m.period<s."end")
    group by s.id
  ) t;
  return season_rows;
end;
$$;

create function public.get_guardian_season_due(p_now timestamptz,p_limit integer)
returns table(membership_id text,membership_type integer,competitive_peak integer,consecutive_errors integer,
  last_played timestamptz,season_id text,points numeric)
language sql stable security invoker set search_path = '' as $$
with candidates as (
  select g.membership_id,g.membership_type,greatest(s.competitive_peak,legacy.competitive_peak) as competitive_peak,
    coalesce(s.consecutive_errors,0) as consecutive_errors,g.last_played,s.season_id,s.points,
    coalesce(s.next_rating_at,g.discovered_at) as due_at,
    coalesce(s.consecutive_errors,0)=0 and coalesce(g.last_requested_at > p_now-interval '10 minutes'
      and g.last_requested_at > coalesce(s.rated_at,'epoch'::timestamptz),false) as requested
  from public.guardian_index g left join public.guardian_season_performance s using (membership_id)
    left join public.guardian_performance legacy using (membership_id)
  where g.profile_status='public' and g.canonical_membership_id is null and g.membership_type is not null
)
select membership_id,membership_type,competitive_peak,consecutive_errors,last_played,season_id,points
from candidates where due_at<=p_now or requested
order by requested desc,due_at,membership_id limit greatest(0,least(coalesce(p_limit,4),20));
$$;

create function public.fail_guardian_season_performance(p_id text,p_next timestamptz,p_private boolean)
returns void language sql security invoker set search_path = '' as $$
insert into public.guardian_season_performance as existing (membership_id,next_rating_at,consecutive_errors)
values (p_id,p_next,1)
on conflict (membership_id) do update set next_rating_at=excluded.next_rating_at,
  consecutive_errors=least(100,existing.consecutive_errors+1),
  rated_at=case when p_private then null else existing.rated_at end;
update public.guardian_performance set last_rated_at=null,credit_rated_at=null where membership_id=p_id and p_private;
$$;

revoke execute on function public.save_guardian_crucible_progress(text,jsonb,jsonb,jsonb,timestamptz),
  public.get_guardian_season_due(timestamptz,integer),public.fail_guardian_season_performance(text,timestamptz,boolean)
  from public, anon, authenticated;
grant execute on function public.save_guardian_crucible_progress(text,jsonb,jsonb,jsonb,timestamptz),
  public.get_guardian_season_due(timestamptz,integer),public.fail_guardian_season_performance(text,timestamptz,boolean) to service_role;

create or replace view public.guardian_activity_model with (security_invoker = true) as
select case when (select count(*) from (
  select 1 from public.guardian_season_performance s join public.guardian_index g using (membership_id)
  where s.eligible and s.rated_at >= now()-interval '7 days'
    and s.season_id=(select c.season_id from public.guardian_crucible_current c)
    and g.canonical_membership_id is null and g.profile_status='public' and g.last_refreshed_at is not null limit 30
) ready_season)=30 then 'GR-3.2'::text when (select count(*) from (
  select 1 from public.guardian_performance s join public.guardian_index g using (membership_id)
  where s.credit_eligible and s.credit_version='GR-3.1' and s.credit_rated_at >= now()-interval '7 days'
    and g.canonical_membership_id is null and g.profile_status='public' and g.last_refreshed_at is not null limit 30
) ready_previous)=30 then 'GR-3.1'::text else 'GR-3.0'::text end as rating_version;

create or replace view public.guardian_activity_rankings with (security_invoker = true) as
with model as (select rating_version from public.guardian_activity_model), cohort as (
  select s.membership_id,g.bungie_name,s.points,s.rating_version,s.rated_at as last_refreshed_at
  from public.guardian_season_performance s join public.guardian_index g using (membership_id)
  where s.eligible and s.rated_at>=now()-interval '7 days'
    and s.season_id=(select c.season_id from public.guardian_crucible_current c)
    and g.canonical_membership_id is null and g.profile_status='public' and g.last_refreshed_at is not null
    and (select rating_version from model)='GR-3.2'
  union all
  select s.membership_id,g.bungie_name,s.precise_points,s.credit_version,s.credit_rated_at
  from public.guardian_performance s join public.guardian_index g using (membership_id)
  where s.credit_eligible and s.credit_version='GR-3.1' and s.credit_rated_at>=now()-interval '7 days'
    and g.canonical_membership_id is null and g.profile_status='public' and g.last_refreshed_at is not null
    and (select rating_version from model)='GR-3.1'
  union all
  select membership_id,bungie_name,points,rating_version,last_refreshed_at from public.guardian_performance_rankings
  where (select rating_version from model)='GR-3.0'
)
select membership_id,bungie_name,points,rating_version,last_refreshed_at,
  rank() over (order by points desc) as standing,count(*) over () as cohort_size,
  case when count(*) over ()>=30 then (100.0*cume_dist() over (order by points))::numeric(6,2) end as percentile
from cohort;

create or replace view public.guardian_activity_reports with (security_invoker = true) as
with latest as (
  select s.membership_id,s.rating_version,s.points,s.eligible,s.metrics,s.rated_at
  from public.guardian_season_performance s join public.guardian_index g using (membership_id)
  where s.rated_at>=now()-interval '7 days' and s.season_id=(select c.season_id from public.guardian_crucible_current c)
    and g.canonical_membership_id is null and g.profile_status='public' and g.last_refreshed_at is not null
), previous as (
  select s.membership_id,s.credit_version as rating_version,s.precise_points as points,s.credit_eligible as eligible,
    s.credit_metrics as metrics,s.credit_rated_at as rated_at
  from public.guardian_performance s join public.guardian_index g using (membership_id)
  where s.credit_version='GR-3.1' and s.credit_rated_at>=now()-interval '7 days'
    and g.canonical_membership_id is null and g.profile_status='public' and g.last_refreshed_at is not null
    and (select rating_version from public.guardian_activity_model)='GR-3.1'
  union all
  select membership_id,rating_version,points,eligible,metrics,last_rated_at from public.guardian_performance_reports
  where (select rating_version from public.guardian_activity_model)='GR-3.0'
), available as (
  select * from latest l where l.points is not null or not exists (select 1 from previous p where p.membership_id=l.membership_id)
  union all
  select * from previous p where not exists (select 1 from latest l where l.membership_id=p.membership_id and l.points is not null)
)
select a.membership_id,a.rating_version,a.points,a.eligible,a.metrics,a.rated_at as last_rated_at,r.standing,r.cohort_size,r.percentile
from available a left join public.guardian_activity_rankings r using (membership_id,rating_version);

create or replace view public.guardian_commendation_rankings with (security_invoker = true) as
with scores as (
  select g.membership_id,g.bungie_name,
    case when s.rated_at>=coalesce(greatest(p.last_rated_at,p.credit_rated_at),'epoch'::timestamptz)
      then s.commendations else p.commendations end as commendations,
    greatest(s.rated_at,p.last_rated_at,p.credit_rated_at) as last_refreshed_at
  from public.guardian_index g left join public.guardian_performance p using (membership_id)
    left join public.guardian_season_performance s using (membership_id)
  where g.profile_status='public' and g.canonical_membership_id is null and g.last_refreshed_at is not null
    and g.highest_guardian_rank>=7
)
select membership_id,bungie_name,commendations,last_refreshed_at,rank() over (order by commendations desc) as standing,
  count(*) over () as cohort_size,
  case when count(*) over ()>=30 then (100.0*cume_dist() over (order by commendations))::numeric(6,2) end as percentile
from scores where commendations>=500 and last_refreshed_at>=now()-interval '7 days';

create function guardian_board_internal.refresh_season_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare projected jsonb;
begin
  select jsonb_agg(case when m->>'id'='seasonKd' then m || '{"id":"recentKd"}'::jsonb else m end order by i) into projected
  from jsonb_array_elements(new.metrics) with ordinality as a(m,i);
  perform guardian_board_internal.refresh_scores(new.membership_id,new.rating_version,new.rated_at,coalesce(projected,'[]'));
  return new;
end;
$$;
create or replace function guardian_board_internal.refresh_scores(p_member text,p_version text,p_observed timestamptz,p_metrics jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_version not in ('GR-3.0','GR-3.1','GR-3.2') or p_version is null then return; end if;
  delete from public.guardian_specialty_scores where membership_id=p_member and rating_version=p_version;
  if p_observed is null or p_observed < now()-interval '7 days' then return; end if;
  insert into public.guardian_specialty_catalog(board_id,category,title,unit,description)
  select distinct on (p.board_id) p.board_id,p.category,p.title,p.unit,p.description
  from guardian_board_internal.project_scores(p_metrics) p where p.title is not null order by p.board_id,p.title
  on conflict (board_id) do nothing;
  insert into public.guardian_specialty_scores(membership_id,rating_version,board_id,score,observed_at)
  select p_member,p_version,p.board_id,max(p.score),p_observed
  from guardian_board_internal.project_scores(p_metrics) p group by p.board_id;
end;
$$;
revoke execute on function guardian_board_internal.refresh_season_snapshot() from public, anon, authenticated;
grant execute on function guardian_board_internal.refresh_season_snapshot() to service_role;
create trigger guardian_specialty_season_snapshot after insert or update of rated_at,metrics
on public.guardian_season_performance for each row execute function guardian_board_internal.refresh_season_snapshot();

update public.guardian_specialty_catalog set title='Current-season Crucible K/D',
  description='GR-3.2 uses all public matches in the current season. Requires five matches and a defined K/D. This board fills after the seasonal cohort opens.'
where board_id='pvp.recent_kd';
alter policy public_specialty_scores on public.guardian_specialty_scores using (
  observed_at>=now()-interval '7 days' and rating_version=(select m.rating_version from public.guardian_activity_model m)
  and (board_id<>'pvp.recent_kd' or rating_version='GR-3.2')
  and (rating_version<>'GR-3.2' or exists (select 1 from public.guardian_season_performance s
    where s.membership_id=guardian_specialty_scores.membership_id and s.rated_at=guardian_specialty_scores.observed_at))
  and exists (select 1 from public.guardian_index g where g.membership_id=guardian_specialty_scores.membership_id
    and g.canonical_membership_id is null and g.profile_status='public' and g.last_refreshed_at is not null)
);

notify pgrst, 'reload schema';
commit;

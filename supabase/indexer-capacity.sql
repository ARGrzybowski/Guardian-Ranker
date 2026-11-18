begin;
alter table public.guardian_index_lease add column backoff_until timestamptz;
create or replace function public.start_guardian_index_run()
returns uuid language plpgsql security definer set search_path='' as $$
declare v_owner uuid := gen_random_uuid();
begin
  update public.guardian_index_lease set owner=v_owner,expires_at=now()+interval '20 minutes'
  where singleton and (expires_at is null or expires_at<now()) and (backoff_until is null or backoff_until<=now());
  if not found then return null; end if;
  insert into public.guardian_index_runs(id) values(v_owner);
  return v_owner;
end;
$$;
alter table public.guardian_index add column identity_checked_at timestamptz;
alter table public.guardian_index add column last_requested_at timestamptz;
alter table public.guardian_index add column character_id text;
alter table public.guardian_index add column next_activity_scan_at timestamptz not null default now();
alter table public.guardian_index drop constraint guardian_index_source_check;
alter table public.guardian_index add constraint guardian_index_source_check check (source in ('legacy','search','clan','seed','activity'));
update public.guardian_index set identity_checked_at = last_refreshed_at,
  next_refresh_at = least(next_refresh_at, last_refreshed_at + case
    when last_played >= now() - interval '1 day' then interval '15 minutes'
    when last_played >= now() - interval '7 days' then interval '2 hours'
    else interval '24 hours' end)
where last_refreshed_at is not null;

create index guardian_index_triumph_top on public.guardian_index(triumph_score desc, membership_id) where canonical_membership_id is null and profile_status='public' and triumph_score is not null;
create index guardian_index_power_top on public.guardian_index(light_level desc, membership_id) where canonical_membership_id is null and profile_status='public' and light_level is not null;
create index guardian_index_time_top on public.guardian_index(time_played_hours desc, membership_id) where canonical_membership_id is null and profile_status='public' and time_played_hours is not null;
create index guardian_index_rank_top on public.guardian_index(guardian_rank desc, membership_id) where canonical_membership_id is null and profile_status='public' and guardian_rank is not null;
create index guardian_index_new_due on public.guardian_index(next_refresh_at, membership_id) where canonical_membership_id is null and last_refreshed_at is null;
create index guardian_index_requested on public.guardian_index(last_requested_at desc) where last_requested_at is not null;
create index guardian_index_activity_due on public.guardian_index(next_activity_scan_at, membership_id) where canonical_membership_id is null and profile_status='public' and character_id is not null;
create table public.guardian_index_activities (
  activity_id text primary key check (activity_id ~ '^[0-9]{1,20}$'),
  scanned_at timestamptz not null default now()
);
alter table public.guardian_index_activities enable row level security;
revoke all on public.guardian_index_activities from public, anon, authenticated;
grant all on public.guardian_index_activities to service_role;

create function public.get_guardians_due(p_now timestamptz, p_limit integer)
returns setof jsonb language sql stable security invoker set search_path='' as $$
with leaders as materialized (
  select membership_id from (select membership_id from public.guardian_index where canonical_membership_id is null and profile_status='public' and triumph_score is not null order by triumph_score desc,membership_id limit 100) t
  union select membership_id from (select membership_id from public.guardian_index where canonical_membership_id is null and profile_status='public' and light_level is not null order by light_level desc,membership_id limit 100) t
  union select membership_id from (select membership_id from public.guardian_index where canonical_membership_id is null and profile_status='public' and time_played_hours is not null order by time_played_hours desc,membership_id limit 100) t
  union select membership_id from (select membership_id from public.guardian_index where canonical_membership_id is null and profile_status='public' and guardian_rank is not null order by guardian_rank desc,membership_id limit 100) t
), urgent as materialized (
  select g.membership_id,g.next_refresh_at from public.guardian_index g
  where g.canonical_membership_id is null and g.next_refresh_at <= p_now
  and (g.last_requested_at > coalesce(g.last_refreshed_at,'epoch'::timestamptz) or g.last_played >= p_now-interval '1 day' or exists(select 1 from leaders l where l.membership_id=g.membership_id))
  order by g.next_refresh_at,g.membership_id limit greatest(1,p_limit/2)
), newcomers as materialized (
  select g.membership_id,g.next_refresh_at from public.guardian_index g
  where g.canonical_membership_id is null and g.next_refresh_at <= p_now and g.last_refreshed_at is null
  and not exists(select 1 from urgent u where u.membership_id=g.membership_id)
  order by g.next_refresh_at,g.membership_id limit greatest(0,p_limit/4)
), remainder as materialized (
  select g.membership_id,g.next_refresh_at from public.guardian_index g
  where g.canonical_membership_id is null and g.next_refresh_at <= p_now
  and not exists(select 1 from urgent u where u.membership_id=g.membership_id)
  and not exists(select 1 from newcomers n where n.membership_id=g.membership_id)
  order by g.next_refresh_at,g.membership_id
  limit greatest(0,p_limit-(select count(*) from urgent)-(select count(*) from newcomers))
), chosen as (
  select membership_id,next_refresh_at,1 as lane from urgent union all
  select membership_id,next_refresh_at,2 from newcomers union all
  select membership_id,next_refresh_at,3 from remainder
)
select to_jsonb(g) || jsonb_build_object('is_leader',exists(select 1 from leaders l where l.membership_id=g.membership_id))
from chosen c join public.guardian_index g using (membership_id)
order by c.lane,c.next_refresh_at,c.membership_id limit greatest(0,p_limit);
$$;
revoke all on function public.get_guardians_due(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.get_guardians_due(timestamptz,integer) to service_role;

create or replace function public.enqueue_guardian(p_membership_id text,p_membership_type integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_id text;
begin
  if p_membership_id is null or p_membership_id !~ '^[0-9]{1,20}$' or p_membership_type is null or p_membership_type not in (1,2,3,4,5,6,10) then
    raise exception 'Invalid Destiny membership' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(71180541);
  select coalesce(canonical_membership_id,membership_id) into v_id from public.guardian_index where membership_id=p_membership_id;
  if found then
    update public.guardian_index set last_requested_at=now(),next_refresh_at=least(next_refresh_at,now())
    where membership_id=v_id and (last_requested_at is null or last_requested_at<now()-interval '5 minutes');
    return true;
  end if;
  if (select count(*) from public.guardian_index where source='search' and discovered_at>=now()-interval '1 hour')>=100 then return false; end if;
  insert into public.guardian_index(membership_id,membership_type,source,last_requested_at)
  values(p_membership_id,p_membership_type,'search',now());
  update public.guardian_index_metrics set tracked_count=tracked_count+1 where singleton;
  return true;
end;
$$;

create or replace function public.save_guardian_snapshot(p_requested_id text, p_snapshot jsonb, p_next_refresh_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id text := p_snapshot->>'membership_id';
begin
  insert into public.guardian_index as existing (
    membership_id, membership_type, identity_checked_at, character_id, bungie_name, source, next_refresh_at,
    last_refreshed_at, profile_status, time_played_hours, triumph_score,
    guardian_rank, highest_guardian_rank, class_type, light_level, last_played
  ) values (
    v_id, (p_snapshot->>'membership_type')::integer, (p_snapshot->>'identity_checked_at')::timestamptz, p_snapshot->>'character_id', p_snapshot->>'bungie_name', 'clan', p_next_refresh_at,
    now(), 'public', (p_snapshot->>'time_played_hours')::bigint, (p_snapshot->>'triumph_score')::bigint,
    (p_snapshot->>'guardian_rank')::integer, (p_snapshot->>'highest_guardian_rank')::integer,
    p_snapshot->>'class_type', (p_snapshot->>'light_level')::integer, (p_snapshot->>'last_played')::timestamptz
  ) on conflict (membership_id) do update set
    membership_type = excluded.membership_type, identity_checked_at = coalesce(excluded.identity_checked_at, existing.identity_checked_at), character_id = excluded.character_id, bungie_name = excluded.bungie_name,
    next_refresh_at = excluded.next_refresh_at, last_refreshed_at = now(),
    profile_status = 'public', canonical_membership_id = null, error_count = 0, last_error = null,
    time_played_hours = coalesce(excluded.time_played_hours, existing.time_played_hours),
    triumph_score = coalesce(excluded.triumph_score, existing.triumph_score),
    guardian_rank = coalesce(excluded.guardian_rank, existing.guardian_rank),
    highest_guardian_rank = coalesce(excluded.highest_guardian_rank, existing.highest_guardian_rank),
    class_type = excluded.class_type, light_level = excluded.light_level, last_played = excluded.last_played;
  if p_requested_id <> v_id then
    update public.guardian_index set canonical_membership_id = v_id where membership_id = p_requested_id;
  end if;
end;
$$;

alter table public.guardian_index_metrics add column fresh_24h_count bigint not null default 0;
alter table public.guardian_index_metrics add column due_count bigint not null default 0;
alter table public.guardian_index_metrics add column oldest_profile_at timestamptz;
create index guardian_index_public_freshness on public.guardian_index(last_refreshed_at) where profile_status='public' and canonical_membership_id is null;
create or replace view public.guardian_index_status with (security_invoker=true) as
select tracked_count,indexed_count,last_refreshed_at,last_run_at,fresh_24h_count,due_count,oldest_profile_at
from public.guardian_index_metrics where singleton;
create or replace function public.finish_guardian_index_run(p_run_id uuid, p_status text, p_summary jsonb)
returns void language plpgsql security definer set search_path = '' as $
begin
  update public.guardian_index_runs set completed_at = now(), status = p_status, summary = p_summary
  where id = p_run_id and status = 'running';
  update public.guardian_index_metrics set
    fresh_24h_count = (select count(*) from public.guardian_rankings where last_refreshed_at >= now()-interval '1 day'),
    due_count = (select count(*) from public.guardian_index where canonical_membership_id is null and next_refresh_at <= now()),
    oldest_profile_at = (select min(last_refreshed_at) from public.guardian_rankings),
    tracked_count = (select count(*) from public.guardian_index where canonical_membership_id is null),
    indexed_count = (select count(*) from public.guardian_rankings),
    last_refreshed_at = (select max(last_refreshed_at) from public.guardian_rankings),
    last_run_at = case when p_status in ('completed','partial','budget_reached') then now() else last_run_at end
  where singleton;
  update public.guardian_index_lease set owner = null, expires_at = null where singleton and owner = p_run_id;
end;
$;


commit;

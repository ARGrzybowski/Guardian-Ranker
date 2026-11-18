-- Apply once in the Supabase SQL editor before enabling the cloud workflow.
-- Existing scores are retained in their original tables; only Bungie-verified
-- snapshots enter the new rankings. Browser roles can enqueue identities only.
begin;

create table public.guardian_index (
  membership_id text primary key check (membership_id ~ '^[0-9]{1,20}$'),
  membership_type integer check (membership_type in (1,2,3,4,5,6,10)),
  bungie_name text,
  source text not null check (source in ('legacy','search','clan','seed')),
  discovered_at timestamptz not null default now(),
  next_refresh_at timestamptz not null default now(),
  next_discovery_at timestamptz not null default now(),
  last_refreshed_at timestamptz,
  last_error text,
  error_count integer not null default 0,
  profile_status text not null default 'pending' check (profile_status in ('pending','public','private')),
  canonical_membership_id text,
  time_played_hours bigint check (time_played_hours >= 0),
  triumph_score bigint check (triumph_score >= 0),
  guardian_rank integer check (guardian_rank >= 0),
  highest_guardian_rank integer check (highest_guardian_rank >= 0),
  class_type text,
  light_level integer check (light_level >= 0),
  last_played timestamptz
);
create index guardian_index_refresh_due on public.guardian_index(next_refresh_at, membership_id) where canonical_membership_id is null;
create index guardian_index_discovery_due on public.guardian_index(next_discovery_at, membership_id) where membership_type is not null and canonical_membership_id is null;
create index guardian_index_search_requests on public.guardian_index(discovered_at) where source = 'search';

create table public.guardian_index_clans (
  clan_id text primary key check (clan_id ~ '^[0-9]{1,20}$'),
  name text,
  next_scan_at timestamptz not null default now(),
  next_page integer not null default 1 check (next_page >= 1),
  last_completed_at timestamptz,
  last_error text
);
create index guardian_index_clans_due on public.guardian_index_clans(next_scan_at, clan_id);

create table public.guardian_index_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running',
  summary jsonb not null default '{}'::jsonb
);
create table public.guardian_index_lease (
  singleton boolean primary key default true check (singleton),
  owner uuid,
  expires_at timestamptz
);
insert into public.guardian_index_lease(singleton) values (true);
create table public.guardian_index_metrics (
  singleton boolean primary key default true check (singleton),
  tracked_count bigint not null default 0,
  indexed_count bigint not null default 0,
  last_refreshed_at timestamptz,
  last_run_at timestamptz
);
insert into public.guardian_index_metrics(singleton) values (true);

-- Bootstrap from previously searched identities, never from client-submitted scores.
insert into public.guardian_index(membership_id, bungie_name, source)
select membership_id::text, bungie_name, 'legacy' from public.leaderboard
where membership_id::text ~ '^[0-9]{1,20}$'
on conflict (membership_id) do nothing;

alter table public.guardian_index enable row level security;
alter table public.guardian_index_clans enable row level security;
alter table public.guardian_index_runs enable row level security;
alter table public.guardian_index_lease enable row level security;
alter table public.guardian_index_metrics enable row level security;
create policy public_index_metrics on public.guardian_index_metrics for select to anon, authenticated using (true);
create policy public_index_snapshots on public.guardian_index for select to anon, authenticated
using (profile_status = 'public' and canonical_membership_id is null and last_refreshed_at is not null);
revoke all on public.guardian_index, public.guardian_index_clans, public.guardian_index_runs, public.guardian_index_lease from public, anon, authenticated;
grant all on public.guardian_index, public.guardian_index_clans, public.guardian_index_runs, public.guardian_index_lease to service_role;
revoke all on public.guardian_index_metrics from public, anon, authenticated;
grant select on public.guardian_index_metrics to anon, authenticated;
grant all on public.guardian_index_metrics to service_role;
grant select(membership_id, bungie_name, time_played_hours, triumph_score, guardian_rank,
  highest_guardian_rank, class_type, light_level, last_refreshed_at, profile_status, canonical_membership_id)
on public.guardian_index to anon, authenticated;

-- These views deliberately expose only public snapshots and aggregate counts.
create view public.guardian_rankings with (security_invoker = true) as
select membership_id, bungie_name, time_played_hours, triumph_score, guardian_rank,
       highest_guardian_rank, class_type, light_level, last_refreshed_at
from public.guardian_index
where profile_status = 'public' and canonical_membership_id is null and last_refreshed_at is not null;
create view public.guardian_index_status with (security_invoker = true) as
select tracked_count, indexed_count, last_refreshed_at, last_run_at from public.guardian_index_metrics where singleton;
update public.guardian_index_metrics set tracked_count = (select count(*) from public.guardian_index) where singleton;
revoke all on public.guardian_rankings, public.guardian_index_status from public, anon, authenticated;
grant select on public.guardian_rankings, public.guardian_index_status to anon, authenticated, service_role;

-- The public RPC accepts only an identity, never a score or a caller-supplied name.
-- Idempotency and a global hourly admission cap bound anonymous queue growth.
create function public.enqueue_guardian(p_membership_id text, p_membership_type integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_membership_id is null or p_membership_id !~ '^[0-9]{1,20}$'
     or p_membership_type is null or p_membership_type not in (1,2,3,4,5,6,10) then
    raise exception 'Invalid Destiny membership' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(71180541);
  if exists (select 1 from public.guardian_index where membership_id = p_membership_id) then return true; end if;
  if (select count(*) from public.guardian_index where source = 'search' and discovered_at >= now() - interval '1 hour') >= 100 then return false; end if;
  insert into public.guardian_index(membership_id, membership_type, source)
  values (p_membership_id, p_membership_type, 'search');
  update public.guardian_index_metrics set tracked_count = tracked_count + 1 where singleton;
  return true;
end;
$$;
revoke all on function public.enqueue_guardian(text, integer) from public;
grant execute on function public.enqueue_guardian(text, integer) to anon, authenticated, service_role;

create function public.start_guardian_index_run()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := gen_random_uuid();
begin
  update public.guardian_index_lease set owner = v_owner, expires_at = now() + interval '20 minutes'
  where singleton and (expires_at is null or expires_at < now());
  if not found then return null; end if;
  insert into public.guardian_index_runs(id) values (v_owner);
  return v_owner;
end;
$$;
create function public.finish_guardian_index_run(p_run_id uuid, p_status text, p_summary jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.guardian_index_runs set completed_at = now(), status = p_status, summary = p_summary
  where id = p_run_id and status = 'running';
  update public.guardian_index_metrics set
    tracked_count = (select count(*) from public.guardian_index where canonical_membership_id is null),
    indexed_count = (select count(*) from public.guardian_rankings),
    last_refreshed_at = (select max(last_refreshed_at) from public.guardian_rankings),
    last_run_at = case when p_status in ('completed','partial','budget_reached') then now() else last_run_at end
  where singleton;
  update public.guardian_index_lease set owner = null, expires_at = null where singleton and owner = p_run_id;
end;
$$;

-- Canonical cross-save remapping and snapshot writes happen in one transaction.
create function public.save_guardian_snapshot(p_requested_id text, p_snapshot jsonb, p_next_refresh_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id text := p_snapshot->>'membership_id';
begin
  insert into public.guardian_index as existing (
    membership_id, membership_type, bungie_name, source, next_refresh_at,
    last_refreshed_at, profile_status, time_played_hours, triumph_score,
    guardian_rank, highest_guardian_rank, class_type, light_level, last_played
  ) values (
    v_id, (p_snapshot->>'membership_type')::integer, p_snapshot->>'bungie_name', 'clan', p_next_refresh_at,
    now(), 'public', (p_snapshot->>'time_played_hours')::bigint, (p_snapshot->>'triumph_score')::bigint,
    (p_snapshot->>'guardian_rank')::integer, (p_snapshot->>'highest_guardian_rank')::integer,
    p_snapshot->>'class_type', (p_snapshot->>'light_level')::integer, (p_snapshot->>'last_played')::timestamptz
  ) on conflict (membership_id) do update set
    membership_type = excluded.membership_type, bungie_name = excluded.bungie_name,
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
revoke all on function public.start_guardian_index_run(), public.finish_guardian_index_run(uuid,text,jsonb), public.save_guardian_snapshot(text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.start_guardian_index_run(), public.finish_guardian_index_run(uuid,text,jsonb), public.save_guardian_snapshot(text,jsonb,timestamptz) to service_role;

-- Public visitors can read the old tables during rollout, but cannot edit scores.
revoke insert, update, delete, truncate, references, trigger on public.leaderboard, public.highest_character from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;

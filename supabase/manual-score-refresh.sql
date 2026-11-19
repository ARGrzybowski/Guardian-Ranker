begin;

create table public.guardian_score_requests (
  membership_id text primary key references public.guardian_index(membership_id) on delete cascade,
  requested_at timestamptz not null,
  next_attempt_at timestamptz not null,
  state text not null check (state in ('queued','indexing','updated','unavailable')),
  failures integer not null default 0 check (failures>=0)
);
create index guardian_score_requests_pending on public.guardian_score_requests(next_attempt_at,requested_at,membership_id)
where state in ('queued','indexing');
alter table public.guardian_score_requests enable row level security;
revoke all on public.guardian_score_requests from public,anon,authenticated;
grant select,update on public.guardian_score_requests to service_role;

alter table public.guardian_index_lease add column last_score_wake_at timestamptz;
create schema if not exists guardian_private;
revoke all on schema guardian_private from public,anon,authenticated;

create function guardian_private.wake_guardian_score_worker()
returns void language plpgsql security invoker set search_path = '' as $$
declare token text;
begin
  -- Installations without the optional cloud scheduler still serve the queue
  -- through their regular worker. No invocation token is exported to clients.
  if to_regprocedure('guardian_private.invoke_guardian_indexer()') is null then return; end if;
  update public.guardian_index_lease set last_score_wake_at=now()
  where singleton and (expires_at is null or expires_at<now())
    and (backoff_until is null or backoff_until<=now())
    and (last_score_wake_at is null or last_score_wake_at<=now()-interval '2 minutes')
  returning invocation_token into token;
  if found then
    perform net.http_post(
      url:='https://vmwdspxtlryiypqacmmx.supabase.co/functions/v1/guardian-indexer',
      headers:=jsonb_build_object('Content-Type','application/json','x-guardian-worker-token',token),
      body:='{"mode":"score_refresh"}'::jsonb,timeout_milliseconds:=120000);
  end if;
end;
$$;
revoke all on function guardian_private.wake_guardian_score_worker() from public,anon,authenticated;

create function public.request_guardian_score(p_membership_id text,p_membership_type integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare request_row public.guardian_score_requests;
declare canonical_id text;
begin
  if not public.enqueue_guardian(p_membership_id,p_membership_type) then return '{"state":"busy"}'::jsonb; end if;
  select coalesce(canonical_membership_id,membership_id) into canonical_id from public.guardian_index where membership_id=p_membership_id;

  insert into public.guardian_score_requests as existing(membership_id,requested_at,next_attempt_at,state)
  values (canonical_id,now(),now(),'queued')
  on conflict (membership_id) do update set requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,
    state=excluded.state,failures=0
  where existing.state in ('updated','unavailable') and existing.requested_at<=now()-interval '5 minutes';

  select * into request_row from public.guardian_score_requests where membership_id=canonical_id;
  if request_row.state in ('queued','indexing') and request_row.next_attempt_at<=now() then
    begin
      perform guardian_private.wake_guardian_score_worker();
    exception when others then
      raise warning 'Guardian score request saved for the scheduled worker. Immediate wake was unavailable.';
    end;
  end if;
  return jsonb_build_object('membershipId',request_row.membership_id,'requestedAt',request_row.requested_at,'state',request_row.state);
end;
$$;

create function public.get_guardian_score_request(p_membership_id text,p_requested_at timestamptz)
returns text language sql stable security definer set search_path = '' as $$
  select case when g.canonical_membership_id is not null and q.state in ('queued','indexing') then 'unavailable' else q.state end
  from public.guardian_score_requests q join public.guardian_index g using(membership_id)
  where q.membership_id=p_membership_id and q.requested_at=p_requested_at;
$$;
revoke all on function public.request_guardian_score(text,integer),public.get_guardian_score_request(text,timestamptz) from public,anon,authenticated;
grant execute on function public.request_guardian_score(text,integer),public.get_guardian_score_request(text,timestamptz) to anon,authenticated,service_role;

create function public.get_guardian_score_work(p_now timestamptz,p_limit integer,p_requests_only boolean)
returns table(membership_id text,membership_type integer,competitive_peak integer,consecutive_errors integer,
  last_played timestamptz,season_id text,points numeric,requested_at timestamptz,request_failures integer)
language sql stable security invoker set search_path = '' as $$
with priority as materialized (
  select g.membership_id,g.membership_type,greatest(s.competitive_peak,legacy.competitive_peak) as peak,
    coalesce(s.consecutive_errors,0) as errors,g.last_played,s.season_id,s.points,q.requested_at,q.failures,q.next_attempt_at as due_at
  from public.guardian_score_requests q join public.guardian_index g using(membership_id)
  left join public.guardian_season_performance s using(membership_id)
  left join public.guardian_performance legacy using(membership_id)
  where q.state in ('queued','indexing') and q.next_attempt_at<=p_now
    and g.canonical_membership_id is null and g.membership_type is not null
  order by q.next_attempt_at,q.requested_at,g.membership_id limit greatest(0,least(coalesce(p_limit,4),2))
), background as (
  select g.membership_id,g.membership_type,greatest(s.competitive_peak,legacy.competitive_peak) as peak,
    coalesce(s.consecutive_errors,0) as errors,g.last_played,s.season_id,s.points,null::timestamptz as requested_at,
    0 as failures,coalesce(s.next_rating_at,g.discovered_at) as due_at
  from public.guardian_index g left join public.guardian_season_performance s using(membership_id)
  left join public.guardian_performance legacy using(membership_id)
  where not p_requests_only and g.profile_status='public' and g.canonical_membership_id is null and g.membership_type is not null
    and coalesce(s.next_rating_at,g.discovered_at)<=p_now
    and not exists(select 1 from public.guardian_score_requests q where q.membership_id=g.membership_id and q.state in ('queued','indexing'))
  order by coalesce(s.next_rating_at,g.discovered_at),g.membership_id
  limit greatest(0,least(coalesce(p_limit,4),20)-(select count(*) from priority))
), chosen as (
  select *,0 as lane from priority union all select *,1 from background
)
select membership_id,membership_type,peak,errors,last_played,season_id,points,requested_at,failures
from chosen order by lane,due_at,requested_at,membership_id;
$$;
revoke all on function public.get_guardian_score_work(timestamptz,integer,boolean) from public,anon,authenticated;
grant execute on function public.get_guardian_score_work(timestamptz,integer,boolean) to service_role;

notify pgrst,'reload schema';
commit;

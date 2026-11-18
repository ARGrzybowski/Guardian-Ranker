begin;
create function public.promote_guardian_leaders()
returns void language sql security invoker set search_path='' as $$
  with leaders as (
    select membership_id from (select membership_id from public.guardian_index where canonical_membership_id is null and profile_status='public' and triumph_score is not null order by triumph_score desc,membership_id limit 100)t
    union select membership_id from (select membership_id from public.guardian_index where canonical_membership_id is null and profile_status='public' and light_level is not null order by light_level desc,membership_id limit 100)t
    union select membership_id from (select membership_id from public.guardian_index where canonical_membership_id is null and profile_status='public' and time_played_hours is not null order by time_played_hours desc,membership_id limit 100)t
    union select membership_id from (select membership_id from public.guardian_index where canonical_membership_id is null and profile_status='public' and guardian_rank is not null order by guardian_rank desc,membership_id limit 100)t
  )
  update public.guardian_index g set next_refresh_at=g.last_refreshed_at+interval '15 minutes'
  where g.membership_id in (select membership_id from leaders) and g.last_refreshed_at is not null
  and g.next_refresh_at>g.last_refreshed_at+interval '15 minutes';
$$;
revoke all on function public.promote_guardian_leaders() from public,anon,authenticated;
grant execute on function public.promote_guardian_leaders() to service_role;
create or replace function public.finish_guardian_index_run(p_run_id uuid, p_status text, p_summary jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.promote_guardian_leaders();
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
$$;



select public.promote_guardian_leaders();
commit;

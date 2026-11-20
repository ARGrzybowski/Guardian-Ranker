begin;

alter table public.guardian_index
  add column eververse_bright_dust bigint check (eververse_bright_dust >= 0),
  add column eververse_version smallint,
  add column eververse_checked_at timestamptz;

create index guardian_index_eververse_order on public.guardian_index(eververse_bright_dust desc, membership_id)
where profile_status='public' and canonical_membership_id is null and eververse_version=2 and eververse_bright_dust>0;

grant select(eververse_bright_dust, eververse_version, eververse_checked_at)
on public.guardian_index to anon, authenticated;

create view public.guardian_eververse_rankings with (security_invoker=true) as
select membership_id, bungie_name, eververse_bright_dust, eververse_checked_at as last_refreshed_at
from public.guardian_index
where profile_status='public' and canonical_membership_id is null and eververse_version=2
  and last_refreshed_at is not null and eververse_bright_dust>0 and eververse_checked_at>=now()-interval '21 days';
revoke all on public.guardian_eververse_rankings from public, anon, authenticated;
grant select on public.guardian_eververse_rankings to anon, authenticated;

alter table public.guardian_specialty_catalog drop constraint guardian_specialty_catalog_unit_check;
alter table public.guardian_specialty_catalog add constraint guardian_specialty_catalog_unit_check
check (unit in ('points','clears','activities','events','dungeons','passages','kd','kills','rank','power','proof','solo','bright_dust'));

insert into public.guardian_specialty_catalog(board_id,category,title,unit,description,source)
values ('profile.eververse','Collections','Bright Dust Net Worth','bright_dust',
  'Estimated Bright Dust value of owned Eververse cosmetics from recently verified public Collections. Includes labeled ornament-set estimates.','profile');

create or replace function public.save_guardian_snapshot(p_requested_id text, p_snapshot jsonb, p_next_refresh_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id text := p_snapshot->>'membership_id';
begin
  insert into public.guardian_index as existing (
    membership_id, membership_type, identity_checked_at, character_id, bungie_name, source, next_refresh_at,
    last_refreshed_at, profile_status, time_played_hours, triumph_score,
    guardian_rank, highest_guardian_rank, class_type, light_level, last_played,
    eververse_bright_dust, eververse_version, eververse_checked_at
  ) values (
    v_id, (p_snapshot->>'membership_type')::integer, (p_snapshot->>'identity_checked_at')::timestamptz, p_snapshot->>'character_id', p_snapshot->>'bungie_name', 'clan', p_next_refresh_at,
    now(), 'public', (p_snapshot->>'time_played_hours')::bigint, (p_snapshot->>'triumph_score')::bigint,
    (p_snapshot->>'guardian_rank')::integer, (p_snapshot->>'highest_guardian_rank')::integer,
    p_snapshot->>'class_type', (p_snapshot->>'light_level')::integer, (p_snapshot->>'last_played')::timestamptz,
    (p_snapshot->>'eververse_bright_dust')::bigint, (p_snapshot->>'eververse_version')::smallint,
    case when p_snapshot ? 'eververse_version' then now() end
  ) on conflict (membership_id) do update set
    membership_type = excluded.membership_type, identity_checked_at = coalesce(excluded.identity_checked_at, existing.identity_checked_at), character_id = excluded.character_id, bungie_name = excluded.bungie_name,
    next_refresh_at = excluded.next_refresh_at, last_refreshed_at = now(),
    profile_status = 'public', canonical_membership_id = null, error_count = 0, last_error = null,
    time_played_hours = coalesce(excluded.time_played_hours, existing.time_played_hours),
    triumph_score = coalesce(excluded.triumph_score, existing.triumph_score),
    guardian_rank = coalesce(excluded.guardian_rank, existing.guardian_rank),
    highest_guardian_rank = coalesce(excluded.highest_guardian_rank, existing.highest_guardian_rank),
    class_type = excluded.class_type, light_level = excluded.light_level, last_played = excluded.last_played,
    eververse_bright_dust = case when excluded.eververse_checked_at is not null then excluded.eververse_bright_dust else existing.eververse_bright_dust end,
    eververse_version = coalesce(excluded.eververse_version, existing.eververse_version),
    eververse_checked_at = coalesce(excluded.eververse_checked_at, existing.eververse_checked_at);
  if p_requested_id <> v_id then
    update public.guardian_index set canonical_membership_id = v_id where membership_id = p_requested_id;
  end if;
end;
$$;

create or replace function public.get_guardian_specialty_board(p_board text,p_offset integer default 0,p_limit integer default 25,p_guardian text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
with board as (select c.* from public.guardian_specialty_catalog c where c.board_id=p_board),
cohort as (
  select g.membership_id,g.bungie_name,s.score
  from board b join public.guardian_specialty_scores s on s.board_id=b.board_id
  join public.guardian_index g using (membership_id)
  where b.source='performance' and s.rating_version=(select m.rating_version from public.guardian_activity_model m)
    and (b.board_id<>'pvp.recent_kd' or s.rating_version='GR-3.2')
    and case when s.rating_version='GR-3.2' then exists (select 1 from public.guardian_season_performance p
      where p.membership_id=s.membership_id and p.rated_at>=now()-interval '7 days'
        and p.season_id=(select c.season_id from public.guardian_crucible_current c)) else s.observed_at>=now()-interval '7 days' end
    and g.profile_status='public' and g.canonical_membership_id is null and g.last_refreshed_at is not null
  union all
  select g.membership_id,g.bungie_name,
    case b.board_id when 'profile.peak_rank' then g.highest_guardian_rank else g.light_level end
  from board b cross join public.guardian_index g
  where b.source='profile' and g.profile_status='public' and g.canonical_membership_id is null
    and g.last_refreshed_at>=now()-interval '14 days'
    and (b.board_id='profile.peak_rank' or lower(g.class_type) || '_power' = substring(b.board_id from 9))
  union all
  select e.membership_id,e.bungie_name,e.eververse_bright_dust
  from board b cross join public.guardian_eververse_rankings e
  where b.board_id='profile.eververse'
), ranked as materialized (
  select membership_id,bungie_name,score,rank() over (order by score desc) as standing
  from cohort where score > 0 or (p_board in ('pvp.lifetime_kd','pvp.recent_kd') and score = 0)
), page as (
  select * from ranked order by score desc,membership_id
  limit greatest(1,least(coalesce(p_limit,25),50)) offset greatest(0,least(coalesce(p_offset,0),1000000))
)
select jsonb_build_object(
  'total',(select count(*) from ranked),
  'rows',coalesce((select jsonb_agg(to_jsonb(page) order by page.score desc,page.membership_id) from page),'[]'),
  'match',(select to_jsonb(r) from ranked r where p_guardian is not null
    and lower(r.bungie_name)=lower(btrim(left(p_guardian,100))) order by r.standing,r.membership_id limit 1)
) from board;
$$;

commit;

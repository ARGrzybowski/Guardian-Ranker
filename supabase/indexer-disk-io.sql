begin;

alter table public.guardian_index_metrics add column counts_refreshed_at timestamptz;

-- Each run still closes its log and releases its lease. Only the public
-- coverage totals and leader promotion need to touch the full index.
create or replace function public.finish_guardian_index_run(p_run_id uuid,p_status text,p_summary jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.guardian_index_runs set completed_at=now(),status=p_status,summary=p_summary
  where id=p_run_id and status='running';

  if found and p_status in ('completed','partial','budget_reached') then
    update public.guardian_index_metrics set last_run_at=now() where singleton;
    if exists (select 1 from public.guardian_index_metrics where singleton
      and (counts_refreshed_at is null or counts_refreshed_at<=now()-interval '30 minutes')) then
      perform public.promote_guardian_leaders();
      with profiles as (
        select count(*) as tracked,
          count(*) filter(where next_refresh_at<=now()) as due,
          count(*) filter(where profile_status='public' and last_refreshed_at is not null) as indexed,
          count(*) filter(where profile_status='public' and last_refreshed_at>=now()-interval '1 day') as fresh,
          min(last_refreshed_at) filter(where profile_status='public') as oldest,
          max(last_refreshed_at) filter(where profile_status='public') as newest
        from public.guardian_index where canonical_membership_id is null
      ), ratings as (
        select count(*) as indexed,max(last_refreshed_at) as newest from public.guardian_rating_rankings
      )
      update public.guardian_index_metrics m set tracked_count=p.tracked,indexed_count=p.indexed,
        fresh_24h_count=p.fresh,due_count=p.due,oldest_profile_at=p.oldest,last_refreshed_at=p.newest,
        rating_indexed_count=r.indexed,rating_last_updated_at=r.newest,counts_refreshed_at=now(),
        rating_due_count=(select count(*) from public.guardian_index g left join public.guardian_account_ratings a using(membership_id)
          where g.profile_status='public' and g.canonical_membership_id is null
          and (a.membership_id is null or a.next_rating_at<=now() or a.rating_version is distinct from 'GR-2.0' and a.last_error is null
            or g.last_requested_at>coalesce(a.last_rated_at,'epoch'::timestamptz) and g.last_requested_at>now()-interval '10 minutes'))
      from profiles p cross join ratings r where m.singleton;
    end if;
  end if;
  update public.guardian_index_lease set owner=null,expires_at=null where singleton and owner=p_run_id;
end;
$$;

alter table public.guardian_crucible_progress add column totals jsonb,add column season_signature text;

create or replace function public.save_guardian_crucible_progress(p_id text,p_scans jsonb,p_matches jsonb,p_seasons jsonb,p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare season_rows jsonb;
declare signature text := md5(p_seasons::text);
declare changed bigint;
begin
  -- Overlapping pages are normal. Filter complete entries before the upsert
  -- so Postgres does not lock and dirty each already-indexed match row.
  insert into public.guardian_crucible_matches as existing(membership_id,id,period,kills,deaths)
  select p_id,m.id,m.period,m.kills,m.deaths
  from jsonb_to_recordset(p_matches) m(id text,period timestamptz,kills integer,deaths integer)
  left join public.guardian_crucible_matches stored on stored.membership_id=p_id and stored.id=m.id
  where m.period<=p_now and (stored.id is null or
    ((stored.kills is null or stored.deaths is null) and m.kills is not null and m.deaths is not null))
  on conflict (membership_id,id) do update set kills=excluded.kills,deaths=excluded.deaths
  where (existing.kills is null or existing.deaths is null) and excluded.kills is not null and excluded.deaths is not null;
  get diagnostics changed = row_count;

  update public.guardian_crucible_current c set season_id=s.id
  from jsonb_to_recordset(p_seasons) s(id text,start timestamptz,"end" timestamptz)
  where s.start<=p_now and (s."end" is null or p_now<s."end") and c.season_id is distinct from s.id;

  if changed=0 then
    select totals into season_rows from public.guardian_crucible_progress
    where membership_id=p_id and season_signature=signature;
  end if;
  if season_rows is null then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.season_id),'[]') into season_rows
    from (
      select s.id as season_id,count(*) as matches,
        case when count(m.kills)=count(*) then sum(m.kills) end as kills,
        case when count(m.deaths)=count(*) then sum(m.deaths) end as deaths
      from jsonb_to_recordset(p_seasons) s(id text,start timestamptz,"end" timestamptz)
      join public.guardian_crucible_matches m on m.membership_id=p_id and m.period>=s.start
        and m.period<=p_now and (s."end" is null or m.period<s."end")
      group by s.id
    ) t;
  end if;

  insert into public.guardian_crucible_progress as existing(membership_id,scans,totals,season_signature)
  values (p_id,p_scans,season_rows,signature)
  on conflict (membership_id) do update set scans=excluded.scans,totals=excluded.totals,season_signature=excluded.season_signature
  where row(existing.scans,existing.totals,existing.season_signature)
    is distinct from row(excluded.scans,excluded.totals,excluded.season_signature);
  return season_rows;
end;
$$;

create or replace function guardian_board_internal.refresh_scores(p_member text,p_version text,p_observed timestamptz,p_metrics jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare projected jsonb;
begin
  if p_version not in ('GR-3.0','GR-3.1','GR-3.2') or p_version is null then return; end if;
  if p_observed is null or p_observed<now()-interval '7 days' then
    delete from public.guardian_specialty_scores where membership_id=p_member and rating_version=p_version;
    return;
  end if;

  select coalesce(jsonb_agg(to_jsonb(p)),'[]') into projected from guardian_board_internal.project_scores(p_metrics) p;
  insert into public.guardian_specialty_catalog(board_id,category,title,unit,description)
  select distinct on (p.board_id) p.board_id,p.category,p.title,p.unit,p.description
  from jsonb_to_recordset(projected) p(board_id text,category text,title text,unit text,description text)
  where p.title is not null and not exists (select 1 from public.guardian_specialty_catalog c where c.board_id=p.board_id)
  order by p.board_id,p.title on conflict (board_id) do nothing;

  delete from public.guardian_specialty_scores existing
  where existing.membership_id=p_member and existing.rating_version=p_version
    and not exists (select 1 from jsonb_to_recordset(projected) p(board_id text) where p.board_id=existing.board_id);

  insert into public.guardian_specialty_scores as existing(membership_id,rating_version,board_id,score,observed_at)
  select p_member,p_version,p.board_id,p.score,p_observed
  from (select board_id,max(score)::numeric(24,8) as score from jsonb_to_recordset(projected) x(board_id text,score numeric) group by board_id) p
  left join public.guardian_specialty_scores stored on stored.membership_id=p_member and stored.rating_version=p_version and stored.board_id=p.board_id
  where stored.board_id is null or stored.score is distinct from p.score
    or (p_version<>'GR-3.2' and stored.observed_at is distinct from p_observed)
  on conflict (membership_id,rating_version,board_id) do update set score=excluded.score,observed_at=excluded.observed_at;
end;
$$;

-- The producing snapshot still controls visibility when an unchanged score
-- keeps its original observation date. The trigger updates scores atomically.
alter policy public_specialty_scores on public.guardian_specialty_scores using (
  rating_version=(select m.rating_version from public.guardian_activity_model m)
  and (board_id<>'pvp.recent_kd' or rating_version='GR-3.2')
  and case when rating_version='GR-3.2' then exists (select 1 from public.guardian_season_performance s
    where s.membership_id=guardian_specialty_scores.membership_id and s.rated_at>=now()-interval '7 days'
      and s.season_id=(select c.season_id from public.guardian_crucible_current c)) else observed_at>=now()-interval '7 days' end
  and exists (select 1 from public.guardian_index g where g.membership_id=guardian_specialty_scores.membership_id
    and g.canonical_membership_id is null and g.profile_status='public' and g.last_refreshed_at is not null)
);

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

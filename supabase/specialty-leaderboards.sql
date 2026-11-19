begin;

create schema guardian_board_internal;
revoke all on schema guardian_board_internal from public, anon, authenticated;
grant usage on schema guardian_board_internal to service_role;

create table public.guardian_specialty_catalog (
  board_id text primary key,
  category text not null,
  title text not null,
  unit text not null check (unit in ('points','clears','activities','events','dungeons','passages','kd','kills','rank','power','proof','solo')),
  description text not null,
  source text not null default 'performance' check (source in ('performance','profile'))
);
alter table public.guardian_specialty_catalog enable row level security;
revoke all on public.guardian_specialty_catalog from public, anon, authenticated;
grant select on public.guardian_specialty_catalog to anon, authenticated;
grant all on public.guardian_specialty_catalog to service_role;
create policy public_board_catalog on public.guardian_specialty_catalog for select to anon, authenticated using (true);

insert into public.guardian_specialty_catalog (board_id, category, title, unit, description, source) values
  ('raid.points','Raids','Raid performance','points','Raid clear points and verified contest achievements.','performance'),
  ('raid.clears','Raids','Total raid clears','clears','Recorded raid completion counters. Checkpoints can count.','performance'),
  ('raid.variety','Raids','Raid variety','activities','Distinct raid families with at least one recorded clear.','performance'),
  ('raid.contest','Raids','Verified raid contest clears','events','Distinct verified contest or launch-window raid clears.','performance'),
  ('dungeon.points','Dungeons','Dungeon performance','points','Dungeon clear points, contest clears and best solo achievements.','performance'),
  ('dungeon.clears','Dungeons','Total dungeon clears','clears','Recorded dungeon completion counters. Checkpoints can count.','performance'),
  ('dungeon.variety','Dungeons','Dungeon variety','activities','Distinct dungeon families with at least one recorded clear.','performance'),
  ('dungeon.contest','Dungeons','Verified dungeon contest clears','events','Distinct verified dungeon contest clears.','performance'),
  ('dungeon.solo','Dungeons','Dungeons cleared solo','dungeons','Distinct verified full solo dungeons. Solo flawless counts once.','performance'),
  ('dungeon.flawless','Dungeons','Dungeons cleared solo flawless','dungeons','Distinct full dungeons with a verified solo flawless clear.','performance'),
  ('dungeon.solo_points','Dungeons','Solo dungeon achievements','points','Only the strongest verified solo achievement in each dungeon contributes.','performance'),
  ('ops.points','Operations','Operations performance','points','Grandmaster and Solo Ops points with descending repeat credit.','performance'),
  ('gm.clears','Operations','Grandmaster Nightfall clears','clears','Recorded clears of named Grandmaster Nightfalls.','performance'),
  ('gm.variety','Operations','Grandmaster Nightfall variety','activities','Distinct named Grandmaster Nightfalls cleared.','performance'),
  ('solo_ops.clears','Operations','Solo Ops clears','clears','Recorded clears of named single-player Solo Ops missions.','performance'),
  ('solo_ops.variety','Operations','Solo Ops variety','activities','Distinct named single-player Solo Ops missions cleared.','performance'),
  ('pvp.points','Crucible','Crucible performance','points','Best observed Competitive score, Trials flawless and K/D points.','performance'),
  ('pvp.comp','Crucible','Best observed Competitive score','points','Highest public division score recorded by Guardian Ranker.','performance'),
  ('pvp.flawless','Crucible','Total Trials flawless passages','passages','Combined flawless totals from Bungie’s legacy and current trackers.','performance'),
  ('pvp.legacy_flawless','Crucible','Trials flawless tickets','passages','Bungie’s legacy Trials flawless tracker through Episode 2.','performance'),
  ('pvp.lighthouse','Crucible','Flawless Lighthouse passages','passages','Bungie’s newer flawless passage tracker from Episode 3 onward.','performance'),
  ('pvp.lifetime_kd','Crucible','Lifetime Crucible K/D','kd','At least 100 recorded Crucible matches. K/D must be defined.','performance'),
  ('pvp.recent_kd','Crucible','Recent Crucible K/D','kd','At least five matches among the latest 25 returned in the last 30 days. K/D must be defined.','performance'),
  ('pvp.kills','Crucible','Lifetime Crucible kills','kills','Lifetime account-wide Crucible kills.','performance'),
  ('endgame.contest','Endgame','All verified contest clears','events','Distinct verified contest or launch-window raid and dungeon clears.','performance'),
  ('endgame.variety','Endgame','Raid and dungeon variety','activities','Distinct raid and dungeon families with a recorded clear.','performance'),
  ('profile.peak_rank','Profiles','Highest lifetime Guardian Rank','rank','Highest Guardian Rank ever reported on a public profile.','profile'),
  ('profile.titan_power','Profiles','Titan equipped power','power','Accounts whose highest equipped character is a Titan.','profile'),
  ('profile.hunter_power','Profiles','Hunter equipped power','power','Accounts whose highest equipped character is a Hunter.','profile'),
  ('profile.warlock_power','Profiles','Warlock equipped power','power','Accounts whose highest equipped character is a Warlock.','profile');

create table public.guardian_specialty_scores (
  membership_id text not null references public.guardian_index(membership_id) on delete cascade,
  rating_version text not null,
  board_id text not null,
  score numeric(24,8) not null check (score >= 0),
  observed_at timestamptz not null,
  primary key (membership_id,rating_version,board_id)
);
create index guardian_specialty_score_order on public.guardian_specialty_scores (board_id,rating_version,score desc,membership_id);
alter table public.guardian_specialty_scores enable row level security;
revoke all on public.guardian_specialty_scores from public, anon, authenticated;
grant select on public.guardian_specialty_scores to anon, authenticated;
grant all on public.guardian_specialty_scores to service_role;
create policy public_specialty_scores on public.guardian_specialty_scores for select to anon, authenticated
using (
  observed_at >= now() - interval '7 days'
  and rating_version = (select m.rating_version from public.guardian_activity_model m)
  and exists (select 1 from public.guardian_index g where g.membership_id = guardian_specialty_scores.membership_id
    and g.canonical_membership_id is null and g.profile_status = 'public' and g.last_refreshed_at is not null)
);

create function guardian_board_internal.project_scores(p_metrics jsonb)
returns table(board_id text,score numeric,category text,title text,unit text,description text)
language sql immutable security invoker set search_path = '' as $$
with metrics as materialized (
  select m->>'id' as id, m->>'group' as score_group, m,
    (m->>'value')::numeric as value, (m->>'points')::numeric as points,
    (m->>'families')::numeric as families, (m->>'matches')::numeric as matches
  from jsonb_array_elements(coalesce(p_metrics,'[]')) m
), rollups as (
  select score_group, sum(points) as total
  from metrics where score_group in ('Raids','Dungeons','Operations','Crucible')
  group by score_group having count(points) = count(*)
), individual as (
  select v.id, v.amount
  from metrics
  cross join lateral (values
    (case id when 'raidClears' then 'raid.clears' when 'dungeonClears' then 'dungeon.clears'
      when 'grandmasterClears' then 'gm.clears' when 'soloOpsClears' then 'solo_ops.clears'
      when 'raidContest' then 'raid.contest' when 'dungeonContest' then 'dungeon.contest'
      when 'dungeonSolo' then 'dungeon.solo' when 'competitivePeak' then 'pvp.comp'
      when 'trialsFlawless' then 'pvp.flawless'
      when 'lifetimeKd' then case when matches >= 100 then 'pvp.lifetime_kd' end
      when 'recentKd' then case when matches >= 5 then 'pvp.recent_kd' end end, value),
    (case when points is not null then
      case id when 'raidClears' then 'raid.variety' when 'dungeonClears' then 'dungeon.variety'
        when 'grandmasterClears' then 'gm.variety' when 'soloOpsClears' then 'solo_ops.variety' end end, families),
    (case when id = 'dungeonSolo' then 'dungeon.solo_points' end, points),
    (case when id = 'dungeonSolo' and points is not null then 'dungeon.flawless' end,
      jsonb_array_length(jsonb_path_query_array(coalesce(m->'events','[]'), '$[*] ? (@.tier == "Solo flawless")'))::numeric),
    (case when id = 'trialsFlawless' then 'pvp.legacy_flawless' end, (m->>'legacy')::numeric),
    (case when id = 'trialsFlawless' then 'pvp.lighthouse' end, (m->>'currentSystem')::numeric),
    (case when id = 'lifetimeKd' then 'pvp.kills' end, (m->>'kills')::numeric)
  ) v(id,amount) where v.id is not null
  union all
  select case score_group when 'Raids' then 'raid.points' when 'Dungeons' then 'dungeon.points'
    when 'Operations' then 'ops.points' when 'Crucible' then 'pvp.points' end,total from rollups
  union all
  select 'endgame.contest',sum(value) from metrics where id in ('raidContest','dungeonContest') having count(value)=2
  union all
  select 'endgame.variety',sum(families) from metrics where id in ('raidClears','dungeonClears') and points is not null having count(families)=2
), activity_boards as (
  select 'clear.' || md5(id || ':' || lower(btrim(a->>'name'))) as id,
    (a->>'completions')::numeric as amount, score_group as category, (a->>'name') || ' clears' as title,
    'clears' as unit, 'Recorded clears for this activity family. Aggregate counters can include checkpoints.' as description
  from metrics cross join lateral jsonb_array_elements(coalesce(m->'activities','[]')) a
  where points is not null and id in ('raidClears','dungeonClears','grandmasterClears','soloOpsClears')
    and length(btrim(a->>'name')) between 1 and 180
), event_boards as (
  select 'contest.' || (a->>'hash') as id, 1::numeric as amount, score_group as category,
    (a->>'name') || ' · Contest' as title, 'proof' as unit,
    'Guardians with a verified contest or launch-window clear of this event.' as description
  from metrics cross join lateral jsonb_array_elements(coalesce(m->'events','[]')) a
  where points is not null and id in ('raidContest','dungeonContest') and a->>'hash' ~ '^[0-9]{1,10}$'
  union all
  select 'solo.' || md5(lower(btrim(a->>'name'))), case a->>'tier' when 'Solo flawless' then 2 else 1 end,
    score_group, (a->>'name') || ' · Solo', 'solo',
    'Highest verified solo achievement. Solo flawless ranks above solo.'
  from metrics cross join lateral jsonb_array_elements(coalesce(m->'events','[]')) a
  where points is not null and id = 'dungeonSolo' and a->>'tier' in ('Solo','Solo flawless')
    and length(btrim(a->>'name')) between 1 and 180
)
select id,amount,null::text,null::text,null::text,null::text from individual
where amount > 0 or (id in ('pvp.lifetime_kd','pvp.recent_kd') and amount = 0)
union all
select id,amount,category,title,unit,description from activity_boards where amount > 0
union all
select id,amount,category,title,unit,description from event_boards;
$$;

create function guardian_board_internal.refresh_scores(p_member text,p_version text,p_observed timestamptz,p_metrics jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_version not in ('GR-3.0','GR-3.1') or p_version is null then return; end if;
  delete from public.guardian_specialty_scores where membership_id=p_member and rating_version=p_version;
  if p_observed is null or p_observed < now() - interval '7 days' then return; end if;
  insert into public.guardian_specialty_catalog(board_id,category,title,unit,description)
  select distinct on (p.board_id) p.board_id,p.category,p.title,p.unit,p.description
  from guardian_board_internal.project_scores(p_metrics) p
  where p.title is not null order by p.board_id,p.title
  on conflict (board_id) do nothing;

  insert into public.guardian_specialty_scores(membership_id,rating_version,board_id,score,observed_at)
  select p_member,p_version,p.board_id,max(p.score),p_observed
  from guardian_board_internal.project_scores(p_metrics) p group by p.board_id;
end;
$$;

create function guardian_board_internal.refresh_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' or row(new.rating_version,new.last_rated_at,new.metrics)
                         is distinct from row(old.rating_version,old.last_rated_at,old.metrics) then
    perform guardian_board_internal.refresh_scores(new.membership_id,new.rating_version,new.last_rated_at,new.metrics);
  end if;
  if tg_op = 'INSERT' or row(new.credit_version,new.credit_rated_at,new.credit_metrics)
                         is distinct from row(old.credit_version,old.credit_rated_at,old.credit_metrics) then
    perform guardian_board_internal.refresh_scores(new.membership_id,new.credit_version,new.credit_rated_at,new.credit_metrics);
  end if;
  return new;
end;
$$;

revoke all on all functions in schema guardian_board_internal from public, anon, authenticated;
grant execute on all functions in schema guardian_board_internal to service_role;
create trigger guardian_specialty_snapshot after insert or update of rating_version,last_rated_at,metrics,credit_version,credit_rated_at,credit_metrics
on public.guardian_performance for each row execute function guardian_board_internal.refresh_snapshot();

do $$
declare s record;
begin
  for s in select membership_id,rating_version,last_rated_at,metrics,credit_version,credit_rated_at,credit_metrics
    from public.guardian_performance where greatest(last_rated_at,credit_rated_at) >= now() - interval '7 days'
  loop
    perform guardian_board_internal.refresh_scores(s.membership_id,s.rating_version,s.last_rated_at,s.metrics);
    perform guardian_board_internal.refresh_scores(s.membership_id,s.credit_version,s.credit_rated_at,s.credit_metrics);
  end loop;
end;
$$;

create function public.get_guardian_specialty_board(p_board text, p_offset integer default 0, p_limit integer default 25, p_guardian text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
with board as (select c.* from public.guardian_specialty_catalog c where c.board_id=p_board),
cohort as (
  select g.membership_id,g.bungie_name,s.score
  from board b join public.guardian_specialty_scores s on s.board_id=b.board_id
  join public.guardian_index g using (membership_id)
  where b.source='performance' and s.observed_at >= now()-interval '7 days'
    and s.rating_version=(select m.rating_version from public.guardian_activity_model m)
    and g.profile_status='public' and g.canonical_membership_id is null and g.last_refreshed_at is not null
  union all
  select g.membership_id,g.bungie_name,
    case b.board_id when 'profile.peak_rank' then g.highest_guardian_rank else g.light_level end
  from board b cross join public.guardian_index g
  where b.source='profile' and g.profile_status='public' and g.canonical_membership_id is null
    and g.last_refreshed_at >= now()-interval '14 days'
    and (b.board_id='profile.peak_rank' or lower(g.class_type) || '_power' = substring(b.board_id from 9))
), ranked as materialized (
  select membership_id,bungie_name,score,rank() over (order by score desc) as standing
  from cohort where score > 0 or (p_board in ('pvp.lifetime_kd','pvp.recent_kd') and score = 0)
), page as (
  select * from ranked order by score desc,membership_id
  limit greatest(1,least(coalesce(p_limit,25),50)) offset greatest(0,least(coalesce(p_offset,0),1000000))
select jsonb_build_object(
  'total',(select count(*) from ranked),
  'rows',coalesce((select jsonb_agg(to_jsonb(page) order by page.score desc,page.membership_id) from page),'[]'),
  'match',(select to_jsonb(r) from ranked r where p_guardian is not null
    and lower(r.bungie_name)=lower(btrim(left(p_guardian,100))) order by r.standing,r.membership_id limit 1)
) from board;
$$;
revoke all on function public.get_guardian_specialty_board(text,integer,integer,text) from public, anon, authenticated;
grant execute on function public.get_guardian_specialty_board(text,integer,integer,text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;

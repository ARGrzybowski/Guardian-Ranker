begin;
create function pg_temp.assert_board(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Specialty leaderboard assertion: %', message; end if; end; $$;

set role service_role;
insert into public.guardian_index(membership_id,membership_type,bungie_name,source,profile_status,highest_guardian_rank,class_type,light_level,last_refreshed_at)
select (830000+i)::text,3,'BoardTest'||i||'#1234','seed',case when i=57 then 'private' else 'public' end,
  10,case when i=1 then 'Hunter' else 'Titan' end,400+i,now()
from generate_series(1,57)i;

insert into public.guardian_performance(membership_id,points,eligible,last_rated_at,metrics)
select (830000+i)::text,30,true,case when i=56 then now()-interval '8 days' else now() end,
jsonb_build_array(
  jsonb_build_object('id','raidClears','group','Raids','value',least(i,54),'points',15,'families',1),
  jsonb_build_object('id','raidContest','group','Raids','value',1,'points',250,'events',
    jsonb_build_array(jsonb_build_object('hash','2384429092','name','Vault of Glass'))),
  jsonb_build_object('id','lifetimeKd','group','Crucible','value',case when i=3 then 0 else 3.5 end,'points',30,'matches',
    case when i<3 then 1 else 100 end,'kills',180),
  jsonb_build_object('id','recentKd','group','Crucible','value',2.1,'points',10,'matches',2))
from generate_series(1,57)i;

reset role;
set role anon;
select pg_temp.assert_board(
  (public.get_guardian_specialty_board('raid.clears',0,500,'boardtest1#1234')->>'total')::int=55,
  'private and stale scores are excluded');
select pg_temp.assert_board(
  jsonb_array_length(public.get_guardian_specialty_board('raid.clears',0,500,null)->'rows')=50,
  'page size is capped on the server');
select pg_temp.assert_board(
  (public.get_guardian_specialty_board('raid.clears',0,25,' boardtest1#1234 ')#>>'{match,standing}')::int=55,
  'exact lookup is case insensitive and retains the full cohort rank');
select pg_temp.assert_board(
  (public.get_guardian_specialty_board('raid.clears',1,1,null)#>>'{rows,0,standing}')::int=1,
  'tied scores share rank across page boundaries');
select pg_temp.assert_board(
  (public.get_guardian_specialty_board('pvp.recent_kd')->>'total')::int=0
  and (public.get_guardian_specialty_board('pvp.lifetime_kd')->>'total')::int=53,
  'K/D boards enforce minimum samples');
select pg_temp.assert_board(
  (public.get_guardian_specialty_board('pvp.lifetime_kd',0,1,'BoardTest3#1234')#>>'{match,score}')::numeric=0,
  'a defined zero K/D with sufficient evidence still qualifies');
select pg_temp.assert_board(
  (public.get_guardian_specialty_board('contest.2384429092')->>'total')::int=55,
  'a named contest board is created from verified evidence');
select pg_temp.assert_board(
  (public.get_guardian_specialty_board('profile.hunter_power')->>'total')::int=1,
  'class board uses highest equipped character class');
select pg_temp.assert_board(not has_table_privilege('anon','public.guardian_specialty_scores','insert'), 'browser cannot write scores');
select pg_temp.assert_board(not has_schema_privilege('anon','guardian_board_internal','usage'), 'score projection is private');

reset role;
set role service_role;
update public.guardian_performance s set
credit_version='GR-3.1',credit_eligible=true,precise_points=20,credit_rated_at=now(),
credit_metrics=jsonb_build_array(
  jsonb_build_object('id','raidClears','group','Raids','value',2,'points',17,'families',1,
    'activities',jsonb_build_array(jsonb_build_object('name','Vault of Glass','completions',2))),
  jsonb_build_object('id','dungeonSolo','group','Dungeons','value',1,'points',120,
    'events',jsonb_build_array(jsonb_build_object('name','Prophecy','tier','Solo flawless'))))
where membership_id between '830001' and '830030';

reset role;
set role anon;
select pg_temp.assert_board(
  (public.get_guardian_specialty_board('raid.clears')->>'total')::int=30,
  'the old and revised cohorts never mix');
select pg_temp.assert_board(
  (public.get_guardian_specialty_board('clear.'||md5('raidClears:vault of glass'))->>'total')::int=30,
  'named clear boards populate from revised activity breakdowns');
select pg_temp.assert_board(
  (public.get_guardian_specialty_board('solo.'||md5('prophecy'))#>>'{rows,0,score}')::numeric=2,
  'named solo leaderboard preserves the stronger tier');

reset role;
set role service_role;
update public.guardian_performance set metrics='[]',credit_metrics='[]' where membership_id='830030';
reset role;
set role anon;
select pg_temp.assert_board(
  (public.get_guardian_specialty_board('clear.'||md5('raidClears:vault of glass'))->>'total')::int=29,
  'missing evidence removes earlier specialty rows');
reset role;
rollback;

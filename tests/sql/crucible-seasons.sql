begin;
create function pg_temp.assert_season(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception '%',message; end if; end;
$$;

insert into public.guardian_index(membership_id,bungie_name,membership_type,profile_status,highest_guardian_rank,last_refreshed_at)
select (820000+i)::text,'Season Test#'||i,3,'public',11,now() from generate_series(1,30) i;
insert into public.guardian_performance(membership_id,credit_version,precise_points,credit_eligible,credit_rated_at,competitive_peak,commendations)
select (820000+i)::text,'GR-3.1',i,true,now(),3000,600 from generate_series(1,30) i;

set local role service_role;
select pg_temp.assert_season((select jsonb_array_length(rows)=2 and rows @> '[{"season_id":"monument","matches":1,"kills":9,"deaths":3},{"season_id":"renegades","matches":1,"kills":99,"deaths":1}]'
from public.save_guardian_crucible_progress('820001','{"a":{"page":2}}',
  '[{"id":"9223372036854775800","period":"2026-06-09T16:59:59Z","kills":99,"deaths":1},{"id":"9223372036854775801","period":"2026-06-09T17:00:00Z","kills":9,"deaths":3}]',
  '[{"id":"renegades","start":"2025-12-02T17:00:00Z","end":"2026-06-09T17:00:00Z"},{"id":"monument","start":"2026-06-09T17:00:00Z"}]',
  '2026-11-19T18:00:00Z') rows),'single UTC boundary separates the two periods');
select public.save_guardian_crucible_progress('820001','{"a":{"page":3}}',
  '[{"id":"9223372036854775801","period":"2026-06-09T17:00:00Z","kills":9,"deaths":3}]',
  '[{"id":"monument","start":"2026-06-09T17:00:00Z"}]','2026-11-19T18:00:00Z');
select pg_temp.assert_season((select count(*)=2 from public.guardian_crucible_matches where membership_id='820001'),
  'replayed gigantic instance IDs are deduplicated');
select pg_temp.assert_season((select competitive_peak=3000 from public.get_guardian_season_due(now(),1)), 'rollout keeps the previous Competitive peak');
insert into public.guardian_season_performance(membership_id,season_id,points,eligible,metrics,rated_at,commendations)
select (820000+i)::text,'monument',100+i,true,
  '[{"id":"seasonKd","group":"Crucible","value":1.5,"points":47,"matches":40,"bestSeason":{"points":299}}]',now(),700
from generate_series(1,29) i;
reset role;

set local role anon;
select pg_temp.assert_season((select rating_version='GR-3.1' from public.guardian_activity_model),'old cohort remains available until 30 seasonal scores');
select pg_temp.assert_season((select rating_version='GR-3.2' and standing is null from public.guardian_activity_reports where membership_id='820001'),
  'individual complete season report appears before cohort and uses no old standing');
select pg_temp.assert_season(not has_table_privilege('anon','public.guardian_crucible_matches','select')
  and not has_function_privilege('anon','public.save_guardian_crucible_progress(text,jsonb,jsonb,jsonb,timestamptz)','execute'), 'match and cursor writes are cloud-only');
reset role;

insert into public.guardian_season_performance(membership_id,season_id,points,eligible,rated_at,commendations)
values ('820030','monument',130,true,now(),699);
set local role anon;
select pg_temp.assert_season((select rating_version='GR-3.2' from public.guardian_activity_model),'30 verified scores publish the new cohort');
select pg_temp.assert_season((select count(*)=30 and min(cohort_size)=30 and min(rating_version)='GR-3.2' from public.guardian_activity_rankings),'cohort never mixes models');
select pg_temp.assert_season((public.get_guardian_specialty_board('pvp.recent_kd')->'rows'->0->>'score')::numeric=1.5,
  'season K/D reaches its specialty board while the past score does not');
select pg_temp.assert_season((public.get_guardian_specialty_board('pvp.points')->'rows'->0->>'score')::numeric=47,
  'Crucible rollup only includes current metric points');
select pg_temp.assert_season((select commendations=700 from public.guardian_commendation_rankings where membership_id='820001'), 'season refresh preserves independent commendations');
reset role;
update public.guardian_crucible_current set season_id='later';
set local role anon;
select pg_temp.assert_season(not exists(select 1 from public.guardian_activity_rankings where rating_version='GR-3.2'),
  'a new active season excludes the old season cohort');
reset role;
rollback;

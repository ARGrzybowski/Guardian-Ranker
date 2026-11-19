begin;
create function pg_temp.assert_io(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception '%',message; end if; end;
$$;

insert into public.guardian_index(membership_id,membership_type,bungie_name,source,profile_status,last_refreshed_at)
select (810000+i)::text,3,'Disk IO#'||i,'seed','public',now() from generate_series(1,30) i;

select public.save_guardian_crucible_progress('810001','{"a":1}',
  '[{"id":"987","period":"2026-08-01T13:00:00Z","kills":9,"deaths":3}]',
  '[{"id":"monument","start":"2026-06-09T17:00:00Z"}]','2026-11-19T18:00:00Z');
create temp table io_before as
select (select ctid from public.guardian_crucible_progress where membership_id='810001') as progress,
  (select xmax from public.guardian_crucible_matches where membership_id='810001' and id='987') as match_lock;

select pg_temp.assert_io((select rows @> '[{"season_id":"monument","matches":1,"kills":9,"deaths":3}]'
  from public.save_guardian_crucible_progress('810001','{"a":1}',
  '[{"id":"987","period":"2026-08-01T13:00:00Z","kills":9,"deaths":3}]',
  '[{"id":"monument","start":"2026-06-09T17:00:00Z"}]','2026-11-19T18:01:00Z') rows), 'a replay returns the same totals');
select pg_temp.assert_io((select ctid=(select progress from io_before) and totals is not null
  from public.guardian_crucible_progress where membership_id='810001'), 'replays do not rewrite the progress row');
select pg_temp.assert_io((select xmax=(select match_lock from io_before)
  from public.guardian_crucible_matches where membership_id='810001' and id='987'), 'replays do not take a conflicting match row lock');

select pg_temp.assert_io((select rows @> '[{"season_id":"monument","matches":2,"kills":null,"deaths":4}]'
  from public.save_guardian_crucible_progress('810001','{"a":2}',
  '[{"id":"988","period":"2026-08-01T14:00:00Z","kills":null,"deaths":1}]',
  '[{"id":"monument","start":"2026-06-09T17:00:00Z"}]','2026-11-19T18:02:00Z') rows), 'new matches invalidate the cached totals');
select pg_temp.assert_io((select rows @> '[{"season_id":"monument","matches":2,"kills":16,"deaths":4}]'
  from public.save_guardian_crucible_progress('810001','{"a":2}',
  '[{"id":"988","period":"2026-08-01T14:00:00Z","kills":7,"deaths":1}]',
  '[{"id":"monument","start":"2026-06-09T17:00:00Z"}]','2026-11-19T18:02:00Z') rows), 'incomplete counters can still be repaired');
select pg_temp.assert_io((select rows @> '[{"season_id":"different","matches":2,"kills":16,"deaths":4}]'
  from public.save_guardian_crucible_progress('810001','{"a":2}','[]',
  '[{"id":"different","start":"2026-06-09T17:00:00Z","end":"2026-09-01T17:00:00Z"}]','2026-11-19T18:02:00Z') rows), 'calendar changes invalidate the cached totals');

insert into public.guardian_season_performance(membership_id,season_id,points,eligible,rated_at,metrics)
select (810000+i)::text,'monument',123,true,now()-interval '1 hour',
  '[{"id":"seasonKd","group":"Crucible","value":1.25,"points":36,"matches":25}]'
from generate_series(1,30) i;
update public.guardian_specialty_scores set observed_at=now()-interval '8 days' where membership_id='810001' and board_id='pvp.recent_kd';
create temp table io_board_before as
select ctid as tuple_id from public.guardian_specialty_scores where membership_id='810001' and board_id='pvp.recent_kd';
update public.guardian_season_performance set rated_at=now() where membership_id='810001';
select pg_temp.assert_io((select ctid=(select tuple_id from io_board_before) from public.guardian_specialty_scores
  where membership_id='810001' and board_id='pvp.recent_kd'), 'a refreshed rating leaves unchanged board rows alone');
set local role anon;
select pg_temp.assert_io((public.get_guardian_specialty_board('pvp.recent_kd')->>'total')::int=30,
  'reused board rows are public while their producing snapshots are valid');
reset role;
update public.guardian_season_performance set metrics='[]' where membership_id='810001';
select pg_temp.assert_io(not exists(select 1 from public.guardian_specialty_scores where membership_id='810001'), 'removed scores leave the boards');
update public.guardian_season_performance set rated_at=null where membership_id='810002';
select pg_temp.assert_io(not exists(select 1 from public.guardian_specialty_scores where membership_id='810002'), 'invalidated snapshots clear their board rows');

select public.finish_guardian_index_run(owner,'failed','{}') from public.guardian_index_lease where singleton and owner is not null;
select public.start_guardian_index_run() as run_id \gset
select public.finish_guardian_index_run(:'run_id','completed','{}');
create temp table io_count_before as select tracked_count from public.guardian_index_metrics where singleton;
insert into public.guardian_index(membership_id,membership_type,bungie_name,source) values ('810055',3,'Later#1234','seed');
select public.start_guardian_index_run() as run_id \gset
select public.finish_guardian_index_run(:'run_id','completed','{}');
select pg_temp.assert_io((select tracked_count=(select tracked_count from io_count_before) from public.guardian_index_metrics where singleton),
  'nearby runs reuse coverage counters');
select pg_temp.assert_io((select owner is null from public.guardian_index_lease where singleton), 'every run releases its lease');
update public.guardian_index_metrics set counts_refreshed_at=now()-interval '31 minutes' where singleton;
select public.start_guardian_index_run() as run_id \gset
select public.finish_guardian_index_run(:'run_id','completed','{}');
select pg_temp.assert_io((select tracked_count=1+(select tracked_count from io_count_before) from public.guardian_index_metrics where singleton),
  'coverage counters are refreshed after thirty minutes');
rollback;

begin;
create function pg_temp.assert_performance(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Performance assertion: %', message; end if; end; $$;

set role service_role;
insert into public.guardian_index(membership_id,membership_type,bungie_name,source,profile_status,highest_guardian_rank,triumph_score,last_refreshed_at)
select (900000+i)::text,3,'Performance'||i||'#1234','seed','public',7,10000+i,now() from generate_series(1,31) i;
insert into public.guardian_performance(membership_id,points,eligible,commendations,last_rated_at,next_rating_at)
select (900000+i)::text, least(i,30)*100,true,500+i,now(),now()+interval '1 day' from generate_series(1,31) i;
update public.guardian_index set highest_guardian_rank=6 where membership_id='900001';
update public.guardian_performance set commendations=499 where membership_id='900002';

reset role;
set role anon;
select pg_temp.assert_performance(
  (select percentile=3.23 and cohort_size=31 and standing=31 from public.guardian_performance_reports where membership_id='900001'),
  'a filtered lookup sees the full performance cohort');
select pg_temp.assert_performance(
  (select count(*)=2 from public.guardian_performance_rankings where standing=1 and percentile=100),
  'tied scores share a rank and percentile');
select pg_temp.assert_performance(
  not exists(select 1 from public.guardian_knowledge_rankings where membership_id='900001'),
  'lifetime rank floor applies to Knowledge');
select pg_temp.assert_performance(
  not exists(select 1 from public.guardian_commendation_rankings where membership_id in ('900001','900002')),
  'commendations has both eligibility floors');
select pg_temp.assert_performance(
  (select count(*)=29 and count(percentile)=0 from public.guardian_commendation_rankings where membership_id like '9000%'),
  'small cohorts withhold percentiles');
select pg_temp.assert_performance(not has_table_privilege('anon','public.guardian_performance','insert'), 'browsers cannot insert points');
select pg_temp.assert_performance(not has_function_privilege('anon','public.get_guardian_performance_due(timestamptz,integer)','execute'), 'queue stays private');

reset role;
set role service_role;
update public.guardian_index set profile_status='private' where membership_id='900001';
update public.guardian_performance set last_rated_at=now()-interval '8 days' where membership_id='900002';
update public.guardian_performance set eligible=false,points=null where membership_id='900003';
select public.fail_guardian_performance('900004',now()+interval '1 hour',false);
select public.fail_guardian_performance('900005',now()+interval '1 hour',true);
select pg_temp.assert_performance((select count(*)<=4 from public.get_guardian_performance_due(now(),4)), 'worker backlog stays bounded');

reset role;
set role anon;
select pg_temp.assert_performance(
  not exists(select 1 from public.guardian_performance_rankings where membership_id in ('900001','900002','900003','900005')),
  'private, stale and incomplete scores are excluded');
select pg_temp.assert_performance(
  exists(select 1 from public.guardian_performance_rankings where membership_id='900004'),
  'transient refresh errors preserve an eligible verified score');
reset role;
rollback;

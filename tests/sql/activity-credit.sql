begin;
create function pg_temp.assert_credit(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Activity credit assertion: %', message; end if; end; $$;

set role service_role;
insert into public.guardian_index(membership_id,membership_type,bungie_name,source,profile_status,highest_guardian_rank,last_refreshed_at)
select (870000+i)::text,3,'Credit'||i||'#1234','seed','public',8,now() from generate_series(1,31) i;
insert into public.guardian_performance(membership_id,rating_version,points,eligible,commendations,last_rated_at,next_rating_at)
values ('870001','GR-3.0',900,true,600,now(),now()+interval '1 day');
update public.guardian_index set last_requested_at=now()+interval '1 second' where membership_id='870001';
select pg_temp.assert_credit(exists(select 1 from public.get_guardian_performance_due(now(),4) where membership_id='870001'),
  'old evidence is queued for recalculation before its normal refresh');

reset role;
set role anon;
select pg_temp.assert_credit(
  (select points=900 and rating_version='GR-3.0' from public.guardian_activity_reports where membership_id='870001'),
  'the previous ranking stays visible while the new cohort is forming');

reset role;
set role service_role;
insert into public.guardian_performance(membership_id,credit_version,precise_points,credit_eligible,commendations,credit_rated_at,next_rating_at)
select (870000+i)::text,'GR-3.1',case when i=2 then 220.004 when i=3 then 220.005 else 100 end,true,700+i,now(),now()+interval '1 day'
from generate_series(2,31)i;

reset role;
set role anon;
select pg_temp.assert_credit(
  (select points=220.005 and standing=1 and cohort_size=30 from public.guardian_activity_reports where membership_id='870003'),
  'fractional points determine ranking');
select pg_temp.assert_credit(
  not exists(select 1 from public.guardian_activity_rankings where membership_id='870001'),
  'older model points never enter new standings');
select pg_temp.assert_credit(
  (select count(*)=3 from public.guardian_commendation_rankings where membership_id in ('870001','870002','870003')),
  'commendations remain independent of the performance model');
select pg_temp.assert_credit(not has_table_privilege('anon','public.guardian_performance','insert'), 'public readers cannot post fractional points');
reset role;
rollback;

\set ON_ERROR_STOP on
create function pg_temp.assert_true(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Assertion failed: %', message; end if; end; $$;
create function pg_temp.expect_denied(statement text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when insufficient_privilege then return;
  end;
  raise exception 'Unexpected permission granted: %', statement;
end; $$;

select pg_temp.assert_true((select count(*) = 1 from public.guardian_index), 'legacy identity seeded');
select pg_temp.assert_true((select count(*) = 0 from public.guardian_rankings), 'legacy client scores not trusted');

set role anon;
select pg_temp.assert_true(public.enqueue_guardian('2', 3), 'public identity enqueue');
select pg_temp.assert_true(public.enqueue_guardian('2', 3), 'enqueue is idempotent');
select pg_temp.expect_denied('select * from public.guardian_index');
select pg_temp.expect_denied('select public.start_guardian_index_run()');
select pg_temp.expect_denied('update public.guardian_rankings set triumph_score = 99999999');
select pg_temp.expect_denied('insert into public.leaderboard values (''3'', ''Forged#1234'', 999999)');
select * from public.guardian_index_status;
do $$ begin
  begin perform public.enqueue_guardian('not-an-id', 3); raise exception 'invalid ID accepted';
  exception when invalid_parameter_value then null; end;
  for i in 3..101 loop perform public.enqueue_guardian(i::text, 3); end loop;
  if public.enqueue_guardian('102', 3) then raise exception 'hourly admission cap exceeded'; end if;
end; $$;
reset role;

set role service_role;
select public.start_guardian_index_run() as run_id \gset
select pg_temp.assert_true(public.start_guardian_index_run() is null, 'second worker excluded');
select public.finish_guardian_index_run(gen_random_uuid(), 'completed', '{}');
select pg_temp.assert_true(public.start_guardian_index_run() is null, 'wrong owner cannot release lease');
select public.save_guardian_snapshot('1', '{"membership_id":"2","membership_type":3,"bungie_name":"Verified#1234","triumph_score":123,"light_level":400,"class_type":"Titan"}', now() + interval '6 hours');
select pg_temp.assert_true((select canonical_membership_id = '2' from public.guardian_index where membership_id = '1'), 'canonical alias saved');
select pg_temp.assert_true((select count(*) = 1 from public.guardian_rankings), 'one canonical ranking');
select public.save_guardian_snapshot('2', '{"membership_id":"2","membership_type":3,"bungie_name":"Verified#1234","triumph_score":null,"light_level":401,"class_type":"Titan"}', now() + interval '6 hours');
select pg_temp.assert_true((select triumph_score = 123 from public.guardian_rankings where membership_id = '2'), 'missing metric does not erase previous score');
update public.guardian_index set profile_status = 'private' where membership_id = '2';
select pg_temp.assert_true((select count(*) = 0 from public.guardian_rankings), 'private profile excluded');
select public.finish_guardian_index_run(:'run_id', 'completed', '{"profiles_refreshed":1}');
select pg_temp.assert_true(public.start_guardian_index_run() is not null, 'lease released');
reset role;

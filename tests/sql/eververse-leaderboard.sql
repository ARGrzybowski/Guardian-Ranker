begin;
create function pg_temp.assert_eververse(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Eververse assertion: %', message; end if; end; $$;

set role service_role;
select public.save_guardian_snapshot('845001',
  '{"membership_id":"845001","membership_type":3,"bungie_name":"Bright Test#1234","eververse_bright_dust":1200,"eververse_version":2}',
  now()+interval '1 day');
select public.save_guardian_snapshot('845001',
  '{"membership_id":"845001","membership_type":3,"bungie_name":"Bright Test#1234"}',
  now()+interval '1 day');
insert into public.guardian_index(membership_id,bungie_name,source,profile_status,last_refreshed_at,
  eververse_bright_dust,eververse_version,eververse_checked_at,canonical_membership_id)
values ('845002','Tied Test#1234','seed','public',now(),1200,2,now(),null),
       ('845003','Stale Test#1234','seed','public',now(),2400,2,now()-interval '22 days',null),
       ('845004','Private Test#1234','seed','private',now(),2400,2,now(),null),
       ('845005','Alias Test#1234','seed','public',now(),2400,2,now(),'845001'),
       ('845006','Old Method#1234','seed','public',now(),2400,1,now(),null);
reset role;

set role anon;
select pg_temp.assert_eververse(count(*)=2,'only public, fresh, canonical v2 snapshots are ranked') from public.guardian_eververse_rankings;
select pg_temp.assert_eververse(public.get_guardian_specialty_board('profile.eververse',0,1,'bright test#1234') #>> '{match,score}'='1200',
  'the searchable board and preview share the same stored value');
select pg_temp.assert_eververse(public.get_guardian_specialty_board('profile.eververse',1,1,null) #>> '{rows,0,standing}'='1',
  'equal values tie across pages');
select pg_temp.assert_eververse(not has_function_privilege('public.save_guardian_snapshot(text,jsonb,timestamptz)','EXECUTE'),
  'browser roles cannot write valuations');
reset role;

set role service_role;
select public.save_guardian_snapshot('845001',
  '{"membership_id":"845001","membership_type":3,"bungie_name":"Bright Test#1234","eververse_bright_dust":null,"eververse_version":2}',
  now()+interval '1 day');
reset role;
set role anon;
select pg_temp.assert_eververse(not exists(select 1 from public.guardian_eververse_rankings where membership_id='845001'),
  'a private or partial Collections response clears an earlier score');
rollback;

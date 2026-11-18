-- Disposable CI database only; production never executes test fixture SQL.
begin;
create function pg_temp.assert_capacity(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Capacity assertion: %',message; end if; end; $$;
set role service_role;
truncate public.guardian_index;
insert into public.guardian_index(membership_id,membership_type,bungie_name,source,profile_status,triumph_score,last_refreshed_at,next_refresh_at)
select i::text,3,'Leader'||i||'#1234','seed','public',1000-i,now()-interval '1 day',now()-interval '1 hour' from generate_series(1,10)i;
insert into public.guardian_index(membership_id,membership_type,source,next_refresh_at)
select i::text,3,'clan',now()-interval '2 hours' from generate_series(101,120)i;
insert into public.guardian_index(membership_id,membership_type,bungie_name,source,profile_status,last_refreshed_at,next_refresh_at,last_played)
values('999',3,'Inactive#1234','clan','public',now()-interval '2 days',now()-interval '3 days',now()-interval '1 year');
select pg_temp.assert_capacity((select count(*)=8 from public.get_guardians_due(now(),8)),'batch fills its limit');
select pg_temp.assert_capacity((select count(*)=4 from public.get_guardians_due(now(),8)g where (g->>'is_leader')::boolean),'half the batch prioritizes leaders');
select pg_temp.assert_capacity((select count(*)>=2 from public.get_guardians_due(now(),8)g where g->>'last_refreshed_at' is null),'new accounts receive a reserved share');
select pg_temp.assert_capacity(exists(select 1 from public.get_guardians_due(now(),8)g where g->>'membership_id'='999'),'old inactive accounts are not starved');
select pg_temp.assert_capacity((select count(distinct g->>'membership_id')=8 from public.get_guardians_due(now(),8)g),'no account appears in two lanes');
select public.save_guardian_snapshot('1',jsonb_build_object('membership_id','1','membership_type',3,'bungie_name','Leader1#1234','identity_checked_at',now(),'character_id','123'),now()+interval '1 hour');
select pg_temp.assert_capacity((select identity_checked_at is not null and character_id='123' from public.guardian_index where membership_id='1'),'identity cache and activity character persist');
select public.promote_guardian_leaders();
select pg_temp.assert_capacity((select next_refresh_at<=last_refreshed_at+interval '15 minutes' from public.guardian_index where membership_id='1'),'new leaders inherit the fast refresh cadence');
reset role;
set role anon;
select public.enqueue_guardian('1',3);
reset role;
select pg_temp.assert_capacity((select next_refresh_at<=now() and last_requested_at is not null from public.guardian_index where membership_id='1'),'search requests prioritize a refresh');
update public.guardian_index set next_refresh_at=now()+interval '1 hour' where membership_id='1';
set role anon;
select public.enqueue_guardian('1',3);
reset role;
select pg_temp.assert_capacity((select next_refresh_at>now() from public.guardian_index where membership_id='1'),'repeated requests respect cooldown');
select pg_temp.assert_capacity(not has_function_privilege('anon','public.get_guardians_due(timestamptz,integer)','execute'),'queue selection is server-only');
select pg_temp.assert_capacity(not has_column_privilege('anon','public.guardian_index','identity_checked_at','select'),'identity cache stays private');
rollback;

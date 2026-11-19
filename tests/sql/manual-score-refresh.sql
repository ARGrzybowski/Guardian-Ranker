begin;
create function pg_temp.assert_request(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception '%',message; end if; end;
$$;

insert into public.guardian_index(membership_id,membership_type,bungie_name,source,profile_status,last_refreshed_at,discovered_at)
values ('830001',3,'Requested#1234','seed','public',now(),now()-interval '2 days'),
 ('830002',3,'Searched#1234','seed','public',now(),now()-interval '2 days'),
 ('830003',3,'FirstScore#1234','seed','pending',null,now()-interval '2 days'),
 ('830004',3,'Background#1234','seed','public',now(),now()-interval '20 days'),
 ('830005',3,'Background2#1234','seed','public',now(),now()-interval '20 days');
insert into public.guardian_season_performance(membership_id,season_id,points,eligible,rated_at,next_rating_at)
values ('830001','monument',101,true,now()-interval '1 hour',now()+interval '1 day'),
 ('830002','monument',102,true,now()-interval '1 hour',now()+interval '1 day');

set local role anon;
select public.enqueue_guardian('830002',3);
select pg_temp.assert_request((public.request_guardian_score('830001',3)->>'state')='queued','a user can queue a previously rated account');
select public.request_guardian_score('830001',3)->>'requestedAt' as request_time \gset
select pg_temp.assert_request((public.request_guardian_score('830001',3)->>'requestedAt')=:'request_time','duplicate requests share one token');
select pg_temp.assert_request((public.request_guardian_score('830003',3)->>'state')='queued','a first rating can be requested before the previous worker has indexed a profile');
select pg_temp.assert_request(not has_table_privilege('anon','public.guardian_score_requests','select')
  and not has_table_privilege('anon','public.guardian_score_requests','update')
  and not has_function_privilege('anon','public.get_guardian_score_work(timestamptz,integer,boolean)','execute'), 'public requests cannot read or submit worker results');
reset role;

set local role service_role;
select pg_temp.assert_request((select array_agg(membership_id)=array['830001','830003'] from public.get_guardian_score_work(now(),4,true)),
  'only explicitly requested accounts run on an on-demand wake');
select pg_temp.assert_request((select count(*)=2 from public.get_guardian_score_work(now(),4,false) where requested_at is null),
  'scheduled runs reserve capacity for background ratings');
select pg_temp.assert_request(not exists(select 1 from public.get_guardian_score_work(now(),4,false) where membership_id='830002'),
  'ordinary searching does not make the score due before its normal refresh');
update public.guardian_score_requests set requested_at=now()-interval '2 hours' where membership_id='830001';
select pg_temp.assert_request(exists(select 1 from public.get_guardian_score_work(now(),2,true) where membership_id='830001'),
  'a queued request survives longer than the old search hint');
update public.guardian_score_requests set state='indexing',next_attempt_at=now()+interval '5 minutes' where membership_id='830001';
select pg_temp.assert_request(not exists(select 1 from public.get_guardian_score_work(now(),2,true) where membership_id='830001'),
  'incomplete history respects its next attempt');
update public.guardian_score_requests set state='updated' where membership_id='830001';
reset role;

set local role anon;
select pg_temp.assert_request(public.get_guardian_score_request('830001',now()-interval '2 hours')='updated','the requester can observe completion');
select pg_temp.assert_request(public.get_guardian_score_request('830001',now()-interval '3 hours') is null,'another request token cannot see this state');
select pg_temp.assert_request((public.request_guardian_score('830001',3)->>'state')='queued','an explicit request is accepted again after cooldown');
reset role;
rollback;

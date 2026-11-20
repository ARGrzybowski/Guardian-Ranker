begin;

set role service_role;
select public.save_guardian_snapshot('845021',
  '{"membership_id":"845021","membership_type":3,"bungie_name":"Previous Pricing#1234","eververse_bright_dust":2400,"eververse_version":3}',
  now()+interval '1 day');
select public.save_guardian_snapshot('845022',
  '{"membership_id":"845022","membership_type":3,"bungie_name":"Emote Pricing#1234","eververse_bright_dust":1900,"eververse_version":4}',
  now()+interval '1 day');
select public.save_guardian_snapshot('845023',
  '{"membership_id":"845023","membership_type":3,"bungie_name":"Missing Emote Data#1234","eververse_bright_dust":null,"eververse_version":4}',
  now()+interval '1 day');
reset role;

set role anon;
do $$
begin
  if (select array_agg(membership_id) from public.guardian_eververse_rankings) is distinct from array['845022']
    or public.get_guardian_specialty_board('profile.eververse',0,5,'Emote Pricing#1234') #>> '{match,score}' is distinct from '1900'
  then raise exception 'Eververse standings must use complete valuations from the emote pricing version'; end if;
end;
$$;

rollback;

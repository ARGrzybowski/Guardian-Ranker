begin;

set role service_role;
select public.save_guardian_snapshot('845011',
  '{"membership_id":"845011","membership_type":3,"bungie_name":"Older Pricing#1234","eververse_bright_dust":2400,"eververse_version":2}',
  now()+interval '1 day');
select public.save_guardian_snapshot('845012',
  '{"membership_id":"845012","membership_type":3,"bungie_name":"Standard Pricing#1234","eververse_bright_dust":1200,"eververse_version":3}',
  now()+interval '1 day');
reset role;

set role anon;
do $$
begin
  if (select array_agg(membership_id) from public.guardian_eververse_rankings) is distinct from array['845012']
    or public.get_guardian_specialty_board('profile.eververse',0,5,'Standard Pricing#1234') #>> '{match,score}' is distinct from '1200'
  then raise exception 'The Bright Dust board must compare only valuations using the new pricing'; end if;
end;
$$;

rollback;

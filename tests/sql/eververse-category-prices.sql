begin;

set role service_role;
insert into public.guardian_index(membership_id,bungie_name,source,profile_status,last_refreshed_at,eververse_bright_dust,eververse_version,eververse_checked_at)
values ('845031','Previous Prices#1234','seed','public',now(),1500,4,now()),
       ('845032','Category Prices#1234','seed','public',now(),1250,5,now());
reset role;

set role anon;
do $$
begin
  if (select array_agg(membership_id) from public.guardian_eververse_rankings) is distinct from array['845032']
    or public.get_guardian_specialty_board('profile.eververse',0,5,'Category Prices#1234') #>> '{match,score}' is distinct from '1250'
  then raise exception 'Eververse standings must use the category pricing version'; end if;
end;
$$;

rollback;

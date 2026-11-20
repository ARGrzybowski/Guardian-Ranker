begin;

create index guardian_index_eververse_v6_order on public.guardian_index(eververse_bright_dust desc, membership_id)
where profile_status='public' and canonical_membership_id is null and eververse_version=6 and eververse_bright_dust>0;

create or replace view public.guardian_eververse_rankings with (security_invoker=true) as
select membership_id, bungie_name, eververse_bright_dust, eververse_checked_at as last_refreshed_at
from public.guardian_index
where profile_status='public' and canonical_membership_id is null and eververse_version=6
  and last_refreshed_at is not null and eververse_bright_dust>0 and eververse_checked_at>=now()-interval '21 days';

update public.guardian_specialty_catalog set description =
  'Estimated Bright Dust value of owned Eververse cosmetics. Includes historical collaboration armor estimates and standard prices by type and rarity. Mask ornaments and gameplay rewards are excluded.'
where board_id='profile.eververse';

commit;

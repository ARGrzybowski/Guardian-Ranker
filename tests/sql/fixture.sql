create role anon;
create role authenticated;
create role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;
-- Match Supabase's broad default grants to prove the migration narrows them.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create table public.leaderboard(membership_id text primary key, bungie_name text, triumph_score bigint);
create table public.highest_character(membership_id text primary key, light_level integer);
insert into public.leaderboard values ('1', 'Legacy#1234', 999999);

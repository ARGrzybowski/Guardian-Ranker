-- Cloud-only runtime configuration. Apply after the base index migration.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
alter table public.guardian_index_lease add column invocation_token text not null
  default (gen_random_uuid()::text || gen_random_uuid()::text);
create schema if not exists guardian_private;
revoke all on schema guardian_private from public, anon, authenticated;
create function guardian_private.invoke_guardian_indexer()
returns bigint language sql security invoker set search_path = '' as $$
  select net.http_post(
    url := 'https://vmwdspxtlryiypqacmmx.supabase.co/functions/v1/guardian-indexer',
    headers := jsonb_build_object('Content-Type','application/json', 'x-guardian-worker-token',
      (select invocation_token from public.guardian_index_lease where singleton)),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$;
revoke all on function guardian_private.invoke_guardian_indexer() from public, anon, authenticated;
-- Disabled until the deployed function passes a manually triggered cloud run.
select cron.schedule('guardian-indexer', '7,22,37,52 * * * *', 'select guardian_private.invoke_guardian_indexer();');
select cron.alter_job((select jobid from cron.job where jobname='guardian-indexer'), active := false);
commit;

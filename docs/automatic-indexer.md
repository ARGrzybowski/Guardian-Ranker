# Automatic Guardian indexing

## Account-rating collection

Apply `supabase/account-ratings.sql` after the base/capacity/leader-refresh setup. The deployed Edge bundle must also include `worker/ratings.mjs`, root `accountRating.js`, and root `reportData.js` along with the existing worker dependencies. Rating calculation runs inside the existing scheduled invocation and lease; there is no second collector or local service.

Apply `supabase/performance-rankings.sql` after the previous rating migrations. It adds separate GR-3.0 snapshots and cohort views. Apply `supabase/activity-credit.sql` for GR-3.1 fractional points and version-separated standings. The worker calculates up to four performance snapshots per run, reusing the compact activity catalog and sharing the existing Bungie pacing, operation budget and deadline with discovery. Active accounts target a six-hour refresh and inactive accounts target a daily refresh. The browser reads verified points and percentile standings from Supabase.

Apply `supabase/crucible-seasons.sql` after `supabase/specialty-leaderboards.sql` before deploying the GR-3.2 worker. The existing cloud schedule advances one resumable Crucible history scan per surviving character. Private match IDs and cursors are service-role only. The database sends the totals to the worker, and public views expose the rating and best past season.

Apply `supabase/indexer-disk-io.sql` after `supabase/crucible-seasons.sql` to limit repeat writes and database-wide coverage scans. Existing cloud projects can change the scheduled job with `cron.alter_job` using `*/5 * * * *`.

Apply `supabase/manual-score-refresh.sql` before deploying the worker that supports **Update score**. The button submits a membership ID and type. An idle cloud worker can pick up the request immediately, and the scheduled worker handles work that is still queued. The verified score and specialty standings publish through the existing snapshot writes. The normal indexer reserves capacity for scheduled scores even when manual requests are waiting.

Apply `supabase/eververse-leaderboard.sql` before deploying the Bright Dust leaderboard worker. Each scheduled run checks up to 16 due Collections profiles and refreshes their valuations no more than weekly. Public rankings admit positive totals from complete public Collections checked within the last 21 days. The worker saves only the aggregate, methodology version, and check time alongside the normal profile snapshot. Deploy the checked-in catalogue with both the frontend and the worker.

For standard armor prices, deploy the worker with catalog schema version 3 before applying `supabase/eververse-pricing-v3.sql`. The cloud worker revisits profiles on the old methodology. The view and the directory rank only valuations on the same methodology.

For emote prices, deploy the worker with catalog schema version 4 before applying `supabase/eververse-emote-prices.sql`. The worker adds the profile's emote wheel to the scheduled Collections request. The ranking requires both components so private or missing emote data cannot skew comparisons.

For standard prices by category, deploy catalog schema version 5 to the worker before applying `supabase/eververse-category-prices.sql`. Version 5 also excludes mask ornaments and cosmetics obtainable with Legendary Marks.

For collaboration armor estimates, deploy catalog schema version 6 and its matching valuation module to the worker before applying `supabase/eververse-collaboration-prices.sql`. The leaderboard uses the new prices as the cloud indexer refreshes public Collections.

For approved review estimates, deploy catalog schema version 7 and its matching valuation module before applying `supabase/eververse-reviewed-prices.sql`. This refresh adds values for the last unpriced items and counts each shared cross-class unlock once.

For the expanded legacy Collections catalog, deploy version 8 before applying `supabase/eververse-collections-coverage.sql`. The leaderboard admits complete public valuations using the new catalog.

The lease recovers after three minutes if a process is killed. Both operational entry points stop new requests after 80 seconds and abort at 110 seconds. The optional GitHub Actions entry point remains disabled unless explicitly configured; production scheduling remains in Supabase.

The production worker runs in **Supabase Edge Functions**, scheduled by **Supabase
Cron** every five minutes. Your computer can be switched off. No local scheduler,
service, or persistent process is required.

## Cloud architecture

- Supabase stores discovered identities, trusted profile snapshots, clan page
  cursors, run summaries, a worker lease, and aggregate coverage.
- The worker discovers clans from tracked accounts, imports every roster page,
  and refreshes public profiles independently of website searches.
- A protected Edge Function processes small batches: up to 100 profile attempts with eight concurrent consumers,
  five clan lookups, three roster pages, two activity-history scans, and 240 logical
  Bungie operations per run. One shared reservation queue paces calls at about three
  operations per second. New work stops after 80 seconds; a 110-second hard deadline
  leaves cleanup time within the platform runtime limit.
- Supabase Cron invokes the function every five minutes. A random invocation token
  stays in the restricted lease table and is never returned to browser clients.
  The function authenticates this token itself before doing any indexing.
- The Edge runtime uses its built-in server credentials. No private Supabase key
  needs to be copied into GitHub or provided in chat.
- GitHub Pages serves the frontend. Searches enqueue identities, never scores.

Each run refreshes older due accounts first, discovers their clans, imports roster
pages, then uses any remaining profile budget on newly discovered members.
Rosters checkpoint after every page. Duplicate discoveries do not reset due times.
The next run resumes unfinished work, including after operation limits or failures.
Searches can request a priority profile refresh, with a five-minute per-account cooldown. Score requests start from **Update score** on the player report.
The status panel reports profiles refreshed in the last day and the due backlog,
so a recent update to one player does not imply the entire dataset is fresh.
Coverage counts refresh at most every 30 minutes. The worker records each run's
outcome and releases its lease immediately. The seasonal collector caches the
totals for unchanged match history. Seasonal specialty boards update rows when
scores change and use the producing rating's timestamp for freshness.

Active players (played within 24 hours) and top-100 leaders become due after 15
minutes. Other players active within a week become due after two hours; older
accounts become due after 24 hours. These are targets, not freshness guarantees.
Daily identity caching avoids repeating membership resolution for every refresh.
Half of each batch prioritizes active players, leaders, and recent searches; a
quarter is reserved for new accounts and remaining slots process older due work. Failed profiles back off between six and 48 hours.
Clans are rediscovered and rescanned daily. Scheduling and service availability can
delay actual refreshes; the website shows the latest profile-refresh timestamp.

## Deployment order

1. Apply the base migration in
   `supabase/migrations/202611180001_guardian_index.sql` once. It seeds identities
   from the old leaderboard without trusting browser-submitted scores.
2. Apply `supabase/indexer-capacity.sql`, `supabase/leader-refresh.sql`, then `supabase/cloud-schedule.sql` once using Supabase migration tools. This
   enables pg_cron/pg_net, generates the private invocation token, and creates an
   initially disabled scheduled job.
3. Deploy `supabase/functions/guardian-indexer/index.ts` with its relative
   dependencies and `verify_jwt=false`. Its own invocation-token authentication
   protects it; an anonymous request must return HTTP 401.
4. Trigger `select guardian_private.invoke_guardian_indexer();` from an authorized
   SQL session. Check the run summary, HTTP result, and indexed-account count.
5. Enable the job with
   `select cron.alter_job((select jobid from cron.job where jobname='guardian-indexer'), active := true);`
6. Merge the frontend changes into main and confirm GitHub Pages deployment.

Deployment through the connected Supabase tools records applied migrations in the
hosted project's migration history. No live indexer command should run locally.

## Public data and permissions

The queue RPC accepts only a membership ID and type. It has no display-name or score
arguments. Duplicate requests are idempotent, and a serialized global cap admits
at most 100 new search-origin identities per hour. Trusted clan discovery is not
subject to this public admission cap.

RLS restricts public reads of the backing index to verified public snapshot rows
and explicit display columns; internal queue fields remain inaccessible. The
ranking and status views use `security_invoker=true`, and browser roles have
SELECT-only access. Coverage metrics live in a separate public-read-only summary.

Private profiles leave public rankings without erasing their cached snapshot.
Transient errors retain the previous snapshot and its original timestamp.
Persistent throttles pause all new operations and persist a cooldown across runs. Missing
individual metrics preserve earlier known values, so an individual metric's age
can differ from the overall profile-refresh time.

Before the migration exists, the frontend labels the old read-only rankings as
previously searched players. After migration, rankings may briefly be empty while
the initial queue is verified. These are rankings among **tracked Guardians**,
not an exhaustive global census. Recent public activity reports discover other
participants and their clans, extending coverage beyond the initial clan network.
Private matches are skipped and already processed reports are deduplicated.

## Monitoring and stopping

Inspect `guardian_index_runs` for completed, partial, budget_reached, or failed
runs. Inspect `guardian_index_clans.next_page` for roster progress.
`guardian_index_status` provides aggregate coverage without exposing queue details.

Disable the cron job to stop future runs:
`select cron.alter_job((select jobid from cron.job where jobname='guardian-indexer'), active := false);`
A terminated run's lease expires after 20 minutes. Existing scores remain readable.

## Optional GitHub-hosted alternative

`.github/workflows/index-guardians.yml` remains available for a GitHub-hosted runner.
It stays disabled unless `INDEXER_ENABLED=true` is explicitly configured. Do not
enable it while Supabase Cron is active. This alternative requires GitHub secrets
`SUPABASE_SERVICE_ROLE_KEY` and `BUNGIE_API_KEY`. The operational Node entry point
refuses to run outside GitHub Actions.

## Verification

`node --test tests/*.test.js` runs mocked regression tests, including worker
authentication and batching. `node tests/browser-smoke.mjs` checks the frontend
against mocked APIs. PR CI applies the base migration to disposable PostgreSQL
and verifies permissions, admission limits, canonical snapshots, and worker leases.
No local test indexes live players or contacts production Supabase.

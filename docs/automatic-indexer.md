# Automatic Guardian indexing

This first version discovers clans from tracked accounts, imports every roster page,
and refreshes public profiles on GitHub-hosted runners. Your computer does not host
the worker, database, scheduler, or queue and can be switched off.

The operational entry point refuses to run outside GitHub Actions. Tests use
in-memory accounts and mocked APIs; they do not index live players.

## What runs in the cloud

- GitHub Actions invokes `worker/run.mjs` every six hours at minute 17, and supports a manual run.
- Supabase stores discovered identities, profile snapshots, clan page cursors, run summaries, and a worker lease.
- GitHub Pages serves the existing website. Browsers read verified ranking snapshots and may queue an identity, but cannot submit scores.
- An eight-minute worker deadline, ten-minute job timeout, operation budget, and request spacing bound each run. GitHub concurrency and a database lease prevent overlapping workers.

Each run resolves configured seed accounts, refreshes due accounts, discovers their
clans, imports roster pages, then uses any remaining profile budget to refresh new
members immediately. It handles up to 100 profile attempts, 25 clan lookups, 20
roster pages, and 300 logical Bungie operations per run. Transient HTTP retries are
separately bounded by the shared Bungie client. The next run resumes unfinished work.

Active accounts are due after six hours; accounts not played in seven days are due
after 48 hours. Failed profiles back off between six and 48 hours. Clan membership
and roster scans are due daily. GitHub can delay or disable schedules after extended
repository inactivity, so these are targets rather than freshness guarantees.

## One-time activation

1. In the Supabase project SQL editor, apply
   [`202611180001_guardian_index.sql`](../supabase/migrations/202611180001_guardian_index.sql)
   **once**. It seeds identities from the existing `leaderboard` table, creates the
   worker tables, views, and RPCs, and removes public score-writing privileges.
   Existing score rows remain in their original tables; only fresh Bungie-verified
   snapshots appear in the new rankings.

2. In [the repository's Actions secrets settings](https://github.com/ARGrzybowski/Guardian-Ranker/settings/secrets/actions), add:

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_SERVICE_ROLE_KEY` | A Supabase server secret (`sb_secret_...`) or legacy `service_role` key from the project API keys page. The public `anon` key in `database.js` will be rejected. |
   | `BUNGIE_API_KEY` | The Bungie application's API key. |

   Keep the server key in GitHub secrets only. Do not commit it, add it to browser
   code, or paste it into chat. The worker never prints credentials or raw HTTP error bodies.

3. Merge the implementation into `main`. Scheduled workflows only run from the
   default branch. In [Actions variables](https://github.com/ARGrzybowski/Guardian-Ranker/settings/variables/actions), configure:

   | Variable | Value |
   | --- | --- |
   | `INDEXER_ENABLED` | `true` when the migration and secrets are ready; otherwise leave unset. |
   | `SUPABASE_URL` | Optional; defaults to this project's existing Supabase URL. |
   | `INDEXER_SEED_NAMES` | Optional comma-separated full names; defaults to `Hawk#7753`, the account verified while fixing search. At most 20. |
   | `INDEXER_SEED_CLANS` | Optional comma-separated numeric clan IDs. At most 20. This can bootstrap a community with no prior searches. |

4. Open **Actions → Refresh Guardian index → Run workflow**, choose `main`, and run
   it. No local command, Task Scheduler task, Windows service, or always-on machine
   is needed. A skipped job means `INDEXER_ENABLED` is unset/false or the selected
   branch is not `main`.

5. Confirm the run summary and the website's indexed-account count. A clan roster
   imports players who have never visited the site. A large initial backlog may
   take multiple runs; account searches do not jump ahead of older due work.

The frontend supports a safe rollout: before the migration exists, it shows the old
read-only leaderboards with an explicit "not enabled yet" message. Profile search
still works. After the migration, rankings may start empty while the worker verifies
the queue. Do not enable the workflow before configuring the secrets and migration.

## Data trust and privacy

Public callers can invoke `enqueue_guardian(membership_id, membership_type)` only.
There are no score or display-name arguments. Duplicate requests do not reset due
times. A serialized global cap admits at most 100 new search-origin identities per
hour; service-side clan discovery is independent of that cap.

Worker tables have row-level security and no browser-role access. The public
`guardian_rankings` view exposes verified public snapshots only. The aggregate
`guardian_index_status` view exposes coverage and freshness without queue details.
The public roles have SELECT-only access to these views, even in projects whose
default grants allow writes to new tables.

The worker resolves cross-save aliases before saving snapshots. Accounts with no
public characters are removed from public rankings without erasing the cached
snapshot. Transient Bungie errors retain the last known snapshot and its original
refresh time. Missing individual metrics preserve earlier known values; their
latest availability may differ from the overall profile refresh timestamp.

These are rankings **among tracked Guardians**, not an exhaustive census of Destiny
players. Activity-based discovery through match reports is a later expansion, not
part of this first version.

## Monitoring and stopping

`guardian_index_runs` records status (`completed`, `partial`, `budget_reached`, or
`failed`) and counts of refreshes, roster pages, and errors. A partial run can include
private accounts or failed seeds; inspect repeated errors before assuming the queue
is healthy. A budget-limited run is expected to leave work for the next invocation.

`guardian_index_clans.next_page` is the saved roster cursor. Public scores and the
worker lease update transactionally through server-only functions. If a job is
terminated, its lease expires after 20 minutes.

To stop future indexing, set `INDEXER_ENABLED` to `false` or disable the workflow.
Cancel an already-running job separately. Existing ranking snapshots remain readable.

## Verification

```text
node --test tests/*.test.js
node tests/browser-smoke.mjs
```

The pull-request CI also applies the migration to a disposable PostgreSQL 16 service
and verifies public permissions, admission limits, canonical snapshots, and leases.
It uses test-only credentials and never contacts the production Supabase database.

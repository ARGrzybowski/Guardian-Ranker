# Guardian-Ranker

**Guardian-Ranker** is a web application for Destiny 2 players and others interested. It allows users to search for player stats, compare them to others, and view dynamic leaderboards. The app also displays the current active season, its duration, and a countdown to the next weekly reset.

## Demo

[Try Live Demo](https://argrzybowski.github.io/Guardian-Ranker/)  

<img width="1881" height="911" alt="image" src="https://github.com/user-attachments/assets/28aee728-0cdc-4e70-8144-30a6d403d30d" />


## Features

- **Player Stat Search:** Find and view detailed stats for any Destiny 2 player.
- **Player dossier:** Ten sections covering account overview/rating, characters and equipped gear/perks/stats, career PvP/PvE statistics, mode-specific statistics, paginated activity history and match reports, aggregate activity records, searchable triumphs/titles, collections, reputation/metrics/commendations, and player comparison.
- **Account rating:** Versioned 0–100 scores for eighteen metrics across five dimensions, a weighted 0–1,000 overall rating, grades, activity-family evidence, strongest areas, contribution breakdowns, next milestones, and explicit partial/private-data coverage. [Full scoring methodology](docs/account-rating.md).
- **Account-rating leaderboard:** Cloud-verified GR-2.0 ratings on both leaderboard pages, automatically backfilled from the indexed population. Legacy metadata and small PvP samples no longer make every rating provisional.
- **Rating comparison:** Compare two Guardians across all 18 metrics, see which metrics explain the gap, and share the comparison link.
- **Deeper analysis:** Raid/dungeon activity counters and fastest completions, loaded-history K/D and daily/mode summaries, match weapon breakdowns, closest incomplete triumphs, collectible acquisition sources, and filtered activity-record CSV export.
- **Share and export:** Stable player links, printable loaded sections, and JSON export of the public profile and loaded report data.
- **Leaderboards:** Rank Bungie-verified profiles across power, Triumph score, time played, and Guardian Rank. Automatic clan discovery and refresh run in Supabase's cloud.
- **Season Info:** Shows the current Destiny 2 season, its overall duration, and a live countdown to the next weekly reset.
- **No Installation Required:** Guardian-Ranker is a browser-based application.

## Tech Stack

- **Frontend:** HTML, CSS, JavaScript  
- **Backend/Data:** Supabase  
- **API:** Bungie API  

## Usage

Open the Guardian-Ranker webpage in any modern browser.  
Search for a player’s name and explore the leaderboards and season information.

## Search behavior

Enter the complete Bungie name and four-digit code (for example, `Hawk#7753`) to look up an account directly. Full-name searches use Bungie's exact-name endpoint and do not depend on the account appearing in paginated prefix results.

Partial names show the first page of suggestions. If there are more matches, refine the prefix or enter the full name and code. Typing is debounced, and starting another search cancels the previous one.

## Player report

The player dossier opens with a public profile summary and loads detailed sections on demand. Character gear uses individual item definitions rather than downloading the full inventory manifest. Searchable triumph, collectible, metric, and progression catalogues use Bungie's versioned static manifests. Definition caches are shared within the page session.

Activity history supports character and mode filters, 25 results per character per page, deduplication of shared activities, and retries that retain a failed page. Match reports show participants and combat statistics. Displayed history is explicitly a loaded subset, not a lifetime count. Career totals come from Bungie's historical-stat endpoints and may include deleted characters; character playtime includes idle time and only the surviving characters.

Missing public fields remain unavailable. Triumph completion, redemption, and equippable titles use separate Bungie state flags. Obscured triumph names/descriptions remain hidden in the interface. Collection counts merge profile and character scope without duplicates. Rankings still describe the indexed population, not the global player base. See [report coverage and limits](docs/player-report.md).

Cross-save uses the active membership. For independent platform accounts, the profile with the most recently played public characters is displayed. Private or empty profiles show an explanatory message. Successfully loaded profiles remain visible if leaderboard storage is unavailable.

With the cloud indexer configured, leaderboards include automatically imported clan members, even if they have never been searched. Searches queue identities for background verification; browsers do not submit scores. Coverage counts and refresh timestamps describe the tracked population, not global Destiny rankings.

See [Automatic indexing setup](docs/automatic-indexer.md) for the Supabase migrations, Edge Function, and cloud schedule. No private key needs to be transferred into GitHub. The worker runs entirely in Supabase, not your computer. Before activation, the website explicitly labels its legacy searched-player rankings.

## Development

If you’d like to run it locally:  

```bash
# Clone the repository
git clone https://github.com/ARGrzybowski/Guardian-Ranker.git

cd Guardian-Ranker
npm ci
npm start
```

Use the HTTP URL printed by live-server. Opening `index.html` directly from disk can block JavaScript module loading.

## Verification

Run the regression suite with Node.js 20 or newer:

```bash
node --test tests/*.test.js
# Or: npm test
```

Browser integration checks use an installed Microsoft Edge and require no test dependencies:

```bash
node tests/browser-smoke.mjs
```

Set `BROWSER_PATH` to use a different Chromium-based browser executable. The browser suite mocks all Bungie and Supabase responses, never writes to the live database, and saves ignored screenshots in `test-artifacts/`.

CI also runs a read-only API schema check for `Hawk#7753` from GitHub Actions. That script refuses local execution. Background indexing remains entirely in Supabase.

# Player report coverage

The report aims to expose a useful, inspectable account dossier from public Bungie data. It does not claim access to private data or a complete global index.

| Section | Available features |
| --- | --- |
| Overview | Current, renewed, and highest Guardian Rank; highest equipped power; lifetime/active Triumph score; surviving-character playtime; last played; collection counts; linked memberships and cross-save; clan identity, motto, membership size, founding date, and description |
| Account rating | Ten weighted 0–100 metric ratings, a 0–1,000 overall rating, grades, evidence coverage, partial-data bounds, next milestones, and an inspectable versioned methodology; direct `#rating` links |
| Characters & gear | Each character's power, race, equipped title, combat stats, equipped item names/types/power/damage, descriptions, equipped perks/mods, and detailed item stats on request |
| PvP & PvE | Account-wide career kills/deaths/assists, K/D, efficiency, wins, activity counts, win rate, precision kills, streak, activity time, and available weapon kill breakdown; additional character/mode statistics |
| Activity history | All-character or individual-character history; mode filters including raids, dungeons, Nightfalls, Trials and Gambit; older pages; deduplication; partial-page retry; loaded-history combat summary and daily/mode distribution; participant match reports, weapon breakdowns, and links to other Guardians |
| Activity records | Searchable per-character aggregate completion counters, fastest completions, kills/deaths/time; raid, dungeon, Nightfall and character filters; sorting; partial-character retries and filtered CSV export |
| Triumphs & titles | Search every exposed triumph by name/description; completed/incomplete/redeemed states; objective counters and normalized progress; closest incomplete triumph ordering; filter equippable titles; obscured triumph handling |
| Collections | Search exposed collectible names/descriptions and acquisition sources; acquired/missing filters; profile and character state merge |
| Progression & metrics | Named public reputation/progression counters, levels, next-level progress and resets; searchable named Bungie metric counters; commendation total and category scores/percentages |
| Comparison | Compare two players’ overall rating, five dimensions, 18 metric scores, weighted point differences, and raw profile statistics. Share a link that opens both accounts. |
| Sharing | Stable `?name=Guardian%231234` URLs; copy link; print loaded content; JSON export with retrieval time, schema version, profile response, and loaded sections |

## Sources and semantics

- [GetProfile and component types](https://bungie-net.github.io/multi/schema_Destiny-DestinyComponentType.html): components `100,104,200,202,204,205,300,304,305,800,900,1100,1400`.
- [Historical account statistics](https://bungie-net.github.io/multi/operation_get_Destiny2-GetHistoricalStatsForAccount.html): account aggregates may include deleted characters and do not equal surviving-character playtime. An undefined ratio (zero denominator) stays unavailable unless Bungie provides the ratio directly.
- [Activity history](https://bungie-net.github.io/multi/operation_get_Destiny2-GetActivityHistory.html) and [post-game reports](https://bungie-net.github.io/multi/operation_get_Destiny2-GetPostGameCarnageReport.html): history uses 25 results per character per page. All-character results combine those pages; they do not promise a globally contiguous timestamp window when characters have different activity volumes. A failed character's page is retried before the shared cursor advances. IDs stay strings to preserve 64-bit precision.
- [Record state flags](https://bungie-net.github.io/multi/schema_Destiny-DestinyRecordState.html): completed does not mean redeemed; title unlock is a separate flag. Invisible records are omitted. Obscured descriptions use Bungie's obscured text.
- [Character playtime](https://bungie-net.github.io/multi/schema_Destiny-Entities-Characters-DestinyCharacterComponent.html) includes idle time and excludes deleted characters. Highest displayed power is the maximum current character power, not a theoretical maximum from inventory.

Definition catalogues load from Bungie's manifest-provided static paths only when needed. Item definitions are resolved individually with bounded concurrency. No player scores are submitted by the report to the database. The existing identity-only enqueue RPC remains the only search write. New sections do not add background indexing workload or a local service.

## Analysis coverage

The [account rating methodology](account-rating.md) defines every weight, curve, coverage rule, limitation and example. It is an editorial account-achievement model, not a calibrated population percentile or matchmaking skill rating. Ratings load their required sources independently of other tabs and are included in JSON export when calculated.

[Aggregate activity statistics](https://bungie-net.github.io/multi/operation_get_Destiny2-GetDestinyAggregateActivityStats.html) come from surviving characters, with separate rows per character and activity variant. They are Bungie counters, not an independently verified full-clear history: checkpoints and character deletion affect coverage. Nonpositive/missing fastest times are unavailable. Missing character requests can be retried without losing successful results. Category filters use manifest activity mode types; unmapped activities remain under Other.

Loaded-history totals include known values only; K/D uses only rows containing both kills and deaths. Completion rates exclude unknown completion values. PvP/Gambit win rates use competitive rows with known victory/defeat standings; PvE standings and ties are excluded. Daily bars group observed activity by UTC day and show the latest 14 observed dates. They do not infer inactivity on missing dates or promise complete daily coverage. Mode labels fall back to the numeric mode if unknown.

Match weapon precision means precision kills divided by weapon kills, not shot accuracy. [Commendation scores](https://bungie-net.github.io/multi/schema_Destiny-Components-Social-DestinySocialCommendationsComponent.html) are not raw received-card counts; category nodes can overlap and are not summed. Closest-triumph progress averages each objective's clamped completion fraction, so a large kill counter cannot dominate an unmet binary objective. It is an aid to choosing goals, not an alternative to Bungie's completion flag; secrets and unowned entitlements are excluded from this ordering.

CSV exports contain every filtered aggregate row, including rows beyond the visible page. Missing values stay blank. Formula-like strings and 16+ digit text IDs receive a leading apostrophe to prevent spreadsheet formula execution and ID precision loss. JSON keeps original string IDs without that CSV-specific prefix.

## Practical limits and future extensions

Private progression, non-equipped inventory/vault, and saved loadouts need an authenticated, consent-based account connection. This release does not add OAuth. Reports cannot bypass Bungie's privacy settings.

Activity history is paginated, not a stored lifetime archive. Full raid/dungeon history verification, longitudinal charts, weapon-instance history, and global percentiles need additional collection and storage. Match reports do not contain all profile-wide Triumph/Guardian Rank data. Bungie metric values are shown as raw counters because metric units differ; these are not all interchangeable totals.

Print and JSON export include sections loaded so far. Filtered/paginated tables print their current visible rows. JSON includes all history pages fetched and loaded catalogue entries. Static manifest descriptions can contain game-specific placeholder tokens. Names and descriptions are escaped as text, and image paths are restricted to Bungie-hosted paths.

## Validation

Node regression tests cover missing values, zero denominators, collection merging, record flags, secret-triumph search, numeric precision, pagination, and cancellation. The mocked browser suite covers every report section, equipment/perks, comparison, partial-page recovery, filtering, match reports, export, malicious display text, stale searches, mobile overflow, and the existing leaderboards. GitHub Actions additionally performs a read-only schema check against the public `Hawk#7753` account. No live verification or scheduled indexer runs locally.

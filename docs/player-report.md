# Player report coverage

The report aims to expose a useful, inspectable account dossier from public Bungie data. It does not claim access to private data or a complete global index.

| Section | Available features |
| --- | --- |
| Overview | Current, renewed, and highest Guardian Rank; highest equipped power; lifetime/active Triumph score; surviving-character playtime; last played; collection counts; linked memberships and cross-save; clan identity, motto, membership size, founding date, and description |
| Characters & gear | Each character's power, race, equipped title, combat stats, equipped item names/types/power/damage, descriptions, and equipped perks/mods on request |
| PvP & PvE | Account-wide career kills/deaths/assists, K/D, efficiency, wins, activity counts, win rate, precision kills, streak, activity time, and available weapon kill breakdown; additional character/mode statistics |
| Activity history | All-character or individual-character history; mode filters including raids, dungeons, Nightfalls, Trials and Gambit; older pages; deduplication; partial-page retry; participant match reports and links to other Guardians |
| Triumphs & titles | Search every exposed triumph by name/description; completed/incomplete/redeemed states; objective counters; filter equippable titles; obscured triumph handling |
| Collections | Search exposed collectible names/descriptions; acquired/missing filters; profile and character state merge |
| Progression & metrics | Named public reputation/progression counters, levels, next-level progress and resets; searchable named Bungie metric counters |
| Comparison | Compare two players' equivalent public overview measurements and differences; open the second player's report |
| Sharing | Stable `?name=Guardian%231234` URLs; copy link; print loaded content; JSON export with retrieval time, schema version, profile response, and loaded sections |

## Sources and semantics

- [GetProfile and component types](https://bungie-net.github.io/multi/schema_Destiny-DestinyComponentType.html): components `100,104,200,202,204,205,300,304,305,800,900,1100`.
- [Historical account statistics](https://bungie-net.github.io/multi/operation_get_Destiny2-GetHistoricalStatsForAccount.html): account aggregates may include deleted characters and do not equal surviving-character playtime. An undefined ratio (zero denominator) stays unavailable unless Bungie provides the ratio directly.
- [Activity history](https://bungie-net.github.io/multi/operation_get_Destiny2-GetActivityHistory.html) and [post-game reports](https://bungie-net.github.io/multi/operation_get_Destiny2-GetPostGameCarnageReport.html): history uses 25 results per character per page. All-character results combine those pages; they do not promise a globally contiguous timestamp window when characters have different activity volumes. A failed character's page is retried before the shared cursor advances. IDs stay strings to preserve 64-bit precision.
- [Record state flags](https://bungie-net.github.io/multi/schema_Destiny-DestinyRecordState.html): completed does not mean redeemed; title unlock is a separate flag. Invisible records are omitted. Obscured descriptions use Bungie's obscured text.
- [Character playtime](https://bungie-net.github.io/multi/schema_Destiny-Entities-Characters-DestinyCharacterComponent.html) includes idle time and excludes deleted characters. Highest displayed power is the maximum current character power, not a theoretical maximum from inventory.

Definition catalogues load from Bungie's manifest-provided static paths only when needed. Item definitions are resolved individually with bounded concurrency. No player scores are submitted by the report to the database. The existing identity-only enqueue RPC remains the only search write. New sections do not add background indexing workload or a local service.

## Practical limits and future extensions

Private progression, non-equipped inventory/vault, and saved loadouts need an authenticated, consent-based account connection. This release does not add OAuth. Reports cannot bypass Bungie's privacy settings.

Activity history is paginated, not a stored lifetime archive. Full raid/dungeon history verification, longitudinal charts, weapon-instance history, and global percentiles need additional collection and storage. Match reports do not contain all profile-wide Triumph/Guardian Rank data. Bungie metric values are shown as raw counters because metric units differ; these are not all interchangeable totals.

Print and JSON export include sections loaded so far. Filtered/paginated tables print their current visible rows. JSON includes all history pages fetched and loaded catalogue entries. Static manifest descriptions can contain game-specific placeholder tokens. Names and descriptions are escaped as text, and image paths are restricted to Bungie-hosted paths.

## Validation

Node regression tests cover missing values, zero denominators, collection merging, record flags, secret-triumph search, numeric precision, pagination, and cancellation. The mocked browser suite covers every report section, equipment/perks, comparison, partial-page recovery, filtering, match reports, export, malicious display text, stale searches, mobile overflow, and the existing leaderboards. GitHub Actions additionally performs a read-only schema check against the public `Hawk#7753` account. No live verification or scheduled indexer runs locally.

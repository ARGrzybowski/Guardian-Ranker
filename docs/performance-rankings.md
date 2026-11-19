# Guardian Ranker performance and standings

GR-3.2 awards performance points for verified raid, dungeon, operations and Crucible evidence. Points determine the order of the performance standings. The displayed rating is the percentage of the eligible tracked cohort at or below that score. Tied players share both rank and percentile.

| Evidence | Points |
| --- | --- |
| Raid completions | 15 points for the first recorded completion of each raid family. Each repeat of the same family earns 4 ÷ [n × (n − 1)] points, where n is the completion number. |
| Dungeon completions | 12 points for the first recorded completion of each dungeon family. Its repeats use the same declining curve as raids. |
| Raid contest clears | 250 per verified catalogued launch-window or Contest clear. |
| Dungeon contest clears | 200 per verified catalogued Contest clear. |
| Best solo dungeon tier | 50 points for verified solo or 120 for verified solo flawless. Credit is awarded once per dungeon at its highest verified tier. |
| Grandmaster Nightfalls | 10 points for the first completion of each explicitly named Grandmaster Nightfall. Its repeats use the same declining curve as raids. |
| Solo Ops | 3 points for the first completion of each named single-player Solo Ops mission. Its repeats earn 2 ÷ [n × (n − 1)] points. |
| Competitive | 1 point per 50 division points at the account’s highest observed public score. |
| Trials flawless passages | 30 points for the first flawless passage. Subsequent passages across the lifetime tracker earn 16 ÷ [n × (n − 1)] points. |
| Lifetime Crucible K/D | Round 100 × log₂(1 + kills ÷ (deaths + 100)). |
| Current-season Crucible K/D | Round 65 × log₂(1 + kills ÷ (deaths + 35)). Uses all available matches since the current season began, deduplicated by match ID. |

Monument of Triumph starts on June 9, 2026 at 17:00 UTC. Matches before that launch remain in their past seasons, including Renegades. The best completed past season uses the same point calculation for display only. The cloud indexer resumes paginated history over multiple runs. While an account's historical scan is in progress, any displayed past-season best covers only seasons with complete indexed coverage. [Bungie's Monument of Triumph announcement](https://www.bungie.net/7/en-us/News/Article/monument_of_triumph_is_live). [Bungie activity history API](https://bungie-net.github.io/multi/operation_get_Destiny2-GetActivityHistory.html).

For example, the first three clears of one raid add 15, 2 and about 0.67 points. A new raid starts its own curve. Points retain fractional precision for sorting. Ordinary counters can include checkpoints. The Grandmaster metric tracks named Nightfall records with explicit Grandmaster definitions. Custom Portal configurations can share a single activity definition across difficulties. Contest credit requires a curated Bungie record for a verified clear, with record redemption or all required objectives complete. The original and Epic releases of The Desert Perpetual have distinct official events. Other difficulty modes, event participation, and records that merely mention Contest are insufficient. Earlier clears without supported public records may be absent. [Bungie raid Contest rules](https://www.bungie.net/7/en/News/Article/twid_07_17_2025), [dungeon Contest rules](https://www.bungie.net/7/en/News/article/twid_02_06_2025), [Epic raid Contest rules](https://www.bungie.net/7/en/News/Article/twid_09_25_2025).

Competitive uses the current public progression at each refresh and preserves the exact high-water mark observed by Guardian Ranker. A previous season’s unobserved peak cannot be backfilled from that progression. Trials combines Bungie’s two nonoverlapping lifetime trackers, one for Flawless Tickets from Season 10 through Episode 2 and the other for Flawless Lighthouse Passages from Episode 3 onward. Match outcomes, precision kills, titles, Triumph totals and commendations carry zero performance weight. [Bungie Competitive Divisions](https://help.bungie.net/hc/en-us/articles/11269047447956-Crucible-Competitive-Divisions), [Bungie public API](https://bungie-net.github.io/multi/index.html).

| Standing | Eligible tracked accounts |
| --- | --- |
| Performance | Public, canonical accounts verified in the last 7 days with complete evidence and at least 20 recorded raid, dungeon or Grandmaster clears, 100 Crucible entries, or a verified contest or solo dungeon clear. |
| Knowledge | Public, canonical accounts refreshed in the last 14 days with lifetime Guardian Rank 7+ and 10,000+ Triumph points. |
| Commendations | Public, canonical accounts observed in the last 7 days with lifetime Guardian Rank 7+ and a commendation score of 500+. |

Game time, time spent in activity, and aggregate fastest times earn zero points. A fair speed comparison would group verified full runs by activity, difficulty and ruleset. Bungie’s aggregate records do not expose that verification. [Bungie’s per-run report fields](https://bungie-net.github.io/multi/schema_Destiny-HistoricalStats-DestinyPostGameCarnageReportData.html).

A board publishes percentiles after 30 players qualify. During the GR-3.2 backfill, the overall board shows a previous scoring model until 30 eligible accounts have verified current-season points. Each leaderboard uses one model. Knowledge and commendations have independent cohorts. A player’s percentile changes as peers join or refresh. An explicitly empty current season earns zero seasonal points. Unavailable or unfinished current-season evidence has no verified score. Transient request errors preserve previously validated snapshots until expiry. [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

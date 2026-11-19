# Guardian Account Rating — GR-2.0

GR-2.0 expands the account rating from ten to eighteen metrics. Five dimension summaries expose strengths across Achievement (35%), Endgame (36%), Crucible (20%), PvE (7%) and Recognition (2%). Higher veteran ceilings and new breadth metrics distinguish accounts that previously saturated the same lifetime counters. All benchmarks are editorial choices, not population percentiles or claims about competitive skill. Scores from earlier model versions are not comparable.

## Metric definitions and weights

| Metric | Dimension | Weight | Measurement |
| --- | --- | ---: | --- |
| Triumph mastery | Achievement | 12% | lifetime Triumph points |
| Title mastery | Achievement | 8% | distinct equippable titles |
| Collection breadth | Achievement | 8% | acquired visible collectibles |
| Guardian development | Achievement | 7% | highest lifetime Guardian Rank |
| Raid experience | Endgame | 10% | Bungie raid completions |
| Dungeon experience | Endgame | 8% | Bungie dungeon completions |
| Crucible performance | Crucible | 12% | sample-adjusted combat score |
| Crucible experience | Crucible | 4% | PvP activities entered |
| PvE experience | PvE | 5% | PvE activities entered |
| Commendation recognition | Recognition | 2% | current commendation score |
| Raid breadth | Endgame | 5% | distinct raid families with 1+ completions |
| Dungeon breadth | Endgame | 4% | distinct dungeon families with 1+ completions |
| Raid repeat experience | Endgame | 3% | distinct raid families with 10+ completions |
| Dungeon repeat experience | Endgame | 3% | distinct dungeon families with 10+ completions |
| Endgame class versatility | Endgame | 3% | classes with 10+ endgame completions |
| Crucible precision share | Crucible | 2% | sample-adjusted precision score |
| PvE precision share | PvE | 2% | sample-adjusted precision score |
| Crucible assist participation | Crucible | 2% | sample-adjusted assist score |

Every metric is rated 0–100. Overall points = sum(weight × metric score ÷ 10), capped at 1,000. Dimension scores are weighted averages of their own metrics and add no extra points. Achievement metrics overlap with participation and endgame metrics; these are intentional, correlated views of account development, not independent statistical factors. Power, playtime, recent login and activity speed earn no points.

## Published milestones

| Metric | Raw measurement → score |
| --- | --- |
| Triumph mastery | 0 → 0; 1,000 → 10; 10,000 → 30; 25,000 → 50; 50,000 → 70; 100,000 → 90; 150,000 → 95; 250,000 → 100 |
| Title mastery | 0 → 0; 1 → 15; 5 → 40; 10 → 60; 20 → 80; 35 → 90; 60 → 100 |
| Collection breadth | 0 → 0; 100 → 10; 1,000 → 30; 3,000 → 55; 6,000 → 80; 10,000 → 90; 14,000 → 100 |
| Guardian development | 1 → 0; 5 → 20; 6 → 35; 7 → 50; 8 → 65; 9 → 80; 10 → 90; 11 → 100 |
| Raid experience | 0 → 0; 1 → 10; 10 → 30; 50 → 55; 200 → 80; 750 → 90; 2,000 → 100 |
| Dungeon experience | 0 → 0; 1 → 10; 10 → 30; 50 → 55; 250 → 80; 1,000 → 90; 2,500 → 100 |
| Crucible experience | 0 → 0; 10 → 10; 100 → 35; 500 → 60; 2,000 → 85; 5,000 → 100 |
| PvE experience | 0 → 0; 50 → 10; 500 → 35; 2,500 → 60; 10,000 → 85; 25,000 → 100 |
| Commendation recognition | 0 → 0; 100 → 20; 500 → 50; 1,500 → 75; 5,000 → 100 |
| Raid breadth | 0 → 0; 1 → 15; 3 → 35; 6 → 60; 10 → 85; 14 → 100 |
| Dungeon breadth | 0 → 0; 1 → 15; 3 → 35; 6 → 60; 10 → 85; 14 → 100 |
| Raid repeat experience | 0 → 0; 1 → 20; 3 → 45; 6 → 70; 10 → 90; 14 → 100 |
| Dungeon repeat experience | 0 → 0; 1 → 20; 3 → 45; 6 → 70; 10 → 90; 14 → 100 |
| Endgame class versatility | 0 → 0; 1 → 35; 2 → 70; 3 → 100 |

Volume metrics interpolate logarithmically within each milestone band: y1 + (y2 − y1) × [ln(1+x) − ln(1+x1)] / [ln(1+x2) − ln(1+x1)]. Guardian Rank and class count use linear interpolation. Values at or above the top milestone cap at 100. A benchmark of 14 families is a fixed scoring ceiling, not a claim that every account can access fourteen current activities. Retired content and expansion ownership affect opportunity. Lifetime achievements favor established accounts.

## Endgame breadth, repeat experience and classes

Completions still sum the recognized raid/dungeon counters across surviving characters. Each activity hash counts once per character. Families group activity variants by Bungie's PGCR image; original display name is the fallback, then a display name with a recognized difficulty suffix removed. Family keys include raid/dungeon mode. A missing family identity never falls back to the activity hash and inflates breadth: affected family metrics stay partial. The compact cloud catalog preserves the same metadata and produces the same scores as the full browser catalog. Family grouping is a metadata heuristic, not an official encounter taxonomy; shared artwork can merge activities and changed artwork can split them.

Breadth counts families with one or more completions. Repeat experience counts families with at least ten completions, summed across variants and characters. Class versatility counts Titan, Hunter and Warlock classes with at least ten recognized endgame completions each. Two characters of one class cannot earn two class credits. These counters can include checkpoints, repeat farming, legacy activities and Bungie classification errors; none verifies full clears, solo/flawless achievements, difficulty or teaching skill. Deleted characters are excluded. Retired/unclassified activity entries stay outside the recognized catalog and do not make the account provisional. Failed character requests or missing eligible counters do.

The report exposes the family totals and class completion counts behind these new scores. Strongest areas sort fully rated metrics by score then weight. Next milestones show the next published threshold, ordered by the additional overall points that individual metric would earn. They are not estimates of effort or recommendations to farm an activity, and correlated metrics may also move.

## Combat quality and sample moderation

Crucible performance retains its existing formula: raw = 65% K/D score + 35% win-rate score. K/D benchmarks are 0→0, 0.5→20, 1→50, 1.5→75, 2→90, 3→100. Win-rate benchmarks are 0%→0, 25%→20, 50%→50, 65%→80, 80%→100. Both interpolate linearly. Final = 50 + [activities ÷ (activities + 100)] × (raw − 50).

Precision share = precision kills ÷ all kills × 100, separately for PvP and PvE. Benchmarks: 0%→0, 10%→20, 20%→45, 35%→75, 50%→100, linearly interpolated. Final = 50 + [kills ÷ (kills + 500)] × (raw − 50). This is a share of kills, not shot accuracy. Ability/explosive kills and weapon choices strongly affect it, which is why each metric has only 2% weight.

Crucible assist participation = assists ÷ activities entered. Benchmarks: 0→0, 1→20, 3→50, 5→75, 8→100. Final = 50 + [activities ÷ (activities + 100)] × (raw − 50). Modes, game length and teammate behavior affect assists. The metric does not establish team reliability or personality.

Moderation toward 50 limits tiny perfect samples. It is a heuristic, not a confidence level or probability. Explicit zero participation earns zero experience credit. Missing, negative, nonfinite or contradictory counters remain unavailable; precision kills cannot exceed kills and wins cannot exceed entries. Low samples keep an evidence note without invalidating a complete account grade.

## Grades, missing inputs and privacy

D: 0+, C: 20+, B: 40+, A: 60+, S: 75+, S+: 90+. Overall thresholds use this scale ×10. Grades use unrounded scores; displayed numbers truncate to one decimal so rounding cannot imply a higher grade.

A complete overall grade requires all eighteen metrics. Each complete dimension can still receive a grade independently; an incomplete dimension has no score or grade. Missing weights are not redistributed, and hiding a weak metric cannot produce a complete high rating. Partial monotone counts provide a lower bound; unresolved weights contribute up to their full point ceiling to the upper bound. At least 70% weight coverage is required to display the provisional range midpoint. Below that, only the missing-data range is displayed. This range is not a statistical confidence interval.

Titles deduplicate distinct equippable names and exclude redacted/gilding-only records; collection hashes merge visible acquired states across scopes. Commendations can reset or be farmed, so their weight remains 2%. Private or failed inputs do not become zeros. Successful empty public counters represent zero.

## Worked example and safeguards

The deterministic fixture in tests/rating.test.js has 25,000 Triumph points, five titles, 3,000 collectibles, rank 8, fifty raid and ten dungeon completions across one family each, and one developed class. Its PvP totals are 200 kills, 100 deaths, 80 precision kills, 300 assists, 100 entries and sixty wins; its PvE totals are 10,000 kills, 3,000 precision kills and 2,500 entries. With 500 commendation points, GR-2.0 yields 465.0619047619 / 1,000 (B). Every score, dimension, point contribution and published anchor is tested.

The cloud worker independently calculates ratings with this exact module and the same public input requests. Browsers never submit trusted scores. The current-model read-only leaderboard excludes private, alias, partial, older-model and more-than-seven-day-old snapshots. Transient failures preserve the prior snapshot and timestamp; private profiles remove eligibility. GR-1.1 rows are recalculated during the GR-2.0 backfill rather than mixed into the new ranking.

The compact manifest projection is separately versioned; old cached projections are rebuilt in two bounded cloud invocations even if Bungie's manifest version did not change. Up to ten rating attempts per invocation share the original pacing, operation budget, soft deadline and three-minute lease with profile refresh and discovery. Target refreshes are hourly for active players/leaders, six-hourly for recently active accounts and daily for inactive accounts, subject to queue and API capacity. Recurring collection runs in Supabase only; the optional Actions runner remains disabled. JSON report exports contain the full expanded model and evidence.

Sources: [Bungie activity metadata](https://bungie-net.github.io/multi/schema_Destiny-Definitions-DestinyActivityDefinition.html), [account historical statistics](https://bungie-net.github.io/multi/schema_Destiny-HistoricalStats-DestinyHistoricalStatsAccountResult.html), and [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). The formulas and weights are this project's design, not Bungie-endorsed rankings.

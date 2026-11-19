# Guardian Account Rating — GR-1.1

GR-1.1 fixes the blanket provisional status in GR-1.0. Retired/unclassified activity and title records are outside the recognized scoring catalog; their absence no longer withholds an account grade. Small PvP samples keep their moderated metric and evidence note without invalidating the rest of the account. Genuine missing public inputs still produce partial results.

## Cloud leaderboard

The main page and all-leaderboards page include Account Rating, sorted by unrounded cloud-verified scores and membership ID for ties. Displayed scores are truncated to one decimal. Links open the rating report. Coverage counts identify how many indexed accounts have been rated and how many are due; this is the tracked population, not a global census.

The existing Supabase worker calculates up to ten due ratings per run, within the same 240-operation, paced Bungie request budget and 80-second soft deadline. First-time catalog preparation takes two checkpointed invocations. A compact server-only manifest cache is checked daily. Active accounts and rating leaders target hourly ratings; recently active accounts target six hours; inactive accounts target 24 hours. Actual freshness depends on backlog and API availability.

Only complete public GR-1.1 snapshots refreshed within seven days are eligible. Browser roles can read the guarded ranking view but cannot write ratings, inspect worker diagnostics, read the manifest cache or call worker queue functions. Private accounts and cross-save aliases are filtered through the existing canonical profile index. Transient errors preserve the previous verified snapshot and its original timestamp; privacy errors remove eligibility. Profile and rating workers share a three-minute crash-recovery lease, and all recurring work remains in Supabase.

This system rates public Destiny 2 account achievements and experience. Every metric receives a 0–100 rating and a grade. Ten fixed weights combine into an overall rating with a ceiling of 1,000. It is an account-completeness and achievement model, not a population percentile, Elo rating, player valuation, anti-cheat verdict, or measure of a person's character.

**The weights and thresholds below are editorial design choices. They have not been fitted to a representative player population.** Version 1 is deliberately inspectable and testable before any future cohort calibration. Different play styles can excel in individual metrics while having different overall account ratings.

## Weights and metric definitions

| Metric | Weight | Maximum overall points | Measurement and rationale |
| --- | ---: | ---: | --- |
| Triumph mastery | 15% | 150 | Public lifetime Triumph score: sustained achievement, including legacy accomplishments |
| Title mastery | 10% | 100 | Distinct equippable title names, deduplicated across characters and title records; excludes gilding-only records |
| Collection breadth | 10% | 100 | Unique acquired, visible collectible hashes across exposed profile and character scopes |
| Guardian development | 10% | 100 | Highest lifetime Guardian Rank rather than the seasonally reset current rank |
| Raid experience | 15% | 150 | Sum of Bungie's raid completion counters across surviving characters |
| Dungeon experience | 10% | 100 | Sum of Bungie's dungeon completion counters across surviving characters |
| Crucible performance | 15% | 150 | 65% K/D rating and 35% win-rate rating, moderated toward 50 for small samples |
| Crucible experience | 5% | 50 | Account-wide PvP activity entries: sustained participation with a deliberately small weight |
| PvE experience | 8% | 80 | Account-wide PvE activity entries: general participation, not an assumption of difficult completions |
| Commendation recognition | 2% | 20 | Current commendation score: limited weight because scores can reset and can be farmed |
| **Total** | **100%** | **1,000** | Achievement breadth is intentional; no single metric can dominate |

The achievement metrics total 45%, endgame experience 25%, combat/participation 28%, and commendations 2%. Some measures are correlated: a raid can contribute to participation, achievements and endgame experience. These are purposeful views of account development, not statistically independent dimensions.

## Milestone curves

Milestones are listed as **raw measurement → metric score**. They are scoring benchmarks, not claims about how common each achievement is.

| Metric | Milestones |
| --- | --- |
| Triumph mastery | 0→0; 1,000→10; 10,000→30; 25,000→50; 50,000→70; 100,000→90; 150,000→100 |
| Title mastery | 0→0; 1→15; 5→40; 10→60; 20→80; 35→100 |
| Collection breadth | 0→0; 100→10; 1,000→30; 3,000→55; 6,000→80; 10,000→100 |
| Guardian development | rank 1→0; 5→20; 6→35; 7→50; 8→65; 9→80; 10→90; 11→100 |
| Raid experience | 0→0; 1→10; 10→30; 50→55; 200→80; 750→100 |
| Dungeon experience | 0→0; 1→10; 10→30; 50→55; 250→80; 1,000→100 |
| Crucible experience | 0→0; 10→10; 100→35; 500→60; 2,000→85; 5,000→100 |
| PvE experience | 0→0; 50→10; 500→35; 2,500→60; 10,000→85; 25,000→100 |
| Commendations | 0→0; 100→20; 500→50; 1,500→75; 5,000→100 |

For volume metrics, interpolate within the surrounding milestone band using:

```text
S(x) = y₁ + (y₂ − y₁) × [ln(1+x) − ln(1+x₁)] / [ln(1+x₂) − ln(1+x₁)]
```

Guardian Rank uses ordinary linear interpolation between its milestones. Values at or above the top milestone cap at 100. Negative, missing and nonfinite measurements are unavailable. This is a capped, milestone-based progression curve with logarithmic interpolation within volume bands; it is not a fitted percentile distribution. Rank 11 is the current version's top scoring anchor, not a promise about future game rank caps.

## Crucible performance

K/D is computed from the same account-wide kills and deaths totals. Win rate is wins / activities entered. The model requires consistent nonnegative kills, deaths, wins and activity entries; wins cannot exceed entries. Missing or inconsistent fields leave the metric unrated.

| K/D | Rating |
| ---: | ---: |
| 0 | 0 |
| 0.5 | 20 |
| 1.0 | 50 |
| 1.5 | 75 |
| 2.0 | 90 |
| 3.0+ | 100 |

| Win rate | Rating |
| ---: | ---: |
| 0% | 0 |
| 25% | 20 |
| 50% | 50 |
| 65% | 80 |
| 80%+ | 100 |

These two tables interpolate linearly and clamp at 100. Positive kills with zero deaths receive the capped K/D subscore, while the interface explains that no deaths were recorded. Positive activity entries with zero kills and zero deaths leave performance unrated. Explicit zero activity entries receive zero account-performance/experience credit; they do not establish the player's underlying skill.

```text
Raw performance = 0.65 × K/D rating + 0.35 × win-rate rating
Evidence factor = activity entries / (activity entries + 100)
Performance rating = 50 + evidence factor × (raw performance − 50)
```

The evidence factor is a versioned moderation heuristic, not a statistical confidence level. One perfect recorded activity scores approximately 50.495 instead of 100. A thousand perfect activities score approximately 95.455. Below 100 activities, the Crucible metric carries a small-sample evidence note. The moderation formula already accounts for that limitation, so the account can still receive an overall grade. At exactly 100 activities, the evidence factor is still 0.5; more history continues to moderate the raw result less strongly.

Historical activity mixes, matchmaking, teams and game updates affect K/D and win rate. They do not support an Elo-equivalent claim. Commendations and activity volume cannot substitute for combat performance.

## Overall formula and grades

```text
Overall points = Σ(metric score × metric weight / 10)
```

For example, an 80/100 metric with a 15% weight contributes 120 of its maximum 150 overall points. Calculations use full precision. Displayed score values are truncated to one decimal so rounding does not imply crossing a grade boundary.

| Grade | Name | Metric threshold | Overall threshold |
| --- | --- | ---: | ---: |
| D | Initiate | 0 | 0 |
| C | Developing | 20 | 200 |
| B | Established | 40 | 400 |
| A | Advanced | 60 | 600 |
| S | Elite | 75 | 750 |
| S+ | Legend | 90 | 900 |

Grade thresholds use unrounded scores. An overall grade requires the public inputs for all ten scoped metrics. Small PvP samples are moderated and labeled within that metric; they do not make the whole account provisional. Individual available metrics retain their own grades; their evidence notes still apply.

## Missing, private and partial data

No unavailable metric is assigned a fabricated zero. Each metric has one of three states:

- **Rated:** required public evidence is available; score and grade enter the complete-weight total.
- **Partial:** known evidence gives a lower bound, such as counters from only two characters or malformed required record flags. The card shows “at least” the observed score and receives no grade.
- **Missing:** no defensible measurement is available; the card is unrated.

Coverage means **available metric weight**, not confidence, percentage of all Destiny accounts, or certainty that every historic activity is represented. Collection breadth explicitly measures visible collectibles. If only character-level collectibles are available while the profile-wide scope is absent, the metric is partial. Invisible collectibles are omitted, and an item is counted when any exposed scope shows it acquired and visible.

Endgame coverage requires every surviving character's aggregate response and valid counters for recognized raid/dungeon entries. GR-1.1 scopes the metric to the current recognized endgame catalog: retired, redacted, non-endgame and unclassified records are excluded rather than treated as missing endgame evidence. Failed character requests and missing counters on eligible entries still make the result partial. Duplicate activity hashes within one character are counted once; the same activity on different characters remains separate. A successful empty response represents zero counters, while a failed response represents missing evidence.

For incomplete accounts:

```text
C = sum of fully rated metric weights
P = sum of fully rated metric contributions in overall points
L = P + observed lower-bound contributions from partial metrics
U = P + (100 − C) × 10
Audit-only observed average = P / C × 100, if C > 0
Provisional displayed rating = (L + U) / 2, if C ≥ 70
```

The overall card shows a provisional range midpoint only at 70% or greater coverage; otherwise it is unrated. It also shows the unresolved-data range [L, U]. The midpoint is a display convention, not a probability estimate or an assumption that unknown metrics actually sit halfway through their possible values. The range is a mathematical bound on the default weighted rating, not a statistical confidence interval. No incomplete account receives an overall grade, even if its midpoint is high. Concealing a weak metric therefore cannot create a complete high-grade rating. The available-weight average is retained only for audit in JSON; it is not shown as the overall score, because strong partial lower bounds can put that average outside [L, U].

The rating loads its own complete set of required inputs when opened. Loading more history pages or unrelated report sections does not silently change its weights or sample. Failed-source retries retain successful inputs. Reloading/searching the account creates a new profile snapshot. Profile and career calls are close in time but are not an atomic Bungie snapshot.

## Worked example — synthetic, not a population benchmark

This example is enforced in the regression suite.

| Metric | Example measurement | Metric score | Overall contribution |
| --- | --- | ---: | ---: |
| Triumphs | 25,000 points | 50 | 75 |
| Titles | 5 distinct titles | 40 | 40 |
| Collections | 3,000 acquired visible collectibles | 55 | 55 |
| Guardian development | lifetime highest rank 8 | 65 | 65 |
| Raids | 50 Bungie completions | 55 | 82.5 |
| Dungeons | 10 Bungie completions | 30 | 30 |
| PvP performance | 200 kills, 100 deaths, 60 wins, 100 entries | 66.5 | 99.75 |
| PvP experience | 100 entries | 35 | 17.5 |
| PvE experience | 2,500 entries | 60 | 48 |
| Commendations | 500 score | 50 | 10 |
| **Overall** | **100% metric-weight coverage** | **B · Established** | **522.75 / 1,000** |

If the PvP fields become unavailable, coverage falls to 80%. The remaining confirmed contribution is 405.5; the missing-data range is 405.5–605.5, and its provisional midpoint is 505.5. There is no overall grade. The audit-only available-weight average would be 506.875. Neither replaces a complete rating.

## Exclusions and guardrails

- Power is excluded because its scale and relevance change across releases.
- Playtime is excluded because character totals include idle time and omit deleted characters.
- Fastest activity times are excluded because checkpoint runs and activity variants are not comparable full runs.
- Recent login has no scoring effect: taking a break does not erase account achievements.
- Raid/dungeon counters can include checkpoints and repeated farming. They do not prove full clears, solo/flawless completions or encounter mastery.
- Titles differ in difficulty; a distinct-title count is a transparent depth proxy, not difficulty-normalized achievement quality.
- Collections include cosmetics and legacy items; ownership can reflect purchases and availability as well as gameplay.
- Commendations can reset and can be farmed; their total contribution is capped at 20/1,000 points.
- A specialist can have an excellent metric score and a lower broad-account score. The model does not claim that a PvE-focused account is a worse PvP player, or vice versa.
- Ratings are calculated from public data in the report. Browsers do not submit scores to trusted leaderboard storage. The Supabase cloud worker independently fetches the required Bungie inputs and stores verified snapshots. The account-rating leaderboard includes only complete public GR-1.1 scores refreshed within seven days; old versions, private accounts and genuine partial ratings are excluded.

## Sources, ownership and maintenance

The scoring configuration is owned by the Guardian Ranker codebase in `accountRating.js`; changes to metric definitions, weights, anchors, privacy treatment or grade rules require a scoring-version change and updated tests/docs. Results and JSON exports carry the model version and calculation timestamp. Compare accounts only under compatible versions and coverage rules.

Controlling source definitions:

- [Bungie profile fields](https://bungie-net.github.io/multi/schema_Destiny-Entities-Profiles-DestinyProfileComponent.html): current versus highest lifetime Guardian Rank.
- [Record flags](https://bungie-net.github.io/multi/schema_Destiny-DestinyRecordState.html) and [title definitions](https://bungie-net.github.io/multi/schema_Destiny-Definitions-Records-DestinyRecordTitleBlock.html): completion, invisibility, equippable titles, and gender-localized names.
- [Collectible flags](https://bungie-net.github.io/multi/schema_Destiny-DestinyCollectibleState.html): acquired versus invisible states.
- [Historical account statistics](https://bungie-net.github.io/multi/operation_get_Destiny2-GetHistoricalStatsForAccount.html): account-wide PvP/PvE totals, which can include deleted characters.
- [Aggregate activity statistics](https://bungie-net.github.io/multi/operation_get_Destiny2-GetDestinyAggregateActivityStats.html): per-character completion counters; activity mode definitions classify raid/dungeon records.
- [Commendation component](https://bungie-net.github.io/multi/schema_Destiny-Components-Social-DestinySocialCommendationsComponent.html): current total score.

Before a future calibration release, obtain a representative public-account cohort, inspect coverage by account age/platform/play style/privacy, assess correlated metrics and farming sensitivity, and publish any resulting benchmark changes under a new version. The current convenience sample used for live smoke tests does not establish population distributions or fairness across those cohorts.

Validation includes exact milestones, monotonicity/caps, weighted arithmetic, the worked example, missing/private data, partial character/definition coverage, title/collection deduplication, PvP small samples/contradictions, ignored power/playtime/speed fields, browser retries, mobile layout, export and direct rating links. GitHub Actions performs read-only live verification; no collector or live verification script runs locally.

import { numeric, statValue, recordEntries, careerGroups } from './reportData.js';

export const RATING_VERSION = 'GR-1.1';
// These are editorial milestones, not estimated population percentiles.
export const RATING_METRICS = [
  { id: 'triumphs', name: 'Triumph mastery', weight: 15, unit: 'lifetime Triumph points', source: 'Public profile records', anchors: [[0, 0], [1000, 10], [10000, 30], [25000, 50], [50000, 70], [100000, 90], [150000, 100]], rationale: 'Sustained achievement across the game.', caveat: 'Lifetime totals favor established accounts and include legacy achievements.' },
  { id: 'titles', name: 'Title mastery', weight: 10, unit: 'distinct equippable titles', source: 'Record flags + title definitions', anchors: [[0, 0], [1, 15], [5, 40], [10, 60], [20, 80], [35, 100]], rationale: 'Completed title requirements add achievement depth.', caveat: 'Gilding-only records and duplicate title names are excluded; titles differ in difficulty.' },
  { id: 'collections', name: 'Collection breadth', weight: 10, unit: 'acquired visible collectibles', source: 'Profile + character collectible states', anchors: [[0, 0], [100, 10], [1000, 30], [3000, 55], [6000, 80], [10000, 100]], rationale: 'Breadth of acquired equipment and cosmetics.', caveat: 'Includes cosmetic and legacy items; acquisition count is not combat skill. Private character collection scopes can limit coverage.' },
  { id: 'rank', name: 'Guardian development', weight: 10, unit: 'highest lifetime Guardian Rank', source: 'Public profile', linear: true, anchors: [[1, 0], [5, 20], [6, 35], [7, 50], [8, 65], [9, 80], [10, 90], [11, 100]], rationale: 'Highest demonstrated Guardian Rank avoids seasonal rank decay.', caveat: 'Version 1 reaches its benchmark at rank 11; this is a scoring anchor, not a claim about future rank caps.' },
  { id: 'raids', name: 'Raid experience', weight: 15, unit: 'Bungie raid completions', source: 'All surviving characters’ aggregate counters + activity definitions', anchors: [[0, 0], [1, 10], [10, 30], [50, 55], [200, 80], [750, 100]], rationale: 'Experience with raid activities.', caveat: 'Can include checkpoints; these are not independently verified full clears. Deleted characters are excluded.' },
  { id: 'dungeons', name: 'Dungeon experience', weight: 10, unit: 'Bungie dungeon completions', source: 'All surviving characters’ aggregate counters + activity definitions', anchors: [[0, 0], [1, 10], [10, 30], [50, 55], [250, 80], [1000, 100]], rationale: 'Experience with dungeon activities.', caveat: 'Can include checkpoints and repeat farming; these counters do not establish solo/flawless mastery.' },
  { id: 'pvpPerformance', name: 'Crucible performance', weight: 15, unit: 'sample-adjusted combat score', source: 'Account allPvP historical statistics', rationale: '65% K/D rating + 35% win-rate rating, moderated for small samples.', caveat: 'Matchmaking, team size, modes and historical changes affect these totals. This is not Elo or a matchmaking skill estimate.' },
  { id: 'pvpExperience', name: 'Crucible experience', weight: 5, unit: 'PvP activities entered', source: 'Account allPvP historical statistics', anchors: [[0, 0], [10, 10], [100, 35], [500, 60], [2000, 85], [5000, 100]], rationale: 'Evidence of sustained participation, with a small capped weight.', caveat: 'Participation alone does not establish skill.' },
  { id: 'pveExperience', name: 'PvE experience', weight: 8, unit: 'PvE activities entered', source: 'Account allPvE historical statistics', anchors: [[0, 0], [50, 10], [500, 35], [2500, 60], [10000, 85], [25000, 100]], rationale: 'Breadth of PvE participation with diminishing returns.', caveat: 'Includes lower-difficulty activities; activity entries are not completions or unique activities.' },
  { id: 'commendations', name: 'Commendation recognition', weight: 2, unit: 'current commendation score', source: 'Public commendation component', anchors: [[0, 0], [100, 20], [500, 50], [1500, 75], [5000, 100]], rationale: 'A small recognition signal that cannot dominate the rating.', caveat: 'Season changes and farming affect scores. Commendations are not a measure of character or team reliability.' }
];
export const KD_ANCHORS = [[0, 0], [0.5, 20], [1, 50], [1.5, 75], [2, 90], [3, 100]];
export const WIN_ANCHORS = [[0, 0], [0.25, 20], [0.5, 50], [0.65, 80], [0.8, 100]];
export const RATING_TIERS = [
  { min: 90, grade: 'S+', name: 'Legend' }, { min: 75, grade: 'S', name: 'Elite' },
  { min: 60, grade: 'A', name: 'Advanced' }, { min: 40, grade: 'B', name: 'Established' },
  { min: 20, grade: 'C', name: 'Developing' }, { min: 0, grade: 'D', name: 'Initiate' }
];
const valid = value => { const v = numeric(value); return v != null && v >= 0 ? v : null; };
const clamp = value => Math.min(100, Math.max(0, value));
export function ratingTier(score) {
  return valid(score) == null ? null : RATING_TIERS.find(t => clamp(score) >= t.min);
}
export function milestoneScore(value, anchors, linear = false) {
  const v = valid(value);
  if (v == null) return null;
  if (v <= anchors[0][0]) return anchors[0][1];
  const transform = linear ? x => x : Math.log1p;
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i - 1], [x2, y2] = anchors[i];
    if (v <= x2) return clamp(y1 + (y2 - y1) * (transform(v) - transform(x1)) / (transform(x2) - transform(x1)));
  }
  return anchors.at(-1)[1];
}

export function titleEvidence(profile, definitions) {
  if (!definitions || profile.profileRecords?.data?.records == null) return { value: null, reason: 'Public record states and title definitions are required.' };
  const names = new Set();
  const recordScopes = [profile.profileRecords?.data, ...Object.values(profile.characterRecords?.data || {})];
  let unresolved = recordScopes.flatMap(scope => Object.values(scope?.records || {})).filter(record => valid(record.state) == null || !Number.isInteger(Number(record.state))).length;
  for (const record of recordEntries(profile)) {
    if (!record.titleUnlocked) continue;
    const def = definitions[record.hash];
    if (!def) continue; // Retired/unavailable records are outside the current title catalog.
    if (def.redacted || def.forTitleGilding) continue;
    const title = Object.values(def.titleInfo?.titlesByGender || {}).find(Boolean) || Object.values(def.titleInfo?.titlesByGenderHash || {}).find(Boolean);
    if (typeof title === 'string' && title.trim()) names.add(title.trim().toLocaleLowerCase());
    else if (def.titleInfo?.hasTitle !== false) unresolved++;
  }
  return { value: names.size, partial: unresolved > 0, reason: unresolved ? `${unresolved} unlocked title record(s) could not be resolved.` : '', names: [...names] };
}

export function endgameEvidence(aggregates, characters, definitions) {
  let raid = 0, dungeon = 0, loaded = 0, unclassified = 0, missingCounters = 0;
  for (let index = 0; index < characters.length; index++) {
    const activities = aggregates?.[index]?.activities;
    if (!Array.isArray(activities)) continue;
    loaded++;
    const seen = new Set();
    for (const activity of activities) {
      const hash = String(activity.activityHash);
      if (seen.has(hash)) continue;
      seen.add(hash);
      const count = valid(statValue(activity.values, 'activityCompletions'));
      const def = definitions?.[hash];
      if (!def || def.redacted) { if (count == null || count > 0) unclassified++; continue; }
      if (!Array.isArray(def.activityModeTypes) && valid(def.directActivityModeType) == null) { if (count == null || count > 0) unclassified++; continue; }
      const modes = new Set([...(def.activityModeTypes || []), def.directActivityModeType]);
      if (!modes.has(4) && !modes.has(82)) continue;
      if (count == null) { missingCounters++; continue; }
      if (modes.has(4)) raid += count;
      else dungeon += count;
    }
  }
  const available = loaded > 0 && definitions != null;
  // Unknown legacy/non-endgame definitions do not invalidate the recognized
  // endgame catalog. Failed character requests and missing eligible counters do.
  const partial = loaded !== characters.length || missingCounters > 0 || !definitions;
  return { raid: available ? raid : null, dungeon: available ? dungeon : null, partial,
    charactersLoaded: loaded, charactersTotal: characters.length, unclassified, missingCounters,
    reason: partial ? `${loaded}/${characters.length} characters loaded; ${unclassified} unclassified activity records; ${missingCounters} missing endgame counters.` : '' };
}

export function pvpEvidence(stats) {
  const games = valid(statValue(stats, 'activitiesEntered'));
  const kills = valid(statValue(stats, 'kills')), deaths = valid(statValue(stats, 'deaths')), wins = valid(statValue(stats, 'activitiesWon'));
  if (games == null) return { value: null, reason: 'Public PvP activity count is required.' };
  if (games === 0 && [kills, deaths, wins].some(v => v > 0)) return { value: null, games, reason: 'PvP totals conflict with the zero activity count.' };
  if (games === 0) return { value: 0, games, noExperience: true, reason: 'No recorded PvP participation; this is an account-experience rating, not a measured skill score.' };
  if (kills == null || deaths == null || wins == null || wins > games || (kills === 0 && deaths === 0)) return { value: null, games, reason: 'Consistent kills, deaths and wins are required.' };
  const kd = deaths === 0 ? null : kills / deaths;
  const kdScore = deaths === 0 ? 100 : milestoneScore(kd, KD_ANCHORS, true);
  const winRate = wins / games, winScore = milestoneScore(winRate, WIN_ANCHORS, true);
  const raw = 0.65 * kdScore + 0.35 * winScore;
  const reliability = games / (games + 100);
  return { value: 50 + reliability * (raw - 50), games, kills, deaths, wins, kd, winRate, kdScore, winScore, raw, reliability,
    lowSample: games < 100, reason: games < 100 ? 'Small PvP sample; the performance score is moderated toward the baseline.' : '' };
}

function metricResult(definition, evidence) {
  const observedScore = evidence.value == null ? null : definition.anchors ? milestoneScore(evidence.value, definition.anchors, definition.linear) : clamp(evidence.value);
  const status = observedScore == null ? 'missing' : evidence.partial ? 'partial' : 'rated';
  const score = status === 'rated' ? observedScore : null;
  const next = definition.anchors?.find(([threshold]) => evidence.value != null && threshold > evidence.value);
  return { ...definition, value: evidence.value, score, observedScore, status, tier: ratingTier(score),
    contribution: score == null ? null : definition.weight * score / 10,
    nextMilestone: next ? { value: next[0], score: next[1] } : null, evidence };
}

export function combineRatings(metrics) {
  if (metrics.reduce((sum, m) => sum + m.weight, 0) !== 100) throw new Error('Rating weights must total 100%.');
  const rated = metrics.filter(m => m.status === 'rated' && m.score != null);
  const coverage = rated.reduce((sum, m) => sum + m.weight, 0);
  const confirmed = rated.reduce((sum, m) => sum + m.weight * m.score / 10, 0);
  const lower = confirmed + metrics.filter(m => m.status === 'partial' && m.observedScore != null).reduce((sum, m) => sum + m.weight * m.observedScore / 10, 0);
  const upper = confirmed + (100 - coverage) * 10;
  const observedAverage = coverage ? confirmed / coverage * 100 : null;
  const lowSample = metrics.some(m => m.id === 'pvpPerformance' && m.evidence.lowSample);
  const complete = coverage === 100;
  const provisional = !complete;
  return { score: complete ? confirmed : coverage >= 70 ? (lower + upper) / 2 : null, observedAverage, coverage,
    complete, provisional, tier: !provisional ? ratingTier(confirmed / 10) : null,
    range: { min: Math.max(0, Math.min(1000, lower)), max: Math.max(0, Math.min(1000, upper)) },
    reasons: [...(!complete ? ['Some required public metrics are missing or partial. The provisional score is the range midpoint.'] : []), ...(lowSample ? ['Crucible performance uses a moderated small-sample score.'] : [])] };
}

export function calculateAccountRating({ profile = {}, career, aggregates, characters = Object.values(profile.characters?.data || {}), recordDefinitions, activityDefinitions }) {
  const groups = careerGroups(career), pvp = groups.allPvP?.allTime, pve = groups.allPvE?.allTime;
  const titles = titleEvidence(profile, recordDefinitions), endgame = endgameEvidence(aggregates, characters, activityDefinitions);
  const collected = new Set(); let unknownCollectionStates = 0;
  const scopes = [profile.profileCollectibles?.data, ...Object.values(profile.characterCollectibles?.data || {})];
  for (const scope of scopes) for (const [hash, item] of Object.entries(scope?.collectibles || {})) {
    const state = valid(item.state);
    if (state == null || !Number.isInteger(state)) { unknownCollectionStates++; continue; }
    if (!(state & 1) && !(state & 4)) collected.add(hash);
  }
  const scopesAvailable = profile.profileCollectibles?.data?.collectibles != null;
  const partialCollections = (!scopesAvailable && scopes.some(scope => scope?.collectibles != null)) || unknownCollectionStates > 0;
  const performance = pvpEvidence(pvp);
  const rank = valid(profile.profile?.data?.lifetimeHighestGuardianRank);
  const evidence = {
    triumphs: { value: valid(profile.profileRecords?.data?.lifetimeScore) }, titles,
    collections: { value: scopesAvailable || partialCollections ? collected.size : null, partial: partialCollections, reason: partialCollections ? `Collection coverage is partial: ${scopesAvailable ? 'profile scope available' : 'profile scope unavailable'}; ${unknownCollectionStates} unresolved item states.` : '' },
    rank: { value: rank != null && rank >= 1 ? rank : null },
    raids: { value: endgame.raid, partial: endgame.partial, reason: endgame.reason },
    dungeons: { value: endgame.dungeon, partial: endgame.partial, reason: endgame.reason },
    pvpPerformance: performance,
    pvpExperience: { value: valid(statValue(pvp, 'activitiesEntered')) },
    pveExperience: { value: valid(statValue(pve, 'activitiesEntered')) },
    commendations: { value: valid(profile.profileCommendations?.data?.totalScore) }
  };
  const metrics = RATING_METRICS.map(def => metricResult(def, evidence[def.id]));
  return { version: RATING_VERSION, metrics, overall: combineRatings(metrics), endgameCoverage: endgame,
    interpretation: 'Public account achievements and experience against versioned editorial benchmarks; not a global percentile or matchmaking skill rating.' };
}

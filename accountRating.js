import { numeric, statValue, careerGroups, activityName, endgameType } from './reportData.js';

export const RATING_VERSION = 'GR-2.0';
export const KD_ANCHORS = [[0, 0], [0.5, 20], [1, 50], [1.5, 75], [2, 90], [3, 100]];
export const WIN_ANCHORS = [[0, 0], [0.25, 20], [0.5, 50], [0.65, 80], [0.8, 100]];
export const PRECISION_ANCHORS = [[0, 0], [10, 20], [20, 45], [35, 75], [50, 100]];
export const ASSIST_ANCHORS = [[0, 0], [1, 20], [3, 50], [5, 75], [8, 100]];
const breadthAnchors = [[0, 0], [1, 15], [3, 35], [6, 60], [10, 85], [14, 100]];
const depthAnchors = [[0, 0], [1, 20], [3, 45], [6, 70], [10, 90], [14, 100]];
// Milestones are fixed benchmarks chosen for this model.
export const RATING_METRICS = [
  { id: 'triumphs', group: 'Achievement', name: 'Triumph mastery', weight: 12, unit: 'lifetime Triumph points', source: 'Public profile records', anchors: [[0, 0], [1000, 10], [10000, 30], [25000, 50], [50000, 70], [100000, 90], [150000, 95], [250000, 100]], rationale: 'Sustained achievement across the game.', caveat: 'Lifetime totals favor established accounts and include legacy achievements.' },
  { id: 'titles', group: 'Achievement', name: 'Title mastery', weight: 8, unit: 'distinct equippable titles', source: 'Record flags + title definitions', anchors: [[0, 0], [1, 15], [5, 40], [10, 60], [20, 80], [35, 90], [60, 100]], rationale: 'Completed title requirements add achievement depth.', caveat: 'Gilding-only records and duplicate title names are excluded; titles differ in difficulty.' },
  { id: 'collections', group: 'Achievement', name: 'Collection breadth', weight: 8, unit: 'acquired visible collectibles', source: 'Profile + character collectible states', anchors: [[0, 0], [100, 10], [1000, 30], [3000, 55], [6000, 80], [10000, 90], [14000, 100]], rationale: 'Breadth of acquired equipment and cosmetics.', caveat: 'Includes cosmetic and legacy items; acquisition count is not combat skill. Private character collection scopes can limit coverage.' },
  { id: 'rank', group: 'Achievement', name: 'Guardian development', weight: 7, unit: 'highest lifetime Guardian Rank', source: 'Public profile', linear: true, anchors: [[1, 0], [5, 20], [6, 35], [7, 50], [8, 65], [9, 80], [10, 90], [11, 100]], rationale: 'Highest demonstrated Guardian Rank avoids seasonal rank decay.', caveat: 'This version reaches its benchmark at rank 11; this is a scoring anchor, not a claim about future rank caps.' },
  { id: 'raids', group: 'Endgame', name: 'Raid experience', weight: 10, unit: 'Bungie raid completions', source: 'All surviving characters’ aggregate counters + activity definitions', anchors: [[0, 0], [1, 10], [10, 30], [50, 55], [200, 80], [750, 90], [2000, 100]], rationale: 'Experience with raid activities.', caveat: 'Can include checkpoints; these are not independently verified full clears. Deleted characters are excluded.' },
  { id: 'dungeons', group: 'Endgame', name: 'Dungeon experience', weight: 8, unit: 'Bungie dungeon completions', source: 'All surviving characters’ aggregate counters + activity definitions', anchors: [[0, 0], [1, 10], [10, 30], [50, 55], [250, 80], [1000, 90], [2500, 100]], rationale: 'Experience with dungeon activities.', caveat: 'Can include checkpoints and repeat farming; these counters do not establish solo/flawless mastery.' },
  { id: 'pvpPerformance', group: 'Crucible', name: 'Crucible performance', weight: 12, unit: 'sample-adjusted combat score', source: 'Account allPvP historical statistics', rationale: '65% K/D rating + 35% win-rate rating, moderated for small samples.', caveat: 'Matchmaking, team size, modes and historical changes affect these totals. This is not Elo or a matchmaking skill estimate.' },
  { id: 'pvpExperience', group: 'Crucible', name: 'Crucible experience', weight: 4, unit: 'PvP activities entered', source: 'Account allPvP historical statistics', anchors: [[0, 0], [10, 10], [100, 35], [500, 60], [2000, 85], [5000, 100]], rationale: 'Evidence of sustained participation, with a small capped weight.', caveat: 'Participation alone does not establish skill.' },
  { id: 'pveExperience', group: 'PvE', name: 'PvE experience', weight: 5, unit: 'PvE activities entered', source: 'Account allPvE historical statistics', anchors: [[0, 0], [50, 10], [500, 35], [2500, 60], [10000, 85], [25000, 100]], rationale: 'Breadth of PvE participation with diminishing returns.', caveat: 'Includes lower-difficulty activities; activity entries are not completions or unique activities.' },
  { id: 'commendations', group: 'Recognition', name: 'Commendation recognition', weight: 2, unit: 'current commendation score', source: 'Public commendation component', anchors: [[0, 0], [100, 20], [500, 50], [1500, 75], [5000, 100]], rationale: 'A small recognition signal that cannot dominate the rating.', caveat: 'Season changes and farming affect scores. Commendations are not a measure of character or team reliability.' },
  ...[['raidBreadth', 'Raid breadth', 5, 'raid', breadthAnchors], ['dungeonBreadth', 'Dungeon breadth', 4, 'dungeon', breadthAnchors],
    ['raidDepth', 'Raid repeat experience', 3, 'raid', depthAnchors], ['dungeonDepth', 'Dungeon repeat experience', 3, 'dungeon', depthAnchors]].map(([id, name, weight, type, anchors]) => ({
    id, name, weight, group: 'Endgame', unit: `distinct ${type} families with ${id.endsWith('Depth') ? '10+' : '1+'} completions`,
    source: 'All surviving characters’ aggregate counters + activity family metadata', anchors,
    rationale: id.endsWith('Depth') ? 'Repeated experience across different activities distinguishes breadth from one-off participation.' : 'Different activities contribute once, so farming one activity cannot fill this metric.',
    caveat: 'Variants sharing a PGCR image are grouped; original activity names provide a fallback. Checkpoints can count. This does not verify full, solo, flawless, or high-difficulty clears.'
  })),
  { id: 'classVersatility', name: 'Endgame class versatility', weight: 3, group: 'Endgame', unit: 'classes with 10+ endgame completions', source: 'Character classes + aggregate counters', anchors: [[0, 0], [1, 35], [2, 70], [3, 100]], linear: true, rationale: 'Demonstrated endgame participation across Titan, Hunter and Warlock.', caveat: 'Duplicate characters of one class count once. Deleted characters are excluded. Having one main class does not imply poor combat skill.' },
  { id: 'pvpPrecision', name: 'Crucible precision share', weight: 2, group: 'Crucible', unit: 'sample-adjusted precision score', source: 'Account allPvP precision kills + kills', rationale: 'Precision kills as a share of all kills, moderated by the number of recorded kills.', caveat: 'This is not shot accuracy. Ability kills and weapon choices affect the denominator; a low share can reflect a valid playstyle.' },
  { id: 'pvePrecision', name: 'PvE precision share', weight: 2, group: 'PvE', unit: 'sample-adjusted precision score', source: 'Account allPvE precision kills + kills', rationale: 'Adds a separate view of precision-oriented combat with a deliberately small weight.', caveat: 'This is not accuracy or difficulty-adjusted skill. Abilities, explosive weapons and enemy types strongly affect precision share.' },
  { id: 'pvpAssists', name: 'Crucible assist participation', weight: 2, group: 'Crucible', unit: 'sample-adjusted assist score', source: 'Account allPvP assists + activities entered', rationale: 'Recorded assists per activity add a combat contribution signal beyond final blows.', caveat: 'Mode, match length, teammates and assist rules affect this value. It does not measure personality or team reliability.' }
];
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
  let unresolved = 0;
  const states = new Map();
  for (const scope of recordScopes) {
    const records = scope?.records || {};
    for (const hash of Object.keys(records)) {
      const state = valid(records[hash]?.state);
      if (!Number.isInteger(state)) { unresolved++; continue; }
      const def = definitions[hash];
      if ((state & 16) || !def || def.redacted || def.forTitleGilding) continue;
      // Keep the report's preference for completed or redeemed duplicate records.
      const previous = states.get(hash);
      const becameComplete = !(state & 4) && (previous & 4);
      const becameRedeemed = (state & 1) && !(previous & 1);
      if (previous === undefined || becameComplete || becameRedeemed) states.set(hash, state);
    }
  }
  for (const [hash, state] of states) {
    if (!(state & 64)) continue;
    const def = definitions[hash];
    const title = Object.values(def.titleInfo?.titlesByGender || {}).find(Boolean) || Object.values(def.titleInfo?.titlesByGenderHash || {}).find(Boolean);
    if (typeof title === 'string' && title.trim()) names.add(title.trim().toLocaleLowerCase());
    else if (def.titleInfo?.hasTitle !== false) unresolved++;
  }
  return { value: names.size, partial: unresolved > 0, reason: unresolved ? `${unresolved} unlocked title record(s) could not be resolved.` : '', names: [...names] };
}

export function endgameEvidence(aggregates, characters, definitions) {
  let raid = 0, dungeon = 0, loaded = 0, unclassified = 0, missingCounters = 0;
  let unresolvedFamilies = 0, unknownClasses = 0;
  const families = new Map(), classes = new Map();
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
      const type = endgameType(def);
      if (!type) continue;
      if (count == null) { missingCounters++; continue; }
      if (type === 'raid') raid += count;
      else dungeon += count;
      if (count <= 0) continue;
      const classType = valid(characters[index]?.classType);
      if ([0, 1, 2].includes(classType)) classes.set(classType, (classes.get(classType) || 0) + count);
      else unknownClasses++;
      // Images group normal/master/prestige hashes without counting variants as
      // different raids. Never fall back to the activity hash for breadth.
      const name = activityName(def);
      const baseName = name?.toLowerCase().replace(/\s*:\s*(normal|standard|master|prestige|legend|expert)\b.*$/i, '');
      const artwork = def.pgcrImage && !/\/(placeholder|missing_icon_d2)\.(jpe?g|png)$/i.test(def.pgcrImage) ? def.pgcrImage : null;
      // The original Pantheon tiers are variants of the same raid gauntlet.
      const legacyPantheon = /^the pantheon(?::|$)/i.test(name);
      const key = legacyPantheon ? 'the pantheon' : artwork || baseName;
      if (!key) { unresolvedFamilies++; continue; }
      const familyKey = `${type}:${key}`;
      const previous = families.get(familyKey) || { key: familyKey, type, name: legacyPantheon ? 'The Pantheon' : name || 'Endgame activity', completions: 0 };
      previous.completions += count;
      families.set(familyKey, previous);
    }
  }
  const available = loaded > 0 && definitions != null;
  // Unknown legacy/non-endgame definitions do not invalidate the recognized
  // endgame catalog. Failed character requests and missing eligible counters do.
  const partial = loaded !== characters.length || missingCounters > 0 || !definitions;
  const entries = [...families.values()].sort((a, b) => b.completions - a.completions || a.key.localeCompare(b.key));
  return { raid: available ? raid : null, dungeon: available ? dungeon : null, partial, families: entries,
    raidBreadth: entries.filter(f => f.type === 'raid').length, dungeonBreadth: entries.filter(f => f.type === 'dungeon').length,
    raidDepth: entries.filter(f => f.type === 'raid' && f.completions >= 10).length,
    dungeonDepth: entries.filter(f => f.type === 'dungeon' && f.completions >= 10).length,
    classVersatility: [...classes.values()].filter(count => count >= 10).length,
    classCompletions: [...classes].sort((a, b) => a[0] - b[0]).map(([classType, completions]) => ({ classType, completions })),
    familyPartial: partial || unresolvedFamilies > 0, classPartial: partial || unknownClasses > 0, unresolvedFamilies, unknownClasses,
    charactersLoaded: loaded, charactersTotal: characters.length, unclassified, missingCounters,
    reason: partial ? `${loaded}/${characters.length} characters loaded; ${unclassified} unclassified activity records; ${missingCounters} missing endgame counters.` : '' };
}

export function precisionEvidence(stats) {
  const games = valid(statValue(stats, 'activitiesEntered'));
  const kills = valid(statValue(stats, 'kills')), precision = valid(statValue(stats, 'precisionKills'));
  if (games === 0 && !kills && !precision) return { value: 0, noExperience: true, reason: 'No recorded participation.' };
  if (kills == null || precision == null || precision > kills || games === 0) return { value: null, reason: 'Consistent public kill and precision-kill counters are required.' };
  if (kills === 0) return { value: 0, kills, precision, noExperience: true, reason: 'No recorded kills; precision is not measured.' };
  const share = precision / kills * 100, raw = milestoneScore(share, PRECISION_ANCHORS, true), reliability = kills / (kills + 500);
  return { value: 50 + reliability * (raw - 50), kills, precision, share, raw, reliability, lowSample: kills < 500,
    detail: `${precision.toLocaleString()} precision kills / ${kills.toLocaleString()} kills · ${share.toFixed(1)}% share`,
    reason: kills < 500 ? 'Small kill sample; score is moderated toward 50.' : '' };
}
export function assistEvidence(stats) {
  const games = valid(statValue(stats, 'activitiesEntered')), assists = valid(statValue(stats, 'assists'));
  if (games === 0 && !assists) return { value: 0, noExperience: true, reason: 'No recorded PvP participation.' };
  if (games == null || assists == null || games === 0) return { value: null, reason: 'Consistent public assists and activity count are required.' };
  const perGame = assists / games, raw = milestoneScore(perGame, ASSIST_ANCHORS, true), reliability = games / (games + 100);
  return { value: 50 + reliability * (raw - 50), games, assists, perGame, raw, reliability, lowSample: games < 100,
    detail: `${assists.toLocaleString()} assists / ${games.toLocaleString()} activities · ${perGame.toFixed(2)} assists per activity`,
    reason: games < 100 ? 'Small activity sample; score is moderated toward 50.' : '' };
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

export function ratingDimensions(metrics) {
  return [...new Set(metrics.map(m => m.group))].map(name => {
    const members = metrics.filter(m => m.group === name), weight = members.reduce((sum, m) => sum + m.weight, 0);
    const coverage = members.filter(m => m.status === 'rated').reduce((sum, m) => sum + m.weight, 0);
    const score = coverage === weight ? members.reduce((sum, m) => sum + m.weight * m.score, 0) / weight : null;
    return { name, weight, score, coverage: coverage / weight * 100, tier: ratingTier(score) };
  });
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
    ...Object.fromEntries(['raidBreadth', 'dungeonBreadth', 'raidDepth', 'dungeonDepth'].map(id => [id, {
      value: endgame.raid == null ? null : endgame[id], partial: endgame.familyPartial,
      reason: endgame.familyPartial ? `${endgame.reason} ${endgame.unresolvedFamilies} eligible activity records lack family metadata.`.trim() : ''
    }])),
    classVersatility: { value: endgame.raid == null ? null : endgame.classVersatility, partial: endgame.classPartial,
      reason: endgame.classPartial ? `${endgame.reason} ${endgame.unknownClasses} eligible activity records lack a recognized character class.`.trim() : '' },
    pvpPerformance: performance,
    pvpExperience: { value: valid(statValue(pvp, 'activitiesEntered')) },
    pveExperience: { value: valid(statValue(pve, 'activitiesEntered')) },
    commendations: { value: valid(profile.profileCommendations?.data?.totalScore) },
    pvpPrecision: precisionEvidence(pvp), pvePrecision: precisionEvidence(pve), pvpAssists: assistEvidence(pvp)
  };
  const metrics = RATING_METRICS.map(def => metricResult(def, evidence[def.id]));
  return { version: RATING_VERSION, metrics, dimensions: ratingDimensions(metrics), overall: combineRatings(metrics), endgameCoverage: endgame,
    interpretation: 'Public account achievements and experience against versioned editorial benchmarks; not a global percentile or matchmaking skill rating.' };
}

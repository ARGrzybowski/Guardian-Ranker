import { endgameEvidence } from './accountRating.js';
import { careerGroups, statValue } from './reportData.js';
import { additionalActivityEvidence, diminishingPoints, publicRecordProof, soloDungeonEvidence } from './activityCredit.js';
import { activeCrucibleSeason } from './crucibleSeasons.js';

export const PERFORMANCE_VERSION = 'GR-3.2';
export const PERFORMANCE_COMPONENTS = '100,200,202,900,1100,1400';
export const COMPETITIVE_PROGRESSION = '3696598664';
export const TRIALS_TRACKERS = ['1765255052', '3273582723'];
export const MIN_RAID_DUNGEON_CLEARS = 20;
export const MIN_CRUCIBLE_ACTIVITIES = 100;

// Bungie's manifest describes these records as launch-window or Contest
// completions. Traverse individual records only. The lifetime Triumph total,
// Triumph points and titles do not contribute to performance.
export const CONTEST_RECORDS = {
  3292013044: { name: 'Crown of Sorrow', type: 'raid' },
  2699580344: { name: 'Deep Stone Crypt', type: 'raid' },
  2384429092: { name: 'Vault of Glass', type: 'raid' },
  922211732: { name: 'Vow of the Disciple', type: 'raid' },
  2579096068: { name: "King's Fall", type: 'raid' },
  3025362184: { name: 'Root of Nightmares', type: 'raid' },
  1417273794: { name: "Crota's End", type: 'raid' },
  3975049489: { name: "Salvation's Edge", type: 'raid' },
  2037346146: { name: 'The Desert Perpetual', type: 'raid' },
  2758399574: { name: 'The Desert Perpetual (Epic)', type: 'raid' },
  1136171205: { name: "Vesper's Host", type: 'dungeon' },
  781401026: { name: 'Sundered Doctrine', type: 'dungeon' },
  1519202867: { name: 'Equilibrium', type: 'dungeon' }
};

export const PERFORMANCE_METRICS = [
  { id: 'raidClears', name: 'Raid completions', group: 'Raids', unit: 'completions' },
  { id: 'raidContest', name: 'Verified raid contest clears', group: 'Raids', unit: 'events' },
  { id: 'dungeonClears', name: 'Dungeon completions', group: 'Dungeons', unit: 'completions' },
  { id: 'dungeonContest', name: 'Verified dungeon contest clears', group: 'Dungeons', unit: 'events' },
  { id: 'dungeonSolo', name: 'Best solo dungeon achievements', group: 'Dungeons', unit: 'dungeons' },
  { id: 'grandmasterClears', name: 'Grandmaster Nightfall clears', group: 'Operations', unit: 'completions' },
  { id: 'soloOpsClears', name: 'Solo Ops clears', group: 'Operations', unit: 'completions' },
  { id: 'competitivePeak', name: 'Best observed Competitive score', group: 'Crucible', unit: 'division points' },
  { id: 'trialsFlawless', name: 'Trials flawless passages', group: 'Crucible', unit: 'passages' },
  { id: 'lifetimeKd', name: 'Lifetime Crucible K/D', group: 'Crucible', unit: 'K/D' },
  { id: 'seasonKd', name: 'Current-season Crucible K/D', group: 'Crucible', unit: 'K/D' }
];

const counter = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const stat = (values, name) => counter(statValue(values, name));

export function contestEvidence(profile) {
  return contestClears(publicRecordProof(profile));
}

function contestClears(isVerified) {
  if (!isVerified) return null;
  return Object.entries(CONTEST_RECORDS).flatMap(([hash, event]) => isVerified(hash) ? [{ ...event, hash }] : []);
}

export function competitiveEvidence(profile, previousPeak) {
  const progressions = Object.values(profile.characterProgressions?.data || {});
  const values = progressions.map(character => counter(character.progressions?.[COMPETITIVE_PROGRESSION]?.currentProgress)).filter(value => value != null);
  const current = values.length ? Math.max(...values) : null;
  const prior = counter(previousPeak);
  const value = current == null && prior == null ? null : Math.max(current ?? 0, prior ?? 0);
  return { value, current, observedBefore: prior };
}

export function flawlessEvidence(profile) {
  const trackers = profile.metrics?.data?.metrics;
  const values = TRIALS_TRACKERS.map(hash => counter(trackers?.[hash]?.objectiveProgress?.progress));
  return { value: values.every(value => value != null) ? values[0] + values[1] : null, legacy: values[0], currentSystem: values[1] };
}

function kdEvidence(kills, deaths, matches, priorDeaths, scale) {
  if (kills == null || deaths == null || matches == null) return { value: null, points: null, matches };
  if (!matches) return kills || deaths ? { value: null, points: null, matches } : { value: null, points: 0, matches };
  const value = deaths ? kills / deaths : null;
  const points = Math.round(scale * Math.log2(1 + kills / (deaths + priorDeaths)));
  return { value, points, kills, deaths, matches };
}

export function seasonalKdEvidence({ seasons = [], totals = [], currentComplete = false, historyComplete = false, coveredThrough = null } = {}, now) {
  const current = activeCrucibleSeason(seasons, now);
  const bySeason = new Map(totals.map(row => [row.season_id, row]));
  const score = season => {
    const row = bySeason.get(season.id) || { kills: 0, deaths: 0, matches: 0 };
    return kdEvidence(counter(row.kills), counter(row.deaths), counter(row.matches), 35, 65);
  };
  const past = seasons.filter(season => season.end && Date.parse(season.end) <= now &&
    (historyComplete || (coveredThrough != null && coveredThrough < Date.parse(season.start))));
  const bestSeason = past.map(season => ({ ...season, ...score(season) })).filter(row => row.matches > 0 && row.points != null)
    .sort((a, b) => b.points - a.points || (b.value ?? -1) - (a.value ?? -1) || b.matches - a.matches || Date.parse(b.start) - Date.parse(a.start))[0] ?? null;
  return {
    ...(current && currentComplete ? score(current) : { value: null, points: null }),
    seasonId: current?.id, seasonName: current?.name, seasonStart: current?.start,
    bestSeason, historyComplete, currentComplete
  };
}

function clearCredit(families, type, firstClear, repeatPool, incomplete) {
  const evidence = families.filter(family => family.type === type).map(({ name, completions }) => ({
    name, completions, points: diminishingPoints(completions, firstClear, repeatPool)
  })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return {
    value: incomplete ? null : evidence.reduce((sum, family) => sum + family.completions, 0), families: evidence.length,
    points: incomplete ? null : evidence.reduce((sum, family) => sum + family.points, 0), activities: evidence
  };
}

export function calculatePerformance({ profile, characters, aggregates, activityDefinitions, career, crucible, previousPeak, now = new Date() }) {
  const endgame = endgameEvidence(aggregates, characters, activityDefinitions);
  const ops = additionalActivityEvidence(aggregates, characters, activityDefinitions);
  const isVerified = publicRecordProof(profile);
  const contest = contestClears(isVerified);
  const soloDungeon = soloDungeonEvidence(isVerified);
  const comp = competitiveEvidence(profile, previousPeak);
  const flawless = flawlessEvidence(profile);
  const pvp = careerGroups(career).allPvP?.allTime;
  const games = stat(pvp, 'activitiesEntered');
  const lifetime = kdEvidence(stat(pvp, 'kills') ?? (games === 0 ? 0 : null), stat(pvp, 'deaths') ?? (games === 0 ? 0 : null), games, 100, 100);
  const season = seasonalKdEvidence(crucible, now);
  const ordinary = (type, points) => clearCredit(endgame.families, type, points, 4, endgame.familyPartial || endgame[type] == null);
  const operation = (type, points, pool) => clearCredit(ops?.families ?? [], type, points, pool, !ops || ops.missingCounters.has(type));
  const challenge = (type, points) => {
    const events = contest?.filter(event => event.type === type);
    return { value: events?.length ?? null, points: events == null ? null : events.length * points, events };
  };
  const grandmaster = operation('grandmaster', 10, 4);
  const evidence = {
    raidClears: ordinary('raid', 15), raidContest: challenge('raid', 250),
    dungeonClears: ordinary('dungeon', 12), dungeonContest: challenge('dungeon', 200),
    dungeonSolo: soloDungeon, grandmasterClears: grandmaster, soloOpsClears: operation('soloOps', 3, 2),
    competitivePeak: { ...comp, points: comp.value == null ? null : Math.floor(comp.value / 50) },
    trialsFlawless: { ...flawless, points: flawless.value == null ? null : diminishingPoints(flawless.value, 30, 16) },
    lifetimeKd: lifetime, seasonKd: season
  };
  const metrics = PERFORMANCE_METRICS.map(metric => ({ ...metric, ...evidence[metric.id] }));
  const complete = metrics.every(metric => metric.points != null);
  const clears = endgame.raid + endgame.dungeon + grandmaster.value;
  const eligible = complete && (clears >= MIN_RAID_DUNGEON_CLEARS || games >= MIN_CRUCIBLE_ACTIVITIES || contest.length > 0 || soloDungeon.value > 0);
  return {
    version: PERFORMANCE_VERSION, points: complete ? Number(metrics.reduce((sum, metric) => sum + metric.points, 0).toFixed(8)) : null,
    metrics, complete, eligible, competitivePeak: comp.value,
    commendations: counter(profile.profileCommendations?.data?.totalScore),
    calculatedAt: now.toISOString()
  };
}

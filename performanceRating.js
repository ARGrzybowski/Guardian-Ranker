import { endgameEvidence } from './accountRating.js';
import { careerGroups, mergeActivities, statValue } from './reportData.js';

export const PERFORMANCE_VERSION = 'GR-3.0';
export const PERFORMANCE_COMPONENTS = '100,200,202,900,1100,1400';
export const COMPETITIVE_PROGRESSION = '3696598664';
export const TRIALS_TRACKERS = ['1765255052', '3273582723'];
export const RECENT_MATCH_LIMIT = 25;
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
  { id: 'competitivePeak', name: 'Best observed Competitive score', group: 'Crucible', unit: 'division points' },
  { id: 'trialsFlawless', name: 'Trials flawless passages', group: 'Crucible', unit: 'passages' },
  { id: 'lifetimeKd', name: 'Lifetime Crucible K/D', group: 'Crucible', unit: 'K/D' },
  { id: 'recentKd', name: 'Recent Crucible K/D', group: 'Crucible', unit: 'K/D' }
];

const counter = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const stat = (values, name) => counter(statValue(values, name));
const day = 86400000;

export function contestEvidence(profile) {
  const records = profile.profileRecords?.data?.records;
  if (!records) return null;
  const scopes = [records, ...Object.values(profile.characterRecords?.data || {}).map(scope => scope?.records)];
  return Object.entries(CONTEST_RECORDS).flatMap(([hash, event]) => {
    const cleared = scopes.some(scope => {
      const record = scope?.[hash];
      const state = counter(record?.state);
      return state != null && !(state & (4 | 16)) && (
        Boolean(state & 1) ||
        (record.objectives?.length > 0 && record.objectives.every(objective => objective.complete === true))
      );
    });
    return cleared ? [{ ...event, hash }] : [];
  });
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

export function recentKdEvidence(histories, characters, now) {
  if (histories?.length !== characters.length || histories.some(page => !Array.isArray(page?.activities))) return { value: null, points: null };
  const cutoff = now.getTime() - 30 * day;
  const recent = mergeActivities(histories.map(page => page.activities)).filter(match => {
    const period = Date.parse(match.period);
    return period >= cutoff && period <= now.getTime();
  }).slice(0, RECENT_MATCH_LIMIT);
  const values = recent.map(match => [stat(match.values, 'kills'), stat(match.values, 'deaths')]);
  if (values.some(row => row.includes(null))) return { value: null, points: null, matches: recent.length };
  return kdEvidence(values.reduce((sum, [kills]) => sum + kills, 0), values.reduce((sum, [, deaths]) => sum + deaths, 0), recent.length, 35, 65);
}

// Entry credit goes to breadth. Repeats add two points each for the first 25
// repeats per activity type, then one each through the 100th repeat.
function clearPoints(total, families, firstClearPoints) {
  const repeats = Math.max(0, total - families);
  return families * firstClearPoints + Math.min(repeats, 25) * 2 + Math.min(Math.max(repeats - 25, 0), 75);
}

function flawlessPoints(value) {
  if (!value) return 0;
  return 30 + Math.min(value - 1, 9) * 8 + Math.min(Math.max(0, value - 10), 40) * 2 + Math.min(Math.max(0, value - 50), 50);
}

export function calculatePerformance({ profile, characters, aggregates, activityDefinitions, career, histories, previousPeak, now = new Date() }) {
  const endgame = endgameEvidence(aggregates, characters, activityDefinitions);
  const contest = contestEvidence(profile);
  const comp = competitiveEvidence(profile, previousPeak);
  const flawless = flawlessEvidence(profile);
  const pvp = careerGroups(career).allPvP?.allTime;
  const games = stat(pvp, 'activitiesEntered');
  const lifetime = kdEvidence(stat(pvp, 'kills') ?? (games === 0 ? 0 : null), stat(pvp, 'deaths') ?? (games === 0 ? 0 : null), games, 100, 100);
  const recent = recentKdEvidence(histories, characters, now);
  const ordinary = (type, points) => ({
    value: endgame[type], families: endgame[`${type}Breadth`],
    points: endgame.familyPartial || endgame[type] == null ? null : clearPoints(endgame[type], endgame[`${type}Breadth`], points)
  });
  const challenge = (type, points) => {
    const events = contest?.filter(event => event.type === type);
    return { value: events?.length ?? null, points: events == null ? null : events.length * points, events };
  };
  const evidence = {
    raidClears: ordinary('raid', 15), raidContest: challenge('raid', 250),
    dungeonClears: ordinary('dungeon', 12), dungeonContest: challenge('dungeon', 200),
    competitivePeak: { ...comp, points: comp.value == null ? null : Math.floor(comp.value / 50) },
    trialsFlawless: { ...flawless, points: flawless.value == null ? null : flawlessPoints(flawless.value) },
    lifetimeKd: lifetime, recentKd: recent
  };
  const metrics = PERFORMANCE_METRICS.map(metric => ({ ...metric, ...evidence[metric.id] }));
  const complete = metrics.every(metric => metric.points != null);
  const eligible = complete && ((endgame.raid + endgame.dungeon) >= MIN_RAID_DUNGEON_CLEARS || games >= MIN_CRUCIBLE_ACTIVITIES || contest.length > 0);
  return {
    version: PERFORMANCE_VERSION, points: complete ? metrics.reduce((sum, metric) => sum + metric.points, 0) : null,
    metrics, complete, eligible, competitivePeak: comp.value,
    commendations: counter(profile.profileCommendations?.data?.totalScore),
    calculatedAt: now.toISOString()
  };
}

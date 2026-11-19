import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePerformance, competitiveEvidence, contestEvidence, recentKdEvidence, TRIALS_TRACKERS, COMPETITIVE_PROGRESSION } from '../performanceRating.js';
import { createPerformanceRunner } from '../worker/performance.mjs';

const stats = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { basic: { value } }]));
const now = new Date('2026-11-19T16:00:00Z');
function fixture() {
  const characters = [{ characterId: '1', classType: 0 }];
  return {
    now, characters, previousPeak: 4700,
    profile: {
      characters: { data: { 1: characters[0] } },
      profileRecords: { data: { lifetimeScore: 100000, records: {} } },
      profileCommendations: { data: { totalScore: 500 } },
      metrics: { data: { metrics: Object.fromEntries(TRIALS_TRACKERS.map(hash => [hash, { objectiveProgress: { progress: 3 } }])) } },
      characterProgressions: { data: { 1: { progressions: { [COMPETITIVE_PROGRESSION]: { currentProgress: 4500 } } } } }
    },
    career: { mergedAllCharacters: { results: { allPvP: { allTime: stats({ activitiesEntered: 100, kills: 500, deaths: 450, precisionKills: 80, activitiesWon: 60 }) } } } },
    aggregates: [{ activities: [{ activityHash: 10, values: stats({ activityCompletions: 35 }) }] }],
    histories: [{ activities: [] }],
    activityDefinitions: { 10: { activityModeTypes: [4], displayProperties: { name: 'Test Raid' } } }
  };
}
const metric = (rating, id) => rating.metrics.find(row => row.id === id);

test('ordinary repeats contribute little, cap, and each different contest event earns full credit', () => {
  const f = fixture();
  const first = calculatePerformance(f);
  f.aggregates[0].activities[0].values.activityCompletions.basic.value++;
  assert.equal(calculatePerformance(f).points, first.points + 1);
  f.aggregates[0].activities[0].values.activityCompletions.basic.value = 101;
  const capped = calculatePerformance(f);
  f.aggregates[0].activities[0].values.activityCompletions.basic.value = 10001;
  assert.equal(calculatePerformance(f).points, capped.points);
  Object.assign(f.profile.profileRecords.data.records, {
    922211732: { state: 1 }, 2699580344: { state: 1 }, 781401026: { state: 1 },
    1519202867: { state: 4 }, 1136171205: { state: 0, objectives: [{ complete: false }] }
  });
  f.profile.characterRecords = { data: { 1: { records: { 922211732: { state: 1 } } } } };
  const contested = calculatePerformance(f);
  assert.equal(contested.points - capped.points, 700);
  assert.equal(metric(contested, 'raidContest').value, 2);
  assert.equal(metric(contested, 'dungeonContest').value, 1);
});

test('win rate, precision, Triumph score and commendation score earn no performance points', () => {
  const f = fixture();
  const before = calculatePerformance(f).points;
  f.profile.profileRecords.data.lifetimeScore *= 100;
  f.profile.profileCommendations.data.totalScore *= 100;
  const pvp = f.career.mergedAllCharacters.results.allPvP.allTime;
  pvp.activitiesWon.basic.value = 100;
  pvp.precisionKills.basic.value = 500;
  assert.equal(calculatePerformance(f).points, before);
});

test('a lower Competitive division score preserves the exact higher observation', () => {
  const f = fixture();
  assert.equal(competitiveEvidence(f.profile, 4700).value, 4700);
  assert.equal(competitiveEvidence(f.profile, 4000).value, 4500);
  assert.equal(metric(calculatePerformance(f), 'trialsFlawless').value, 6);
  delete f.profile.metrics.data.metrics[TRIALS_TRACKERS[0]];
  const missing = calculatePerformance(f);
  assert.equal(missing.points, null);
  assert.equal(missing.eligible, false);
  assert.equal(missing.commendations, 500);
});

test('recent K/D excludes older matches and deduplicates match IDs across characters', () => {
  const match = (instanceId, period, kills, deaths) => ({ period, activityDetails: { instanceId }, values: stats({ kills, deaths }) });
  const fresh = match('123', '2026-11-18', 12, 4);
  const old = match('124', '2026-10-01', 500, 1);
  const result = recentKdEvidence([{ activities: [old, fresh] }, { activities: [fresh] }], [{}, {}], now);
  assert.equal(result.value, 3); assert.equal(result.matches, 1); assert.equal(result.kills, 12);
  assert.equal(recentKdEvidence([{ activities: [fresh] }, undefined], [{}, {}], now).points, null);
});

test('a contest proof may qualify a small account and incomplete evidence never does', () => {
  const f = fixture();
  f.aggregates[0].activities[0].values.activityCompletions.basic.value = 1;
  f.career.mergedAllCharacters.results.allPvP.allTime = stats({ activitiesEntered: 0, kills: 0, deaths: 0 });
  assert.equal(calculatePerformance(f).eligible, false);
  f.profile.profileRecords.data.records[2699580344] = { state: 0, objectives: [{ complete: true }, { complete: true }] };
  assert.equal(contestEvidence(f.profile).length, 1);
  assert.equal(calculatePerformance(f).eligible, true);
  f.histories[0] = null;
  assert.equal(calculatePerformance(f).points, null);
});

test('cloud performance reuses the shared activity catalog and saves exact public points', async () => {
  const f = fixture(), saved = [];
  const store = {
    duePerformance: async () => [{ membership_id: '123', membership_type: 3, competitive_peak: 4700 }],
    performanceCatalog: async () => ({ checked_at: now.toISOString(), activities: f.activityDefinitions }),
    savePerformance: async (...row) => saved.push(row)
  };
  const paths = [];
  const bungie = { request: async path => {
    paths.push(path);
    const data = path.includes('/Profile/') ? f.profile : path.includes('AggregateActivityStats') ? f.aggregates[0] : path.includes('/Activities/') ? f.histories[0] : f.career;
    return { Response: data };
  } };
  const result = await createPerformanceRunner()({ store, bungie, now: () => now, limit: 4 });
  assert.equal(result.ratings_saved, 1);
  assert.equal(saved[0][1].points, calculatePerformance(f).points);
  assert.ok(paths.some(path => path.includes('count=25&mode=5')));
});

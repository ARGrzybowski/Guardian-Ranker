import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePerformance, competitiveEvidence, contestEvidence, seasonalKdEvidence, TRIALS_TRACKERS, COMPETITIVE_PROGRESSION } from '../performanceRating.js';
import { compactPerformanceActivities, createPerformanceRunner, PERFORMANCE_CATALOG_PROJECTION } from '../worker/performance.mjs';
import { collectCrucibleSeasons } from '../worker/crucible.mjs';
import { crucibleSeasons } from '../crucibleSeasons.js';
import { diminishingPoints, DUNGEON_SOLO_RECORDS } from '../activityCredit.js';

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
    crucible: { seasons: crucibleSeasons({}), totals: [], currentComplete: true, historyComplete: true },
    activityDefinitions: { 10: { activityModeTypes: [4], displayProperties: { name: 'Test Raid' } } }
  };
}
const metric = (rating, id) => rating.metrics.find(row => row.id === id);

test('ordinary repeats decline toward a small amount and each different contest earns full credit', () => {
  const f = fixture();
  const first = calculatePerformance(f);
  f.aggregates[0].activities[0].values.activityCompletions.basic.value++;
  assert.ok(calculatePerformance(f).points - first.points < .01);
  f.aggregates[0].activities[0].values.activityCompletions.basic.value = 101;
  const hundred = calculatePerformance(f);
  f.aggregates[0].activities[0].values.activityCompletions.basic.value = 10001;
  const farmed = calculatePerformance(f);
  assert.ok(farmed.points > hundred.points && farmed.points - hundred.points < .04);
  Object.assign(f.profile.profileRecords.data.records, {
    922211732: { state: 1 }, 2699580344: { state: 1 }, 781401026: { state: 1 },
    1519202867: { state: 4 }, 1136171205: { state: 0, objectives: [{ complete: false }] }
  });
  f.profile.characterRecords = { data: { 1: { records: { 922211732: { state: 1 } } } } };
  const contested = calculatePerformance(f);
  assert.ok(Math.abs(contested.points - farmed.points - 700) < 1e-7);
  assert.equal(metric(contested, 'raidContest').value, 2);
  assert.equal(metric(contested, 'dungeonContest').value, 1);
});

test('every repeat earns less than its predecessor, and a new raid is worth more than farming', () => {
  const gains = Array.from({ length: 200 }, (_, i) => diminishingPoints(i+1, 15, 4) - diminishingPoints(i, 15, 4));
  assert.equal(gains[0], 15);
  assert.equal(gains[1], 2);
  assert.ok(gains.every((gain, index) => gain > 0 && (index === 0 || gain < gains[index - 1])));
  const f = fixture();
  const one = calculatePerformance(f);
  f.activityDefinitions[11] = { activityModeTypes: [4], displayProperties: { name: 'Different Raid' } };
  f.aggregates[0].activities[0].values.activityCompletions.basic.value--;
  f.aggregates[0].activities.push({ activityHash: 11, values: stats({ activityCompletions: 1 }) });
  const two = calculatePerformance(f);
  assert.equal(metric(one, 'raidClears').value, metric(two, 'raidClears').value);
  assert.ok(two.points - one.points > 14.9);
});

test('solo flawless replaces solo in the same dungeon but a different dungeon still counts', () => {
  const f = fixture();
  const [one, two] = DUNGEON_SOLO_RECORDS;
  const records = f.profile.profileRecords.data.records;
  records[one.solo] = { state: 1 };
  assert.equal(metric(calculatePerformance(f), 'dungeonSolo').points, 50);
  records[one.flawless] = { state: 1 };
  assert.deepEqual(metric(calculatePerformance(f), 'dungeonSolo').events, [{ name: one.name, tier: 'Solo flawless', points: 120 }]);
  records[two.solo] = { state: 1 };
  records[two.flawless] = { state: 4 };
  assert.equal(metric(calculatePerformance(f), 'dungeonSolo').points, 170);
});

test('Grandmaster variants share one curve and only named single-player Solo Ops are counted', () => {
  const f = fixture(), grandmaster = { directActivityModeType: 46, activityTypeHash: 575572995, displayProperties: { name: 'Nightfall Grandmaster: The Glassway' } };
  Object.assign(f.activityDefinitions, {
    11: grandmaster, 12: grandmaster,
    13: { ...grandmaster, displayProperties: { name: 'Nightfall Grandmaster' } },
    14: { activityTypeHash: 3851289711, matchmaking: { maxParty: 1 }, displayProperties: { name: 'Caldera: Customize' }, originalDisplayProperties: { name: 'Caldera' } },
    15: { activityTypeHash: 3851289711, matchmaking: { maxParty: 3 }, displayProperties: { name: 'Other Activity' } }
  });
  f.aggregates[0].activities.push(...[11, 12, 13, 14, 15].map(activityHash => ({ activityHash, values: stats({ activityCompletions: 1 }) })));
  const full = calculatePerformance(f);
  assert.deepEqual(metric(full, 'grandmasterClears').activities, [{ name: 'The Glassway', completions: 2, points: 12 }]);
  assert.deepEqual(metric(full, 'soloOpsClears').activities, [{ name: 'Caldera', completions: 1, points: 3 }]);
  const compact = calculatePerformance({ ...f, activityDefinitions: compactPerformanceActivities(f.activityDefinitions) });
  assert.deepEqual(compact.metrics, full.metrics);
  f.profile.characters.data[1].minutesPlayedTotal = '999999';
  f.aggregates[0].activities[1].values = stats({ activityCompletions: 1, activitySecondsPlayed: 999999, fastestCompletionMsForActivity: 123 });
  assert.equal(calculatePerformance(f).points, full.points);
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

test('Monument begins on launch day and past points are displayed independently of overall points', () => {
  const f = fixture();
  f.crucible.seasons = crucibleSeasons({ 28: { startDate: '2025-12-02T17:00:00Z', endDate: '2099-01-01', displayProperties: { name: 'Monument of Triumph' } } });
  assert.equal(f.crucible.seasons[1].start, '2026-06-09T17:00:00Z');
  f.crucible.totals = [{ season_id: 'monument', kills: 270, deaths: 90, matches: 42 }];
  const current = calculatePerformance(f);
  f.crucible.totals.push({ season_id: 'renegades', kills: 2000, deaths: 20, matches: 80 });
  const withPast = calculatePerformance(f);
  const card = metric(withPast, 'seasonKd');
  assert.equal(card.name, 'Current-season Crucible K/D');
  assert.equal(card.value, 3);
  assert.equal(card.matches, 42);
  assert.equal(card.bestSeason.name, 'Renegades');
  assert.ok(card.bestSeason.points > card.points);
  assert.equal(withPast.points, current.points);
  assert.equal(seasonalKdEvidence({ ...f.crucible, currentComplete: false }, now).points, null);
});

test('season paging resumes older pages, overlaps shifted offsets and indexes across characters', async () => {
  const match = (instanceId, period) => ({ period, activityDetails: { instanceId }, values: stats({ kills: 8, deaths: 4 }) });
  const newest = match('126', '2026-11-18T12:00:00Z');
  const oldInSeason = match('125', '2026-06-09T17:00:00Z');
  const past = match('124', '2026-06-09T16:59:59Z');
  let scans, round = 0;
  const pages = [];
  const known = new Map();
  const characters = [{ characterId: 'a' }, { characterId: 'b' }];
  const options = {
    store: { crucibleProgress: async () => scans, saveCrucibleProgress: async (_, data, rows) => {
      scans = data;
      for (const row of rows) known.set(row.id, row);
      return [];
    } },
    request: async url => {
      const character = url.split('/Character/')[1][0];
      const page = Number(url.split('page=')[1]);
      pages.push([round, character, page]);
      return { activities: character === 'b' ? (page === 0 ? [oldInSeason] : []) : (
        (round ? [[newest, oldInSeason], [match('122', '2026-06-09T17:00:00Z')], [match('121', '2026-06-09T17:00:00Z')], [past]] : [[oldInSeason], [match('122', '2026-06-09T17:00:00Z')], [match('121', '2026-06-09T17:00:00Z')]])[page] || []) };
    }, member: { membership_id: '11', membership_type: 3 }, characters, seasons: crucibleSeasons({}), now
  };
  assert.equal((await collectCrucibleSeasons(options)).currentComplete, false);
  round++;
  assert.equal((await collectCrucibleSeasons(options)).currentComplete, false, 'head refresh still has pages after reaching the launch boundary');
  round++;
  const recovered = await collectCrucibleSeasons(options);
  assert.equal(recovered.currentComplete, true);
  assert.equal(recovered.historyComplete, true);
  assert.deepEqual([...known.keys()].sort(), ['121', '122', '124', '125', '126']);
  assert.ok(pages.some(([run, character, page]) => run === 1 && character === 'a' && page === 2));
});

test('a contest proof may qualify a small account and incomplete evidence never does', () => {
  const f = fixture();
  f.aggregates[0].activities[0].values.activityCompletions.basic.value = 1;
  f.career.mergedAllCharacters.results.allPvP.allTime = stats({ activitiesEntered: 0, kills: 0, deaths: 0 });
  assert.equal(calculatePerformance(f).eligible, false);
  f.profile.profileRecords.data.records[2699580344] = { state: 0, objectives: [{ complete: true }, { complete: true }] };
  assert.equal(contestEvidence(f.profile).length, 1);
  assert.equal(calculatePerformance(f).eligible, true);
  f.crucible.currentComplete = false;
  assert.equal(calculatePerformance(f).points, null);
});

test('cloud performance reuses the shared activity catalog and saves exact public points', async () => {
  const f = fixture(), saved = [];
  const store = {
    duePerformance: async () => [{ membership_id: '123', membership_type: 3, competitive_peak: 4700 }],
    performanceCatalog: async () => ({ checked_at: now.toISOString(), projection: PERFORMANCE_CATALOG_PROJECTION, activities: f.activityDefinitions, seasons: f.crucible.seasons }),
    crucibleProgress: async () => undefined,
    saveCrucibleProgress: async () => [],
    savePerformance: async (...row) => saved.push(row)
  };
  const paths = [];
  const bungie = { request: async path => {
    paths.push(path);
    const data = path.includes('/Profile/') ? f.profile : path.includes('AggregateActivityStats') ? f.aggregates[0] : path.includes('/Activities/') ? { activities: [] } : f.career;
    return { Response: data };
  } };
  const result = await createPerformanceRunner()({ store, bungie, now: () => now, limit: 4 });
  assert.equal(result.ratings_saved, 1);
  assert.equal(saved[0][1].points, calculatePerformance(f).points);
  assert.equal(saved[0][2], 'monument');
  assert.ok(paths.some(path => path.includes('count=100&mode=5')));
});

test('manual requests publish a trusted profile and score before announcing completion', async () => {
  const f = fixture(), writes = [];
  f.profile.profile = { data: { userInfo: { bungieGlobalDisplayName: 'Manual', bungieGlobalDisplayNameCode: 1234 } } };
  const row = { membership_id: '123', membership_type: 3, requested_at: now.toISOString() };
  const store = {
    duePerformance: async (_, limit, only) => { assert.equal(limit, 2); assert.equal(only, true); return [row]; },
    performanceCatalog: async () => ({ checked_at: now.toISOString(), projection: PERFORMANCE_CATALOG_PROJECTION, activities: f.activityDefinitions, seasons: f.crucible.seasons }),
    crucibleProgress: async () => undefined,
    saveCrucibleProgress: async () => [],
    save: async (_, snapshot) => writes.push(['profile', snapshot.bungie_name]),
    savePerformance: async (_, rating) => writes.push(['score', rating.eligible]),
    saveScoreRequest: async (request, state) => { assert.equal(request.requested_at, row.requested_at); writes.push(['status', state]); }
  };
  const bungie = { request: async path => ({ Response: path.includes('/Profile/') ? f.profile : path.includes('AggregateActivityStats')
    ? f.aggregates[0] : path.includes('/Activities/') ? { activities: [] } : f.career }) };
  await createPerformanceRunner()({ store, bungie, now: () => now, limit: 2, requestsOnly: true });
  assert.deepEqual(writes, [['profile', 'Manual#1234'], ['score', true], ['status', 'updated']]);
});

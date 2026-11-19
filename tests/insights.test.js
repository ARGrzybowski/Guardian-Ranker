import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityInsights, aggregateEntries, filterAggregates, closestTriumphs, objectiveCompletion, matchWeapons, csvText, durationText } from '../reportInsights.js';
import { createReportApi } from '../reportData.js';

const stats = values => Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { basic: { value } }]));
const activity = (id, values, extra = {}) => ({ period: '2026-11-18T23:00:00Z', activityDetails: { instanceId: String(id), mode: 4, ...extra }, values: stats(values) });

test('activity summaries deduplicate reports and calculate K/D from matched rows', () => {
  const a = activity(1, { kills: 10, deaths: 2, completed: 1 });
  const s = activityInsights([a, a, activity(2, { kills: 500 }), activity(3, { deaths: 20, completed: 0 })]);
  assert.equal(s.count, 3); assert.equal(s.kills.value, 510); assert.equal(s.kills.known, 2);
  assert.equal(s.kd, 5); assert.equal(s.kdSample, 1); assert.equal(s.completionRate, 50);
  assert.equal(s.duration.value, null);
});
test('PvE standings do not inflate PvP wins; ties and missing standings stay excluded', () => {
  const s = activityInsights([activity(1, { standing: 0 }), activity(2, { standing: 0 }, { mode: 5 }), activity(3, { standing: 1 }, { mode: 63 }), activity(4, { standing: 2 }, { mode: 5 })]);
  assert.equal(s.winRate, 50); assert.equal(s.winSample, 2);
});
test('activity dates group in UTC and unknown dates do not become invented active days', () => {
  const a = activity(1, {}); a.period = '2026-11-18T23:30:00-05:00';
  const b = activity(2, {}); b.period = 'invalid';
  assert.deepEqual(activityInsights([a, b]).days, [{ date: '2026-11-19', count: 1 }]);
});
test('aggregate activity rows stay separate across characters and variants', () => {
  const characters = [{ characterId: 'a', classType: 0 }, { characterId: 'b', classType: 1 }];
  const data = { activities: [{ activityHash: 10, values: stats({ activityCompletions: 5, activityFastestCompletionSeconds: 600 }) }, { activityHash: 11, values: stats({ activityCompletions: 1, activityFastestCompletionSeconds: 0 }) }] };
  const defs = { 10: { displayProperties: { name: 'Raid normal' }, activityModeTypes: [4] }, 11: { displayProperties: { name: 'Dungeon master' }, directActivityModeType: 82 } };
  const rows = aggregateEntries([data, data], characters, defs);
  assert.equal(rows.length, 4); assert.equal(rows[1].fastest, null);
  assert.equal(filterAggregates(rows, { category: 'raid' }).length, 2);
  assert.equal(filterAggregates(rows, { character: 'a', query: 'master' }).length, 1);
  assert.equal(filterAggregates(rows, { sort: 'fastest' })[3].fastest, null);
  assert.equal(aggregateEntries([null, data], characters, defs).length, 2);
});
test('closest triumphs normalize individual objectives, ignore secrets and unowned entitlements', () => {
  const objectives = [{ progress: 1000, completionValue: 1000 }, { progress: 0, completionValue: 1 }];
  assert.equal(objectiveCompletion({ objectives }), 50);
  assert.equal(objectiveCompletion({ objectives: [], intervalObjectives: [{ progress: 8, completionValue: 10 }] }), 80);
  assert.equal(objectiveCompletion({ objectives: [{ progress: 1, completionValue: 0 }] }), null);
  const entries = [
    { name: 'Almost', state: 4, objectives: [{ progress: 9, completionValue: 10 }] },
    { name: 'Secret', state: 12, obscured: true, objectives },
    { name: 'Unowned', state: 36, objectives },
    { name: 'Halfway', state: 4, objectives },
    { name: 'Done', complete: true, objectives }
  ];
  assert.deepEqual(closestTriumphs(entries).map(e => e.name), ['Almost', 'Halfway']);
});
test('Bungie fastest completion milliseconds convert to seconds exactly once', () => {
  const data = { activities: [{ activityHash: 1, values: stats({ fastestCompletionMsForActivity: 612500, activityFastestCompletionSeconds: 99 }) }] };
  const [row] = aggregateEntries([data], [{ characterId: '1', classType: 0 }], {});
  assert.equal(row.fastest, 612.5);
  assert.equal(durationText(row.fastest), '10m 13s');
});
test('match weapon precision percentage uses kills, missing counts are not zero', () => {
  const rows = matchWeapons({ extended: { weapons: [
    { referenceId: 1, values: stats({ uniqueWeaponKills: 20, uniqueWeaponPrecisionKills: 5 }) },
    { referenceId: 2, values: stats({ uniqueWeaponKills: 0, uniqueWeaponPrecisionKills: 0 }) },
    { referenceId: 3, values: {} }
  ] } });
  assert.equal(rows[0].precisionRate, 25); assert.equal(rows[1].precisionRate, null); assert.equal(rows[2].kills, null);
});
test('CSV escapes quotes/newlines and protects formulas and 64-bit text IDs', () => {
  const csv = csvText(['Name', 'ID', 'Value'], [['=HYPERLINK("evil")', '9223372036854775801', 5], ['multi\nline', 'short', -2]]);
  assert.ok(csv.includes('"\'=HYPERLINK(""evil"")"'));
  assert.ok(csv.includes('"\'9223372036854775801"'));
  assert.ok(csv.includes('"multi\nline"')); assert.ok(csv.includes('"-2"'));
});
test('aggregate requests preserve the character ID and duration formatting handles unavailable values', async () => {
  let requested;
  const api = createReportApi({ membershipType: 3, membershipId: '12' }, async path => { requested = path; return { Response: {} }; });
  await api.aggregates('9223372036854775801');
  assert.match(requested, /Character\/9223372036854775801\/Stats\/AggregateActivityStats\/$/);
  assert.equal(durationText(3661), '1h 1m 1s'); assert.equal(durationText(null), 'Unavailable');
});

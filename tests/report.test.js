import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numeric, ratio, collectionEntries, recordEntries, catalogueEntries, filterCatalogue, summarizeCareer, overviewStats, mergeActivities, createReportApi, REPORT_COMPONENTS } from '../reportData.js';
import { bungieImage, createManifestClient, mapConcurrent } from '../manifest.js';

test('report preserves unavailable values and never invents zero denominators', () => {
  assert.equal(numeric(null), null); assert.equal(numeric(''), null); assert.equal(numeric('0'), 0);
  assert.equal(ratio(10, 0), null);
  assert.equal(summarizeCareer({}).kd, null);
  assert.equal(summarizeCareer({ kills: { basic: { value: 5 } }, deaths: { basic: { value: 0 } } }).kd, null);
  assert.equal(overviewStats({}).triumphScore, null);
  assert.equal(overviewStats({}).hours, null);
});
test('collections deduplicate scopes and preserve acquired state across characters', () => {
  const profile = { profileCollectibles: { data: { collectibles: { 1: { state: 1 }, 2: { state: 0 } } } }, characterCollectibles: { data: { a: { collectibles: { 1: { state: 0 } } }, b: { collectibles: { 1: { state: 1 }, 3: { state: 1 } } } } } };
  const entries = collectionEntries(profile);
  assert.equal(entries.length, 3); assert.equal(entries.filter(e => e.acquired).length, 2);
  assert.equal(overviewStats(profile).collectionTotal, 3);
});
test('Collections join all public manifest items and reconcile aliases, missing states, and hidden entries', () => {
  const profile = {
    profileCollectibles: { data: { collectibles: { 1: { state: 1 }, 2: { state: 64 }, 3: { state: 4 }, 4: { state: 1 } } } }
  };
  const definition = (itemHash, name) => ({ itemHash, displayProperties: { name } });
  const definitions = {
    1: definition(9, 'Same Ship'), 2: definition(9, 'Same Ship'), 3: definition(10, 'Hidden example'),
    4: definition(11, 'Missing Ship'), 5: definition(12, 'Omitted Ship')
  };
  const entries = catalogueEntries(profile, 'collections', definitions);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map(e => e.ownership), ['owned', 'unconfirmed', 'missing', 'unconfirmed']);
  assert.equal(entries[1].hidden, true);
  assert.equal(entries[1].definition, undefined);
  assert.deepEqual(filterCatalogue(entries, '', 'unconfirmed', 'collections').map(e => e.name), ['Omitted Ship']);
  assert.deepEqual(filterCatalogue(entries, '', 'incomplete', 'collections').map(e => e.name), ['Missing Ship']);
  assert.equal(overviewStats(profile).collectionAcquired, 1, 'A hidden state cannot establish visible ownership');
  profile.characters = { data: { a: {} } };
  assert.equal(catalogueEntries(profile, 'collections', definitions)[2].ownership, 'unconfirmed');
});
test('triumph flags distinguish completion, redemption, titles, and hidden entries', () => {
  const profile = { profileRecords: { data: { records: { 1: { state: 0 }, 2: { state: 1 }, 3: { state: 4 }, 4: { state: 16 }, 5: { state: 65 } } } } };
  const entries = recordEntries(profile);
  assert.equal(entries.length, 4);
  assert.equal(entries.find(e => e.hash === '1').complete, true);
  assert.equal(entries.find(e => e.hash === '1').redeemed, false);
  assert.equal(entries.find(e => e.hash === '3').complete, false);
  assert.equal(filterCatalogue(entries, '', 'titles').length, 1);
});
test('secret triumphs cannot leak their names or descriptions through search', () => {
  const profile = { profileRecords: { data: { records: { 8: { state: 12 } } } } };
  const entries = catalogueEntries(profile, 'records', { 8: { displayProperties: { name: 'Spoiler name', description: 'Secret solution' }, stateInfo: { obscuredDescription: 'Keep playing.' } } });
  assert.equal(entries[0].name, 'Secret triumph');
  assert.equal(entries[0].description, 'Keep playing.');
  assert.equal(filterCatalogue(entries, 'solution').length, 0);
});
test('career rates use numeric totals and account-provided ratios when available', () => {
  const stats = Object.fromEntries(Object.entries({ kills: 20, deaths: 4, assists: 8, activitiesEntered: 10, activitiesWon: 7 }).map(([k, value]) => [k, { basic: { value } }]));
  const s = summarizeCareer(stats);
  assert.equal(s.kd, 5); assert.equal(s.efficiency, 7); assert.equal(s.winRate, 70);
  assert.equal(summarizeCareer({ ...stats, killsDeathsRatio: { basic: { value: 3.25 } } }).kd, 3.25);
});
test('collection acquisition sources are searchable and commendations stay nullable', () => {
  const entries = [{ name: 'Ship', description: '', acquired: true, definition: { sourceString: 'Earned in a raid' } }];
  assert.equal(filterCatalogue(entries, 'raid', 'all', 'collections').length, 1);
  assert.equal(overviewStats({}).commendationScore, null);
  assert.equal(overviewStats({ profileCommendations: { data: { totalScore: 1234 } } }).commendationScore, 1234);
});
test('history merging keeps unique reports, uses full 64-bit string IDs, sorts dates', () => {
  const a = { period: '2026-01-01', activityDetails: { instanceId: '9223372036854775801' } };
  const b = { period: '2026-02-01', activityDetails: { instanceId: '9223372036854775802' } };
  assert.deepEqual(mergeActivities([[a, b], [a]]), [b, a]);
});
test('report API keeps pagination and mode filters in all character requests', async () => {
  const paths = [];
  const api = createReportApi({ membershipType: 3, membershipId: '9223372036854775801' }, async path => { paths.push(path); return { Response: {} }; });
  await api.history('123', 82, 4);
  assert.match(paths[0], /Character\/123\/Stats\/Activities\/\?count=25&mode=82&page=4$/);
  await assert.rejects(api.match('../oops'), /Invalid activity ID/);
  assert.ok(REPORT_COMPONENTS.split(',').includes('205'));
  assert.ok(!REPORT_COMPONENTS.split(',').includes('102'), 'No private vault requested');
});
test('Bungie image paths reject external and protocol-relative URLs', () => {
  assert.equal(bungieImage('https://example.com/evil'), '');
  assert.equal(bungieImage('//example.com/evil'), '');
  assert.equal(bungieImage('/img/icon.png'), 'https://www.bungie.net/img/icon.png');
});
test('manifest resolves only requested item definitions and caches successes', async () => {
  let calls = 0;
  const client = createManifestClient(async path => { calls++; assert.match(path, /DestinyInventoryItemDefinition\/9876543210/); return { Response: { displayProperties: { name: 'Test gear' } } }; });
  await client.definition('DestinyInventoryItemDefinition', '9876543210');
  await client.definition('DestinyInventoryItemDefinition', '9876543210');
  assert.equal(calls, 1);
  assert.equal(await client.definition('Invalid/Path', 1), null);
});
test('definition hydration has bounded concurrency and honors cancellation', async () => {
  let active = 0, peak = 0;
  const output = await mapConcurrent([1, 2, 3, 4, 5], async value => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return value * 2; }, undefined, 2);
  assert.deepEqual(output, [2, 4, 6, 8, 10]); assert.equal(peak, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(mapConcurrent([1], async () => 1, controller.signal), { name: 'AbortError' });
});

// Read-only cloud smoke check. Never starts a worker or writes to Supabase.
// Run by GitHub Actions only; local tests use entirely mocked responses.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { searchExactName, loadPlayerProfile, bungieRequest } from '../bungieApi.js';
import { REPORT_COMPONENTS, overviewStats, createReportApi, careerGroups, collectionEntries, recordEntries, catalogueEntries } from '../reportData.js';
import { createManifestClient } from '../manifest.js';
import { aggregateEntries } from '../reportInsights.js';
import { calculatePerformance, CONTEST_RECORDS, TRIALS_TRACKERS, COMPETITIVE_PROGRESSION, PERFORMANCE_VERSION } from '../performanceRating.js';
import { compactPerformanceActivities } from '../worker/performance.mjs';
import { collectCrucibleSeasons } from '../worker/crucible.mjs';
import { crucibleSeasons } from '../crucibleSeasons.js';
import { DUNGEON_SOLO_RECORDS } from '../activityCredit.js';
import { eververseCollection, valueEververseCollection } from '../eververseValue.js';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Live verification runs in GitHub Actions, not on your machine.');
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 90000);
try {
  const signal = controller.signal;
  const user = await searchExactName('Hawk#7753', signal);
  const loaded = await loadPlayerProfile(user, signal, undefined, REPORT_COMPONENTS);
  const profile = loaded.profileData.Response;
  const summary = overviewStats(profile);
  assert.ok(Object.keys(profile.characters?.data || {}).length > 0);
  assert.ok(summary.hours >= 0);
  const ownership = eververseCollection(profile);
  assert.ok(ownership?.owned.size > 0, 'Public Collections expose acquired cosmetic state');
  const priceCatalog = JSON.parse(await readFile(new URL('../eververseCatalog.json', import.meta.url), 'utf8'));
  const eververse = valueEververseCollection(ownership, priceCatalog);
  assert.ok(eververse.brightDust > 0 && eververse.pricedCount > 0, 'Owned Eververse collectibles resolve to catalog prices');
  console.log(JSON.stringify({ eververseBrightDust: eververse.brightDust, cosmeticsPriced: eververse.pricedCount, cosmeticsOwned: eververse.ownedCount, collectionCoverage: eververse.collectionCoverage }));
  const api = createReportApi(loaded.membership), manifest = createManifestClient();
  const career = await api.career(signal);
  assert.ok(career?.mergedAllCharacters, 'Account historical stats schema');
  const clan = await api.clan(signal);
  assert.ok(Array.isArray(clan?.results), 'Clan membership schema');
  const character = Object.values(profile.characters.data)[0];
  const aggregates = await api.aggregates(character.characterId, signal);
  assert.ok(Array.isArray(aggregates?.activities), 'Aggregate activity schema');
  const history = await api.history(character.characterId, 0, 0, signal);
  assert.ok(history != null, 'History endpoint available');
  const gear = profile.characterEquipment?.data?.[character.characterId]?.items?.[0];
  if (gear) {
    const def = await manifest.definition('DestinyInventoryItemDefinition', gear.itemHash, signal);
    assert.ok(def?.displayProperties?.name, 'Named equipment definition');
  }
  const firstActivity = history.activities?.[0];
  if (firstActivity) {
    const match = await api.match(firstActivity.activityDetails.instanceId, signal);
    assert.ok(Array.isArray(match.entries), 'Match report entries schema');
  }
  const catalogueCoverage = {};
  let activityRecords = [], ratingActivityDefinitions;
  for (const [section, type] of [['records', 'DestinyRecordDefinition'], ['collections', 'DestinyCollectibleDefinition'], ['metrics', 'DestinyMetricDefinition'], ['progression', 'DestinyProgressionDefinition'], ['activities', 'DestinyActivityDefinition']]) {
    const definitions = await manifest.table(type, signal);
    assert.ok(Object.keys(definitions).length > 0, `${section} catalogue`);
    if (section === 'records') {
      assert.ok(Object.keys(CONTEST_RECORDS).every(hash => definitions[hash]), 'Every tracked contest record exists in the current catalog');
      assert.ok(DUNGEON_SOLO_RECORDS.every(row => definitions[row.solo] && definitions[row.flawless]), 'Solo and solo flawless proof are catalogued');
    }
    if (section === 'metrics') assert.ok(TRIALS_TRACKERS.every(hash => definitions[hash]), 'Both Trials trackers exist');
    if (section === 'progression') assert.ok(definitions[COMPETITIVE_PROGRESSION], 'Competitive progression exists');
    if (section === 'activities') ratingActivityDefinitions = definitions;
    if (section === 'activities') {
      activityRecords = aggregateEntries([aggregates], [character], definitions);
      if (activityRecords.length) {
        assert.ok(activityRecords.some(r => r.completions != null), 'Aggregate completion counters resolve');
        assert.ok(activityRecords.some(r => r.fastest != null), 'Fastest completion milliseconds resolve into seconds');
      }
    }
    if (section === 'records' || section === 'collections') {
      const entries = catalogueEntries(profile, section, definitions);
      const named = entries.filter(e => !e.name.startsWith('Unknown ')).length;
      assert.ok(named > 0, `${section} names resolved`);
      catalogueCoverage[section] = { exposed: entries.length, named };
    }
  }
  const ratingCharacters = Object.values(profile.characters.data);
  const ratingAggregates = await Promise.all(ratingCharacters.map(c => c.characterId === character.characterId ? aggregates : api.aggregates(c.characterId, signal)));
  const seasons = crucibleSeasons(await manifest.table('DestinySeasonDefinition', signal));
  let matchCount;
  const crucible = await collectCrucibleSeasons({
    store: { crucibleProgress: async () => undefined, saveCrucibleProgress: async (_, scans, matches, windows, now) => {
      matchCount = matches.length;
      return windows.map(season => {
        const included = matches.filter(match => Date.parse(match.period) >= Date.parse(season.start) &&
          Date.parse(match.period) <= Date.parse(now) && (!season.end || Date.parse(match.period) < Date.parse(season.end)));
        const total = field => included.some(match => match[field] == null) ? null : included.reduce((sum, match) => sum + match[field], 0);
        return { season_id: season.id, matches: included.length, kills: total('kills'), deaths: total('deaths') };
      });
    } }, request: path => bungieRequest(path, { signal }).then(r => r.Response),
    member: { membership_type: loaded.membership.membershipType, membership_id: loaded.membership.membershipId },
    characters: ratingCharacters, seasons, now: new Date()
  });
  assert.ok(Number.isInteger(matchCount), 'Cloud season collector reads public match pages');
  const ratingInput = { profile, career, characters: ratingCharacters, aggregates: ratingAggregates, crucible };
  const performance = calculatePerformance({ ...ratingInput, activityDefinitions: ratingActivityDefinitions });
  const cloudProjection = calculatePerformance({ ...ratingInput, activityDefinitions: compactPerformanceActivities(ratingActivityDefinitions) });
  assert.equal(performance.version, PERFORMANCE_VERSION);
  assert.equal(performance.metrics.length, 11);
  assert.deepEqual(cloudProjection.metrics, performance.metrics);
  if (crucible.currentComplete) {
    assert.ok(performance.complete && performance.eligible, JSON.stringify(performance.metrics.filter(metric => metric.points == null)));
    assert.ok(Math.abs(performance.points - performance.metrics.reduce((sum, metric) => sum + metric.points, 0)) < 1e-7);
  } else assert.equal(performance.metrics.find(metric => metric.id === 'seasonKd').points, null);
  console.log(JSON.stringify({ account: 'Hawk#7753', ratingVersion: performance.version, points: performance.points,
    metrics: performance.metrics.map(m => ({ id: m.id, value: m.value, points: m.points, matches: m.matches, events: m.events })) }));
  console.log(JSON.stringify({
    account: 'Hawk#7753', characters: Object.keys(profile.characters.data).length,
    careerGroups: Object.keys(careerGroups(career)), historyRows: history.activities?.length || 0,
    equipmentVisible: Boolean(gear), records: recordEntries(profile).length,
    collectibles: collectionEntries(profile).length,
    progressionVisible: Boolean(profile.characterProgressions?.data), metricsVisible: Boolean(profile.metrics?.data), catalogueCoverage,
    activityRecordCount: activityRecords.length,
    recordsWithFastestTime: activityRecords.filter(r => r.fastest != null).length,
    aggregateCategories: [...new Set(activityRecords.map(r => r.category))],
    aggregateCounterKeys: Object.keys(aggregates.activities[0]?.values || {}),
    commendationsVisible: Boolean(profile.profileCommendations?.data),
    itemStatsVisible: Boolean(profile.itemComponents?.stats?.data)
  }));
} catch (error) {
  if (error.message !== 'This system is temporarily disabled for maintenance.') throw error;
  console.log('::notice::Live Bungie verification deferred because the API reported maintenance.');
} finally { clearTimeout(timeout); }

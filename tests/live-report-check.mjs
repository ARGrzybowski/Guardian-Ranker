// Read-only cloud smoke check. Never starts a worker or writes to Supabase.
// Run by GitHub Actions only; local tests use entirely mocked responses.
import assert from 'node:assert/strict';
import { searchExactName, loadPlayerProfile } from '../bungieApi.js';
import { REPORT_COMPONENTS, overviewStats, createReportApi, careerGroups, collectionEntries, recordEntries, catalogueEntries } from '../reportData.js';
import { createManifestClient } from '../manifest.js';
import { aggregateEntries } from '../reportInsights.js';
import { calculateAccountRating } from '../accountRating.js';

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
  let activityRecords = [], ratingRecordDefinitions, ratingActivityDefinitions;
  for (const [section, type] of [['records', 'DestinyRecordDefinition'], ['collections', 'DestinyCollectibleDefinition'], ['metrics', 'DestinyMetricDefinition'], ['progression', 'DestinyProgressionDefinition'], ['activities', 'DestinyActivityDefinition']]) {
    const definitions = await manifest.table(type, signal);
    assert.ok(Object.keys(definitions).length > 0, `${section} catalogue`);
    if (section === 'records') ratingRecordDefinitions = definitions;
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
  const accountRating = calculateAccountRating({ profile, career, characters: ratingCharacters, aggregates: ratingAggregates, recordDefinitions: ratingRecordDefinitions, activityDefinitions: ratingActivityDefinitions });
  assert.equal(accountRating.metrics.length, 10);
  assert.ok(accountRating.metrics.every(m => m.score == null || Number.isFinite(m.score) && m.score >= 0 && m.score <= 100));
  assert.ok(accountRating.overall.range.min >= 0 && accountRating.overall.range.max <= 1000);
  console.log(JSON.stringify({ ratingVersion: accountRating.version, overall: accountRating.overall,
    metrics: accountRating.metrics.map(m => ({ id: m.id, value: m.value, score: m.score, status: m.status })), endgameCoverage: accountRating.endgameCoverage }));
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
} finally { clearTimeout(timeout); }

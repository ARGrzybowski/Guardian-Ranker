import { loadPlayerProfile } from '../bungieApi.js';
import { calculatePerformance, PERFORMANCE_COMPONENTS } from '../performanceRating.js';
import { activeCrucibleSeason, crucibleSeasons } from '../crucibleSeasons.js';
import { additionalActivityFamily } from '../activityCredit.js';
import { BudgetReached, profileSnapshot } from './indexer.mjs';
import { compactActivities } from './ratings.mjs';
import { collectCrucibleSeasons } from './crucible.mjs';

export const PERFORMANCE_BATCH_LIMIT = 4;
export const PERFORMANCE_CATALOG_PROJECTION = 2;
const hoursAfter = (date, hours) => new Date(date.getTime() + hours * 3600000).toISOString();

export function compactPerformanceActivities(definitions) {
  const activities = compactActivities(definitions);
  for (const [hash, definition] of Object.entries(definitions)) {
    const family = additionalActivityFamily(definition);
    if (family) activities[hash] = { ...activities[hash], performanceFamily: family };
  }
  return activities;
}

export function createPerformanceRunner() {
  let cachedCatalog;
  return async function runPerformance({ store, bungie, signal, now, limit, requestsOnly }) {
    const summary = { ratings_attempted: 0, ratings_saved: 0, ratings_partial: 0, rating_errors: 0, rating_manifest_prepared: 0 };
    const rows = await store.duePerformance(now().toISOString(), limit, requestsOnly);
    if (!rows.length) return summary;
    const request = bungie.request.bind(bungie);
    let catalog = cachedCatalog || await store.performanceCatalog();
    const outOfDate = catalog?.projection !== PERFORMANCE_CATALOG_PROJECTION;
    if (outOfDate || !catalog?.seasons?.length || now().getTime() - Date.parse(catalog.checked_at) >= 86400000) {
      const metadata = (await request('/Destiny2/Manifest/')).Response;
      if (!metadata?.version) throw new Error('Activity catalog metadata is unavailable.');
      const needsDownload = outOfDate || catalog.version !== metadata.version || !catalog.activities;
      const activities = needsDownload ? compactPerformanceActivities(await bungie.staticJson(metadata.jsonWorldComponentContentPaths?.en?.DestinyActivityDefinition)) : catalog.activities;
      const seasons = needsDownload || !catalog.seasons?.length
        ? crucibleSeasons(await bungie.staticJson(metadata.jsonWorldComponentContentPaths?.en?.DestinySeasonDefinition)) : catalog.seasons;
      if (!Object.keys(activities).length) throw new Error('Endgame catalog is empty.');
      catalog = { version: metadata.version, projection: PERFORMANCE_CATALOG_PROJECTION, activities, seasons, checked_at: now().toISOString() };
      await store.savePerformanceCatalog(catalog);
      cachedCatalog = catalog;
      if (needsDownload) return { ...summary, rating_manifest_prepared: 1 };
    }
    cachedCatalog = catalog;

    for (const row of rows) {
      signal?.throwIfAborted();
      summary.ratings_attempted++;
      const requested = row.requested_at != null;
      try {
        const loaded = await loadPlayerProfile({ destinyMemberships: [{ membershipId: row.membership_id, membershipType: row.membership_type }] }, signal, request, PERFORMANCE_COMPONENTS);
        const profile = loaded.profileData.Response;
        const override = profile.profile?.data?.userInfo?.crossSaveOverride;
        if (override && override !== row.membership_type) throw new Error('Membership changed; await canonical refresh.');
        if (requested) {
          const snapshot = profileSnapshot(loaded);
          const retrieved = now();
          snapshot.identity_checked_at = retrieved.toISOString();
          const age = retrieved.getTime() - Date.parse(snapshot.last_played);
          const refreshHours = age < 86400000 ? 0.25 : age < 7 * 86400000 ? 2 : 24;
          await store.save(row.membership_id, snapshot, hoursAfter(retrieved, refreshHours));
        }
        const characters = Object.values(profile.characters.data);
        const base = `/Destiny2/${row.membership_type}/Account/${row.membership_id}`;
        const requestSource = path => request(path).then(result => result.Response);
        const sources = await Promise.allSettled([
          requestSource(`${base}/Stats/?groups=1`),
          ...characters.map(c => requestSource(`${base}/Character/${c.characterId}/Stats/AggregateActivityStats/`))
        ]);
        const failures = sources.filter(source => source.status === 'rejected');
        if (failures.length) throw (failures.find(source => source.reason instanceof BudgetReached) || failures[0]).reason;
        const [career, ...aggregates] = sources.map(source => source.value);
        const calculatedAt = now();
        const crucible = await collectCrucibleSeasons({ store, request: requestSource, member: row, characters, seasons: catalog.seasons, now: calculatedAt });
        const season = activeCrucibleSeason(catalog.seasons, calculatedAt);
        const active = row.last_played && calculatedAt.getTime() - Date.parse(row.last_played) < 86400000;
        const next = hoursAfter(calculatedAt, !crucible.historyComplete || !crucible.currentComplete ? 0.25 : active ? 6 : 24);
        if (!crucible.currentComplete && row.season_id === season.id && row.points != null) {
          await store.deferPerformance(row.membership_id, next);
          if (requested) await store.saveScoreRequest(row, 'indexing', hoursAfter(now(), 5 / 60));
          summary.ratings_partial++;
          continue;
        }
        const rating = calculatePerformance({
          profile, career, characters, aggregates, crucible,
          activityDefinitions: catalog.activities, previousPeak: row.competitive_peak, now: calculatedAt
        });
        await store.savePerformance(row.membership_id, rating, season.id, rating.complete ? next : hoursAfter(calculatedAt, crucible.currentComplete ? 6 : 0.25));
        if (requested) {
          const state = rating.complete ? 'updated' : crucible.currentComplete ? 'unavailable' : 'indexing';
          await store.saveScoreRequest(row, state, hoursAfter(now(), 5 / 60));
        }
        if (rating.complete) summary.ratings_saved++; else summary.ratings_partial++;
      } catch (error) {
        if (error instanceof BudgetReached || error.databaseFailure || signal?.aborted) {
          error.ratingSummary = summary;
          throw error;
        }
        summary.rating_errors++;
        const retry = Math.min(24, 2 * 2 ** Math.min(row.consecutive_errors || 0, 3));
        await store.failPerformance(row.membership_id, hoursAfter(now(), retry), Boolean(error.noPublicCharacters));
        if (requested) {
          const failures = (row.request_failures || 0) + 1;
          const state = error.noPublicCharacters || failures >= 3 ? 'unavailable' : 'queued';
          await store.saveScoreRequest(row, state, hoursAfter(now(), 5 * failures / 60), failures);
        }
      }
    }
    return summary;
  };
}

import { loadPlayerProfile } from '../bungieApi.js';
import { calculatePerformance, PERFORMANCE_COMPONENTS, RECENT_MATCH_LIMIT } from '../performanceRating.js';
import { BudgetReached } from './indexer.mjs';
import { compactActivities } from './ratings.mjs';

export const PERFORMANCE_BATCH_LIMIT = 4;
const hoursAfter = (date, hours) => new Date(date.getTime() + hours * 3600000).toISOString();

export function createPerformanceRunner() {
  let cachedCatalog;
  return async function runPerformance({ store, bungie, signal, now, limit }) {
    const summary = { ratings_attempted: 0, ratings_saved: 0, ratings_partial: 0, rating_errors: 0, rating_manifest_prepared: 0 };
    const rows = await store.duePerformance(now().toISOString(), limit);
    if (!rows.length) return summary;
    const request = bungie.request.bind(bungie);
    let catalog = cachedCatalog || await store.performanceCatalog();
    if (!catalog || now().getTime() - Date.parse(catalog.checked_at) >= 86400000) {
      const metadata = (await request('/Destiny2/Manifest/')).Response;
      if (!metadata?.version) throw new Error('Activity catalog metadata is unavailable.');
      const needsDownload = catalog?.version !== metadata.version || !catalog.activities;
      const activities = needsDownload ? compactActivities(await bungie.staticJson(metadata.jsonWorldComponentContentPaths?.en?.DestinyActivityDefinition)) : catalog.activities;
      if (!Object.keys(activities).length) throw new Error('Endgame catalog is empty.');
      catalog = { version: metadata.version, activities, checked_at: now().toISOString() };
      await store.savePerformanceCatalog(catalog);
      cachedCatalog = catalog;
      if (needsDownload) return { ...summary, rating_manifest_prepared: 1 };
    }
    cachedCatalog = catalog;

    for (const row of rows) {
      signal?.throwIfAborted();
      summary.ratings_attempted++;
      try {
        const loaded = await loadPlayerProfile({ destinyMemberships: [{ membershipId: row.membership_id, membershipType: row.membership_type }] }, signal, request, PERFORMANCE_COMPONENTS);
        const profile = loaded.profileData.Response;
        const override = profile.profile?.data?.userInfo?.crossSaveOverride;
        if (override && override !== row.membership_type) throw new Error('Membership changed; await canonical refresh.');
        const characters = Object.values(profile.characters.data);
        const base = `/Destiny2/${row.membership_type}/Account/${row.membership_id}`;
        const requestSource = path => request(path).then(result => result.Response);
        const sources = await Promise.allSettled([
          requestSource(`${base}/Stats/?groups=1`),
          ...characters.map(c => requestSource(`${base}/Character/${c.characterId}/Stats/AggregateActivityStats/`)),
          ...characters.map(c => requestSource(`${base}/Character/${c.characterId}/Stats/Activities/?count=${RECENT_MATCH_LIMIT}&mode=5&page=0`))
        ]);
        const failures = sources.filter(source => source.status === 'rejected');
        if (failures.length) throw (failures.find(source => source.reason instanceof BudgetReached) || failures[0]).reason;
        const [career, ...results] = sources.map(source => source.value);
        const histories = results.slice(characters.length).map(page => page && { activities: page.activities ?? [] });
        const rating = calculatePerformance({
          profile, career, characters, aggregates: results.slice(0, characters.length), histories,
          activityDefinitions: catalog.activities, previousPeak: row.competitive_peak, now: now()
        });
        const active = row.last_played && now().getTime() - Date.parse(row.last_played) < 86400000;
        await store.savePerformance(row.membership_id, rating, hoursAfter(now(), active || !rating.complete ? 6 : 24));
        if (rating.complete) summary.ratings_saved++; else summary.ratings_partial++;
      } catch (error) {
        if (error instanceof BudgetReached || error.databaseFailure || signal?.aborted) {
          error.ratingSummary = summary;
          throw error;
        }
        summary.rating_errors++;
        const retry = Math.min(24, 2 * 2 ** Math.min(row.consecutive_errors || 0, 3));
        await store.failPerformance(row.membership_id, hoursAfter(now(), retry), Boolean(error.noPublicCharacters));
      }
    }
    return summary;
  };
}

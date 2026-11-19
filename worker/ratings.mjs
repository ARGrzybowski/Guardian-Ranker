import { loadPlayerProfile } from '../bungieApi.js';
import { calculateAccountRating, RATING_VERSION } from '../accountRating.js';
import { endgameType } from '../reportData.js';
import { BudgetReached } from './indexer.mjs';

export function compactTitles(definitions) {
  return Object.fromEntries(Object.entries(definitions).flatMap(([hash, d]) => {
    const title = Object.values(d.titleInfo?.titlesByGender || {}).find(Boolean) || Object.values(d.titleInfo?.titlesByGenderHash || {}).find(Boolean);
    return !d.redacted && !d.forTitleGilding && title ? [[hash, { titleInfo: { titlesByGender: { 0: title } } }]] : [];
  }));
}
export function compactActivities(definitions) {
  return Object.fromEntries(Object.entries(definitions).flatMap(([hash, d]) => {
    const type = endgameType(d);
    return type ? [[hash, { directActivityModeType: type === 'raid' ? 4 : 82,
      pgcrImage: d.pgcrImage, displayProperties: { name: d.displayProperties?.name },
      originalDisplayProperties: { name: d.originalDisplayProperties?.name } }]] : [];
  }));
}
const after = (date, hours) => new Date(date.getTime() + hours * 3600000).toISOString();

// The existing indexer lease, pacing, operation limit and hard deadline cover
// rating work too. The runner never starts a local timer or another scheduler.
export function createRatingRunner() {
  let cachedManifest;
  return async function runRatings({ store, bungie, signal, now, limit }) {
    const summary = { ratings_attempted: 0, ratings_saved: 0, ratings_partial: 0, rating_errors: 0, rating_manifest_prepared: 0 };
    const rows = await store.dueRatings(now().toISOString(), limit, RATING_VERSION);
    if (!rows.length) return summary;
    const request = bungie.request.bind(bungie);
    let manifest = cachedManifest || await store.ratingManifest();
    // Projection shape is versioned independently of Bungie's content version.
    if (manifest?.projection_version !== 2) manifest = undefined;
    const age = manifest?.checked_at ? now().getTime() - Date.parse(manifest.checked_at) : Infinity;
    if (!manifest || age >= 86400000) {
      const metadata = (await request('/Destiny2/Manifest/')).Response;
      if (!metadata?.version) throw new Error('Rating manifest metadata is unavailable.');
      if (manifest?.ready && manifest.version === metadata.version) {
        manifest.checked_at = now().toISOString();
        await store.saveRatingManifest(manifest);
      } else {
        const paths = metadata.jsonWorldComponentContentPaths?.en;
        const records = await bungie.staticJson(paths?.DestinyRecordDefinition);
        const titles = compactTitles(records);
        if (!Object.keys(titles).length) throw new Error('Title catalog is empty.');
        manifest = { version: metadata.version, projection_version: 2, records: titles, activities: {}, activity_path: paths.DestinyActivityDefinition, ready: false, checked_at: now().toISOString() };
        await store.saveRatingManifest(manifest);
        cachedManifest = manifest;
        return { ...summary, rating_manifest_prepared: 1 };
      }
    }
    if (!manifest.ready) {
      const activities = compactActivities(await bungie.staticJson(manifest.activity_path));
      if (!Object.keys(activities).length) throw new Error('Endgame catalog is empty.');
      manifest = { ...manifest, activities, ready: true };
      await store.saveRatingManifest(manifest);
      cachedManifest = manifest;
      return { ...summary, rating_manifest_prepared: 1 };
    }
    cachedManifest = manifest;
    // Complete a rating before starting another so a deadline cannot leave an
    // entire batch half fetched. Character requests still overlap their I/O.
    for (const row of rows) {
      signal?.throwIfAborted();
      summary.ratings_attempted++;
      try {
        const loaded = await loadPlayerProfile({ destinyMemberships: [{ membershipId: row.membership_id, membershipType: row.membership_type }] }, signal, request, '100,200,800,900,1400');
        const profile = loaded.profileData.Response;
        const override = profile.profile?.data?.userInfo?.crossSaveOverride;
        if (override && override !== row.membership_type) throw new Error('Membership changed; await canonical profile refresh.');
        const characters = Object.values(profile.characters.data);
        const sources = await Promise.allSettled([
          request(`/Destiny2/${row.membership_type}/Account/${row.membership_id}/Stats/?groups=1,2,3`).then(r => r.Response),
          ...characters.map(c => request(`/Destiny2/${row.membership_type}/Account/${row.membership_id}/Character/${c.characterId}/Stats/AggregateActivityStats/`).then(r => r.Response))
        ]);
        const failed = sources.find(s => s.status === 'rejected');
        if (failed) throw failed.reason;
        const [career, ...aggregates] = sources.map(s => s.value);
        const rating = calculateAccountRating({ profile, career, aggregates, characters, recordDefinitions: manifest.records, activityDefinitions: manifest.activities });
        const eligible = rating.overall.complete && !rating.overall.provisional && rating.overall.score != null;
        const age = row.last_played ? now().getTime() - Date.parse(row.last_played) : Infinity;
        const hours = row.is_rating_leader || age < 86400000 ? 1 : age < 604800000 ? 6 : 24;
        await store.saveRating(row.membership_id, rating, manifest.version, after(now(), eligible ? hours : 6));
        if (eligible) summary.ratings_saved++; else summary.ratings_partial++;
      } catch (error) {
        if (error instanceof BudgetReached || error.databaseFailure || signal?.aborted) { error.ratingSummary=summary; throw error; }
        summary.rating_errors++;
        await store.failRating(row, after(now(), Math.min(24, 2 * 2 ** Math.min(row.rating_error_count || 0, 3))), Boolean(error.noPublicCharacters));
      }
    }
    return summary;
  };
}

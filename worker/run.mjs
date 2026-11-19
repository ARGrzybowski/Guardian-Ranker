import { IndexStore } from './store.mjs';
import { createBungieWorker, runIndexer } from './indexer.mjs';
import { readWorkerConfiguration } from './config.mjs';
import { createRatingRunner, MAX_RATINGS_PER_RUN } from './ratings.mjs';

// This operational entry point is intentionally cloud-only. Unit tests import
// the indexer with in-memory dependencies; they never index live accounts.
const config = readWorkerConfiguration(process.env);
const signal = AbortSignal.timeout(110000);
const store = new IndexStore({ url: config.url, key: config.key, signal });
const bungie = createBungieWorker({ apiKey: config.apiKey, signal, maxOperations:240,intervalMs:334,stopAt:Date.now()+80000 });
try {
  const summary = await runIndexer({ store, bungie, signal, seedNames: config.seedNames, seedClans: config.seedClans,
    maxProfiles:100,profileConcurrency:8,maxDiscoveries:5,maxClanPages:3,maxActivityScans:2,maxRatings:MAX_RATINGS_PER_RUN,rateProfiles:createRatingRunner() });
  console.log(JSON.stringify(summary));
} catch (error) {
  // Configuration and HTTP status errors are safe; raw API messages may contain
  // identifiers. Never print request headers or serialized client objects.
  console.error(error.databaseFailure ? error.message : 'Indexer run failed. Check connectivity, seed names, and the run summary in Supabase.');
  process.exitCode = 1;
}

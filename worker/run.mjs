import { IndexStore } from './store.mjs';
import { createBungieWorker, runIndexer } from './indexer.mjs';
import { readWorkerConfiguration } from './config.mjs';

// This operational entry point is intentionally cloud-only. Unit tests import
// the indexer with in-memory dependencies; they never index live accounts.
const config = readWorkerConfiguration(process.env);
const signal = AbortSignal.timeout(8 * 60 * 1000);
const store = new IndexStore({ url: config.url, key: config.key, signal });
const bungie = createBungieWorker({ apiKey: config.apiKey, signal });
try {
  const summary = await runIndexer({ store, bungie, signal, seedNames: config.seedNames, seedClans: config.seedClans });
  console.log(JSON.stringify(summary));
} catch (error) {
  // Configuration and HTTP status errors are safe; raw API messages may contain
  // identifiers. Never print request headers or serialized client objects.
  console.error(error.databaseFailure ? error.message : 'Indexer run failed. Check connectivity, seed names, and the run summary in Supabase.');
  process.exitCode = 1;
}

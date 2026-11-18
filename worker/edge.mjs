import { API_KEY } from '../bungieApi.js';
import { IndexStore } from './store.mjs';
import { createBungieWorker, runIndexer } from './indexer.mjs';

function sameToken(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return different === 0;
}

export function createEdgeHandler({ url, key, apiKey = API_KEY, storeFactory = options => new IndexStore(options), bungieFactory = options => createBungieWorker(options), index = runIndexer }) {
  let tokenPromise;
  return async request => {
    if (request.method !== 'POST') return new Response('POST required', { status: 405 });
    const provided = request.headers.get('x-guardian-worker-token');
    if (!provided || provided.length !== 72) return new Response('Unauthorized', { status: 401 });
    try {
      tokenPromise ??= storeFactory({ url, key }).select('guardian_index_lease', { select: 'invocation_token', singleton: 'eq.true' })
        .then(rows => rows[0]?.invocation_token).catch(error => { tokenPromise = undefined; throw error; });
      if (!sameToken(provided, await tokenPromise)) return new Response('Unauthorized', { status: 401 });
      // Stay below the free-plan 150-second wall-clock limit, leaving time for cleanup.
      const signal = AbortSignal.timeout(110000);
      const store = storeFactory({ url, key, signal });
      const bungie = bungieFactory({ apiKey, maxOperations: 240, intervalMs: 334, stopAt: Date.now() + 80000, signal });
      const summary = await index({ store, bungie, signal, maxProfiles: 100, profileConcurrency: 8, maxDiscoveries: 5, maxClanPages: 3, maxActivityScans: 2 });
      console.log(JSON.stringify(summary));
      return Response.json(summary);
    } catch {
      return Response.json({ error: 'Indexer run failed; inspect its database run summary.' }, { status: 500 });
    }
  };
}

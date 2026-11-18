import { bungieRequest } from './bungieApi.js';

// Definitions are shared between players. Never download the enormous inventory
// table: equipped items are resolved individually. Large catalogues load on demand.
const definitions = new Map();
const tables = new Map();
let manifest;
export function bungieImage(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
    ? `https://www.bungie.net${path}` : '';
}

export function createManifestClient(request = bungieRequest, fetcher = fetch) {
  return {
    async definition(type, hash, signal) {
      if (hash == null || !/^Destiny\w+Definition$/.test(type) || !/^\d+$/.test(String(hash))) return null;
      const key = `${type}/${hash}`;
      if (definitions.has(key)) return definitions.get(key);
      const { Response } = await request(`/Destiny2/Manifest/${type}/${hash}/`, { signal });
      signal?.throwIfAborted();
      if (definitions.size >= 600) definitions.delete(definitions.keys().next().value);
      definitions.set(key, Response);
      return Response;
    },
    async table(type, signal) {
      if (!['DestinyRecordDefinition', 'DestinyCollectibleDefinition', 'DestinyMetricDefinition', 'DestinyProgressionDefinition', 'DestinyActivityDefinition'].includes(type)) throw new Error('Unsupported catalogue.');
      if (tables.has(type)) return tables.get(type);
      manifest ??= (await request('/Destiny2/Manifest/', { signal })).Response;
      const path = manifest?.jsonWorldComponentContentPaths?.en?.[type];
      const url = bungieImage(path);
      if (!url) throw new Error('Bungie catalogue is unavailable. Try again later.');
      const response = await fetcher(url, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(60000)]), cache: 'force-cache' });
      if (!response.ok) throw new Error(`Catalogue download failed (${response.status}).`);
      const data = await response.json();
      signal?.throwIfAborted();
      tables.set(type, data);
      return data;
    }
  };
}

export async function mapConcurrent(values, mapper, signal, concurrency = 4) {
  const output = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      signal?.throwIfAborted();
      const index = cursor++;
      output[index] = await mapper(values[index], index);
    }
  }));
  return output;
}

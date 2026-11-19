import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEdgeHandler } from '../worker/edge.mjs';

const token = 'x'.repeat(72);
test('edge worker rejects missing or invalid authentication before indexing', async () => {
  let runs = 0;
  const handler = createEdgeHandler({ url: 'https://example.test', key: 'test',
    storeFactory: () => ({ select: async () => [{ invocation_token: token }] }),
    index: async () => { runs++; } });
  assert.equal((await handler(new Request('https://example.test', { method: 'POST' }))).status, 401);
  assert.equal((await handler(new Request('https://example.test', { method: 'POST', headers: { 'x-guardian-worker-token': 'y'.repeat(72) } }))).status, 401);
  assert.equal(runs, 0);
});
test('authenticated cloud runs use bounded batches and ignore caller-supplied scores', async () => {
  let options;
  const handler = createEdgeHandler({ url: 'https://example.test', key: 'test',
    storeFactory: () => ({ select: async () => [{ invocation_token: token }] }),
    bungieFactory: () => ({}), index: async value => { options = value; return { status: 'completed' }; } });
  const response = await handler(new Request('https://example.test', { method: 'POST', headers: { 'x-guardian-worker-token': token }, body: '{"triumph_score":99999}' }));
  assert.equal(response.status, 200);
  assert.equal(options.maxProfiles, 100);
  assert.equal(options.profileConcurrency, 8);
  assert.equal(options.maxRatings, 4);
  assert.equal(options.maxClanPages, 3);
  assert.equal('triumph_score' in options, false);
});

test('a signed score wake receives a smaller Bungie budget and handles requested ratings only', async () => {
  let options, budget;
  const handler = createEdgeHandler({ url: 'https://example.test', key: 'test',
    storeFactory: () => ({ select: async () => [{ invocation_token: token }] }),
    bungieFactory: value => { budget = value.maxOperations; return {}; },
    index: async value => { options = value; return { status: 'completed' }; } });
  const response = await handler(new Request('https://example.test', { method: 'POST', headers: { 'x-guardian-worker-token': token }, body: '{"mode":"score_refresh"}' }));
  assert.equal(response.status, 200);
  assert.equal(options.scoresOnly, true);
  assert.equal(options.maxRatings, 2);
  assert.equal(budget, 48);
});

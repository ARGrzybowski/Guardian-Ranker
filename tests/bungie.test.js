import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { bungieRequest, searchExactName, loadPlayerProfile, parseBungieName, formatBungieName } from '../bungieApi.js';

afterEach(() => mock.restoreAll());
const response = (Response, options) => new globalThis.Response(JSON.stringify({ ErrorCode: 1, Response }), options);
const member = (membershipId, membershipType = 3, extra = {}) => ({ membershipId, membershipType, ...extra });
const profile = (date = '2026-11-01') => ({ characters: { data: { c1: { characterId: 'c1', dateLastPlayed: date } } } });

test('popular full names use one exact lookup with no prefix pagination', async () => {
  const calls = [];
  mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return response([member('hawk', 1)]);
  });
  const user = await searchExactName('Hawk#7753');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /SearchDestinyPlayerByBungieName\/-1\/$/);
  assert.deepEqual(JSON.parse(calls[0].options.body), { displayName: 'Hawk', displayNameCode: 7753 });
  assert.equal(formatBungieName(user), 'Hawk#7753');
});

test('Unicode, spaces, hashes, and leading-zero codes survive exact lookup', async () => {
  mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { displayName: '守護者 # α', displayNameCode: 7 });
    return response([member('1')]);
  });
  assert.equal(formatBungieName(await searchExactName('  守護者 # α#0007  ')), '守護者 # α#0007');
  assert.equal(parseBungieName('Hawk#775'), null);
});

test('missing exact account gets a useful not-found error', async () => {
  mock.method(globalThis, 'fetch', async () => response([]));
  await assert.rejects(searchExactName('Missing#1234'), /No Destiny 2 account found/);
});

test('cross-save selects the active membership rather than the first platform', async () => {
  const paths = [];
  mock.method(globalThis, 'fetch', async url => { paths.push(url); return response(profile()); });
  const loaded = await loadPlayerProfile({ destinyMemberships: [
    member('overridden', 2, { crossSaveOverride: 3 }),
    member('active', 3, { crossSaveOverride: 3 })
  ] });
  assert.equal(loaded.membership.membershipId, 'active');
  assert.equal(paths.length, 1);
  assert.match(paths[0], /\/3\/Profile\/active\//);
  assert.match(paths[0], /components=100,200,800,900$/);
});

test('independent platform profiles use the most recently played account', async () => {
  mock.method(globalThis, 'fetch', async url => response(profile(url.includes('/old/') ? '2020-01-01' : '2026-11-01')));
  const loaded = await loadPlayerProfile({ destinyMemberships: [member('old', 2), member('recent', 3)] });
  assert.equal(loaded.membership.membershipId, 'recent');
});

test('an empty first platform does not prevent another membership loading', async () => {
  mock.method(globalThis, 'fetch', async url => response(url.includes('/empty/') ? { characters: { data: {} } } : profile()));
  const loaded = await loadPlayerProfile({ destinyMemberships: [member('empty', 2), member('populated', 3)] });
  assert.equal(loaded.membership.membershipId, 'populated');
});

test('private and empty profiles produce an explanatory error instead of a null dereference', async () => {
  mock.method(globalThis, 'fetch', async () => response({ characters: { data: {} } }));
  await assert.rejects(loadPlayerProfile({ destinyMemberships: [member('empty')] }), /No public characters/);
});

test('Bungie service errors are surfaced without being mistaken for no matches', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify({ ErrorCode: 99, Message: 'API key unavailable' }));
  });
  await assert.rejects(searchExactName('Hawk#7753'), /API key unavailable/);
  assert.equal(calls, 1);
});

test('transient HTTP failures retry and recover', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? new Response(JSON.stringify({ Message: 'Unavailable' }), { status: 503 }) : response([]));
  await bungieRequest('/test');
  assert.equal(calls, 2);
});

test('persistent failures stop after three attempts', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify({ Message: 'Unavailable' }), { status: 503 });
  });
  await assert.rejects(bungieRequest('/test'), /Unavailable/);
  assert.equal(calls, 3);
});

test('long throttles are surfaced without sending an early retry', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify({ ErrorCode: 36, ThrottleSeconds: 60, Message: 'Please wait' }));
  });
  await assert.rejects(bungieRequest('/test'), /Please wait/);
  assert.equal(calls, 1);
});

test('cancellation stops in-flight work and prevents retries', async () => {
  const controller = new AbortController();
  let calls = 0;
  mock.method(globalThis, 'fetch', async () => { calls++; controller.abort(); return response([]); });
  await assert.rejects(bungieRequest('/test', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

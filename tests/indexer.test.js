import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runIndexer, BudgetReached, createBungieWorker, profileSnapshot } from '../worker/indexer.mjs';
import { IndexStore } from '../worker/store.mjs';
import { readWorkerConfiguration } from '../worker/config.mjs';

afterEach(() => mock.restoreAll());
const NOW = new Date('2026-11-18T12:00:00Z');
const member = id => ({ membershipId: String(id), membershipType: 3, bungieGlobalDisplayName: `Player${id}`, bungieGlobalDisplayNameCode: 1234 });
const queued = (id, extra = {}) => ({ membership_id: String(id), membership_type: 3, source: 'seed', next_refresh_at: NOW.toISOString(), next_discovery_at: NOW.toISOString(), error_count: 0, ...extra });
const profile = id => ({ Response: {
  profile: { data: { userInfo: member(id), currentGuardianRank: 11, lifetimeHighestGuardianRank: 11 } },
  characters: { data: { c: { characterId: 'c', light: 400, classType: 0, minutesPlayedTotal: '600', dateLastPlayed: NOW.toISOString() } } },
  profileRecords: { data: { lifetimeScore: 10000 } }
} });

class MemoryStore {
  guardians = new Map(); clans = new Map(); activities = new Set(); finished = []; locked = false;
  constructor(rows = [queued(1)]) { for (const row of rows) this.guardians.set(row.membership_id, { ...row }); }
  async start() { if (this.locked) return null; this.locked = true; return 'run-1'; }
  async finish(id, status, summary) { this.finished.push({ id, status, summary }); this.locked = false; }
  async insert(table, rows) {
    if (table === 'guardian_index_activities') { for (const row of rows) this.activities.add(row.activity_id); return; }
    const map = table === 'guardian_index' ? this.guardians : this.clans;
    const key = table === 'guardian_index' ? 'membership_id' : 'clan_id';
    for (const row of rows) if (!map.has(row[key])) map.set(row[key], table === 'guardian_index' ? queued(row.membership_id, row) : { next_page: 1, next_scan_at: NOW.toISOString(), ...row });
  }
  async patch(table, _key, id, values) { Object.assign((table === 'guardian_index' ? this.guardians : this.clans).get(id), values); }
  async dueProfiles(now, limit) { return [...this.guardians.values()].filter(row => !row.canonical_membership_id && row.next_refresh_at <= now).slice(0, limit).map(row => ({ ...row })); }
  async dueDiscovery(now, limit) { return [...this.guardians.values()].filter(row => !row.canonical_membership_id && row.membership_type != null && row.next_discovery_at <= now).slice(0, limit); }
  async dueClans(now, limit) { return [...this.clans.values()].filter(row => row.next_scan_at <= now).slice(0, limit); }
  async dueActivities(now, limit) { return [...this.guardians.values()].filter(row => row.character_id && (!row.next_activity_scan_at || row.next_activity_scan_at <= now)).slice(0, limit); }
  async activitySeen(id) { return this.activities.has(id); }
  async save(requested, snapshot, next) {
    const clean = Object.fromEntries(Object.entries(snapshot).filter(([, value]) => value !== null));
    const existing = this.guardians.get(snapshot.membership_id) || queued(snapshot.membership_id);
    this.guardians.set(snapshot.membership_id, { ...existing, ...clean, profile_status: 'public', canonical_membership_id: null, next_refresh_at: next, last_refreshed_at: NOW.toISOString() });
    if (requested !== snapshot.membership_id) this.guardians.get(requested).canonical_membership_id = snapshot.membership_id;
  }
  async failProfile(row, next, isPrivate) { Object.assign(this.guardians.get(row.membership_id), { next_refresh_at: next, error_count: row.error_count + 1, ...(isPrivate ? { profile_status: 'private' } : {}) }); }
}

function fakeBungie({ pages = [], budget = Infinity, profiles = {}, memberships = {}, failSeed = false, history = [], participants = [] } = {}) {
  let operations = 0;
  const paths = [];
  return {
    paths, get operations() { return operations; },
    async request(path) {
      if (operations >= budget) throw new BudgetReached();
      operations++; paths.push(path);
      if (path.includes('SearchDestinyPlayerByBungieName')) {
        if (failSeed) throw new Error('No such seed');
        return { Response: [member(1)] };
      }
      if (path.includes('/User/GetMembershipsById/')) {
        const id = path.split('/GetMembershipsById/')[1].split('/')[0];
        return { Response: { destinyMemberships: memberships[id] || [member(id)] } };
      }
      if (path.includes('/Profile/')) {
        const id = path.split('/Profile/')[1].split('/')[0];
        if (profiles[id] instanceof Error) throw profiles[id];
        return profiles[id] || profile(id);
      }
      if (path.includes('/GroupV2/User/')) return { Response: { results: pages.length ? [{ group: { groupId: '10', groupType: 1, name: 'Test clan' } }] : [] } };
      if (path.includes('/Members/')) {
        const page = Number(new URL('https://example.test' + path).searchParams.get('currentpage'));
        const ids = pages[page - 1] || [];
        return { Response: { results: ids.map(id => ({ destinyUserInfo: member(id) })), hasMore: page < pages.length } };
      }
      if (path.includes('/Stats/Activities/')) return { Response: { activities: history } };
      if (path.includes('/PostGameCarnageReport/')) return { Response: { entries: participants.map(id => ({ player: { destinyUserInfo: member(id) } })) } };
      throw new Error(`Unexpected request ${path}`);
    }
  };
}
const run = (store, bungie, extra = {}) => runIndexer({ store, bungie, now: () => NOW, ...extra });

test('rating backfills reserve time for clan discovery instead of consuming the whole profile tranche', async () => {
  const store = new MemoryStore(Array.from({length:100},(_,i)=>queued(i+1)));
  const bungie=fakeBungie({pages:[[101]]});
  const result=await run(store,bungie,{maxProfiles:100,maxRatings:10,rateProfiles:async()=>({ratings_attempted:10,ratings_saved:10})});
  assert.equal(result.profiles_refreshed,60);
  assert.equal(result.ratings_saved,10);
  assert.ok(store.guardians.has('101'),'clan discovery still adds unsearched accounts');
});

test('clan members on later roster pages enter rankings without ever being searched', async () => {
  const store = new MemoryStore();
  const bungie = fakeBungie({ pages: [Array.from({ length: 50 }, (_, i) => i + 2), [52, 53]] });
  const result = await run(store, bungie);
  assert.equal(result.roster_pages, 2);
  assert.equal(store.guardians.size, 53);
  assert.equal(store.guardians.get('53').profile_status, 'public');
  assert.equal(store.guardians.get('53').source, 'clan');
  assert.equal(result.profiles_refreshed, 53);
});

test('roster page caps persist the cursor and resume on the next cloud run', async () => {
  const store = new MemoryStore();
  const options = { pages: [[2, 3], [4, 5]] };
  await run(store, fakeBungie(options), { maxClanPages: 1 });
  assert.equal(store.clans.get('10').next_page, 2);
  assert.equal(store.guardians.has('4'), false);
  const next = fakeBungie(options);
  await run(store, next);
  assert.ok(next.paths.some(path => path.endsWith('currentpage=2')));
  assert.equal(store.guardians.get('5').profile_status, 'public');
  assert.equal(store.clans.get('10').next_page, 1);
  assert.ok(store.clans.get('10').last_completed_at);
});

test('API budget exhaustion leaves the next roster page queued', async () => {
  const store = new MemoryStore();
  const result = await run(store, fakeBungie({ pages: [[2], [3]], budget: 4 }));
  assert.equal(result.status, 'budget_reached');
  assert.equal(store.clans.get('10').next_page, 2);
  assert.equal(store.locked, false);
  await run(store, fakeBungie({ pages: [[2], [3]] }));
  assert.equal(store.guardians.get('3').profile_status, 'public');
});

test('duplicate clan entries do not reset an existing account refresh schedule', async () => {
  const future = '2026-11-20T12:00:00.000Z';
  const store = new MemoryStore([queued(1), queued(2, { next_refresh_at: future, next_discovery_at: future })]);
  await run(store, fakeBungie({ pages: [[2, 2, 3]] }));
  assert.equal(store.guardians.size, 3);
  assert.equal(store.guardians.get('2').next_refresh_at, future);
});

test('private profiles are marked private without replacing saved scores with zero', async () => {
  const store = new MemoryStore([queued(1, { profile_status: 'public', triumph_score: 12345 })]);
  await run(store, fakeBungie({ profiles: { 1: { Response: { characters: { data: {} } } } } }));
  assert.equal(store.guardians.get('1').profile_status, 'private');
  assert.equal(store.guardians.get('1').triumph_score, 12345);
  assert.equal(store.guardians.get('1').next_refresh_at, '2026-11-18T18:00:00.000Z');
});

test('transient profile failures preserve cached public snapshots and back off', async () => {
  const store = new MemoryStore([queued(1, { profile_status: 'public', triumph_score: 12345, error_count: 2 })]);
  await run(store, fakeBungie({ profiles: { 1: new Error('Unavailable') } }));
  assert.equal(store.guardians.get('1').profile_status, 'public');
  assert.equal(store.guardians.get('1').triumph_score, 12345);
  assert.equal(store.guardians.get('1').next_refresh_at, '2026-11-19T12:00:00.000Z');
});

test('cross-save aliases resolve to one canonical indexed account', async () => {
  const store = new MemoryStore();
  const bungie = fakeBungie({ memberships: { 1: [
    { ...member(1), membershipType: 1, crossSaveOverride: 3 },
    { ...member(2), crossSaveOverride: 3 }
  ] } });
  await run(store, bungie);
  assert.equal(store.guardians.get('1').canonical_membership_id, '2');
  assert.equal(store.guardians.get('2').profile_status, 'public');
  assert.ok(!bungie.paths.some(path => path.includes('/Profile/1/')));
});

test('missing private metrics remain null instead of being fabricated as zero', () => {
  const data = profile(1);
  delete data.Response.profileRecords;
  delete data.Response.characters.data.c.minutesPlayedTotal;
  const snapshot = profileSnapshot({ membership: member(1), profileData: data });
  assert.equal(snapshot.triumph_score, null);
  assert.equal(snapshot.time_played_hours, null);
});

test('an overlapping worker exits before making Bungie requests', async () => {
  const store = new MemoryStore(); store.locked = true;
  const bungie = fakeBungie();
  assert.equal((await run(store, bungie)).status, 'already_running');
  assert.equal(bungie.operations, 0);
  assert.equal(store.finished.length, 0);
});

test('a bad optional seed does not block existing queued accounts', async () => {
  const store = new MemoryStore();
  const result = await run(store, fakeBungie({ failSeed: true }), { seedNames: ['Missing#1234'] });
  assert.equal(result.status, 'partial');
  assert.equal(result.profiles_refreshed, 1);
  assert.equal(result.seed_errors, 1);
});

test('database write failures stop the run and release its lease', async () => {
  const store = new MemoryStore();
  store.save = async () => { throw Object.assign(new Error('Database failure'), { databaseFailure: true }); };
  await assert.rejects(run(store, fakeBungie()), /Database failure/);
  assert.equal(store.locked, false);
  assert.equal(store.finished[0].status, 'failed');
});

test('the worker bounds API operations, spaces calls, and uses its own API key', async () => {
  const waits = [], headers = [];
  mock.method(globalThis, 'fetch', async (_url, options) => { headers.push(options.headers); return new Response(JSON.stringify({ ErrorCode: 1, Response: [] })); });
  const worker = createBungieWorker({ apiKey: 'test-worker-key', maxOperations: 2, wait: async ms => waits.push(ms) });
  await worker.request('/test'); await worker.request('/test');
  await assert.rejects(worker.request('/test'), BudgetReached);
  assert.deepEqual(waits, [500]);
  assert.equal(headers[0]['X-API-Key'], 'test-worker-key');
});

test('the operational entry point rejects local execution and public anon credentials', () => {
  assert.throws(() => readWorkerConfiguration({}), /GitHub Actions/);
  const anonKey = `header.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
  assert.throws(() => readWorkerConfiguration({ GITHUB_ACTIONS: 'true', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: anonKey, BUNGIE_API_KEY: 'test' }), /not the public anon key/);
});

test('store errors never expose the server key or raw response body', async () => {
  const secret = 'sb_secret_do-not-log';
  const store = new IndexStore({ url: 'https://example.supabase.co', key: secret, fetchImpl: async () => new Response(secret, { status: 401 }) });
  await assert.rejects(store.start(), error => error.databaseFailure && !error.message.includes(secret));
});

test('manual clan seeds work without any previously searched account', async () => {
  const store = new MemoryStore([]);
  const result = await run(store, fakeBungie({ pages: [[10, 11]] }), { seedClans: ['10'] });
  assert.equal(result.profiles_refreshed, 2);
  assert.equal(store.guardians.get('11').source, 'clan');
});

test('recently verified identities refresh with one profile request', async () => {
  const store = new MemoryStore([queued(1, { identity_checked_at: NOW.toISOString() })]);
  const bungie = fakeBungie();
  const result = await run(store,bungie,{maxDiscoveries:0});
  assert.equal(result.cached_identity_hits,1);
  assert.equal(bungie.operations,1);
  assert.ok(bungie.paths[0].includes('/Profile/1/'));
  assert.ok(bungie.paths[0].endsWith('components=100,200,900'));
  assert.equal(store.guardians.get('1').next_refresh_at,'2026-11-18T12:15:00.000Z');
});

test('a cross-save change invalidates cached identity and resolves the active account', async () => {
  const data = profile(1); data.Response.profile.data.userInfo.crossSaveOverride = 1;
  const store = new MemoryStore([queued(1,{identity_checked_at:NOW.toISOString()})]);
  await run(store,fakeBungie({profiles:{1:data},memberships:{1:[{...member(2),membershipType:1,crossSaveOverride:1}]}}),{maxDiscoveries:0});
  assert.equal(store.guardians.get('1').canonical_membership_id,'2');
});

test('public match participants expand beyond the seed clan and duplicate reports are skipped', async () => {
  const store = new MemoryStore();
  const options = {history:[{activityDetails:{instanceId:'99',isPrivate:true}},{activityDetails:{instanceId:'100',isPrivate:false}}],participants:[2,3,3]};
  const first = fakeBungie(options);
  await run(store,first,{maxActivityScans:1});
  assert.equal(store.guardians.get('2').source,'activity');
  assert.equal(store.guardians.get('2').profile_status,'public');
  assert.ok(!first.paths.some(path=>path.includes('/PostGameCarnageReport/99/')));
  assert.ok(store.activities.has('100'));
  store.guardians.get('1').next_activity_scan_at=NOW.toISOString();
  const second=fakeBungie(options);
  await run(store,second,{maxActivityScans:1});
  assert.ok(!second.paths.some(path=>path.includes('/PostGameCarnageReport/')));
});

test('parallel requests still share one operation cap', async () => {
  mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({ErrorCode:1,Response:[]})));
  const worker=createBungieWorker({apiKey:'test',maxOperations:2,wait:async()=>{}});
  const results=await Promise.allSettled([worker.request('/a'),worker.request('/b'),worker.request('/c')]);
  assert.equal(worker.operations,2);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
});

test('the time budget stops new work before the hard function deadline', async () => {
  const worker=createBungieWorker({apiKey:'test',stopAt:100,clock:()=>100});
  await assert.rejects(worker.request('/a'),BudgetReached);
  assert.equal(worker.operations,0);
});

test('persistent Bungie throttling stops new operations and records a shared cooldown', async () => {
  mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({ErrorCode:36,ThrottleSeconds:60,Message:'Wait'}),{status:429}));
  const worker=createBungieWorker({apiKey:'test',clock:()=>1000});
  await assert.rejects(worker.request('/a'),BudgetReached);
  assert.equal(worker.backoffUntil,61000);
  await assert.rejects(worker.request('/b'),BudgetReached);
  assert.equal(worker.operations,1);
});

test('parallel profile writes settle before a failed run releases its lease', async () => {
  const store=new MemoryStore(Array.from({length:8},(_,i)=>queued(i+1)));
  const events=[];
  const save=store.save.bind(store), finish=store.finish.bind(store);
  let active=0, peak=0;
  store.save=async(id,snapshot,next)=>{
    active++; peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,id==='1'?5:20));
    active--;
    if(id==='1')throw Object.assign(new Error('Write failed'),{databaseFailure:true});
    await save(id,snapshot,next); events.push('write');
  };
  store.finish=async(...args)=>{events.push('finish');await finish(...args);};
  await assert.rejects(run(store,fakeBungie(),{maxProfiles:8,profileConcurrency:4}),/Write failed/);
  assert.equal(peak,4);
  assert.equal(active,0);
  assert.equal(events.at(-1),'finish');
});

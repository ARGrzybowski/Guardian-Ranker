// Dependency-free browser integration checks. Uses installed Edge or BROWSER_PATH.
// All Bungie and Supabase traffic is mocked; this never writes to the live database.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { PERFORMANCE_METRICS, PERFORMANCE_VERSION } from '../performanceRating.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const longGuardian = 'GuardianWithoutSpaces'.repeat(3) + '#1234';
const fixtureRows = Array.from({ length: 8 }, (_, i) => ({
  membership_id: String(i), bungie_name: i === 0 ? longGuardian : i === 7 ? 'Hawk#7753' : `Player${i}#1234`,
  triumph_score: 1000 - i, guardian_rank: 11 - i, time_played_hours: 200 - i,
  class_type: 'Titan', light_level: 400 - i, points: 900-i, standing: i+1, percentile: 99-i, cohort_size: 50, commendations: 800-i
}));
const performanceRow = (contest, percentile) => ({
  rating_version: PERFORMANCE_VERSION, points: contest * 250, eligible: true, standing: contest === 2 ? 4 : 10,
  percentile, cohort_size: 50, last_rated_at: '2026-11-18T12:00:00Z',
  metrics: PERFORMANCE_METRICS.map(metric => ({ ...metric, points: metric.id === 'raidContest' ? contest * 250 : 0, value: metric.id === 'raidContest' ? contest : 0,
    ...(metric.id === 'seasonKd' ? { seasonName: 'Monument of Triumph', currentComplete: true, matches: 0, historyComplete: true,
      bestSeason: { name: 'Renegades', points: 88, value: 1.65, matches: 120 } } : {}) }))
});
const basicStats = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { basic: { value } }]));
const specialtyCatalog = [
  { board_id: 'raid.points', category: 'Raids', title: 'Raid performance', unit: 'points', description: 'Clear credit and contest points.' },
  { board_id: 'contest.123', category: 'Raids', title: 'Test raid · Contest', unit: 'proof', description: 'Verified contest clears.' },
  { board_id: 'solo.test', category: 'Dungeons', title: 'Test dungeon · Solo', unit: 'solo', description: 'Best verified solo tier.' },
  { board_id: 'profile.eververse', category: 'Collections', title: 'Bright Dust Net Worth', unit: 'bright_dust', description: 'Estimated Eververse value.' }
];
const brightDustRows = [
  { membership_id: '7', bungie_name: 'Hawk#7753', eververse_bright_dust: 3800 },
  { membership_id: '8', bungie_name: 'Cosmetic Rival#1234', eververse_bright_dust: 3800 }
];
const specialtyRows = Array.from({ length: 28 }, (_, i) => ({
  membership_id: String(i), bungie_name: i === 27 ? 'FarGuardian#1234' : fixtureRows[i]?.bungie_name ?? `Board Guardian ${i}#1234`, score: 300 - i, standing: i + 1
}));
const recordDefinitions = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, { displayProperties: { name: `Triumph ${i + 1}`, description: 'A public triumph' }, ...(i === 0 ? { titleInfo: { titlesByGender: { Male: 'Wayfarer' } } } : {}) }]));
recordDefinitions[31] = { displayProperties: { name: 'SECRET SPOILER', description: 'SECRET SOLUTION' }, stateInfo: { obscuredDescription: 'Keep playing to reveal.' } };
const collectibleDefinitions = { 1: { displayProperties: { name: 'Test Exotic', description: 'An acquired item' } }, 2: { displayProperties: { name: 'Missing Ship', description: 'Not yet acquired' } } };
const eververseCatalog = { schemaVersion: 6, emotePlugSetHash: 2860926541, manifestVersion: 'test', catalogDate: '2026-10-20', pricedCount: 5, items: [
  [101, [1, 4], '<script>Test Shader</script>', 'Shaders', 300], [102, [2], 'Missing Ship', 'Ships', 2000], [103, [3], 'Test Shell', 'Ghost shells', null],
  [104, [5], 'Test Armor Ornament', 'Armor ornaments', 1200, 'Test Armor Set'],
  [105, [6], 'Partner Armor Ornament', 'Armor ornaments', 1600, null, 'collaboration'],
  [106, [], 'Test Emote', 'Emotes', 700]
] };
const armorOrnamentCatalog = { schemaVersion: 1, manifestVersion: 'test', reviewPrice: 1200, items: [
  [104, [5], 'Test Armor Ornament', 'Titan', 'Legendary', ['Eververse'], ['Test Armor Set'], []],
  [201, [2], 'Test Activity Ornament', 'Hunter', 'Legendary', ['Trials of Osiris'], [], ['Legendary Marks']],
  [202, [], 'Test Exotic Ornament', 'Warlock', 'Exotic', [], [], []]
] };
const databaseScript = `
window.__writes = []; window.__dbFail = false; window.__indexMissing = false; window.__rows = ${JSON.stringify(fixtureRows)};
window.__standingRetry = true;
window.__ratingRefreshReads = 0;
window.__boardCalls = [];
window.__performanceRows = ${JSON.stringify({ hawk: performanceRow(1, 82), rival: performanceRow(2, 94), retry: performanceRow(1, 82), partial: { ...performanceRow(0, null), points: null, eligible: false, standing: null } })};
window.supabase = { createClient: () => ({
  rpc: (name, args) => {
    if (name === 'request_guardian_score') {
      window.__writes.push({ name, args });
      return { abortSignal: async () => ({ data: { membershipId: args.p_membership_id, requestedAt: '2026-11-19T22:00:00Z', state: 'queued' }, error: null }) };
    }
    if (name === 'get_guardian_score_request') {
      return { abortSignal: async () => {
        window.__performanceRows[args.p_membership_id].points = 315;
        window.__rows[0].points = 315;
        return { data: 'updated', error: null };
      } };
    }
    if (name === 'get_guardian_specialty_board') {
      window.__boardCalls.push(args);
      const raw = ${JSON.stringify(specialtyRows)};
      const list = args.p_board.startsWith('contest.') ? [{ ...raw[0], score: 1 }] :
        args.p_board.startsWith('solo.') ? [{ ...raw[0], score: 2 }] :
        args.p_board === 'profile.eververse' ? ${JSON.stringify(brightDustRows)}.map(row => ({ ...row, score: row.eververse_bright_dust, standing: 1 })) : raw;
      return { abortSignal: async () => ({ data: {
        total: list.length,
        rows: list.slice(args.p_offset, args.p_offset + args.p_limit),
        match: list.find(row => row.bungie_name.toLowerCase() === args.p_guardian?.toLowerCase()) || null
      }, error: null }) };
    }
    window.__writes.push({ name, args });
    return Promise.resolve({ data: true, error: window.__dbFail ? { message: 'Offline' } : null });
  },
  from: table => ({
  select: () => {
    const error = window.__indexMissing && table.startsWith('guardian_') ? { code: 'PGRST205' } : null;
    let memberId;
    const query = { order: () => query,
      eq: (_, id) => { memberId=id; return query; },
      abortSignal: () => query,
      maybeSingle: async () => {
        if (table === 'guardian_activity_reports') {
          if (memberId === 'retry' && window.__standingRetry) return { data: null, error: { message: 'Temporary failure' } };
          return { data: window.__performanceRows[memberId] || window.__performanceRows.hawk, error };
        }
        const sample = { percentile: 88, standing: 7, cohort_size: 50, triumph_score: 12500, commendations: 800 };
        return { data: sample, error };
      },
      single: async () => ({ data: { indexed_count: 8, tracked_count: 10, fresh_24h_count: 7, due_count: 3, rating_indexed_count: 8, rating_due_count: 2, last_refreshed_at: '2026-11-18T12:00:00Z' }, error }),
      range: async (start, end) => {
        if (table === 'guardian_activity_rankings' && window.__rows[0]?.points === 315) window.__ratingRefreshReads++;
        const rows = table === 'guardian_specialty_catalog' ? ${JSON.stringify(specialtyCatalog)} :
          table === 'guardian_eververse_rankings' ? ${JSON.stringify(brightDustRows)} : window.__rows;
        return { data: rows.slice(start, end + 1), error };
      } };
    return query;
  }
}) }) };`;

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/__supabase.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(databaseScript);
      return;
    }
    if (pathname === '/eververseCatalog.json' || pathname === '/armorOrnamentCatalog.json') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(pathname === '/eververseCatalog.json' ? eververseCatalog : armorOrnamentCatalog));
      return;
    }
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep)) throw new Error('Invalid path');
    let contents = await readFile(file);
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] || 'text/plain';
    if (extname(file) === '.html') contents = contents.toString().replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', '/__supabase.js');
    response.writeHead(200, { 'Content-Type': type });
    response.end(contents);
  } catch {
    response.writeHead(404); response.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const portServer = createServer();
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
const debugPort = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));
const profileDir = await mkdtemp(join(tmpdir(), 'guardian-ranker-browser-'));
const browser = spawn(process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  ...(process.platform === 'linux' ? ['--disable-dev-shm-usage'] : []),
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, 'about:blank'
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let spawnError;
let launchDiagnostics = '';
browser.stderr.on('data', data => { launchDiagnostics = (launchDiagnostics + data.toString()).slice(-6000); });
browser.on('error', error => { spawnError = error; });
let socket;
try {
  let targets;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (spawnError) throw spawnError;
    if (browser.exitCode != null) throw new Error(`Browser exited before debugging started (${browser.exitCode}): ${launchDiagnostics}`);
    try {
      targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      if (targets.some(target => target.type === 'page')) break;
    } catch { /* Wait for the debug endpoint to start. */ }
    await sleep(100);
  }
  const target = targets?.find(target => target.type === 'page');
  assert.ok(target, `Browser debugging endpoint started: ${launchDiagnostics}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map(), errors = [], apiCalls = [];
  let historyFailure = false, aggregateFailure = false, milestoneFailure = false;
  function cdp(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  const json = Response => ({ ErrorCode: 1, Response });
  async function intercept(event) {
    const url = event.request.url;
    if (event.request.method === 'OPTIONS') {
      await cdp('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 204,
        responseHeaders: [
          { name: 'Access-Control-Allow-Origin', value: '*' },
          { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { name: 'Access-Control-Allow-Headers', value: 'X-API-Key,Content-Type' }
        ] });
      return;
    }
    let body;
    if (url.includes('/Platform/')) {
      apiCalls.push(url);
      if (url.includes('SearchDestinyPlayerByBungieName')) {
        const name = JSON.parse(event.request.postData);
        if (name.displayName === 'Slow') await sleep(700);
        body = json(name.displayName === 'Missing' ? [] : [{
          membershipId: name.displayName.toLowerCase(), membershipType: 1, displayName: name.displayName,
          bungieGlobalDisplayName: name.displayName, bungieGlobalDisplayNameCode: name.displayNameCode, iconPath: '/icon.png'
        }]);
      } else if (url.includes('/User/Search/Prefix/')) {
        const prefix = decodeURIComponent(url.split('/Prefix/')[1].split('/')[0]);
        if (prefix === 'Ha') await sleep(700);
        body = json({ searchResults: [{ bungieGlobalDisplayName: prefix, bungieGlobalDisplayNameCode: 7753 }], hasMore: true });
      } else if (url.includes('/Profile/')) {
        const id = url.split('/Profile/')[1].split('/')[0];
        const collectionsPrivate = id === 'private' || id === 'privatecollections';
        body = json({
          characters: { data: id === 'private' ? {} : Object.fromEntries([0, 1, 2].map(i => [String(i), {
            characterId: String(i), classType: i, light: 400 + i, minutesPlayedTotal: '6000',
            dateLastPlayed: '2026-11-18T00:00:00Z', emblemBackgroundPath: '/emblem.png'
          }])) },
          profile: { data: { currentGuardianRank: 11, lifetimeHighestGuardianRank: 11 } },
          profileRecords: { data: { lifetimeScore: id === 'rival' ? 25000 : 10000 } },
          profileCollectibles: collectionsPrivate ? { privacy: 2 } : { data: { collectibles: { 1: { state: 0 }, 2: { state: 1 }, 3: { state: 0 }, 5: { state: 0 }, 6: { state: 0 } } } },
          characterCollectibles: collectionsPrivate ? { privacy: 2 } : { data: { 0: { collectibles: { 4: { state: 0 } } }, 1: { collectibles: {} }, 2: { collectibles: {} } } },
          profilePlugSets: id === 'privateemotes' ? { privacy: 2 } : { data: { plugs: {
            2860926541: [{ plugItemHash: 106, canInsert: true, enabled: true }]
          } } },
          characterEquipment: { data: { 0: { items: [{ itemHash: 901, itemInstanceId: '10001' }] } } },
          itemComponents: { instances: { data: { 10001: { primaryStat: { value: 402 }, damageType: 3 } } }, sockets: { data: { 10001: { sockets: [{ plugHash: 902, isEnabled: true }] } } }, stats: { data: { 10001: { stats: { 905: { value: 78 } } } } } },
          characterProgressions: { data: { 0: { progressions: { 903: { level: 10, progressToNextLevel: 20, nextLevelAt: 100, currentResetCount: 2 } } } } },
          metrics: { data: { metrics: { 1: { objectiveProgress: { progress: 42 } } } } },
          profileCommendations: { data: { totalScore: 1234, commendationNodeScoresByHash: { 906: 100 }, commendationNodePercentagesByHash: { 906: 25 } } }
        });
        body.Response.profileRecords.data.records = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [i + 1, { state: i === 0 ? 65 : i === 30 ? 12 : i % 2 ? 4 : 1, objectives: [{ progress: i + 1, completionValue: 40 }] }]));
      } else if (url.includes('/GroupV2/User/')) body = json({ results: [{ group: { groupId: '1', name: '<script>Clan</script>', clanInfo: { clanCallsign: 'TEST' }, memberCount: 50, motto: 'A good clan', creationDate: '2020-01-01' } }] });
      else if (url.includes('/Stats/PostGameCarnageReport/')) body = json({ period: '2026-11-18', entries: [{ player: { destinyUserInfo: { bungieGlobalDisplayName: 'Teammate', bungieGlobalDisplayNameCode: 7 } }, values: basicStats({ kills: 12, deaths: 2, assists: 3, score: 100, team: 1 }), extended: { weapons: [{ referenceId: 901, values: basicStats({ uniqueWeaponKills: 12, uniqueWeaponPrecisionKills: 3 }) }] } }] });
      else if (url.includes('/Stats/AggregateActivityStats/')) {
        if (url.includes('/Character/1/') && !aggregateFailure) { aggregateFailure = true; body = { ErrorCode: 99, Message: 'Aggregate temporarily unavailable' }; }
        else body = json({ activities: [{ activityHash: 904, values: basicStats({ activityCompletions: 7, fastestCompletionMsForActivity: 600000, activityKills: 350, activityDeaths: 7, activitySecondsPlayed: 7200 }) }, { activityHash: 907, values: basicStats({ activityCompletions: 2, fastestCompletionMsForActivity: 0 }) }] });
      }
      else if (url.includes('/Stats/Activities/')) {
        const page = Number(new URL(url).searchParams.get('page'));
        if (page === 1 && url.includes('/Character/1/') && !historyFailure) { historyFailure = true; body = { ErrorCode: 99, Message: 'History temporarily unavailable' }; }
        else body = json({ activities: Array.from({ length: page === 0 ? 25 : page === 1 ? 1 : 0 }, (_, i) => ({ period: '2026-11-18', activityDetails: { instanceId: String(page * 25 + i + 1), referenceId: 904, mode: 4 }, values: basicStats({ completed: 1, kills: 50, deaths: 2, activityDurationSeconds: 600 }) })) });
      } else if (url.includes('/Stats/')) body = url.includes('/Character/') ? json({ raid: { allTime: basicStats({ kills: 100, deaths: 10, activitiesEntered: 20, activitiesWon: 15 }) } }) : json({ mergedAllCharacters: { results: { allPvP: { allTime: basicStats({ kills: 200, precisionKills: 80, deaths: 100, assists: 50, activitiesEntered: 100, activitiesWon: 60, secondsPlayed: 7200 }) }, allPvE: { allTime: basicStats({ kills: 1000, precisionKills: 300, deaths: 10, activitiesEntered: 50, activitiesWon: 45 }) } } } });
      else if (url.endsWith('/Destiny2/Milestones/')) {
        if (!milestoneFailure) {
          milestoneFailure = true;
          body = { ErrorCode: 99, Message: 'Milestones temporarily unavailable' };
        } else {
          body = json({
            10: { milestoneHash: 10, endDate: new Date(Date.now() + 86400000).toISOString(), activities: [{ challengeObjectiveHashes: [1, 2] }, { challengeObjectiveHashes: [1] }] },
            11: { milestoneHash: 11, endDate: '2020-01-01T17:00:00Z' }
          });
        }
      } else if (url.includes('/Manifest/DestinySeasonDefinition/1/')) {
        body = json({ displayProperties: { name: 'Monument of Triumph' }, seasonNumber: 28, startDate: '2025-12-02T17:00:00Z', endDate: '2099-01-01T17:00:00Z' });
      } else if (url.includes('/Manifest/DestinyArtifactDefinition/2/')) body = json({ displayProperties: { name: 'Test Artifact' } });
      else if (url.includes('/Manifest/DestinySeasonPassDefinition/3/')) body = json({ displayProperties: { name: 'Test Reward Pass' } });
      else if (/\/Manifest\/Destiny\w+Definition\/\d+\//.test(url)) body = json({ displayProperties: { name: url.includes('/901/') ? 'Test Rifle' : url.includes('/902/') ? 'Test Perk' : url.includes('/903/') ? 'Vanguard Reputation' : url.includes('/905/') ? 'Handling' : url.includes('/906/') ? 'Ally' : 'Test Raid', description: 'Public definition', icon: '/icon.png' }, inventory: { tierType: 6 }, itemTypeDisplayName: 'Scout Rifle' });
      else if (url.includes('/Manifest/')) body = json({ jsonWorldComponentContentPaths: { en: { DestinySeasonDefinition: '/seasons.json', DestinyMilestoneDefinition: '/milestones.json', DestinyRecordDefinition: '/records.json', DestinyCollectibleDefinition: '/collectibles.json', DestinyMetricDefinition: '/metrics.json', DestinyProgressionDefinition: '/progressions.json', DestinyActivityDefinition: '/activities.json' } } });
      else if (url.includes('/Settings/')) body = json({ destiny2CoreSettings: { currentSeasonHash: 1, currentSeasonalArtifactHash: 2, currentSeasonPassHash: 3 } });
      else throw new Error(`Unexpected API request: ${url}`);
    } else if (url.endsWith('/seasons.json')) body = { 1: { displayProperties: { name: 'Test Season' }, seasonNumber: 1 } };
    else if (url.endsWith('/milestones.json')) body = { 10: { displayProperties: { name: '<script>Test Raid</script>' } }, 11: { displayProperties: { name: 'Expired Event' } } };
    else if (url.endsWith('/records.json')) body = recordDefinitions;
    else if (url.endsWith('/collectibles.json')) body = collectibleDefinitions;
    else if (url.endsWith('/metrics.json')) body = { 1: { displayProperties: { name: 'Raid completions' } } };
    else if (url.endsWith('/progressions.json')) body = { 903: { displayProperties: { name: 'Vanguard Reputation' } } };
    else if (url.endsWith('/activities.json')) body = { 904: { displayProperties: { name: 'Test Raid' }, activityModeTypes: [4] }, 907: { displayProperties: { name: 'Test Dungeon' }, directActivityModeType: 82 } };
    if (body !== undefined) {
      await cdp('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
        body: Buffer.from(JSON.stringify(body)).toString('base64') });
    } else {
      await cdp('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
        body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' });
    }
  }
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(message.error.message));
      else request?.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ': ' + message.params.exceptionDetails.exception?.description);
    else if (message.method === 'Fetch.requestPaused') void intercept(message.params).catch(error => {
      // Aborting a stale request can invalidate its interception ID.
      if (!/Invalid InterceptionId|Invalid interceptionId/.test(error.message)) errors.push(error.message);
    });
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  let viewportWidth;
  async function resize(width, height, mobile = false) {
    viewportWidth = width;
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  }
  await resize(1440, 1000);
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__intervals = new Set();
    const startInterval = window.setInterval, stopInterval = window.clearInterval;
    window.setInterval = (...args) => { const id = startInterval(...args); window.__intervals.add(id); return id; };
    window.clearInterval = id => { window.__intervals.delete(id); return stopInterval(id); };
  ` });
  await cdp('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function waitFor(expression) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await sleep(50);
    }
    throw new Error(`Timed out: ${expression}\n${JSON.stringify({ errors, apiCalls, body: await evaluate('document.body.innerText') })}`);
  }
  async function search(name) {
    await evaluate(`document.getElementById('nameInput').value = ${JSON.stringify(name)}; document.getElementById('searchBtn').click()`);
  }
  async function assertLayout(label) {
    const { width, pageOverflow, overflowing } = await evaluate(`(() => {
      const root = document.documentElement;
      const containers = document.querySelectorAll('#results, #game-stats, .home-sidebar, .report-header, .report-actions, .report-filters, .report-table-wrap--responsive, .search-layout, .leaderboard-section, .board-directory, .board-table-wrap');
      return {
        width: window.innerWidth, pageOverflow: root.scrollWidth - root.clientWidth,
        overflowing: [...containers].filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1)
          .map(el => el.id || el.className)
      };
    })()`);
    assert.ok(width <= viewportWidth + 1 && pageOverflow <= 1,
      `${label} at ${viewportWidth}px: layout width ${width}px, page overflow ${pageOverflow}px`);
    assert.deepEqual(overflowing, [], `${label} at ${viewportWidth}px: overflowing containers`);
    const splitHeaders = await evaluate(`[...document.querySelectorAll('.styled-table th')].filter(header => {
      if (!/^\\S+$/.test(header.textContent.trim()) || !header.getClientRects().length) return false;
      const text = new Range();
      text.selectNodeContents(header);
      return text.getClientRects().length > 1;
    }).map(header => ({ text: header.textContent, width: header.clientWidth, font: getComputedStyle(header).fontSize }))`);
    assert.deepEqual(splitHeaders, [], `${label} at ${viewportWidth}px: split leaderboard headers`);
  }
  async function assertSidebar(sideBySide) {
    const positions = await evaluate(`(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return { report: rect('#results'), stats: rect('#game-stats'), boards: rect('.home-leaderboards') };
    })()`);
    const { report, stats, boards } = positions;
    if (sideBySide) {
      assert.ok(stats.left >= report.right && Math.abs(stats.top - report.top) <= 1, 'Game stats sit to the right of the report');
    } else {
      assert.ok(stats.top >= report.bottom && Math.abs(stats.left - report.left) <= 1, 'Game stats sit below the report on phones');
    }
    assert.ok(boards.top >= stats.bottom && Math.abs(boards.left - stats.left) <= 1, 'Featured boards sit below game stats');
  }
  await cdp('Page.navigate', { url: origin });
  await waitFor("document.querySelector('#eververse-board-body tr a') && document.querySelector('#account-rating-body tr a')");
  await assertLayout('Home');
  assert.equal(await evaluate("document.querySelectorAll('.home-leaderboards .leaderboard-section').length"), 3);
  assert.equal(await evaluate("document.querySelectorAll('#account-rating-body tr a').length"), 5);
  assert.equal(await evaluate("document.querySelector('#eververse-board-body tr:nth-child(2) td').textContent"), '1');
  assert.ok(await evaluate("document.querySelector('#eververse-board-body a').href.endsWith('#overview')"));
  await search('Hawk#7753');
  await waitFor("document.querySelector('#results .bungie-name')?.textContent === 'Hawk#7753' && window.__writes.length === 1");
  await assertSidebar(true);
  await waitFor("document.querySelector('#game-season').textContent.includes('Season 28: Monument of Triumph')");
  assert.equal(await evaluate("document.querySelectorAll('#game-stats details[open]').length"), 0);
  assert.ok(!apiCalls.some(url => /Milestones\/|ArtifactDefinition|SeasonPassDefinition/.test(url)), 'Collapsed sections do not fetch extra data');
  await evaluate("document.querySelector('#game-season-details summary').click()");
  await waitFor("document.querySelector('#game-season-facts').textContent.includes('Test Reward Pass')");
  assert.equal(await evaluate("document.querySelector('#game-season-facts time').dateTime"), '2026-06-09T17:00:00.000Z');
  assert.match(await evaluate("document.querySelector('#game-season-facts').textContent"), /No announced end date.*Test Artifact.*Test Reward Pass.*550/s);
  await evaluate("document.querySelector('#game-reset-details summary').click()");
  const [weekly, daily, weekStart] = await evaluate(`['weekly-reset-timer', 'daily-reset-timer', 'current-game-week'].map(id => {
    const date = new Date(document.querySelector('#' + id + ' time').dateTime);
    return [date.getUTCDay(), date.getUTCHours(), date > new Date()];
  })`);
  assert.deepEqual(weekly, [2, 17, true]);
  assert.deepEqual(daily.slice(1), [17, true]);
  assert.deepEqual(weekStart, [2, 17, false]);
  await evaluate("document.querySelector('#game-milestones-details summary').click()");
  await waitFor("document.querySelector('#game-milestones').textContent.includes('Reopen this section to retry')");
  await evaluate("document.querySelector('#game-milestones-details summary').click()");
  await evaluate("document.querySelector('#game-milestones-details summary').click()");
  await waitFor("document.querySelector('#game-milestones li')");
  assert.match(await evaluate("document.querySelector('#game-milestones').textContent"), /<script>Test Raid<\/script>2 challenges.*Ends/);
  assert.equal(await evaluate("document.querySelectorAll('#game-milestones li').length"), 1);
  assert.equal(await evaluate("document.querySelectorAll('#game-milestones script').length"), 0);
  await assertLayout('Expanded game stats');
  await assertSidebar(true);
  await mkdir(join(root, 'test-artifacts'), { recursive: true });
  const expandedSidebar = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(root, 'test-artifacts', 'global-sidebar.png'), Buffer.from(expandedSidebar.data, 'base64'));
  await evaluate("document.querySelectorAll('#game-stats details[open] summary').forEach(summary => summary.click())");
  assert.deepEqual(await evaluate('window.__writes[0]'), { name: 'enqueue_guardian', args: { p_membership_id: 'hawk', p_membership_type: 1 } });
  assert.match(await evaluate("document.getElementById('index-status').textContent"), /8 indexed Guardians; 2 waiting/);
  assert.match(await evaluate("document.getElementById('index-status').textContent"), /7 updated in 24 hours; 3 due/);
  assert.equal(apiCalls.filter(url => url.includes('/User/Search/')).length, 0, 'Full names never use prefix search');
  assert.equal(await evaluate("document.querySelectorAll('#results .character-section img').length"), 3);
  assert.equal(await evaluate('window.__intervals.size'), 1, 'Only one weekly-reset timer remains active');
  await waitFor("document.querySelector('.clan-summary').textContent.includes('<script>Clan</script>')");
  assert.equal(await evaluate("document.querySelector('.clan-summary script')"), null);
  assert.ok(apiCalls.some(url => url.includes('components=100,104,200,202,204,205,300,304,305,800,900,1100,1400')));
  await waitFor("document.querySelector('.eververse-value')?.textContent === '3,800 Bright Dust'");
  await evaluate("document.querySelector('.eververse-details').parentElement.querySelector('summary').click()");
  assert.match(await evaluate("document.querySelector('.eververse-details').innerText"), /4 of 5 owned Eververse cosmetics/);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.eververse-details thead th')].map(th => th.textContent)`),
    ['Cosmetic type', 'Owned', 'Catalog total', 'Confirmed missing', 'Unconfirmed', 'Owned with prices', 'Bright Dust value']);
  const shipCoverage = await evaluate(`(() => {
    const ships = [...document.querySelectorAll('.eververse-details tbody tr')].find(row => row.querySelector('th').textContent === 'Ships');
    return Array.from(ships.querySelectorAll('.report-cell-value'), cell => cell.textContent);
  })()`);
  assert.deepEqual(shipCoverage, ['0', '1', '1', '0', '0', '—']);
  await evaluate("document.querySelector('.eververse-items summary').click()");
  await waitFor("document.querySelector('.eververse-items tbody')?.textContent.includes('<script>Test Shader</script>')");
  assert.equal(await evaluate("document.querySelector('.eververse-items tbody script')"), null);
  assert.equal(await evaluate("document.querySelectorAll('.eververse-items tbody tr').length"), 5);
  assert.match(await evaluate("document.querySelector('.eververse-items tbody').textContent"), /1,200 Bright Dust.*Estimated share of Test Armor Set.*No verified price.*Excluded from total/s);
  assert.match(await evaluate("document.querySelector('.eververse-items tbody').textContent"), /Partner Armor Ornament.*1,600 Bright Dust.*Collaboration set estimate/s);
  assert.match(await evaluate("document.querySelector('.eververse-items tbody').textContent"), /Test Emote.*700 Bright Dust.*Individual offer/s);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.eververse-items tbody tr')).display"), 'table-row');
  await evaluate("document.querySelector('.eververse-details').parentElement.querySelector('summary').click()");
  async function openSection(id, condition) {
    await evaluate(`{
      const picker = document.querySelector('.report-section-picker select');
      if (picker.getClientRects().length) {
        picker.value = ${JSON.stringify(id)};
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      } else document.querySelector('[data-section="${id}"]').click();
    }`);
    await waitFor(condition);
    await assertLayout(id);
  }
  await openSection('characters', "document.querySelector('#report-characters').textContent.includes('Test Rifle')");
  await evaluate("document.querySelector('.gear-perks').click()");
  await waitFor("document.querySelector('.perk-list').textContent.includes('Test Perk')");
  await evaluate("document.querySelector('.gear-stats').click()");
  await waitFor("document.querySelector('.item-stats')?.textContent.includes('Handling')");
  assert.ok(await evaluate("document.querySelector('.item-stats').textContent.includes('78')"));
  await openSection('career', "document.querySelector('#report-career').textContent.includes('60%')");
  await evaluate("document.querySelector('.load-mode').click()");
  await waitFor("document.querySelector('.mode-result').textContent.includes('15')");
  await openSection('activities', "document.querySelectorAll('.match-open').length === 25");
  assert.ok(await evaluate("document.querySelector('.activity-insights').textContent.includes('25 unique loaded activities')"));
  await evaluate("document.querySelector('.history-more').click()");
  await waitFor("document.querySelector('.history-more').textContent === 'Retry incomplete page' && !document.querySelector('.history-more').disabled");
  assert.equal(await evaluate("document.querySelectorAll('.match-open').length"), 26);
  await evaluate("document.querySelector('.history-more').click()");
  await waitFor("document.querySelector('.history-more').hidden");
  assert.equal(await evaluate("document.querySelectorAll('.match-open').length"), 26, 'Retried pages do not duplicate shared matches');
  assert.ok(apiCalls.filter(url => url.includes('/Character/1/Stats/Activities/') && url.includes('page=1')).length >= 2);
  await evaluate("document.querySelector('.match-open').click()");
  await waitFor("document.querySelector('.match-result').textContent.includes('Teammate#0007')");
  await waitFor("document.querySelector('.weapon-result')?.textContent.includes('Test Rifle')");
  assert.ok(await evaluate("document.querySelector('.weapon-result').textContent.includes('25%')"));
  await openSection('endgame', "document.querySelector('.aggregate-retry') != null");
  assert.ok(await evaluate("document.querySelector('.record-coverage').textContent.includes('2 / 3')"));
  await evaluate("document.querySelector('.aggregate-retry').click()");
  await waitFor("document.querySelector('.record-coverage').textContent.includes('3 / 3')");
  await evaluate("document.querySelector('.aggregate-category').value='dungeon'; document.querySelector('.aggregate-category').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelectorAll('.aggregate-result tbody tr').length"), 3);
  assert.ok(await evaluate("document.querySelector('.aggregate-result').textContent.includes('Unavailable')"), 'Missing fastest time is not a zero-second completion');
  await evaluate("{ const original = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { window.__lastDownloadText = blob.text(); return original(blob); }; HTMLAnchorElement.prototype.click = function() {}; document.querySelector('.aggregate-csv').click(); }");
  assert.ok((await evaluate('window.__lastDownloadText')).includes('Test Dungeon'));
  assert.ok(!(await evaluate('window.__lastDownloadText')).includes('Test Raid'));
  await openSection('rating', "document.querySelectorAll('.rating-metric').length === 11");
  assert.ok(await evaluate("document.querySelector('.rating-coverage').textContent.includes('#10 of 50')"));
  assert.ok(await evaluate(`document.querySelector('#report-rating').textContent.includes('${PERFORMANCE_VERSION}')`));
  assert.ok(await evaluate("document.querySelector('#report-rating').textContent.includes('Monument of Triumph')"));
  assert.ok(await evaluate("document.querySelector('.crucible-best-season').textContent.includes('Renegades · 88 points')"));
  assert.equal(await evaluate("document.querySelectorAll('.rating-dimension').length"), 2);
  assert.ok(await evaluate("document.querySelector('.rating-tier').textContent.includes('82%')"));
  assert.equal(await evaluate('window.location.hash'), '#rating');
  assert.ok(await evaluate("!document.querySelector('#report-rating').textContent.includes('/ 1,000')"));
  assert.ok(await evaluate("document.querySelector('.rating-methodology').textContent.includes('250 points')"));
  await mkdir(join(root, 'test-artifacts'), { recursive: true });
  await evaluate("document.querySelector('#report-rating').scrollIntoView({block:'start'})");
  const desktopRating = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(root, 'test-artifacts', 'account-rating.png'), Buffer.from(desktopRating.data, 'base64'));
  await openSection('records', "document.querySelector('.catalogue-count')?.textContent.includes('31 matching')");
  assert.equal(await evaluate("document.querySelectorAll('#report-records .catalogue-item').length"), 24);
  assert.equal(await evaluate("document.querySelector('#report-records').textContent.includes('SECRET SOLUTION')"), false);
  await evaluate("document.querySelector('#report-records .catalogue-filter').value='titles'; document.querySelector('#report-records .catalogue-filter').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelectorAll('#report-records .catalogue-item').length"), 1);
  assert.ok(await evaluate("document.querySelector('#report-records').textContent.includes('Wayfarer')"));
  await evaluate("document.querySelector('.catalogue-sort').value='closest'; document.querySelector('.catalogue-sort').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelector('#report-records .catalogue-item h4').textContent"), 'Triumph 30');
  assert.ok(await evaluate("document.querySelector('#report-records .catalogue-item').textContent.includes('75%')"));
  await openSection('collections', "document.querySelector('#report-collections').textContent.includes('Missing Ship')");
  await evaluate("document.querySelector('#report-collections input').value='exotic'; document.querySelector('#report-collections input').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelectorAll('#report-collections .catalogue-item').length"), 1);
  await openSection('armor', "document.querySelector('#report-armor').textContent.includes('Test Activity Ornament')");
  assert.match(await evaluate("document.querySelector('#report-armor').textContent"), /3 ornaments · 1 owned · 1 confirmed missing · 1 unconfirmed/);
  await evaluate("document.querySelector('#report-armor input').value = 'trials'; document.querySelector('#report-armor input').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelectorAll('#report-armor tbody tr').length"), 1);
  assert.match(await evaluate("document.querySelector('#report-armor tbody').textContent"), /Test Activity Ornament.*Confirmed missing.*1,200 Bright Dust/s);
  await openSection('progression', "document.querySelector('#report-progression').textContent.includes('Vanguard Reputation')");
  await waitFor("document.querySelector('#report-progression').textContent.includes('Ally')");
  await evaluate("document.querySelector('.load-metrics').click()");
  await waitFor("document.querySelector('.metric-rows')?.textContent.includes('Raid completions')");
  await openSection('rating', "document.querySelector('.rating-compare') != null");
  await evaluate("document.querySelector('.rating-compare').click()");
  await waitFor("document.activeElement === document.querySelector('.compare-form input')");
  const primaryStatsRequests = apiCalls.filter(url => url.includes('/Account/hawk/') && url.includes('/Stats/')).length;
  await evaluate("document.querySelector('.compare-form input').value = 'Rival#1234'; document.querySelector('.compare-form').requestSubmit()");
  await waitFor("document.querySelector('.comparison-status').textContent === 'Comparison ready.'");
  assert.equal(await evaluate("document.querySelectorAll('.comparison-ratings tbody tr').length"), 16);
  assert.ok(await evaluate("document.querySelector('.comparison-ratings').textContent.includes('Best past Crucible season')"));
  assert.equal(await evaluate("document.querySelectorAll('.compare-metrics tbody tr').length"), 11);
  assert.ok(await evaluate("document.querySelector('.compare-drivers').textContent.includes('250 points in favor of Rival#1234')"));
  assert.equal(primaryStatsRequests, apiCalls.filter(url => url.includes('/Account/hawk/') && url.includes('/Stats/')).length, 'Comparison reuses current player rating data');
  assert.equal(await evaluate("new URL(location.href).searchParams.get('compare')"), 'Rival#1234');
  assert.equal(await evaluate('window.__writes.length'), 1, 'Comparison does not submit profile scores or queue extra accounts');
  await evaluate("window.__createObjectURL = URL.createObjectURL; URL.createObjectURL = blob => { window.__exportText = blob.text(); return window.__createObjectURL(blob); }; HTMLAnchorElement.prototype.click = function() {}; document.querySelector('#downloadRawBtn').click()");
  const exported = JSON.parse(await evaluate('window.__exportText'));
  assert.equal(exported.bungieName, 'Hawk#7753');
  assert.equal(exported.sections.activities.activities.length, 26);
  assert.equal(exported.sections.activities.insights.kd, 25);
  assert.equal(exported.sections.activityRecords.rows.length, 6);
  assert.equal(exported.sections.activityRecords.coverage.charactersLoaded, 3);
  assert.equal(exported.sections.metrics[0].objectiveProgress.progress, 42);
  assert.equal(exported.sections.armorOrnaments.items.length, 3);
  assert.ok(exported.sections.armorOrnaments.items.every(item => item.reviewPrice === 1200));
  assert.equal(exported.sections.eververseNetWorth.brightDust, 3800);
  assert.equal(exported.sections.eververseNetWorth.emoteCoverage, 'public');
  assert.equal(exported.sections.eververseNetWorth.standardArmorEstimateCount, 0);
  assert.equal(exported.sections.eververseNetWorth.standardEstimateCount, 0);
  assert.equal(exported.sections.eververseNetWorth.collaborationEstimateCount, 1);
  assert.equal(exported.sections.eververseNetWorth.unpricedCount, 1);
  assert.ok(exported.sections.eververseNetWorth.catalogCoverage.every(row =>
    row.catalogTotal === row.owned + row.confirmedMissing + row.unconfirmed && row.priced <= row.owned));
  assert.equal(exported.sections.accountRating.version, PERFORMANCE_VERSION);
  assert.equal(exported.sections.accountRating.performance.percentile, 82);
  assert.equal(exported.sections.accountRating.knowledge.percentile, 88);
  assert.equal(exported.sections.comparison.rating.version, PERFORMANCE_VERSION);
  assert.equal(exported.sections.comparison.rating.overallDifference, -250);
  assert.equal(exported.sections.comparison.rating.metrics.find(m => m.id === 'raidContest').difference, -250);
  await evaluate("document.querySelector('[data-section=overview]').click()");
  await evaluate('window.scrollTo(0, 0)');
  const reportDesktop = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await mkdir(join(root, 'test-artifacts'), { recursive: true });
  await writeFile(join(root, 'test-artifacts', 'player-report.png'), Buffer.from(reportDesktop.data, 'base64'));
  await search('Retry#1234');
  await waitFor("document.querySelector('#results .bungie-name')?.textContent === 'Retry#1234'");
  await openSection('rating', "document.querySelector('.rating-tier')?.textContent.includes('temporarily unavailable')");
  assert.ok(await evaluate("document.querySelector('.rating-dimensions').textContent.includes('Knowledge')"));
  assert.ok(await evaluate("window.__writes.every(request => request.name === 'enqueue_guardian')"), 'Ordinary searches do not manually refresh scores');
  assert.equal(await evaluate("document.querySelector('.rating-refresh').textContent"), 'Update score');
  await evaluate("window.__standingRetry=false; document.querySelector('.rating-refresh').click()");
  await waitFor("document.querySelector('.rating-refresh-status')?.textContent.includes('Score and leaderboards updated') && window.__ratingRefreshReads > 0");
  assert.equal(await evaluate("document.querySelector('.overall-rating-score').textContent"), '315 points');
  assert.deepEqual(await evaluate("window.__writes.find(request => request.name === 'request_guardian_score')"),
    { name: 'request_guardian_score', args: { p_membership_id: 'retry', p_membership_type: 1 } });
  await search('<img src=x onerror=window.__injected=true>#1234');
  await waitFor("document.querySelector('#results .bungie-name')?.textContent.includes('<img')");
  assert.equal(await evaluate('Boolean(window.__injected)'), false, 'Display names cannot inject HTML');
  await evaluate('window.__dbFail = true');
  await search('Offline#1234');
  await waitFor("document.querySelector('#results .queue-status')?.textContent.includes('could not be queued')");
  assert.equal(await evaluate("document.querySelector('#results .bungie-name').textContent"), 'Offline#1234');
  await search('PrivateCollections#1234');
  await waitFor("document.querySelector('.eververse-details')?.textContent.includes('did not return public Collections data')");
  assert.equal(await evaluate("document.querySelector('.eververse-value').textContent"), 'Unavailable');
  await search('PrivateEmotes#1234');
  await waitFor("document.querySelector('.eververse-details')?.textContent.includes('did not return public emote data')");
  assert.equal(await evaluate("document.querySelector('.eververse-value').textContent"), '3,100 Bright Dust');
  await search('Private#1234');
  await waitFor("document.getElementById('results').textContent.includes('No public characters')");
  await search('Missing#1234');
  await waitFor("document.getElementById('results').textContent.includes('No Destiny 2 account found')");
  await search('Slow#1234');
  await sleep(100);
  await search('New#1234');
  await waitFor("document.querySelector('#results .bungie-name')?.textContent === 'New#1234'");
  await sleep(800);
  assert.equal(await evaluate("document.querySelector('#results .bungie-name').textContent"), 'New#1234');
  await search('Ha');
  await sleep(100);
  await search('Haw');
  await waitFor("document.querySelector('#suggestions button')?.textContent === 'Haw#7753'");
  await sleep(800);
  assert.equal(await evaluate("document.querySelector('#suggestions button').textContent"), 'Haw#7753');
  await evaluate("document.getElementById('nameInput').value='Hawk#7753'; document.getElementById('nameInput').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true}))");
  await waitFor("document.querySelector('#results .bungie-name')?.textContent === 'Hawk#7753'");
  await resize(390, 844, true);
  await evaluate("document.querySelector('#suggestions').classList.remove('show')");
  await openSection('overview', "document.querySelector('.eververse-value')?.textContent === '3,800 Bright Dust'");
  await assertSidebar(false);
  await evaluate('window.scrollTo(0, 0)');
  assert.ok(await evaluate(`Math.abs(document.querySelector('#nameInput').getBoundingClientRect().top -
    document.querySelector('#searchBtn').getBoundingClientRect().top) <= 1`), 'The search button stays beside the field on phones');
  assert.ok(await evaluate("document.querySelector('.report-section-picker select').getClientRects().length && !document.querySelector('.report-tabs').getClientRects().length"));
  const artifactDir = join(root, 'test-artifacts');
  await mkdir(artifactDir, { recursive: true });
  const mobile = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifactDir, 'mobile.png'), Buffer.from(mobile.data, 'base64'));
  await evaluate("document.querySelector('#game-season-details summary').click()");
  await waitFor("document.querySelector('#game-season-facts').textContent.includes('Test Artifact')");
  await assertLayout('Expanded game stats on mobile');
  await assertSidebar(false);
  await evaluate("document.querySelector('#game-stats').scrollIntoView({block:'start'})");
  const mobileSidebar = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifactDir, 'global-sidebar-mobile.png'), Buffer.from(mobileSidebar.data, 'base64'));
  await evaluate("document.querySelector('#game-season-details summary').click()");
  await waitFor("document.querySelector('.eververse-value')?.textContent === '3,800 Bright Dust'");
  await evaluate("document.querySelector('.eververse-details').parentElement.querySelector('summary').click(); document.querySelector('.eververse-items summary').click()");
  await waitFor("document.querySelectorAll('.eververse-items tbody tr').length === 5 && document.querySelector('.eververse-items .report-cell-label').getClientRects().length");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.eververse-items tbody tr')).display"), 'grid');
  await assertLayout('Eververse breakdown');
  await openSection('armor', "document.querySelector('#report-armor .ornament-results')?.textContent.includes('Test Exotic Ornament')");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#report-armor tbody tr')).display"), 'grid');
  await assertLayout('Armor ornament catalog on mobile');
  await openSection('activities', "document.querySelectorAll('.match-open').length === 25");
  await openSection('characters', "document.querySelector('#report-characters').textContent.includes('Test Rifle')");
  await openSection('records', "document.querySelector('#report-records .catalogue-count')?.textContent.includes('31 matching')");
  await openSection('endgame', "document.querySelector('.record-coverage')?.textContent.includes('3 / 3')");
  await evaluate("document.querySelector('#report-endgame').scrollIntoView({block:'start'})");
  const mobileRecords = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifactDir, 'activity-records-mobile.png'), Buffer.from(mobileRecords.data, 'base64'));
  await openSection('rating', "document.querySelectorAll('.rating-metric').length === 11");
  await evaluate("document.querySelector('#report-rating').scrollIntoView({block:'start'})");
  const mobileRating = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifactDir, 'account-rating-mobile.png'), Buffer.from(mobileRating.data, 'base64'));
  await cdp('Page.navigate', { url: `${origin}/?name=Hawk%237753#rating` });
  await waitFor("document.querySelectorAll('.rating-metric').length === 11 && document.querySelector('.rating-tier').textContent.includes('82%')");
  assert.equal(await evaluate("document.querySelector('#report-rating').hidden"), false, 'Shared rating links open and calculate the correct section');
  assert.equal(await evaluate("document.querySelector('.report-section-picker select').value"), 'rating');
  await resize(320, 780, true);
  const comparisonQuery = new URLSearchParams({ name: longGuardian, compare: 'Partial#1234' });
  await cdp('Page.navigate', { url: `${origin}/?${comparisonQuery}#compare` });
  await waitFor("document.querySelector('.comparison-ratings')?.textContent.includes('Partial#1234') && document.querySelector('.comparison-status').textContent === 'Comparison ready.'");
  assert.equal(await evaluate("document.querySelector('.comparison-ratings tbody tr td:last-child .report-cell-value').textContent"), '—', 'A provisional score cannot determine an overall lead');
  await assertLayout('Shared comparison with a long player name');
  await assertSidebar(false);
  await resize(768, 1024);
  await assertLayout('Tablet comparison');
  await assertSidebar(false);
  await resize(1000, 880);
  await assertLayout('Narrow desktop comparison');
  await assertSidebar(true);
  await resize(1440, 1000);
  await cdp('Page.navigate', { url: `${origin}/leaderboards.html` });
  await waitFor("document.querySelectorAll('#board-rows tr').length === 25");
  await assertLayout('Leaderboard directory');
  assert.equal(await evaluate("window.__boardCalls.length"), 1, 'The directory loads only the selected board');
  await evaluate("document.querySelector('#board-player').value='farguardian#1234'; document.querySelector('.board-find').requestSubmit()");
  await waitFor("document.querySelector('#board-match').textContent.includes('Rank #28')");
  await evaluate("document.querySelector('#board-next').click()");
  await waitFor("document.querySelectorAll('#board-rows tr').length === 3");
  assert.equal(await evaluate("window.__boardCalls.at(-1).p_offset"), 25);
  await evaluate("document.querySelector('#board-category').value='Dungeons'; document.querySelector('#board-category').dispatchEvent(new Event('change'))");
  await waitFor("document.querySelector('#board-rows').textContent.includes('Solo flawless')");
  assert.equal(await evaluate("new URL(location.href).searchParams.get('board')"), 'solo.test');
  await waitFor("document.querySelectorAll('#highest-character-body tr a').length === 5");
  await waitFor("document.querySelectorAll('#account-rating-body tr a').length === 5");
  assert.ok(await evaluate("document.querySelector('#account-rating-body a').href.endsWith('#rating')"));
  await evaluate("document.querySelector('#toggleAccountRatingBtn').click()");
  assert.equal(await evaluate("document.querySelectorAll('#account-rating-body tr a').length"),8);
  await evaluate("document.getElementById('toggleHighestCharacterBtn').click(); document.getElementById('toggleTimePlayedBtn').click()");
  assert.equal(await evaluate("document.querySelectorAll('#highest-character-body tr a').length"), 8);
  assert.equal(await evaluate("document.querySelectorAll('#time-played-body tr a').length"), 8);
  await evaluate("document.getElementById('leaderboardSearch').value='Hawk#7753'; document.getElementById('leaderboardSearchBtn').click()");
  assert.equal(await evaluate("document.querySelectorAll('tr.highlight').length"), 7);
  await evaluate("document.getElementById('toggleHighestCharacterBtn').click()");
  assert.equal(await evaluate("document.querySelectorAll('#highest-character-body tr a').length"), 5);
  const desktop = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifactDir, 'leaderboards.png'), Buffer.from(desktop.data, 'base64'));
  await evaluate("window.__indexMissing = true; import('./leaderboard.js?v=bright-dust').then(module => module.loadLeaderboards())");
  assert.match(await evaluate("document.getElementById('index-status').textContent"), /not enabled yet/);
  assert.equal(await evaluate("document.querySelectorAll('#highest-character-body tr a').length"), 5);
  await resize(320, 780, true);
  await cdp('Page.navigate', { url: `${origin}/leaderboards.html?board=contest.123#discover` });
  await waitFor("document.querySelector('#board-rows')?.textContent.includes('Verified clear')");
  assert.equal(await evaluate("document.querySelector('#board-choice').value"), 'contest.123');
  await waitFor("document.querySelector('#account-rating-body a')");
  await assertLayout('Leaderboards with a long player name');
  await cdp('Page.navigate', { url: `${origin}/leaderboards.html?board=profile.eververse#discover` });
  await waitFor("document.querySelector('#board-rows').textContent.includes('3,800')");
  assert.equal(await evaluate("document.querySelector('#board-unit').textContent"), 'Bright Dust');
  assert.equal(await evaluate("document.querySelectorAll('#board-rows tr a').length"), 2);
  assert.ok(await evaluate("document.querySelector('#board-rows a').href.endsWith('#overview')"));
  await assertLayout('Bright Dust full board on mobile');
  const narrowBoards = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifactDir, 'leaderboards-mobile.png'), Buffer.from(narrowBoards.data, 'base64'));
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  console.log('PASS: account-rating metrics/coverage/retries/exports/deep links, public player reports, activity insights, gear, mobile, privacy/injection, stale searches, and leaderboards.');
} finally {
  socket?.close();
  browser.kill();
  await new Promise(resolve => server.close(resolve));
}

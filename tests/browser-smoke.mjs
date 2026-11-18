// Dependency-free browser integration checks. Uses installed Edge or BROWSER_PATH.
// All Bungie and Supabase traffic is mocked; this never writes to the live database.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixtureRows = Array.from({ length: 8 }, (_, i) => ({
  membership_id: String(i), bungie_name: i === 7 ? 'Hawk#7753' : `Player${i}#1234`,
  triumph_score: 1000 - i, guardian_rank: 11 - i, time_played_hours: 200 - i,
  class_type: 'Titan', light_level: 400 - i
}));
const basicStats = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { basic: { value } }]));
const recordDefinitions = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, { displayProperties: { name: `Triumph ${i + 1}`, description: 'A public triumph' }, ...(i === 0 ? { titleInfo: { titlesByGender: { Male: 'Wayfarer' } } } : {}) }]));
recordDefinitions[31] = { displayProperties: { name: 'SECRET SPOILER', description: 'SECRET SOLUTION' }, stateInfo: { obscuredDescription: 'Keep playing to reveal.' } };
const collectibleDefinitions = { 1: { displayProperties: { name: 'Test Exotic', description: 'An acquired item' } }, 2: { displayProperties: { name: 'Missing Ship', description: 'Not yet acquired' } } };
const databaseScript = `
window.__writes = []; window.__dbFail = false; window.__indexMissing = false; window.__rows = ${JSON.stringify(fixtureRows)};
window.supabase = { createClient: () => ({
  rpc: async (name, args) => {
    window.__writes.push({ name, args });
    return { data: true, error: window.__dbFail ? { message: 'Offline' } : null };
  },
  from: table => ({
  select: () => {
    const error = window.__indexMissing && table.startsWith('guardian_') ? { code: 'PGRST205' } : null;
    const query = { order: () => query,
      single: async () => ({ data: { indexed_count: 8, tracked_count: 10, fresh_24h_count: 7, due_count: 3, last_refreshed_at: '2026-11-18T12:00:00Z' }, error }),
      range: async (start, end) => ({ data: window.__rows.slice(start, end + 1), error }) };
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
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
let spawnError;
browser.on('error', error => { spawnError = error; });
let socket;
try {
  let targets;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError) throw spawnError;
    try {
      targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      if (targets.some(target => target.type === 'page')) break;
    } catch { /* Wait for the debug endpoint to start. */ }
    await sleep(100);
  }
  const target = targets?.find(target => target.type === 'page');
  assert.ok(target, 'Browser debugging endpoint started');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map(), errors = [], apiCalls = [];
  let historyFailure = false;
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
        body = json({
          characters: { data: id === 'private' ? {} : Object.fromEntries([0, 1, 2].map(i => [String(i), {
            characterId: String(i), classType: i, light: 400 + i, minutesPlayedTotal: '6000',
            dateLastPlayed: '2026-11-18T00:00:00Z', emblemBackgroundPath: '/emblem.png'
          }])) },
          profile: { data: { currentGuardianRank: 11, lifetimeHighestGuardianRank: 11 } },
          profileRecords: { data: { lifetimeScore: 10000 } },
          profileCollectibles: { data: { collectibles: { 1: { state: 0 }, 2: { state: 1 } } } },
          characterEquipment: { data: { 0: { items: [{ itemHash: 901, itemInstanceId: '10001' }] } } },
          itemComponents: { instances: { data: { 10001: { primaryStat: { value: 402 }, damageType: 3 } } }, sockets: { data: { 10001: { sockets: [{ plugHash: 902, isEnabled: true }] } } } },
          characterProgressions: { data: { 0: { progressions: { 903: { level: 10, progressToNextLevel: 20, nextLevelAt: 100, currentResetCount: 2 } } } } },
          metrics: { data: { metrics: { 1: { objectiveProgress: { progress: 42 } } } } }
        });
        body.Response.profileRecords.data.records = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [i + 1, { state: i === 0 ? 65 : i === 30 ? 12 : i % 2 ? 4 : 1 }]));
      } else if (url.includes('/GroupV2/User/')) body = json({ results: [{ group: { groupId: '1', name: '<script>Clan</script>', clanInfo: { clanCallsign: 'TEST' }, memberCount: 50, motto: 'A good clan', creationDate: '2020-01-01' } }] });
      else if (url.includes('/Stats/PostGameCarnageReport/')) body = json({ period: '2026-11-18', entries: [{ player: { destinyUserInfo: { bungieGlobalDisplayName: 'Teammate', bungieGlobalDisplayNameCode: 7 } }, values: basicStats({ kills: 12, deaths: 2, assists: 3, score: 100, team: 1 }) }] });
      else if (url.includes('/Stats/Activities/')) {
        const page = Number(new URL(url).searchParams.get('page'));
        if (page === 1 && url.includes('/Character/1/') && !historyFailure) { historyFailure = true; body = { ErrorCode: 99, Message: 'History temporarily unavailable' }; }
        else body = json({ activities: Array.from({ length: page === 0 ? 25 : page === 1 ? 1 : 0 }, (_, i) => ({ period: '2026-11-18', activityDetails: { instanceId: String(page * 25 + i + 1), referenceId: 904, mode: 4 }, values: basicStats({ completed: 1, kills: 50, deaths: 2, activityDurationSeconds: 600 }) })) });
      } else if (url.includes('/Stats/')) body = url.includes('/Character/') ? json({ raid: { allTime: basicStats({ kills: 100, deaths: 10, activitiesEntered: 20, activitiesWon: 15 }) } }) : json({ mergedAllCharacters: { results: { allPvP: { allTime: basicStats({ kills: 200, deaths: 100, assists: 50, activitiesEntered: 100, activitiesWon: 60, secondsPlayed: 7200 }) }, allPvE: { allTime: basicStats({ kills: 1000, deaths: 10, activitiesEntered: 50, activitiesWon: 45 }) } } } });
      else if (/\/Manifest\/Destiny\w+Definition\/\d+\//.test(url)) body = json({ displayProperties: { name: url.includes('/901/') ? 'Test Rifle' : url.includes('/902/') ? 'Test Perk' : url.includes('/903/') ? 'Vanguard Reputation' : 'Test Raid', description: 'Public definition', icon: '/icon.png' }, inventory: { tierType: 6 }, itemTypeDisplayName: 'Scout Rifle' });
      else if (url.includes('/Manifest/')) body = json({ jsonWorldComponentContentPaths: { en: { DestinySeasonDefinition: '/seasons.json', DestinyRecordDefinition: '/records.json', DestinyCollectibleDefinition: '/collectibles.json', DestinyMetricDefinition: '/metrics.json', DestinyProgressionDefinition: '/progressions.json' } } });
      else if (url.includes('/Settings/')) body = json({ destiny2CoreSettings: { currentSeasonHash: 1 } });
      else throw new Error(`Unexpected API request: ${url}`);
    } else if (url.endsWith('/seasons.json')) body = { 1: { displayProperties: { name: 'Test Season' }, seasonNumber: 1 } };
    else if (url.endsWith('/records.json')) body = recordDefinitions;
    else if (url.endsWith('/collectibles.json')) body = collectibleDefinitions;
    else if (url.endsWith('/metrics.json')) body = { 1: { displayProperties: { name: 'Raid completions' } } };
    else if (url.endsWith('/progressions.json')) body = { 903: { displayProperties: { name: 'Vanguard Reputation' } } };
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
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
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
  await cdp('Page.navigate', { url: origin });
  await waitFor("document.querySelector('#leaderboard-body tr a') && document.getElementById('nameInput')");
  await search('Hawk#7753');
  await waitFor("document.querySelector('#results .bungie-name')?.textContent === 'Hawk#7753' && window.__writes.length === 1");
  assert.deepEqual(await evaluate('window.__writes[0]'), { name: 'enqueue_guardian', args: { p_membership_id: 'hawk', p_membership_type: 1 } });
  assert.match(await evaluate("document.getElementById('index-status').textContent"), /8 indexed Guardians; 2 waiting/);
  assert.match(await evaluate("document.getElementById('index-status').textContent"), /7 updated in 24 hours; 3 due/);
  assert.equal(apiCalls.filter(url => url.includes('/User/Search/')).length, 0, 'Full names never use prefix search');
  assert.equal(await evaluate("document.querySelectorAll('#results .character-section img').length"), 3);
  assert.equal(await evaluate('window.__intervals.size'), 1, 'Only one weekly-reset timer remains active');
  await waitFor("document.querySelector('.clan-summary').textContent.includes('<script>Clan</script>')");
  assert.equal(await evaluate("document.querySelector('.clan-summary script')"), null);
  assert.ok(apiCalls.some(url => url.includes('components=100,104,200,202,204,205,300,304,305,800,900,1100')));
  async function openSection(id, condition) {
    await evaluate(`document.querySelector('[data-section="${id}"]').click()`);
    await waitFor(condition);
    const overflow = await evaluate('document.documentElement.scrollWidth - window.innerWidth');
    assert.ok(overflow <= 1, `${id} overflow: ${overflow}px`);
  }
  await openSection('characters', "document.querySelector('#report-characters').textContent.includes('Test Rifle')");
  await evaluate("document.querySelector('.gear-perks').click()");
  await waitFor("document.querySelector('.perk-list').textContent.includes('Test Perk')");
  await openSection('career', "document.querySelector('#report-career').textContent.includes('60%')");
  await evaluate("document.querySelector('.load-mode').click()");
  await waitFor("document.querySelector('.mode-result').textContent.includes('15')");
  await openSection('activities', "document.querySelectorAll('.match-open').length === 25");
  await evaluate("document.querySelector('.history-more').click()");
  await waitFor("document.querySelector('.history-more').textContent === 'Retry incomplete page' && !document.querySelector('.history-more').disabled");
  assert.equal(await evaluate("document.querySelectorAll('.match-open').length"), 26);
  await evaluate("document.querySelector('.history-more').click()");
  await waitFor("document.querySelector('.history-more').hidden");
  assert.equal(await evaluate("document.querySelectorAll('.match-open').length"), 26, 'Retried pages do not duplicate shared matches');
  assert.ok(apiCalls.filter(url => url.includes('/Character/1/Stats/Activities/') && url.includes('page=1')).length >= 2);
  await evaluate("document.querySelector('.match-open').click()");
  await waitFor("document.querySelector('.match-result').textContent.includes('Teammate#0007')");
  await openSection('records', "document.querySelector('.catalogue-count')?.textContent.includes('31 matching')");
  assert.equal(await evaluate("document.querySelectorAll('#report-records .catalogue-item').length"), 24);
  assert.equal(await evaluate("document.querySelector('#report-records').textContent.includes('SECRET SOLUTION')"), false);
  await evaluate("document.querySelector('#report-records .catalogue-filter').value='titles'; document.querySelector('#report-records .catalogue-filter').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelectorAll('#report-records .catalogue-item').length"), 1);
  assert.ok(await evaluate("document.querySelector('#report-records').textContent.includes('Wayfarer')"));
  await openSection('collections', "document.querySelector('#report-collections').textContent.includes('Missing Ship')");
  await evaluate("document.querySelector('#report-collections input').value='exotic'; document.querySelector('#report-collections input').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelectorAll('#report-collections .catalogue-item').length"), 1);
  await openSection('progression', "document.querySelector('#report-progression').textContent.includes('Vanguard Reputation')");
  await evaluate("document.querySelector('.load-metrics').click()");
  await waitFor("document.querySelector('.metric-rows')?.textContent.includes('Raid completions')");
  await openSection('compare', "document.querySelector('.compare-form') != null");
  await evaluate("document.querySelector('.compare-form input').value = 'Rival#1234'; document.querySelector('.compare-form').requestSubmit()");
  await waitFor("document.querySelector('.comparison-result').textContent.includes('Rival#1234')");
  assert.equal(await evaluate('window.__writes.length'), 1, 'Comparison does not submit profile scores or queue extra accounts');
  await evaluate("window.__createObjectURL = URL.createObjectURL; URL.createObjectURL = blob => { window.__exportText = blob.text(); return window.__createObjectURL(blob); }; HTMLAnchorElement.prototype.click = function() {}; document.querySelector('#downloadRawBtn').click()");
  const exported = JSON.parse(await evaluate('window.__exportText'));
  assert.equal(exported.bungieName, 'Hawk#7753');
  assert.equal(exported.sections.activities.activities.length, 26);
  assert.equal(exported.sections.metrics[0].objectiveProgress.progress, 42);
  await evaluate("document.querySelector('[data-section=overview]').click()");
  await evaluate('window.scrollTo(0, 0)');
  const reportDesktop = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await mkdir(join(root, 'test-artifacts'), { recursive: true });
  await writeFile(join(root, 'test-artifacts', 'player-report.png'), Buffer.from(reportDesktop.data, 'base64'));
  await search('<img src=x onerror=window.__injected=true>#1234');
  await waitFor("document.querySelector('#results .bungie-name')?.textContent.includes('<img')");
  assert.equal(await evaluate('Boolean(window.__injected)'), false, 'Display names cannot inject HTML');
  await evaluate('window.__dbFail = true');
  await search('Offline#1234');
  await waitFor("document.querySelector('#results [role=status]')?.textContent.includes('could not be queued')");
  assert.equal(await evaluate("document.querySelector('#results .bungie-name').textContent"), 'Offline#1234');
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
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("document.querySelector('#suggestions').classList.remove('show')");
  await evaluate('window.scrollTo(0, 0)');
  const overflow = await evaluate('document.documentElement.scrollWidth - window.innerWidth');
  assert.ok(overflow <= 1, `Mobile horizontal overflow: ${overflow}px`);
  const artifactDir = join(root, 'test-artifacts');
  await mkdir(artifactDir, { recursive: true });
  const mobile = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifactDir, 'mobile.png'), Buffer.from(mobile.data, 'base64'));
  await openSection('activities', "document.querySelectorAll('.match-open').length === 25");
  await openSection('characters', "document.querySelector('#report-characters').textContent.includes('Test Rifle')");
  await openSection('records', "document.querySelector('#report-records .catalogue-count')?.textContent.includes('31 matching')");
  await cdp('Emulation.clearDeviceMetricsOverride');
  await cdp('Page.navigate', { url: `${origin}/leaderboards.html` });
  await waitFor("document.querySelectorAll('#highest-character-body tr a').length === 5");
  await evaluate("document.getElementById('toggleHighestCharacterBtn').click(); document.getElementById('toggleTimePlayedBtn').click()");
  assert.equal(await evaluate("document.querySelectorAll('#highest-character-body tr a').length"), 8);
  assert.equal(await evaluate("document.querySelectorAll('#time-played-body tr a').length"), 8);
  await evaluate("document.getElementById('leaderboardSearch').value='Hawk#7753'; document.getElementById('leaderboardSearchBtn').click()");
  assert.equal(await evaluate("document.querySelectorAll('tr.highlight').length"), 4);
  await evaluate("document.getElementById('toggleHighestCharacterBtn').click()");
  assert.equal(await evaluate("document.querySelectorAll('#highest-character-body tr a').length"), 5);
  const desktop = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifactDir, 'leaderboards.png'), Buffer.from(desktop.data, 'base64'));
  await evaluate("window.__indexMissing = true; import('./leaderboard.js').then(module => module.loadLeaderboards())");
  assert.match(await evaluate("document.getElementById('index-status').textContent"), /not enabled yet/);
  assert.equal(await evaluate("document.querySelectorAll('#highest-character-body tr a').length"), 5);
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  console.log('PASS: comprehensive report sections, equipment/perks, career/mode stats, history pagination/retries/deduplication, match reports, triumph/title/collection search, metrics/export, mobile, privacy/injection, stale searches, and leaderboards.');
} finally {
  socket?.close();
  browser.kill();
  await new Promise(resolve => server.close(resolve));
}

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
      single: async () => ({ data: { indexed_count: 8, tracked_count: 10, last_refreshed_at: '2026-11-18T12:00:00Z' }, error }),
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
          profileCollectibles: { data: { collectibles: { 1: { state: 0 }, 2: { state: 1 } } } }
        });
      } else if (url.includes('/Manifest/')) body = json({ jsonWorldComponentContentPaths: { en: { DestinySeasonDefinition: '/seasons.json' } } });
      else if (url.includes('/Settings/')) body = json({ destiny2CoreSettings: { currentSeasonHash: 1 } });
      else throw new Error(`Unexpected API request: ${url}`);
    } else if (url.endsWith('/seasons.json')) body = { 1: { displayProperties: { name: 'Test Season' }, seasonNumber: 1 } };
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
  assert.equal(apiCalls.filter(url => url.includes('/User/Search/')).length, 0, 'Full names never use prefix search');
  assert.equal(await evaluate("document.querySelectorAll('#results .character-section img').length"), 3);
  assert.equal(await evaluate('window.__intervals.size'), 1, 'Only one weekly-reset timer remains active');
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
  const overflow = await evaluate('document.documentElement.scrollWidth - window.innerWidth');
  assert.ok(overflow <= 1, `Mobile horizontal overflow: ${overflow}px`);
  const artifactDir = join(root, 'test-artifacts');
  await mkdir(artifactDir, { recursive: true });
  const mobile = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifactDir, 'mobile.png'), Buffer.from(mobile.data, 'base64'));
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
  console.log('PASS: exact account lookup, profile display, save failures, empty/missing accounts, stale searches, Enter key, mobile layout, leaderboard toggles and search.');
} finally {
  socket?.close();
  browser.kill();
  await new Promise(resolve => server.close(resolve));
}

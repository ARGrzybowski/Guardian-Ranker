import { test } from 'node:test';
import assert from 'node:assert/strict';

class Element extends EventTarget {
  children = []; style = {}; attributes = {}; textContent = ''; listeners = new Map();
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.listeners.set(name, (this.listeners.get(name) || 0) + 1); super.addEventListener(name, handler); }
}
const ids = ['leaderboard-body', 'guardian-rank-body', 'highest-character-body', 'time-played-body','account-rating-body',
  'toggleLeaderboardBtn', 'toggleGuardianRankBtn', 'toggleHighestCharacterBtn', 'toggleTimePlayedBtn','toggleAccountRatingBtn'];
const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
globalThis.document = Object.assign(new EventTarget(), {
  getElementById: id => elements[id], createElement: () => new Element()
});
const requests = [], reads = [];
let rows = [], queueError = null, queueAccepted = true, indexMissing = false;
globalThis.supabase = { createClient: () => ({
  rpc: async (name, args) => { requests.push({ name, args }); return { data: queueAccepted, error: queueError }; },
  from: table => ({
  select: fields => {
    const read = { table, fields, orders: [] };
    reads.push(read);
    const query = {
      order: (field, options) => { read.orders.push({ field, options }); return query; },
      range: async (start, end) => indexMissing && table === 'guardian_rankings'
        ? { data: null, error: { code: 'PGRST205' } }
        : { data: rows.slice(start, end + 1), error: null }
    };
    return query;
  }
}) }) };
const boards = await import('../leaderboard.js');
const { queueGuardian } = await import('../indexQueue.js');
await import('../highestCharacter.js');
await import('../timePlayed.js');

test('browser searches submit identities without any scores or names', async () => {
  await queueGuardian('1', 3);
  assert.deepEqual(requests.at(-1), { name: 'enqueue_guardian', args: { p_membership_id: '1', p_membership_type: 3 } });
});

test('queue admission limits are reported instead of falsely claiming success', async () => {
  queueAccepted = false;
  await assert.rejects(queueGuardian('1', 3), /queue is busy/);
  queueAccepted = true;
});

test('queue errors propagate separately from Bungie profile loading', async () => {
  queueError = new Error('Database offline');
  await assert.rejects(queueGuardian('1', 3), /Database offline/);
  queueError = null;
});

test('power reads the verified ranking view with correct column names', async () => {
  await boards.loadPowerLeaderboard();
  assert.equal(reads.at(-1).table, 'guardian_rankings');
  assert.match(reads.at(-1).fields, /class_type,light_level,last_refreshed_at/);
  assert.equal(reads.at(-1).orders[0].field, 'light_level');
});
test('account rating reads cloud-verified scores and links to the rating report', async () => {
  rows = [{ membership_id:'1',bungie_name:'Hawk#7753',account_rating:917.96856,rating_grade:'S+' }];
  await boards.loadAccountRatingLeaderboard();
  assert.equal(reads.at(-1).table,'guardian_rating_rankings');
  assert.equal(reads.at(-1).orders[0].field,'account_rating');
  const row=elements['account-rating-body'].children[0];
  assert.equal(row.children[2].textContent,'917.9 / 1,000');
  assert.match(row.children[1].children[0].href,/#rating$/);
});

test('each leaderboard toggle receives exactly one rendering handler', () => {
  document.dispatchEvent(new Event('DOMContentLoaded'));
  for (const id of ids.filter(id => id.startsWith('toggle'))) assert.equal(elements[id].listeners.get('click'), 1);
});

test('Show More includes players beyond the first Supabase page and stays expanded on refresh', async () => {
  rows = Array.from({ length: 1001 }, (_, i) => ({ membership_id: String(i), bungie_name: `Guardian${i}#1234`, triumph_score: 1001 - i }));
  await boards.loadLeaderboard();
  assert.equal(elements['leaderboard-body'].children.length, 5);
  elements.toggleLeaderboardBtn.dispatchEvent(new Event('click'));
  assert.equal(elements['leaderboard-body'].children.length, 1001);
  await boards.loadLeaderboard();
  assert.equal(elements['leaderboard-body'].children.length, 1001);
  assert.equal(elements.toggleLeaderboardBtn.attributes['aria-expanded'], 'true');
});

test('player names are assigned as text rather than HTML', async () => {
  rows = [{ membership_id: '1', bungie_name: '<img src=x onerror=alert(1)>#1234', triumph_score: 100 }];
  await boards.loadLeaderboard();
  const link = elements['leaderboard-body'].children[0].children[1].children[0];
  assert.equal(link.textContent, rows[0].bungie_name);
  assert.match(link.href, /%3Cimg/);
});

test('read-only legacy leaderboards remain usable until the migration is installed', async () => {
  indexMissing = true;
  await boards.loadPowerLeaderboard();
  assert.equal(reads.at(-1).table, 'highest_character');
  assert.match(reads.at(-1).fields, /class_type,light_level$/);
  indexMissing = false;
});

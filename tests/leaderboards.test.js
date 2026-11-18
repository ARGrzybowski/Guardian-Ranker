import { test } from 'node:test';
import assert from 'node:assert/strict';

class Element extends EventTarget {
  children = []; style = {}; attributes = {}; textContent = ''; listeners = new Map();
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.listeners.set(name, (this.listeners.get(name) || 0) + 1); super.addEventListener(name, handler); }
}
const ids = ['leaderboard-body', 'guardian-rank-body', 'highest-character-body', 'time-played-body',
  'toggleLeaderboardBtn', 'toggleGuardianRankBtn', 'toggleHighestCharacterBtn', 'toggleTimePlayedBtn'];
const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
globalThis.document = Object.assign(new EventTarget(), {
  getElementById: id => elements[id], createElement: () => new Element()
});
const writes = [], reads = [];
let rows = [], writeError = null;
globalThis.supabase = { createClient: () => ({ from: table => ({
  upsert: async (row, options) => { writes.push({ table, row, options }); return { data: null, error: writeError }; },
  select: fields => {
    const read = { table, fields, orders: [] };
    reads.push(read);
    const query = {
      order: (field, options) => { read.orders.push({ field, options }); return query; },
      range: async (start, end) => ({ data: rows.slice(start, end + 1), error: null })
    };
    return query;
  }
}) }) };
const boards = await import('../leaderboard.js');
const { upsertHighestCharacter } = await import('../highestCharacter.js');
await import('../timePlayed.js');

test('a successful Supabase v2 upsert with null data returns the accepted row', async () => {
  const saved = await boards.upsertPlayer({ membership_id: '1', bungie_name: 'Hawk#7753', triumph_score: 5 });
  assert.equal(saved.triumph_score, 5);
  assert.equal(writes.at(-1).options.onConflict, 'membership_id');
});

test('unavailable metrics are omitted instead of overwriting numeric columns', async () => {
  await boards.upsertPlayer({ membership_id: '1', bungie_name: 'Hawk#7753', guardian_rank: null });
  assert.equal('guardian_rank' in writes.at(-1).row, false);
});

test('database errors propagate so the profile can show a save failure separately', async () => {
  writeError = new Error('Database offline');
  await assert.rejects(boards.upsertPlayer({ membership_id: '1' }), /Database offline/);
  writeError = null;
});

test('power writes and reads agree on class_type and light_level', async () => {
  await upsertHighestCharacter({ membership_id: '1', character_class: 'Titan', character_light: 400 });
  assert.equal(writes.at(-1).row.class_type, 'Titan');
  assert.equal(writes.at(-1).row.light_level, 400);
  await boards.loadPowerLeaderboard();
  assert.match(reads.at(-1).fields, /class_type,light_level/);
  assert.equal(reads.at(-1).orders[0].field, 'light_level');
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

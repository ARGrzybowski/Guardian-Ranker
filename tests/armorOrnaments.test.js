import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildArmorOrnamentCatalog } from '../scripts/build-armor-ornament-catalog.mjs';
import { armorOrnamentEntries } from '../armorOrnamentsView.js';

test('armor review includes legacy and non-Collections ornaments and records source evidence', () => {
  const item = (name, itemTypeDisplayName, classType = 3) => ({
    displayProperties: { name }, itemTypeDisplayName, itemType: 19, itemSubType: 21, classType,
    inventory: { tierTypeName: 'Legendary' }
  });
  const inventory = {
    1: item('Test Mask', 'Hunter Universal Ornament'),
    2: item('Legacy reward', 'Armor Ornament', 2),
    3: item('Festival mask', 'Mask Ornament'),
    4: item('Weapon skin', 'Weapon Ornament'),
    5: item('Classified ornament', 'Titan Universal Ornament'),
    6: { ...item('Retired', 'Warlock Ornament'), blacklisted: true },
    10: { displayProperties: { name: 'Test bundle' }, itemTypeDisplayName: 'Package' },
    20: { displayProperties: { name: 'Legendary Marks' } }
  };
  const catalog = buildArmorOrnamentCatalog(inventory, {
    11: { itemHash: 1, sourceString: 'Source: Eververse' },
    12: { itemHash: 1, sourceString: 'Source: Activities' },
    13: { itemHash: 2, redacted: true, sourceString: 'Secret' }
  }, {
    10: { displayProperties: { name: 'Test bundle' }, itemList: [{ itemHash: 1, quantity: 1 }] },
    21: { itemList: [{ itemHash: 2, quantity: 1, currencies: [{ itemHash: 20, quantity: 2 }] }] }
  }, 'mock');
  assert.equal(catalog.reviewPrice, 1200);
  assert.deepEqual(catalog.items, [
    [1, [11, 12], 'Test Mask', 'Hunter', 'Legendary', ['Activities', 'Eververse'], ['Test bundle'], []],
    [2, [], 'Legacy reward', 'Warlock', 'Legendary', [], [], ['Legendary Marks']]
  ]);
  const profile = { profileCollectibles: { data: { collectibles: { 11: { state: 1 }, 12: { state: 1 } } } } };
  const entries = () => armorOrnamentEntries(catalog, profile);
  assert.deepEqual(entries().map(item => item.ownership), ['unconfirmed', 'missing']);
  profile.profileCollectibles.data.collectibles[12].state = 0;
  assert.deepEqual(entries().map(item => item.ownership), ['unconfirmed', 'owned']);
  delete profile.profileCollectibles.data;
  assert.deepEqual(entries().map(item => item.ownership), ['unconfirmed', 'unconfirmed']);
  assert.ok(entries().every(item => item.reviewPrice === 1200));
});

test('the published full-list snapshot contains all priced-catalog armor and unique item IDs', () => {
  const load = name => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
  const full = load('armorOrnamentCatalog.json');
  const eververse = load('eververseCatalog.json');
  const ids = new Set(full.items.map(item => item[0]));
  const eververseArmor = eververse.items.filter(item => item[3] === 'Armor ornaments');
  assert.equal(ids.size, full.items.length);
  assert.equal(full.reviewPrice, 1200);
  assert.ok(ids.size > eververseArmor.length);
  assert.ok(eververseArmor.every(item => ids.has(item[0])));
  assert.ok(full.items.some(item => !item[1].length), 'Preserve public ornaments without collectible hashes');
  assert.ok(full.items.some(item => item[7].includes('Legendary Mark') || item[7].includes('Legendary Marks')),
    'Preserve in-game cost evidence for review');
});

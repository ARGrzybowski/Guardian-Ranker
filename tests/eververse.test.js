import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEververseCatalog } from '../scripts/build-eververse-catalog.mjs';
import { EMOTE_PLUG_SET, eververseCollection, valueEververseCollection } from '../eververseValue.js';

const collectible = (itemHash, sourceString = 'Source: Eververse') => ({ itemHash, sourceString, displayProperties: { name: `Cosmetic ${itemHash}` } });
const offer = (itemHash, quantity, currency = 2817410917) => ({ itemHash, quantity: 1, currencies: [{ itemHash: currency, quantity }] });

test('catalog only values cosmetics explicitly sourced to Eververse with single-item direct offers', () => {
  const catalog = buildEververseCatalog({
    storefront: { itemList: [offer(101, 1800), offer(101, 1200), offer(102, 700), offer(103, 450), offer(104, 400), offer(105, 600, 3147280338),
      { ...offer(106, 600), currencies: [{ itemHash: 2817410917, quantity: 600 }, { itemHash: 77, quantity: 1 }] },
      { ...offer(107, 500), quantity: 5 },
      { ...offer(108, 600), currencies: [{ itemHash: 2817410917, quantity: 600, hasConditionalVisibility: true }] }] },
    hidden: { redacted: true, itemList: [offer(101, 1)] }
  }, {
    1: collectible(101), 2: collectible(101), 3: collectible(102, 'Source: Vault of Glass raid'),
    4: collectible(103), 5: collectible(104), 6: collectible(104, 'Source: Unlocked by a special offer.'),
    7: collectible(105), 8: collectible(106), 9: collectible(107), 10: collectible(108)
  }, {
    101: { itemType: 19, itemSubType: 20 }, 102: { itemType: 22 }, 103: { itemType: 2 }, 104: { itemType: 21 },
    105: { itemType: 24 }, 106: { itemType: 29 }, 107: { itemType: 21 }, 108: { itemType: 21 }
  }, { manifestVersion: 'mock' });
  assert.equal(catalog.pricedCount, 1);
  assert.deepEqual(catalog.items.map(([item, hashes, , category, price]) => [item, hashes, category, price]), [
    [101, [1, 2], 'Shaders', 1200], [105, [7], 'Ghost shells', null], [106, [8], 'Finishers', null], [107, [9], 'Ships', null], [108, [10], 'Ships', null]
  ]);
});

test('values an owned cosmetic once across collectible aliases and character scopes', () => {
  const collection = eververseCollection({
    characters: { data: { a: {}, b: {} } },
    profileCollectibles: { data: { collectibles: { 1: { state: 16 }, 3: { state: 1 }, 4: { state: 2 }, 5: { state: 4 }, 6: {}, 7: { state: '0' } } } },
    characterCollectibles: { data: { a: { collectibles: { 1: { state: 1 }, 2: { state: 0 }, 8: { state: 8 } } } } }
  });
  assert.deepEqual([...collection.owned], [1, 2, 8]);
  const value = valueEververseCollection(collection, {
    manifestVersion: 'mock', pricedCount: 2,
    items: [[101, [1, 2], 'Shader', 'Shaders', 300], [102, [8], 'Ship', 'Ships', null], [103, [3, 4, 5, 6, 7], 'Vehicle', 'Vehicles', 2200]]
  });
  assert.equal(value.collectionCoverage, 'partial');
  assert.equal(value.brightDust, 300);
  assert.equal(value.pricedCount, 1);
  assert.equal(value.unpricedCount, 1);
  assert.deepEqual(value.categories.map(row => [row.category, row.priced, row.owned]), [['Shaders', 1, 1], ['Ships', 0, 1]]);
});

test('distinguishes private collections, zero verified unlocks, and owned items without prices', () => {
  assert.equal(eververseCollection({ profileCollectibles: { privacy: 2 } }), null);
  const catalog = { items: [[101, [1], 'Ship', 'Ships', null]] };
  const value = (hashes, partial = false) => valueEververseCollection({ owned: new Set(hashes), partial }, catalog);
  assert.equal(value([], false).brightDust, 0);
  assert.equal(value([], true).brightDust, null);
  assert.equal(value([1]).brightDust, null);
});

test('published pricing snapshot has valid, unique item and collectible identifiers', () => {
  const catalog = JSON.parse(readFileSync(new URL('../eververseCatalog.json', import.meta.url), 'utf8'));
  assert.equal(catalog.schemaVersion, 4);
  assert.equal(catalog.emotePlugSetHash, EMOTE_PLUG_SET);
  assert.ok(catalog.manifestVersion);
  assert.ok(catalog.pricedCount > 0);
  assert.ok(catalog.items.some(row => row[3] === 'Armor ornaments' && row[5]), 'Verified set prices reach individual ornaments');
  assert.ok(catalog.items.some(row => row[3] === 'Armor ornaments' && row[6] && row[4] === 1200));
  assert.ok(catalog.items.some(row => row[3] === 'Armor ornaments' && row[6] && row[4] === 1500));
  assert.equal(catalog.items.find(row => row[2] === 'N7 Helm')[4], null, 'The Mass Effect collaboration has no inferred price');
  assert.ok(catalog.items.some(row => row[3] === 'Ghost projections' && row[4] > 0));
  assert.ok(catalog.items.some(row => row[3] === 'Emotes' && row[1].length === 0 && row[4] > 0));
  assert.equal(catalog.items.filter(row => row[4] !== null).length, catalog.pricedCount);
  assert.equal(new Set(catalog.items.map(row => row[0])).size, catalog.items.length);
  const hashes = catalog.items.flatMap(row => row[1]);
  assert.equal(new Set(hashes).size, hashes.length);
  for (const [item, collectibles, name, category, dust] of catalog.items) {
    assert.ok(Number.isSafeInteger(item) && (collectibles.length || category === 'Emotes') && collectibles.every(Number.isSafeInteger));
    assert.ok(name && category && (dust === null || (Number.isSafeInteger(dust) && dust > 0)));
  }
});

test('emotes require an exact wheel item and direct Eververse offer, and count once across ownership sources', () => {
  const ids = [101, 102, 103, 104, 105, 106];
  const inventory = Object.fromEntries(ids.map(id => [id, {
    itemType: 19, itemTypeDisplayName: 'Emote', displayProperties: { name: `Emote ${id}` }
  }]));
  const catalog = buildEververseCatalog({
    2184482416: { itemList: [offer(101, 700), offer(102, 400), offer(103, 600), offer(104, 800), offer(106, 500, 3147280338)] },
    other: { itemList: [offer(101, 100), offer(105, 200)] }
  }, {
    2: collectible(102, 'Source: Bright Engrams'),
    3: collectible(103, 'Source: Complete activities in the Crucible.')
  }, inventory, {}, { [EMOTE_PLUG_SET]: { reusablePlugItems: [101, 102, 103, 105, 106].map(plugItemHash => ({ plugItemHash })) } });
  assert.deepEqual(catalog.items.map(row => [row[0], row[1], row[4]]), [[101, [], 700], [102, [2], 400]]);

  const profile = {
    profileCollectibles: { data: { collectibles: { 2: { state: 0 } } } },
    profilePlugSets: { data: { plugs: {
      [EMOTE_PLUG_SET]: [
        { plugItemHash: 101, canInsert: true, enabled: false },
        { plugItemHash: 102, canInsert: true, enabled: true }
      ],
      1: [{ plugItemHash: 101, canInsert: true, enabled: true }]
    } } }
  };
  let value = valueEververseCollection(eververseCollection(profile), catalog);
  assert.equal(value.brightDust, 400, 'The disabled emote and the unrelated set do not prove an unlock');
  profile.profilePlugSets.data.plugs[EMOTE_PLUG_SET][0].enabled = true;
  value = valueEververseCollection(eververseCollection(profile), catalog);
  assert.equal(value.brightDust, 1100);
  assert.equal(value.ownedCount, 2, 'The Collections alias and wheel unlock count once');
  delete profile.profilePlugSets;
  assert.equal(valueEververseCollection(eververseCollection(profile), catalog).emoteCoverage, 'unavailable');
});

test('an eligible five-piece ornament set contributes each owned share once and honors a cheaper individual offer', () => {
  const sale = (itemHash, quantity) => ({ itemHash, quantity: 1, currencies: [{ itemHash: 2817410917, quantity }] });
  const members = [1, 2, 3, 4, 5].map(itemHash => ({ itemHash, quantity: 1 }));
  const inventory = Object.fromEntries(members.map(({ itemHash }) => [itemHash, {
    itemType: 19, itemSubType: 21, itemTypeDisplayName: 'Hunter Universal Ornament', classType: 1
  }]));
  inventory[20] = { itemTypeDisplayName: 'Package', displayProperties: { name: 'Hunter Set' } };
  const collectibles = Object.fromEntries(members.map(({ itemHash }) => [itemHash, {
    itemHash, sourceString: 'Source: Eververse', displayProperties: { name: `Piece ${itemHash}` }
  }]));
  collectibles[9] = { ...collectibles[1] };
  const vendors = {
    10: { itemList: [sale(20, 6000), sale(2, 900), sale(3, 1600)] },
    20: { displayProperties: { name: 'Hunter Set' }, itemList: members }
  };
  let catalog = buildEververseCatalog(vendors, collectibles, inventory, {});
  const value = valueEververseCollection({ owned: new Set([1, 2, 3, 9]), partial: false }, catalog);
  assert.equal(value.brightDust, 3300);
  assert.equal(value.items.length, 3);
  assert.equal(value.items.find(item => item.itemHash === 3).ornamentSet, 'Hunter Set');
  assert.equal(value.items.find(item => item.itemHash === 2).ornamentSet, undefined);
  collectibles[4].sourceString = 'Source: Season Pass Reward';
  catalog = buildEververseCatalog(vendors, collectibles, inventory, {});
  assert.equal(catalog.items.find(row => row[0] === 1)[4], null, 'Mixed-source sets do not assign a per-piece price');
  assert.ok(!catalog.items.some(row => row[0] === 4));
});

test('standard armor estimates fill gaps and never substitute for marked collaborations, shared unlocks, or gameplay awards', () => {
  const legendary = { itemType: 19, itemSubType: 21, itemTypeDisplayName: 'Hunter Universal Ornament', inventory: { tierType: 5 } };
  const exotic = { ...legendary, itemTypeDisplayName: 'Hunter Ornament', inventory: { tierType: 6 } };
  const partner = { tooltipNotifications: [{ displayString: 'Inspired by lore and legends from a distant universe!' }] };
  const pack = { itemTypeDisplayName: 'Package', displayProperties: { name: 'Partner Pack' }, ...partner };
  const inventory = {
    101: legendary, 102: exotic, 103: { ...legendary, ...partner }, 104: legendary, 105: exotic,
    106: { ...legendary, tooltipNotifications: [{ displayString: 'Ornament is available for all classes once acquired.' }] },
    107: legendary, 108: { ...legendary, ...partner }, 200: pack
  };
  const catalog = buildEververseCatalog({
    tess: { itemList: [offer(105, 1650), offer(108, 2000)] },
    200: { displayProperties: pack.displayProperties, itemList: [{ itemHash: 104, quantity: 1 }] }
  }, Object.fromEntries(Object.keys(inventory).filter(id => id !== '200').map(id =>
    [id, collectible(Number(id), id === '107' ? 'Source: Season Pass Reward' : undefined)])), inventory, {});
  assert.deepEqual(catalog.items.map(row => [row[0], row[4], row[6] || false]), [
    [101, 1200, true], [102, 1500, true], [103, null, false], [104, null, false],
    [105, 1650, false], [106, null, false], [108, 2000, false]
  ]);
  const value = valueEververseCollection({ owned: new Set([101, 102, 103]), partial: false }, catalog);
  assert.equal(value.brightDust, 2700);
  assert.equal(value.standardArmorEstimateCount, 2);
  assert.equal(value.unpricedCount, 1);
});

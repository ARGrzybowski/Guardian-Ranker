import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEververseCatalog } from '../scripts/build-eververse-catalog.mjs';
import { eververseCollection, valueEververseCollection } from '../eververseValue.js';

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
  assert.equal(catalog.schemaVersion, 1);
  assert.ok(catalog.manifestVersion);
  assert.ok(catalog.pricedCount > 0);
  assert.equal(catalog.items.filter(row => row[4] !== null).length, catalog.pricedCount);
  assert.equal(new Set(catalog.items.map(row => row[0])).size, catalog.items.length);
  const hashes = catalog.items.flatMap(row => row[1]);
  assert.equal(new Set(hashes).size, hashes.length);
  for (const [item, collectibles, name, category, dust] of catalog.items) {
    assert.ok(Number.isSafeInteger(item) && collectibles.length && collectibles.every(Number.isSafeInteger));
    assert.ok(name && category && (dust === null || (Number.isSafeInteger(dust) && dust > 0)));
  }
});

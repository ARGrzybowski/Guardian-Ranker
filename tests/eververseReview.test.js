import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { addPriceSuggestions, importPriceDecisions, priceReviewQueue, reviewItems } from '../eververseReviewData.js';

test('every catalog row has an icon and each individual or bundle price has matching manifest evidence', () => {
  const read = name => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
  const catalog = read('eververseCatalog.json');
  const metadata = read('eververseReviewMetadata.json');
  const items = reviewItems(catalog, metadata);
  assert.equal(metadata.manifestVersion, catalog.manifestVersion);
  assert.equal(items.length, catalog.items.length);
  assert.equal(metadata.rows.length, items.length);
  const hasDustPrice = (offers, price) => offers.some(offer => offer.currency === 'Bright Dust' && offer.amount === price);
  for (const item of items) {
    assert.ok(item.icon?.startsWith('/common/'), item.name);
    if (item.basis === 'individual') assert.ok(hasDustPrice(item.offers, item.price), item.name);
    if (item.basis === 'bundle') assert.ok(item.bundles.some(bundle =>
      bundle.name === item.set && hasDustPrice(bundle.offers, item.price * 5)), item.name);
  }
  const suggestions = addPriceSuggestions(items);
  assert.ok(suggestions.filter(item => item.basis === 'unpriced' && item.proposedPrice != null).every(item =>
    item.price === null && item.proposedPrice > 0 && item.proposalBasis));
});

test('review imports retain notes and require the current catalog price and pricing basis', () => {
  const catalog = { items: [[1, [], 'Ornament', 'Armor ornaments', 1200, null, true], [2, [], 'Shell', 'Ghost shells', null]] };
  const [armor, shell] = reviewItems(catalog, null);
  const items = new Map([[1, armor], [2, shell]]);
  const input = { schemaVersion: 1, decisions: [
    { itemHash: 1, signature: armor.signature, status: 'flagged', note: 'Check historical rate', suggestedPrice: 1600 },
    { itemHash: 2, signature: '[1500,"individual",null]', status: 'confirmed' },
    { itemHash: 3, signature: armor.signature, status: 'confirmed' }
  ] };
  const result = importPriceDecisions(input, items);
  assert.equal(result.skipped, 2);
  assert.deepEqual([...result.decisions.values()], [{ ...input.decisions[0], confirmedPrice: null }]);
  const changed = reviewItems({ items: [[1, [], 'Ornament', 'Armor ornaments', 1200]] }, null)[0];
  assert.equal(importPriceDecisions(input, new Map([[1, changed]])).decisions.size, 0);
  assert.throws(() => importPriceDecisions({}, items), /review export/);
});

test('imports preserve the confirmed proposal and can read older priced confirmations', () => {
  const [shell, shader] = reviewItems({ items: [[1, [], 'Shell', 'Ghost shells', null], [2, [], 'Shader', 'Shaders', 300]] }, null);
  const decisions = [
    { itemHash: 1, signature: shell.signature, status: 'confirmed', suggestedPrice: 400 },
    { itemHash: 2, signature: shader.signature, status: 'confirmed' }
  ];
  const result = importPriceDecisions({ schemaVersion: 1, decisions }, new Map([[1, shell], [2, shader]]));
  assert.equal(result.decisions.get(1).confirmedPrice, 400);
  assert.equal(result.decisions.get(2).confirmedPrice, 300);
});

test('the review queue prioritizes uncertain prices and retains items the reviewer flagged', () => {
  const items = reviewItems({ items: [
    [1, [], 'Fixture', 'Armor ornaments', 1200, null, true],
    [2, [], 'Fixture', 'Armor ornaments', 1200],
    [3, [], 'Fixture', 'Armor ornaments', 1600, null, 'collaboration'],
    [4, [], 'Fixture', 'Armor ornaments', null],
    [5, [], 'Fixture', 'Armor ornaments', 1200, 'Verified Bundle'],
    [6, [], 'Fixture', 'Armor ornaments', 1200]
  ] }, null);
  const decisions = new Map([[2, { status: 'flagged' }], [6, { status: 'confirmed' }]]);
  assert.deepEqual(priceReviewQueue(items, decisions).map(item => item.hash), [4, 3, 1, 2]);
});

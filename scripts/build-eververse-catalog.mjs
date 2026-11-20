import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { EMOTE_PLUG_SET, EVERVERSE_CATALOG_VERSION } from '../eververseValue.js';

const BUNGIE = 'https://www.bungie.net';
const BRIGHT_DUST = 2817410917;
const LEGENDARY_MARK = 402110270;
const EVERVERSE_SOURCE = 'Source: Eververse';
// Tess and the manifest's Eververse Ghost Projection rotation.
const PROJECTION_VENDORS = new Set(['3361454721', '1446296883']);
// Tess and the two Eververse emote rotations for the profile emote wheel.
const EMOTE_VENDORS = new Set(['3361454721', '2184482416', '3118972542']);
const COSMETIC_TYPES = new Map([[14, 'Emblems'], [21, 'Ships'], [22, 'Vehicles'], [23, 'Emotes'], [24, 'Ghost shells'], [29, 'Finishers']]);
const COSMETIC_MODS = new Map([['Ghost Projection', 'Ghost projections'], ['Transmat Effect', 'Transmat effects'], ['Emote', 'Emotes'], ['Multiplayer Emote', 'Emotes']]);
const ARMOR_TYPE = /^(Hunter|Titan|Warlock)( Universal)? Ornament$/;
const STANDARD_DUST = {
  // Legendary weapon ornaments use the historical retail rate. Today's
  // rotations retain the Exotic rate.
  'Weapon ornaments': { 5: 700, 6: 1250 },
  'Ghost shells': { 6: 2850 },
  Ships: { 6: 2000 },
  Vehicles: { 6: 2500 },
  Shaders: { 5: 300 },
  Finishers: { 5: 3250 },
  'Ghost projections': { 4: 1500, 5: 1500 },
  'Transmat effects': { 5: 450 }
};

function needsIndividualPrice(item) {
  // Bungie marks partner items and shared cross-class unlocks with these tooltips.
  return item.tooltipNotifications?.some(({ displayString }) =>
    /distant universe|available for all classes once acquired|partnership/i.test(displayString));
}

function standardDust(category, item) {
  const tier = item.inventory?.tierType;
  if (category === 'Armor ornaments') {
    const type = ARMOR_TYPE.exec(item.itemTypeDisplayName);
    if (type?.[2] && tier === 5) return 1200;
    if (type && !type[2] && tier === 6) return 1500;
  }
  if (category === 'Emotes') {
    if (item.itemTypeDisplayName === 'Multiplayer Emote') return ({ 5: 1250, 6: 4250 })[tier] ?? null;
    if (item.itemTypeDisplayName === 'Emote') return ({ 4: 400, 5: 700, 6: 3250 })[tier] ?? null;
  }
  return STANDARD_DUST[category]?.[tier] ?? null;
}

function cosmeticCategory(item) {
  if (item?.itemTypeDisplayName === 'Mask Ornament') return null;
  if (item?.itemType !== 19) return COSMETIC_TYPES.get(item?.itemType);
  if (item.itemSubType === 20) return 'Shaders';
  if (item.itemSubType === 21) {
    if (item.itemTypeDisplayName === 'Weapon Ornament') return 'Weapon ornaments';
    return 'Armor ornaments';
  }
  return COSMETIC_MODS.get(item.itemTypeDisplayName);
}

export function buildEververseCatalog(vendors, collectibles, inventory, metadata, plugSets = {}) {
  const prices = new Map();
  const storeProjections = new Set();
  const emotePrices = new Map();
  const gameplayRewards = new Set();
  const wheel = new Set((plugSets[EMOTE_PLUG_SET]?.reusablePlugItems || []).map(plug => plug.plugItemHash));
  // Bungie also lists rotation pools as unnamed vendors. We require independent
  // Eververse provenance from Collections before accepting any price.
  for (const [vendorHash, vendor] of Object.entries(vendors)) {
    if (vendor.redacted || vendor.blacklisted) continue;
    for (const sale of vendor.itemList || []) {
      if (sale.quantity !== 1 || sale.currencies?.length !== 1) continue;
      const cost = sale.currencies[0];
      if (!Number.isSafeInteger(cost.quantity) || cost.quantity <= 0 || cost.scalarDenominator || cost.hasConditionalVisibility) continue;
      if (cost.itemHash === LEGENDARY_MARK) gameplayRewards.add(sale.itemHash);
      if (cost.itemHash !== BRIGHT_DUST) continue;
      prices.set(sale.itemHash, Math.min(prices.get(sale.itemHash) ?? Infinity, cost.quantity));
      if (PROJECTION_VENDORS.has(vendorHash)) storeProjections.add(sale.itemHash);
      if (EMOTE_VENDORS.has(vendorHash) && wheel.has(sale.itemHash) && cosmeticCategory(inventory[sale.itemHash]) === 'Emotes') {
        emotePrices.set(sale.itemHash, Math.min(emotePrices.get(sale.itemHash) ?? Infinity, cost.quantity));
      }
    }
  }

  const byItem = new Map();
  const excludedEmotes = new Set();
  for (const [hash, collectible] of Object.entries(collectibles)) {
    const item = inventory[collectible.itemHash];
    const category = cosmeticCategory(item);
    const name = collectible.displayProperties?.name?.trim();
    const source = collectible.sourceString?.trim();
    const storeEmote = emotePrices.has(collectible.itemHash);
    const eligibleEmoteSource = !source || source === EVERVERSE_SOURCE || source === 'Source: Bright Engrams';
    if (storeEmote && (collectible.redacted || !eligibleEmoteSource)) excludedEmotes.add(collectible.itemHash);
    if (!category || !name || gameplayRewards.has(collectible.itemHash) || collectible.redacted ||
        item.redacted || item.blacklisted || /^Classified\b/i.test(name)) continue;
    const row = byItem.get(collectible.itemHash) ?? { hashes: [], category, name, eververseOnly: true };
    row.eververseOnly &&= source === EVERVERSE_SOURCE ||
      (!source && category === 'Ghost projections' && storeProjections.has(collectible.itemHash)) ||
      (storeEmote && eligibleEmoteSource);
    row.hashes.push(Number(hash));
    byItem.set(collectible.itemHash, row);
  }
  for (const hash of emotePrices.keys()) {
    if (excludedEmotes.has(hash) || gameplayRewards.has(hash)) {
      byItem.delete(hash);
      continue;
    }
    const item = inventory[hash];
    const name = item.displayProperties?.name?.trim();
    if (!byItem.has(hash) && name && !item.redacted && !item.blacklisted && !/^Classified\b/i.test(name)) {
      byItem.set(hash, { hashes: [], category: 'Emotes', name, eververseOnly: true });
    }
  }

  const setShares = new Map();
  const requiresOffer = new Set();
  for (const [hash, preview] of Object.entries(vendors)) {
    const bundle = inventory[hash];
    const name = bundle?.displayProperties?.name?.trim();
    // These offers have an exact same-hash Bungie preview vendor. Count only
    // full five-piece universal armor sets with verified Eververse provenance.
    if (bundle?.itemTypeDisplayName !== 'Package' || bundle.redacted || !name ||
        preview?.redacted || preview?.blacklisted || preview?.displayProperties?.name?.trim() !== name) continue;
    const members = preview.itemList || [];
    if (needsIndividualPrice(bundle)) for (const { itemHash } of members) requiresOffer.add(itemHash);
    const price = prices.get(Number(hash));
    if (price === undefined) continue;
    if (members.length !== 5 || price % members.length || new Set(members.map(item => item.itemHash)).size !== members.length) continue;
    if (!members.every(({ itemHash, quantity }) => quantity === 1 && byItem.get(itemHash)?.eververseOnly &&
        byItem.get(itemHash).category === 'Armor ornaments' && / Universal Ornament$/.test(inventory[itemHash].itemTypeDisplayName) &&
        inventory[itemHash].classType === inventory[members[0].itemHash].classType)) continue;
    const share = price / members.length;
    for (const { itemHash } of members) {
      const previous = setShares.get(itemHash);
      if (!previous || share < previous.price || (share === previous.price && name < previous.name)) setShares.set(itemHash, { price: share, name });
    }
  }

  const items = [...byItem].filter(([, row]) => row.eververseOnly)
    .sort(([a], [b]) => a - b)
    .map(([hash, row]) => {
      const direct = emotePrices.get(hash) ?? prices.get(hash);
      const set = setShares.get(hash);
      const base = [hash, row.hashes.sort((a, b) => a - b), row.name, row.category];
      if (set && set.price < (direct ?? Infinity)) return [...base, set.price, set.name];
      if (direct !== undefined) return [...base, direct];
      const item = inventory[hash];
      const standard = !requiresOffer.has(hash) && !needsIndividualPrice(item) ? standardDust(row.category, item) : null;
      return standard === null ? [...base, null] : [...base, standard, null, true];
    });
  return { schemaVersion: EVERVERSE_CATALOG_VERSION, emotePlugSetHash: EMOTE_PLUG_SET, ...metadata,
    pricedCount: items.filter(row => row[4] !== null).length, items };
}

async function readJson(path) {
  if (!path?.startsWith('/common/destiny2_content/json/en/') && path !== '/Platform/Destiny2/Manifest/') throw new Error('Unexpected Bungie manifest path.');
  const url = new URL(path, BUNGIE);
  if (url.origin !== BUNGIE) throw new Error('Unexpected manifest host.');
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Bungie manifest request failed (${response.status}).`);
  return { data: await response.json(), modified: response.headers.get('last-modified') };
}

async function generate() {
  const { data: { Response: manifest } } = await readJson('/Platform/Destiny2/Manifest/');
  const paths = manifest?.jsonWorldComponentContentPaths?.en;
  if (!paths || !manifest.version) throw new Error('Bungie manifest is unavailable.');
  const [vendors, collectibles, inventory, plugSets] = await Promise.all([
    readJson(paths.DestinyVendorDefinition), readJson(paths.DestinyCollectibleDefinition), readJson(paths.DestinyInventoryItemLiteDefinition), readJson(paths.DestinyPlugSetDefinition)
  ]);
  if (inventory.data[BRIGHT_DUST]?.displayProperties?.name !== 'Bright Dust') throw new Error('Bright Dust currency could not be verified.');
  const catalog = buildEververseCatalog(vendors.data, collectibles.data, inventory.data, {
    manifestVersion: manifest.version,
    catalogDate: Number.isFinite(Date.parse(vendors.modified)) ? new Date(vendors.modified).toISOString().slice(0, 10) : null
  }, plugSets.data);
  if (!catalog.pricedCount || !catalog.items.some(row => row[3] === 'Emotes' && row[4] !== null)) {
    throw new Error('The Bungie manifest returned no compatible cosmetic or emote prices.');
  }
  const { items, ...header } = catalog;
  const json = `${JSON.stringify(header).slice(0, -1)},"items":[\n${items.map(row => JSON.stringify(row)).join(',\n')}\n]}\n`;
  await writeFile(new URL('../eververseCatalog.json', import.meta.url), json);
  console.log(`Catalog ${catalog.manifestVersion}: ${catalog.pricedCount} of ${items.length} priced; ${items.filter(row => row[6]).length} category estimates.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await generate();

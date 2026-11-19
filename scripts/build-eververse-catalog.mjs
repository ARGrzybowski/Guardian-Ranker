import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const BUNGIE = 'https://www.bungie.net';
const BRIGHT_DUST = 2817410917;
const EVERVERSE_SOURCE = 'Source: Eververse';
const COSMETIC_TYPES = new Map([[14, 'Emblems'], [21, 'Ships'], [22, 'Vehicles'], [23, 'Emotes'], [24, 'Ghost shells'], [29, 'Finishers']]);
const COSMETIC_MODS = new Map([['Ghost Projection', 'Ghost projections'], ['Transmat Effect', 'Transmat effects'], ['Emote', 'Emotes'], ['Multiplayer Emote', 'Emotes']]);

function cosmeticCategory(item) {
  if (item?.itemType !== 19) return COSMETIC_TYPES.get(item?.itemType);
  if (item.itemSubType === 20) return 'Shaders';
  if (item.itemSubType === 21) {
    if (item.itemTypeDisplayName === 'Weapon Ornament') return 'Weapon ornaments';
    if (item.itemTypeDisplayName === 'Mask Ornament') return 'Mask ornaments';
    return 'Armor ornaments';
  }
  return COSMETIC_MODS.get(item.itemTypeDisplayName);
}

export function buildEververseCatalog(vendors, collectibles, inventory, metadata) {
  const prices = new Map();
  // Bungie also lists rotation pools as unnamed vendors. We require independent
  // Eververse provenance from Collections before accepting any price.
  for (const vendor of Object.values(vendors)) {
    if (vendor.redacted || vendor.blacklisted) continue;
    for (const sale of vendor.itemList || []) {
      if (sale.quantity !== 1 || sale.currencies?.length !== 1) continue;
      const cost = sale.currencies[0];
      if (cost.itemHash !== BRIGHT_DUST || !Number.isSafeInteger(cost.quantity) || cost.quantity <= 0 || cost.scalarDenominator || cost.hasConditionalVisibility) continue;
      prices.set(sale.itemHash, Math.min(prices.get(sale.itemHash) ?? Infinity, cost.quantity));
    }
  }

  const byItem = new Map();
  for (const [hash, collectible] of Object.entries(collectibles)) {
    const item = inventory[collectible.itemHash];
    const category = cosmeticCategory(item);
    const name = collectible.displayProperties?.name?.trim();
    if (!category || !name || collectible.redacted || item.redacted || /^Classified\b/i.test(name)) continue;
    const row = byItem.get(collectible.itemHash) ?? { hashes: [], category, name, eververseOnly: true };
    row.eververseOnly &&= collectible.sourceString?.trim() === EVERVERSE_SOURCE;
    row.hashes.push(Number(hash));
    byItem.set(collectible.itemHash, row);
  }

  const items = [...byItem].filter(([, row]) => row.eververseOnly)
    .sort(([a], [b]) => a - b)
    .map(([hash, row]) => [hash, row.hashes.sort((a, b) => a - b), row.name, row.category, prices.get(hash) ?? null]);
  return { schemaVersion: 1, ...metadata, pricedCount: items.filter(row => row[4] !== null).length, items };
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
  const [vendors, collectibles, inventory] = await Promise.all([
    readJson(paths.DestinyVendorDefinition), readJson(paths.DestinyCollectibleDefinition), readJson(paths.DestinyInventoryItemLiteDefinition)
  ]);
  if (inventory.data[BRIGHT_DUST]?.displayProperties?.name !== 'Bright Dust') throw new Error('Bright Dust currency could not be verified.');
  const catalog = buildEververseCatalog(vendors.data, collectibles.data, inventory.data, {
    manifestVersion: manifest.version,
    catalogDate: Number.isFinite(Date.parse(vendors.modified)) ? new Date(vendors.modified).toISOString().slice(0, 10) : null
  });
  if (!catalog.pricedCount) throw new Error('The Bungie manifest returned no compatible prices.');
  const { items, ...header } = catalog;
  const json = `${JSON.stringify(header).slice(0, -1)},"items":[\n${items.map(row => JSON.stringify(row)).join(',\n')}\n]}\n`;
  await writeFile(new URL('../eververseCatalog.json', import.meta.url), json);
  console.log(`Catalog ${catalog.manifestVersion}: ${items.length} cosmetics, ${catalog.pricedCount} directly priced in Bright Dust.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await generate();

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readJson } from './build-eververse-catalog.mjs';

const ARMOR_ORNAMENT = /^(?:(Hunter|Titan|Warlock)(?: Universal)?|Armor) Ornament$/;
const CLASSES = ['Titan', 'Hunter', 'Warlock'];
const COLUMNS = ['itemHash', 'collectibleHashes', 'name', 'className', 'rarity', 'sources', 'bundles', 'offerCurrencies'];

export function buildArmorOrnamentCatalog(inventory, collectibles, vendors, manifestVersion) {
  const items = new Map();
  for (const [hash, item] of Object.entries(inventory)) {
    const name = item.displayProperties?.name?.trim();
    if (item.itemType !== 19 || item.itemSubType !== 21 || item.redacted || item.blacklisted ||
        !name || /^Classified\b/i.test(name)) continue;
    const type = ARMOR_ORNAMENT.exec(item.itemTypeDisplayName);
    if (!type) continue;
    const className = type[1] ?? CLASSES[item.classType] ?? 'Any class';
    items.set(Number(hash), {
      name, className, rarity: item.inventory?.tierTypeName ?? 'Unknown', hashes: [],
      sources: new Set(), bundles: new Set(), offerCurrencies: new Set()
    });
  }
  for (const [hash, collectible] of Object.entries(collectibles)) {
    const item = items.get(collectible.itemHash);
    if (!item || collectible.redacted) continue;
    item.hashes.push(Number(hash));
    const source = collectible.sourceString?.replace(/^Source:\s*/i, '').trim();
    if (source) item.sources.add(source);
  }
  for (const [hash, vendor] of Object.entries(vendors)) {
    if (vendor.redacted || vendor.blacklisted) continue;
    const pack = inventory[hash];
    const name = pack?.displayProperties?.name?.trim();
    const exactPreview = name && pack.itemTypeDisplayName === 'Package' && !pack.redacted && !pack.blacklisted &&
      vendor.displayProperties?.name?.trim() === name;
    for (const sale of vendor.itemList || []) {
      const item = items.get(sale.itemHash);
      if (!item || sale.quantity !== 1) continue;
      if (exactPreview) item.bundles.add(name);
      for (const cost of sale.currencies || []) {
        const currency = inventory[cost.itemHash]?.displayProperties?.name?.trim();
        if (currency && cost.quantity > 0) item.offerCurrencies.add(currency);
      }
    }
  }
  return {
    schemaVersion: 1, manifestVersion, reviewPrice: 1200, columns: COLUMNS,
    items: [...items].sort(([a], [b]) => a - b).map(([hash, item]) => [
      hash, item.hashes.sort((a, b) => a - b), item.name, item.className, item.rarity,
      [...item.sources].sort(), [...item.bundles].sort(), [...item.offerCurrencies].sort()
    ])
  };
}

async function generate() {
  const { data: { Response: manifest } } = await readJson('/Platform/Destiny2/Manifest/');
  const paths = manifest?.jsonWorldComponentContentPaths?.en;
  if (!paths || !manifest.version) throw new Error('Bungie manifest is unavailable.');
  const [inventory, collectibles, vendors] = await Promise.all([
    readJson(paths.DestinyInventoryItemLiteDefinition), readJson(paths.DestinyCollectibleDefinition), readJson(paths.DestinyVendorDefinition)
  ]);
  const catalog = buildArmorOrnamentCatalog(inventory.data, collectibles.data, vendors.data, manifest.version);
  if (!catalog.items.length) throw new Error('Bungie returned no compatible armor ornament definitions.');
  const { items, ...header } = catalog;
  const json = `${JSON.stringify(header).slice(0, -1)},"items":[\n${items.map(item => JSON.stringify(item)).join(',\n')}\n]}\n`;
  await writeFile(new URL('../armorOrnamentCatalog.json', import.meta.url), json);
  console.log(`Armor ornament catalog ${catalog.manifestVersion}: ${items.length} items, ${catalog.reviewPrice} Bright Dust review value per item.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await generate();

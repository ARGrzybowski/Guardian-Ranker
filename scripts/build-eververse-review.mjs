import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readJson } from './build-eververse-catalog.mjs';

const ICON_ROOT = '/common/destiny2_content/icons/';
const CLASSES = ['Titan', 'Hunter', 'Warlock'];

export function buildEververseReviewMetadata(catalog, inventory, collectibles, vendors) {
  const itemIds = new Set(catalog.items.map(row => row[0]));
  const labels = [];
  const labelIds = new Map();
  const label = text => {
    if (!labelIds.has(text)) {
      labelIds.set(text, labels.length);
      labels.push(text);
    }
    return labelIds.get(text);
  };
  const itemBundles = new Map();
  const listings = new Set(itemIds);
  for (const [key, vendor] of Object.entries(vendors)) {
    const pack = inventory[key];
    const name = pack?.displayProperties?.name?.trim();
    if (vendor.redacted || vendor.blacklisted || pack?.itemTypeDisplayName !== 'Package' || pack.redacted ||
        pack.blacklisted || !name || vendor.displayProperties?.name?.trim() !== name) continue;
    const hash = Number(key);
    for (const { itemHash } of vendor.itemList || []) {
      if (!itemIds.has(itemHash)) continue;
      if (!itemBundles.has(itemHash)) itemBundles.set(itemHash, new Set());
      itemBundles.get(itemHash).add(hash);
      listings.add(hash);
    }
  }
  const offers = new Map();
  for (const vendor of Object.values(vendors)) {
    if (vendor.redacted || vendor.blacklisted) continue;
    const name = vendor.displayProperties?.name?.trim() || 'Manifest rotation';
    for (const sale of vendor.itemList || []) {
      if (!listings.has(sale.itemHash) || sale.quantity !== 1 || sale.currencies?.length !== 1) continue;
      const cost = sale.currencies[0];
      if (!Number.isSafeInteger(cost.quantity) || cost.quantity <= 0 || cost.scalarDenominator || cost.hasConditionalVisibility) continue;
      const currency = inventory[cost.itemHash]?.displayProperties?.name?.trim() || `Currency ${cost.itemHash}`;
      if (!offers.has(sale.itemHash)) offers.set(sale.itemHash, new Map());
      const entry = [cost.quantity, label(currency), label(name)];
      offers.get(sale.itemHash).set(entry.join(','), entry);
    }
  }
  const bundles = {};
  const rows = catalog.items.map(([hash, aliases]) => {
    const item = inventory[hash];
    const icon = item?.displayProperties?.icon ?? '';
    const type = item?.itemTypeDisplayName ?? '';
    const rarity = item?.inventory?.tierTypeName ?? '';
    const className = /^(Hunter|Titan|Warlock)(?:\s|$)/.exec(type)?.[1] ?? CLASSES[item?.classType] ?? '';
    const sources = new Set();
    for (const id of aliases) {
      const source = collectibles[id]?.sourceString?.replace(/^Source:\s*/i, '').trim();
      if (source && !collectibles[id].redacted) sources.add(label(source));
    }
    const packIds = [...(itemBundles.get(hash) || [])];
    for (const id of packIds) {
      bundles[id] ??= [label(inventory[id].displayProperties.name.trim()), [...(offers.get(id)?.values() || [])]];
    }
    return [hash, icon.startsWith(ICON_ROOT) ? icon.slice(ICON_ROOT.length) : icon, label(rarity), label(type), label(className),
      [...sources], [...(offers.get(hash)?.values() || [])], packIds];
  });
  return { schemaVersion: 1, manifestVersion: catalog.manifestVersion, iconRoot: ICON_ROOT, labels, bundles, rows };
}

async function generate() {
  const catalog = JSON.parse(await readFile(new URL('../eververseCatalog.json', import.meta.url), 'utf8'));
  const { data: { Response: manifest } } = await readJson('/Platform/Destiny2/Manifest/');
  if (manifest?.version !== catalog.manifestVersion) throw new Error('Rebuild the Eververse catalog against the current Bungie manifest first.');
  const paths = manifest.jsonWorldComponentContentPaths.en;
  const [inventory, collectibles, vendors] = await Promise.all([
    readJson(paths.DestinyInventoryItemLiteDefinition), readJson(paths.DestinyCollectibleDefinition), readJson(paths.DestinyVendorDefinition)
  ]);
  const { rows, ...header } = buildEververseReviewMetadata(catalog, inventory.data, collectibles.data, vendors.data);
  const json = `${JSON.stringify(header).slice(0, -1)},"rows":[\n${rows.map(row => JSON.stringify(row)).join(',\n')}\n]}\n`;
  await writeFile(new URL('../eververseReviewMetadata.json', import.meta.url), json);
  console.log(`Review metadata for ${rows.length} items, including ${rows.filter(row => row[1]).length} icons.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await generate();

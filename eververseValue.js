const HIDDEN_OR_UNOWNED = 1 | 2 | 4;
export const EMOTE_PLUG_SET = 2860926541;
export const EVERVERSE_CATALOG_VERSION = 5;

function collectibleTable(scope) {
  const table = scope?.collectibles;
  return table && typeof table === 'object' && !Array.isArray(table) ? table : null;
}

export function eververseCollection(profile) {
  const profileTable = collectibleTable(profile.profileCollectibles?.data);
  const characters = profile.characterCollectibles?.data;
  const tables = [profileTable, ...Object.values(characters || {}).map(collectibleTable)].filter(Boolean);
  if (!tables.length) return null;

  const owned = new Set();
  for (const table of tables) {
    for (const [hash, entry] of Object.entries(table)) {
      const state = entry?.state;
      if (Number.isInteger(state) && state >= 0 && state <= 0x7fffffff && !(state & HIDDEN_OR_UNOWNED)) owned.add(Number(hash));
    }
  }
  const characterIds = Object.keys(profile.characters?.data || {});
  const partial = !profileTable || characterIds.some(id => !collectibleTable(characters?.[id]));
  const emotePlugs = profile.profilePlugSets?.data?.plugs?.[EMOTE_PLUG_SET];
  const emotes = Array.isArray(emotePlugs)
    ? new Set(emotePlugs.filter(plug => plug?.canInsert === true && plug.enabled === true).map(plug => plug.plugItemHash))
    : null;
  return { owned, partial, emotes };
}

export function valueEververseCollection({ owned, partial, emotes }, catalog) {
  const items = [];
  const categories = new Map();
  let brightDust = 0;
  let pricedCount = 0;
  let standardEstimateCount = 0;
  let standardArmorEstimateCount = 0;

  for (const [itemHash, collectibleHashes, name, category, price, ornamentSet, standardEstimate] of catalog.items) {
    if (!collectibleHashes.some(hash => owned.has(hash)) && !(category === 'Emotes' && emotes?.has(itemHash))) continue;
    const standardArmorEstimate = standardEstimate && category === 'Armor ornaments';
    items.push({ itemHash, name, category, brightDust: price, ...(ornamentSet ? { ornamentSet } : {}),
      ...(standardEstimate ? { standardEstimate } : {}), ...(standardArmorEstimate ? { standardArmorEstimate } : {}) });
    if (standardEstimate) standardEstimateCount++;
    if (standardArmorEstimate) standardArmorEstimateCount++;
    if (!categories.has(category)) categories.set(category, { category, owned: 0, priced: 0, estimated: 0, brightDust: 0 });
    const totals = categories.get(category);
    totals.owned++;
    if (standardEstimate || ornamentSet) totals.estimated++;
    if (price === null) continue;
    pricedCount++;
    brightDust += price;
    totals.priced++;
    totals.brightDust += price;
  }

  return {
    manifestVersion: catalog.manifestVersion,
    catalogVersion: catalog.schemaVersion,
    catalogDate: catalog.catalogDate,
    catalogPricedCount: catalog.pricedCount,
    collectionCoverage: partial ? 'partial' : 'public',
    emoteCoverage: emotes != null ? 'public' : 'unavailable',
    brightDust: !pricedCount && (partial || items.length || (catalog.emotePlugSetHash && emotes == null)) ? null : brightDust,
    ownedCount: items.length,
    pricedCount,
    standardEstimateCount,
    standardArmorEstimateCount,
    unpricedCount: items.length - pricedCount,
    categories: [...categories.values()].sort((a, b) => b.brightDust - a.brightDust || a.category.localeCompare(b.category)),
    items: items.sort((a, b) => (b.brightDust ?? 0) - (a.brightDust ?? 0) || a.name.localeCompare(b.name))
  };
}

let savedCatalog;
export async function loadEververseCatalog(signal) {
  if (savedCatalog) return savedCatalog;
  const response = await fetch(new URL('./eververseCatalog.json?v=5', import.meta.url), { signal });
  if (!response.ok) throw new Error('The Eververse price catalog could not be loaded.');
  const catalog = await response.json();
  signal.throwIfAborted();
  if (catalog.schemaVersion !== EVERVERSE_CATALOG_VERSION || catalog.emotePlugSetHash !== EMOTE_PLUG_SET ||
      !Array.isArray(catalog.items) || !catalog.pricedCount) {
    throw new Error('The Eververse price catalog is unavailable.');
  }
  savedCatalog = catalog;
  return catalog;
}

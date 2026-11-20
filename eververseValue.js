const NOT_ACQUIRED = 1;
const HIDDEN = 2 | 4;
export const EMOTE_PLUG_SET = 2860926541;
export const EVERVERSE_CATALOG_VERSION = 6;

function collectibleTable(scope) {
  const table = scope?.collectibles;
  return table && typeof table === 'object' && !Array.isArray(table) ? table : null;
}

function collectionTables(profile) {
  const profileTable = collectibleTable(profile.profileCollectibles?.data);
  const characters = profile.characterCollectibles?.data;
  return { profileTable, characters, tables: [profileTable, ...Object.values(characters || {}).map(collectibleTable)].filter(Boolean) };
}

function validState(state) {
  return Number.isInteger(state) && state >= 0 && state <= 0x7fffffff;
}

export function eververseCollection(profile) {
  const { profileTable, characters, tables } = collectionTables(profile);
  if (!tables.length) return null;

  const owned = new Set();
  for (const table of tables) {
    for (const [hash, entry] of Object.entries(table)) {
      const state = entry?.state;
      if (validState(state) && !(state & (HIDDEN | NOT_ACQUIRED))) owned.add(Number(hash));
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
  let collaborationEstimateCount = 0;

  for (const [itemHash, collectibleHashes, name, category, price, ornamentSet, estimate] of catalog.items) {
    if (!collectibleHashes.some(hash => owned.has(hash)) && !(category === 'Emotes' && emotes?.has(itemHash))) continue;
    const standardEstimate = estimate === true;
    const collaborationEstimate = estimate === 'collaboration';
    const standardArmorEstimate = standardEstimate && category === 'Armor ornaments';
    items.push({ itemHash, name, category, brightDust: price, ...(ornamentSet ? { ornamentSet } : {}),
      ...(standardEstimate ? { standardEstimate } : {}), ...(standardArmorEstimate ? { standardArmorEstimate } : {}),
      ...(collaborationEstimate ? { collaborationEstimate } : {}) });
    if (standardEstimate) standardEstimateCount++;
    if (standardArmorEstimate) standardArmorEstimateCount++;
    if (collaborationEstimate) collaborationEstimateCount++;
    if (!categories.has(category)) categories.set(category, { category, owned: 0, priced: 0, estimated: 0, brightDust: 0 });
    const totals = categories.get(category);
    totals.owned++;
    if (estimate || ornamentSet) totals.estimated++;
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
    collaborationEstimateCount,
    unpricedCount: items.length - pricedCount,
    categories: [...categories.values()].sort((a, b) => b.brightDust - a.brightDust || a.category.localeCompare(b.category)),
    items: items.sort((a, b) => (b.brightDust ?? 0) - (a.brightDust ?? 0) || a.name.localeCompare(b.name))
  };
}

// Collection coverage is display-only. An omitted or hidden state does not
// establish that the Guardian has missed an item.
export function eververseCatalogCoverage(profile, catalog, valuation) {
  const owned = new Set(valuation.items.map(item => item.itemHash));
  const missing = new Set();
  const hiddenAcquired = new Set();
  if (valuation.collectionCoverage === 'public') {
    for (const table of collectionTables(profile).tables) {
      for (const [hash, entry] of Object.entries(table)) {
        const state = entry?.state;
        if (!validState(state)) continue;
        if ((state & (HIDDEN | NOT_ACQUIRED)) === NOT_ACQUIRED) missing.add(Number(hash));
        if ((state & HIDDEN) && !(state & NOT_ACQUIRED)) hiddenAcquired.add(Number(hash));
      }
    }
  }

  const categories = new Map(valuation.categories.map(row => [row.category, {
    ...row, catalogTotal: 0, confirmedMissing: 0, unconfirmed: 0
  }]));
  for (const [itemHash, aliases, , category] of catalog.items) {
    if (!categories.has(category)) categories.set(category, {
      category, owned: 0, priced: 0, estimated: 0, brightDust: 0, catalogTotal: 0, confirmedMissing: 0, unconfirmed: 0
    });
    const row = categories.get(category);
    row.catalogTotal++;
    if (owned.has(itemHash)) continue;
    if (aliases.length && aliases.every(hash => missing.has(hash) && !hiddenAcquired.has(hash))) row.confirmedMissing++;
    else row.unconfirmed++;
  }
  return [...categories.values()].sort((a, b) => b.brightDust - a.brightDust || a.category.localeCompare(b.category));
}

let savedCatalog;
export async function loadEververseCatalog(signal) {
  if (savedCatalog) return savedCatalog;
  const response = await fetch(new URL(`./eververseCatalog.json?v=${EVERVERSE_CATALOG_VERSION}`, import.meta.url), { signal });
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

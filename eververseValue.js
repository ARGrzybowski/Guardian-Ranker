const NOT_ACQUIRED = 1;
const HIDDEN = 2 | 4;
export const EMOTE_PLUG_SET = 2860926541;
export const EVERVERSE_CATALOG_VERSION = 7;

function collectibleTable(scope) {
  const table = scope?.collectibles;
  return table && typeof table === 'object' && !Array.isArray(table) ? table : null;
}

function collectionTables(profile) {
  const profileTable = collectibleTable(profile.profileCollectibles?.data);
  const characters = profile.characterCollectibles?.data;
  const partial = !profileTable || Object.keys(profile.characters?.data || {}).some(id => !collectibleTable(characters?.[id]));
  return { partial, tables: [profileTable, ...Object.values(characters || {}).map(collectibleTable)].filter(Boolean) };
}

function validState(state) {
  return Number.isInteger(state) && state >= 0 && state <= 0x7fffffff;
}

export function eververseCollection(profile) {
  const { partial, tables } = collectionTables(profile);
  if (!tables.length) return null;

  const owned = new Set();
  for (const table of tables) {
    for (const [hash, entry] of Object.entries(table)) {
      const state = entry?.state;
      if (validState(state) && !(state & (HIDDEN | NOT_ACQUIRED))) owned.add(Number(hash));
    }
  }
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
  let approvedEstimateCount = 0;
  const sharedUnlocks = new Set();
  const sharedPrices = new Map();
  for (const [, , , , price, set, estimate, , sharedUnlock] of catalog.items) {
    if (!sharedUnlock || price == null) continue;
    const verified = !set && !estimate;
    const best = sharedPrices.get(sharedUnlock);
    if (!best || (verified && !best.verified) || (verified === best.verified && price < best.price)) {
      sharedPrices.set(sharedUnlock, { price, verified });
    }
  }

  for (const [itemHash, collectibleHashes, name, category, price, ornamentSet, estimate, approved, sharedUnlock] of catalog.items) {
    if (!collectibleHashes.some(hash => owned.has(hash)) && !(category === 'Emotes' && emotes?.has(itemHash))) continue;
    const standardEstimate = estimate === true;
    const collaborationEstimate = estimate === 'collaboration';
    const standardArmorEstimate = standardEstimate && category === 'Armor ornaments';
    const includedWithSharedUnlock = sharedUnlock && sharedUnlocks.has(sharedUnlock);
    if (sharedUnlock) sharedUnlocks.add(sharedUnlock);
    const value = includedWithSharedUnlock ? 0 : sharedPrices.get(sharedUnlock)?.price ?? price;
    items.push({ itemHash, name, category, brightDust: value, ...(ornamentSet ? { ornamentSet } : {}),
      ...(standardEstimate ? { standardEstimate } : {}), ...(standardArmorEstimate ? { standardArmorEstimate } : {}),
      ...(collaborationEstimate ? { collaborationEstimate } : {}), ...(approved ? { approvedEstimate: true } : {}),
      ...(includedWithSharedUnlock ? { includedWithSharedUnlock: true } : {}) });
    if (standardEstimate) standardEstimateCount++;
    if (standardArmorEstimate) standardArmorEstimateCount++;
    if (collaborationEstimate) collaborationEstimateCount++;
    if (approved) approvedEstimateCount++;
    if (!categories.has(category)) categories.set(category, { category, owned: 0, priced: 0, estimated: 0, brightDust: 0 });
    const totals = categories.get(category);
    totals.owned++;
    if (estimate || ornamentSet) totals.estimated++;
    if (value === null) continue;
    pricedCount++;
    brightDust += value;
    totals.priced++;
    totals.brightDust += value;
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
    approvedEstimateCount,
    unpricedCount: items.length - pricedCount,
    categories: [...categories.values()].sort((a, b) => b.brightDust - a.brightDust || a.category.localeCompare(b.category)),
    items: items.sort((a, b) => (b.brightDust ?? 0) - (a.brightDust ?? 0) || a.name.localeCompare(b.name))
  };
}

// Every alias needs a visible missing result. A hidden acquired result leaves
// conflicting evidence unresolved.
export function confirmedMissingCollectibles(profile) {
  const { partial, tables } = collectionTables(profile);
  const missing = new Set();
  if (partial) return missing;
  const hiddenAcquired = new Set();
  for (const table of tables) {
    for (const [hash, entry] of Object.entries(table)) {
      const state = entry?.state;
      if (!validState(state)) continue;
      if ((state & (HIDDEN | NOT_ACQUIRED)) === NOT_ACQUIRED) missing.add(Number(hash));
      if ((state & HIDDEN) && !(state & NOT_ACQUIRED)) hiddenAcquired.add(Number(hash));
    }
  }
  for (const hash of hiddenAcquired) missing.delete(hash);
  return missing;
}

export function eververseCatalogCoverage(profile, catalog, valuation) {
  const owned = new Set(valuation.items.map(item => item.itemHash));
  const missing = valuation.collectionCoverage === 'public' ? confirmedMissingCollectibles(profile) : new Set();
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
    if (aliases.length && aliases.every(hash => missing.has(hash))) row.confirmedMissing++;
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

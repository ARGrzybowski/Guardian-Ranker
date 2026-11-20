export const REVIEW_STATES = { unreviewed: 'Unreviewed', confirmed: 'Confirmed', flagged: 'Flagged for review' };
export const PRICE_BASES = {
  individual: 'Individual offer',
  bundle: 'Bundle share',
  standard: 'Standard estimate',
  collaboration: 'Collaboration estimate',
  unpriced: 'Unpriced'
};

const REVIEW_PRIORITY = { unpriced: 0, collaboration: 1, standard: 2 };

export function priceReviewQueue(items, decisions) {
  return items
    .filter(item => Object.hasOwn(REVIEW_PRIORITY, item.basis) || decisions.get(item.hash)?.status === 'flagged')
    .sort((a, b) => (REVIEW_PRIORITY[a.basis] ?? 3) - (REVIEW_PRIORITY[b.basis] ?? 3));
}

export function reviewItems(catalog, metadata) {
  const definitions = new Map(metadata?.rows?.map(([hash, ...fields]) => [hash, fields]) || []);
  const labels = metadata?.labels || [];
  function decodeOffers(rows) {
    return rows.map(([amount, currency, vendor]) => ({ amount, currency: labels[currency], vendor: labels[vendor] }));
  }
  return catalog.items.map(([hash, collectibleHashes, name, category, price, set, estimate]) => {
    const [path, rarity, type, className, sources = [], offers = [], bundles = []] = definitions.get(hash) || [];
    let basis = 'individual';
    if (price == null) basis = 'unpriced';
    else if (set) basis = 'bundle';
    else if (estimate === 'collaboration') basis = 'collaboration';
    else if (estimate === true) basis = 'standard';
    return {
      hash, collectibleHashes, name, category, price, set, basis, signature: JSON.stringify([price, basis, set ?? null]),
      icon: path && (path.startsWith('/') ? path : metadata.iconRoot + path),
      rarity: labels[rarity], type: labels[type], className: labels[className], sources: sources.map(source => labels[source]),
      offers: decodeOffers(offers), bundles: bundles.map(id => {
        const [title, prices] = metadata.bundles[id];
        return { name: labels[title], offers: decodeOffers(prices) };
      })
    };
  });
}

export function importPriceDecisions(input, itemsByHash) {
  if (input?.schemaVersion !== 1 || !Array.isArray(input.decisions)) throw new Error('Choose an Eververse review export.');
  const decisions = new Map();
  let skipped = 0;
  for (const entry of input.decisions) {
    const item = itemsByHash.get(entry?.itemHash);
    if (!item || entry.signature !== item.signature || !['confirmed', 'flagged'].includes(entry.status)) {
      skipped++;
      continue;
    }
    const suggestedPrice = Number.isSafeInteger(entry.suggestedPrice) && entry.suggestedPrice >= 0 ? entry.suggestedPrice : null;
    decisions.set(item.hash, { itemHash: item.hash, signature: item.signature, status: entry.status,
      note: typeof entry.note === 'string' ? entry.note.slice(0, 2000) : '', suggestedPrice });
  }
  return { decisions, skipped };
}

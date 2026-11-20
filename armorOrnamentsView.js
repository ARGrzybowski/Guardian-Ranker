import { escapeHtml as e } from './html.js';
import { confirmedMissingCollectibles, eververseCollection } from './eververseValue.js?v=8';
import { reportTable } from './reportTables.js';

const PAGE_SIZE = 30;
const OWNERSHIP = { owned: 'Owned', missing: 'Confirmed missing', unconfirmed: 'Unconfirmed' };
const number = new Intl.NumberFormat();
let savedCatalog;

async function loadCatalog(signal) {
  if (savedCatalog) return savedCatalog;
  const response = await fetch(new URL('./armorOrnamentCatalog.json?v=1', import.meta.url), { signal });
  if (!response.ok) throw new Error('The armor ornament catalog could not be downloaded.');
  const catalog = await response.json();
  signal.throwIfAborted();
  if (catalog.schemaVersion !== 1 || !Number.isSafeInteger(catalog.reviewPrice) ||
      catalog.reviewPrice <= 0 || !Array.isArray(catalog.items) || !catalog.items.length) {
    throw new Error('The armor ornament catalog is unavailable.');
  }
  savedCatalog = catalog;
  return catalog;
}

export function armorOrnamentEntries(catalog, profile) {
  const collection = eververseCollection(profile);
  const missing = confirmedMissingCollectibles(profile);
  return catalog.items.map(([itemHash, hashes, name, className, rarity, sources, bundles, offerCurrencies]) => {
    let ownership = 'unconfirmed';
    if (hashes.some(hash => collection?.owned.has(hash))) ownership = 'owned';
    else if (hashes.length && hashes.every(hash => missing.has(hash))) ownership = 'missing';
    return { itemHash, name, className, rarity, sources, bundles, offerCurrencies, ownership, reviewPrice: catalog.reviewPrice };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.className.localeCompare(b.className) || a.itemHash - b.itemHash);
}

function filterOptions(entries, key, label) {
  const values = [...new Set(entries.map(item => item[key]))].sort();
  return `<option value="">${label}</option>${values.map(value => `<option value="${e(value)}">${e(value)}</option>`).join('')}`;
}

export async function renderArmorOrnaments(target, { profile, signal, onExport }) {
  const catalog = await loadCatalog(signal);
  signal.throwIfAborted();
  const entries = armorOrnamentEntries(catalog, profile);
  onExport({ manifestVersion: catalog.manifestVersion, items: entries });
  const totals = { owned: 0, missing: 0, unconfirmed: 0 };
  for (const item of entries) totals[item.ownership]++;
  const count = value => number.format(value);
  target.innerHTML = `<h3>Armor ornaments</h3>
    <p class="report-note">${count(entries.length)} ornaments · ${count(totals.owned)} owned · ${count(totals.missing)} confirmed missing · ${count(totals.unconfirmed)} unconfirmed</p>
    <p class="report-note">Each piece starts at ${count(catalog.reviewPrice)} Bright Dust for the pricing review. Bungie sources include Collections labels, bundle previews, and offer currencies.</p>
    <div class="report-filters">
      <label>Search armor ornaments<input type="search" placeholder="Name, bundle, or source"></label>
      <label>Class<select class="ornament-class">${filterOptions(entries, 'className', 'All classes')}</select></label>
      <label>Rarity<select class="ornament-rarity">${filterOptions(entries, 'rarity', 'All rarities')}</select></label>
      <label>Ownership<select class="ornament-ownership"><option value="">All ownership states</option>
        ${Object.entries(OWNERSHIP).map(([key, title]) => `<option value="${key}">${title}</option>`).join('')}</select></label>
    </div>
    <p class="ornament-count report-note" aria-live="polite"></p>
    <div class="ornament-results"></div><button type="button" class="ornament-more">Show more</button>`;

  const input = target.querySelector('input');
  const classFilter = target.querySelector('.ornament-class');
  const rarityFilter = target.querySelector('.ornament-rarity');
  const ownershipFilter = target.querySelector('.ornament-ownership');
  const results = target.querySelector('.ornament-results');
  const status = target.querySelector('.ornament-count');
  const more = target.querySelector('.ornament-more');
  let limit = PAGE_SIZE;
  function draw() {
    const query = input.value.trim().toLowerCase();
    const matches = entries.filter(item =>
      (!classFilter.value || item.className === classFilter.value) &&
      (!rarityFilter.value || item.rarity === rarityFilter.value) &&
      (!ownershipFilter.value || item.ownership === ownershipFilter.value) &&
      (!query || [item.name, ...item.sources, ...item.bundles, ...item.offerCurrencies].some(text => text.toLowerCase().includes(query))));
    const rows = matches.slice(0, limit).map(item => {
      const source = [
        ...item.sources,
        ...item.bundles,
        ...(item.offerCurrencies.length ? [`Offer currencies: ${item.offerCurrencies.join(', ')}`] : [])
      ];
      return [e(item.name), e(item.className), e(item.rarity), source.map(e).join('<br>') || 'Source unavailable',
        OWNERSHIP[item.ownership], `${count(item.reviewPrice)} Bright Dust`];
    });
    status.textContent = `${count(matches.length)} matching · ${count(rows.length)} shown`;
    results.innerHTML = rows.length ? reportTable(['Ornament', 'Class', 'Rarity', 'Bungie source', 'Ownership', 'Review value'], rows,
      { caption: 'Destiny 2 armor ornaments and review values' }) : '<p class="report-note">No ornaments match these filters.</p>';
    more.hidden = rows.length >= matches.length;
  }

  function filter() { limit = PAGE_SIZE; draw(); }
  input.addEventListener('input', filter);
  for (const select of [classFilter, rarityFilter, ownershipFilter]) select.addEventListener('change', filter);
  more.addEventListener('click', () => { limit += PAGE_SIZE; draw(); });
  draw();
}

import { escapeHtml as e } from './html.js';
import { bungieImage } from './manifest.js';
import { reportTable } from './reportTables.js';

const PAGE_SIZE = 30;
const number = new Intl.NumberFormat();
const share = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });
const OWNERSHIP = { owned: 'Owned', missing: 'Confirmed missing', unconfirmed: 'Unconfirmed' };
const note = text => `<p class="report-note">${e(text)}</p>`;
const tile = (label, value) => `<div class="report-stat"><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`;
const amount = value => value == null ? 'Unpriced' : `${number.format(value)} Bright Dust`;
let savedMetadata;

async function loadIcons(catalog, signal) {
  if (!savedMetadata || savedMetadata.manifestVersion !== catalog.manifestVersion) {
    const response = await fetch('./eververseReviewMetadata.json?v=2', { signal });
    if (!response.ok) return new Map();
    const metadata = await response.json();
    signal.throwIfAborted();
    if (metadata.schemaVersion !== 1 || metadata.manifestVersion !== catalog.manifestVersion || !Array.isArray(metadata.rows)) return new Map();
    savedMetadata = metadata;
  }
  return new Map(savedMetadata.rows.filter(([, path]) => path).map(([hash, path]) => [
    hash, bungieImage(path.startsWith('/') ? path : savedMetadata.iconRoot + path)
  ]));
}

export function renderEververseReport(target, report, signal) {
  if (!report) {
    target.innerHTML = '<h3>Eververse net worth</h3>' + note('Bungie did not return public Collections data for this player.');
    return;
  }
  const { catalog, valuation, catalogCoverage, ownership } = report;
  const owned = new Map(valuation.items.map(item => [item.itemHash, item]));
  const items = catalog.items.map(([hash, aliases, name, category, price, set, estimate, approved]) => {
    const acquired = owned.get(hash);
    const value = acquired ? acquired.brightDust : price;
    const pricing = acquired?.includedWithSharedUnlock ? 'Included with shared unlock' :
      set ? `Estimated share of ${set}` : approved ? 'Approved estimate' : estimate === 'collaboration' ?
        'Collaboration set estimate' : estimate === true ? 'Standard price estimate' : value == null ? 'No verified price' : 'Individual offer';
    return { hash, name, category, value, pricing, state: ownership(hash, aliases), search: `${name} ${hash} ${pricing}`.toLowerCase() };
  }).sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.name.localeCompare(b.name));

  const categories = [...catalogCoverage].sort((a, b) => a.category.localeCompare(b.category));
  target.innerHTML = `<header class="eververse-report-header">
      <div><h3>Eververse net worth</h3>
        <strong class="eververse-report-total">${e(valuation.brightDust == null ? 'No verified estimate' : amount(valuation.brightDust))}</strong>
        ${valuation.catalogDate ? note(`Estimated collection value · Bungie catalog dated ${valuation.catalogDate}`) : note('Estimated collection value')}
      </div>
      <a class="site-button" href="leaderboards.html?board=profile.eververse#discover">Bright Dust leaderboard</a>
    </header>
    <dl class="report-stats compact">
      ${tile('Owned cosmetics', number.format(valuation.ownedCount))}
      ${tile('Owned with values', `${number.format(valuation.pricedCount)} / ${number.format(valuation.ownedCount)}`)}
      ${tile('Catalog with prices', `${number.format(valuation.catalogPricedCount)} / ${number.format(catalog.items.length)}`)}
    </dl>
    ${valuation.collectionCoverage === 'partial' ? note('Some profile or character Collections are unavailable. The estimate covers visible unlocks.') : ''}
    ${valuation.emoteCoverage === 'unavailable' ? note('Bungie did not return public emote data. This estimate may omit emotes.') : ''}
    <h4>Value by category</h4>
    <div class="eververse-category-summary">
      ${reportTable(['Cosmetic type', 'Owned', 'Catalog total', 'Confirmed missing', 'Unconfirmed', 'Owned with prices', 'Bright Dust value'],
        catalogCoverage.map(row => [
          `<button class="eververse-category-button" type="button" data-cosmetic-category="${e(row.category)}">${e(row.category)}</button>`,
          e(number.format(row.owned)), e(number.format(row.catalogTotal)), e(number.format(row.confirmedMissing)), e(number.format(row.unconfirmed)),
          `${e(number.format(row.priced))}${row.estimated ? `<br><small>${e(number.format(row.estimated))} estimated</small>` : ''}`,
          row.owned ? `${e(amount(row.priced ? row.brightDust : null))}${valuation.brightDust > 0 && row.brightDust > 0 ?
            ` <small>(${e(share.format(row.brightDust / valuation.brightDust))})</small>` : ''}` : '—'
        ]), { caption: 'Eververse ownership and value by cosmetic type' })}
    </div>
    <h4 class="eververse-cosmetics-heading">Browse cosmetics</h4>
    <div class="report-filters eververse-filters">
      <label>Search cosmetics<input type="search" placeholder="Name or item ID" /></label>
      <label>Category<select class="eververse-category"><option value="">All categories</option>${categories.map(({ category }) =>
        `<option value="${e(category)}">${e(category)}</option>`).join('')}</select></label>
      <label>Ownership<select class="eververse-ownership"><option value="owned">Owned</option><option value="">All catalog items</option>
        <option value="missing">Confirmed missing</option><option value="unconfirmed">Unconfirmed</option></select></label>
      <label>Pricing<select class="eververse-pricing"><option value="">All prices</option><option value="priced">With a value</option>
        <option value="unpriced">Unpriced</option></select></label>
    </div>
    <p class="report-note eververse-item-count" aria-live="polite"></p>
    <div class="eververse-items"></div>
    <button type="button" class="eververse-more">Show more</button>
    <details class="report-details"><summary>How Bright Dust values are calculated</summary>
      ${note('Confirmed missing comes from visible Bungie ownership records. Hidden or omitted records appear as unconfirmed. Emote unlocks can also come from the public emote wheel.')}
      ${note('Owned items contribute their individual offers, shares of verified bundles, or labeled estimates. An unlock shared across classes contributes one value to the total.')}
      ${note('Items with unknown prices are included in ownership counts. Their Bright Dust contribution is pending a price.')}
    </details>`;

  const filters = target.querySelector('.eververse-filters');
  const query = filters.querySelector('input');
  const category = filters.querySelector('.eververse-category');
  const state = filters.querySelector('.eververse-ownership');
  const pricing = filters.querySelector('.eververse-pricing');
  const more = target.querySelector('.eververse-more');
  const list = target.querySelector('.eververse-items');
  const count = target.querySelector('.eververse-item-count');
  let limit = PAGE_SIZE, icons = new Map();
  function redraw() {
    const search = query.value.trim().toLowerCase();
    const matches = items.filter(item => (!category.value || category.value === item.category) &&
      (!state.value || state.value === item.state) &&
      (!pricing.value || (pricing.value === 'priced' ? item.value != null : item.value == null)) &&
      (!search || item.search.includes(search)));
    const rows = matches.slice(0, limit).map(item => {
      const icon = icons.get(item.hash);
      const thumb = icon ? `<img src="${e(icon)}" alt="" loading="lazy" decoding="async" width="28" height="28" />` : '';
      return [`<span class="eververse-item-title">${thumb}${e(item.name)}</span>`, e(item.category), OWNERSHIP[item.state],
        e(amount(item.value)), e(item.pricing)];
    });
    count.textContent = `${number.format(matches.length)} matching · ${number.format(rows.length)} shown`;
    list.innerHTML = rows.length ? reportTable(['Cosmetic', 'Type', 'Ownership', 'Bright Dust value', 'Price basis'], rows,
      { caption: 'Individual Eververse cosmetics and values' }) : note('No cosmetics match these filters.');
    more.hidden = rows.length >= matches.length;
  }
  const reset = () => { limit = PAGE_SIZE; redraw(); };
  query.addEventListener('input', reset);
  filters.addEventListener('change', reset);
  more.addEventListener('click', () => { limit += PAGE_SIZE; redraw(); });
  target.querySelector('.eververse-category-summary').addEventListener('click', event => {
    const button = event.target.closest('[data-cosmetic-category]');
    if (!button) return;
    category.value = button.dataset.cosmeticCategory;
    query.value = '';
    pricing.value = '';
    state.value = '';
    reset();
    category.focus();
  });
  redraw();
  void loadIcons(catalog, signal).then(result => {
    if (!signal.aborted && result.size) { icons = result; redraw(); }
  }).catch(() => {});
}

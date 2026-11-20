import { escapeHtml as e } from './html.js';
import { bungieImage, createManifestClient } from './manifest.js';
import { loadEververseCatalog } from './eververseValue.js?v=7';
import { addPriceSuggestions, importPriceDecisions, PRICE_BASES, REVIEW_STATES, priceReviewQueue, reviewItems } from './eververseReviewData.js?v=4';

const PAGE_SIZE = 24;
const STORAGE_KEY = 'guardian-ranker.eververse-price-review.v1';
const fmt = new Intl.NumberFormat();
const byId = id => document.getElementById(id);
const list = byId('review-items');
const message = byId('review-message');
const dialog = byId('item-details');
const filters = ['review-query', 'review-category', 'review-basis', 'review-status'].map(byId);
const form = byId('detail-review');
const manifest = createManifestClient();
let items = [], itemsByHash = new Map(), decisions = new Map(), catalog, detailItem, definitionRequest;
let page = 0;
let pageCount = 0;
let canStore = true;
const priceText = price => price == null ? 'No verified price' : `${fmt.format(price)} Bright Dust`;
const statusOf = item => {
  const decision = decisions.get(item.hash);
  return item.proposedPrice != null && decision?.status === 'confirmed' && decision.confirmedPrice == null
    ? 'unreviewed' : decision?.status ?? (item.approved ? 'confirmed' : 'unreviewed');
};
const valueToReview = item => {
  const decision = decisions.get(item.hash);
  return decision?.confirmedPrice ?? decision?.suggestedPrice ?? item.proposedPrice ?? item.price;
};
const image = (path, css, lazy = false) => {
  const url = bungieImage(path);
  return url ? `<img class="${css}" src="${e(url)}" alt=""${lazy ? ' loading="lazy" decoding="async"' : ''}>`
    : '<span class="review-icon" aria-hidden="true"></span>';
};
const choice = (label, value) => `<option value="${e(value)}">${e(label)}</option>`;
const fact = (label, content) => `<div><dt>${label}</dt><dd>${content}</dd></div>`;

function currentFocus() {
  const button = document.activeElement?.closest('[data-action]');
  return { hash: button?.closest('[data-item]')?.dataset.item, action: button?.dataset.action };
}

function updateChoices(select, label, values) {
  const key = JSON.stringify(values);
  if (select.dataset.choices === key) return;
  const selected = select.value;
  select.innerHTML = choice(label, '') + values.map(([value, text]) => choice(text, value)).join('');
  select.value = values.some(([value]) => value === selected) ? selected : '';
  select.dataset.choices = key;
}

function render(focus = {}) {
  const [queryInput, category, basis, status] = filters;
  const query = queryInput.value.trim().toLowerCase();
  const queue = priceReviewQueue(items, decisions);
  updateChoices(category, 'All categories', [...new Set(queue.map(item => item.category))].sort().map(name => [name, name]));
  updateChoices(basis, 'All price bases', [...new Set(queue.map(item => item.basis))].map(key => [key, PRICE_BASES[key]]));
  const totals = { confirmed: 0, flagged: 0, unreviewed: 0 };
  for (const item of queue) totals[statusOf(item)]++;
  byId('item-count').textContent = fmt.format(queue.length);
  for (const [key, count] of Object.entries(totals)) byId(`${key}-count`).textContent = fmt.format(count);
  const matches = queue.filter(item => (!category.value || item.category === category.value) &&
    (!basis.value || item.basis === basis.value) &&
    (!status.value || (status.value === 'open' ? statusOf(item) !== 'confirmed' : statusOf(item) === status.value)) &&
    (!query || item.search.includes(query)));
  pageCount = Math.ceil(matches.length / PAGE_SIZE);
  page = Math.min(page, Math.max(0, pageCount - 1));
  const slice = matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  list.innerHTML = slice.map(item => {
    const state = statusOf(item);
    const meta = [item.rarity, item.category, item.className].filter(Boolean).join(' · ');
    const amount = valueToReview(item);
    const priceLabel = state === 'confirmed' ? 'Confirmed value' :
      item.proposedPrice != null || amount !== item.price ? 'Proposed value' : PRICE_BASES[item.basis];
    return `<li class="review-item" data-item="${item.hash}" data-rarity="${e(item.rarity)}">
      <div class="review-identity">${image(item.icon, 'review-icon', true)}
        <div><button class="review-item-name" type="button" data-action="details" aria-label="View details for ${e(item.name)}">${e(item.name)}</button>
        <span class="review-meta">${e(meta)}</span></div></div>
      <div class="review-item-price"><strong>${priceText(amount)}</strong><span class="review-meta">${priceLabel}</span></div>
      <div class="review-decision"><span class="review-meta">${REVIEW_STATES[state]}</span>
        <div class="review-row-actions">
          <button class="site-button review-confirm" type="button" data-action="confirmed" aria-pressed="${state === 'confirmed'}" aria-label="Confirm price for ${e(item.name)}" ${amount == null ? 'disabled' : ''}>Confirm</button>
          <button class="site-button review-flag" type="button" data-action="flagged" aria-pressed="${state === 'flagged'}" aria-label="Flag ${e(item.name)} for review">Flag for review</button>
        </div>
      </div></li>`;
  }).join('');
  byId('review-load-status').textContent = matches.length ? '' :
    status.value === 'open' && !totals.unreviewed && !totals.flagged
      ? 'All prices in this queue are confirmed. Choose Confirmed to revisit them.' : 'No items match these filters.';
  byId('review-pagination').hidden = !matches.length;
  byId('review-page-info').textContent = matches.length
    ? `${fmt.format(page * PAGE_SIZE + 1)}–${fmt.format(page * PAGE_SIZE + slice.length)} of ${fmt.format(matches.length)}` : '';
  byId('review-previous').disabled = page === 0;
  byId('review-next').disabled = page + 1 >= pageCount;
  if (focus.hash && !dialog.open) {
    const replacement = list.querySelector(`[data-item="${focus.hash}"] [data-action="${focus.action}"]`) ||
      list.querySelector(`[data-action="${focus.action}"]`) || filters[3];
    replacement.focus({ preventScroll: true });
  }
}

function readDecisions() {
  if (!canStore) return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? importPriceDecisions(JSON.parse(saved), itemsByHash).decisions : new Map();
  } catch {
    canStore = false;
    return null;
  }
}

function storeDecisions(text) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, decisions: [...decisions.values()] }));
    canStore = true;
    message.textContent = text;
  } catch {
    canStore = false;
    message.textContent = `${text} Browser storage is unavailable. Export your reviews before leaving.`;
  }
}

function setDecision(item, status, changes = {}) {
  decisions = readDecisions() ?? decisions;
  if (status === 'unreviewed') decisions.delete(item.hash);
  else {
    const amount = changes.suggestedPrice ?? valueToReview(item);
    decisions.set(item.hash, { itemHash: item.hash, signature: item.signature, status,
      note: changes.note ?? decisions.get(item.hash)?.note ?? '',
      suggestedPrice: amount, confirmedPrice: status === 'confirmed' ? amount : null });
  }
  storeDecisions(`${item.name} · ${REVIEW_STATES[statusOf(item)]}`);
}

function exportReviews() {
  const data = { schemaVersion: 1, catalogVersion: catalog.schemaVersion, manifestVersion: catalog.manifestVersion,
    decisions: items.filter(item => item.approved || decisions.has(item.hash)).map(item => {
      const entry = decisions.get(item.hash) ?? { itemHash: item.hash, signature: item.signature, status: 'confirmed',
        note: '', suggestedPrice: item.price, confirmedPrice: item.price };
      return { ...entry, name: item.name, category: item.category, catalogPrice: item.price, priceBasis: PRICE_BASES[item.basis],
        proposedPrice: item.proposedPrice ?? item.price, proposalBasis: item.proposalBasis ?? PRICE_BASES[item.basis] };
    })
  };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  link.download = 'eververse-price-reviews.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function importReviews(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const imported = importPriceDecisions(JSON.parse(await file.text()), itemsByHash);
    decisions = readDecisions() ?? decisions;
    for (const [hash, entry] of imported.decisions) decisions.set(hash, entry);
    const skipped = imported.skipped ? ` · ${fmt.format(imported.skipped)} skipped because the entry or catalog price changed` : '';
    storeDecisions(`${fmt.format(imported.decisions.size)} reviews imported${skipped}.`);
    render();
  } catch (error) {
    message.textContent = `Could not import reviews. ${error.message}`;
  }
}

function offerList(offers) {
  return offers.length ? `<ul>${offers.map(({ amount, currency, vendor }) =>
    `<li>${fmt.format(amount)} ${e(currency)} · ${e(vendor)}</li>`).join('')}</ul>` : 'No offer recorded in the manifest';
}

async function showItem(item) {
  definitionRequest?.abort();
  detailItem = item;
  const decision = decisions.get(item.hash);
  byId('detail-title').textContent = item.name;
  form.elements.namedItem('note').value = decision?.note ?? '';
  const priceInput = form.elements.namedItem('suggestedPrice');
  priceInput.setCustomValidity('');
  priceInput.value = valueToReview(item) ?? '';
  form.querySelector('[value="unreviewed"]').hidden = !decision;
  const setShare = item.set ? `<p class="review-meta">${e(item.set)} · ${priceText(item.price * 5)} divided among 5 pieces</p>` : '';
  const bundles = item.bundles.map(bundle => `<p>${e(bundle.name)}</p>${offerList(bundle.offers)}`).join('');
  const amount = valueToReview(item);
  const amountBasis = amount === item.proposedPrice ? item.proposalBasis :
    amount !== item.price ? 'Your review value' : PRICE_BASES[item.basis];
  byId('detail-evidence').innerHTML = `<div class="detail-summary">${image(item.icon, 'review-icon')}
      <div><strong>${priceText(amount)}</strong><p class="review-meta">${e(amountBasis)} · ${REVIEW_STATES[statusOf(item)]}</p>${setShare}</div></div>
    <dl class="detail-facts">
      ${fact('Published catalog price', priceText(item.price))}
      ${fact('Type', e([item.type || item.category, item.rarity, item.className].filter(Boolean).join(' · ')))}
      ${fact('Collections source', item.sources.map(e).join('<br>') || 'No source listed')}
      ${fact('Bungie item ID', `<code>${item.hash}</code>`)}
      ${fact('Collectible IDs', item.collectibleHashes.length ? e(item.collectibleHashes.join(', ')) : 'No collectible ID')}
      ${fact('Manifest offers', offerList(item.offers))}
      ${fact('Bundles', bundles || 'No bundle recorded')}
    </dl>`;
  const detail = byId('detail-definition');
  detail.replaceChildren();
  dialog.showModal();
  const request = new AbortController();
  definitionRequest = request;
  const loading = document.createElement('p');
  loading.className = 'review-meta';
  loading.textContent = 'Loading Bungie item details…';
  detail.append(loading);
  try {
    const definition = await manifest.definition('DestinyInventoryItemDefinition', item.hash, request.signal);
    request.signal.throwIfAborted();
    if (!definition) throw new Error('No definition returned.');
    const notes = new Set([definition.displayProperties?.description, definition.flavorText,
      ...(definition.tooltipNotifications || []).map(entry => entry.displayString)].filter(Boolean));
    detail.innerHTML = `${definition.screenshot ? image(definition.screenshot, 'detail-screenshot') : ''}
      ${[...notes].map(note => `<p>${e(note)}</p>`).join('')}
      <details><summary>Full Bungie item definition</summary><pre></pre></details>`;
    detail.querySelector('pre').textContent = JSON.stringify(definition, null, 2);
  } catch {
    if (!request.signal.aborted) loading.textContent = 'Additional Bungie details are unavailable.';
  }
}

async function load() {
  byId('retry-catalog').hidden = true;
  try {
    const signal = AbortSignal.timeout(25_000);
    let metadata;
    [catalog, metadata] = await Promise.all([
      loadEververseCatalog(signal),
      fetch('./eververseReviewMetadata.json?v=1', { signal }).then(response => response.ok ? response.json() : null).catch(() => null)
    ]);
    const compatible = metadata?.schemaVersion === 1 && metadata.manifestVersion === catalog.manifestVersion;
    items = addPriceSuggestions(reviewItems(catalog, compatible ? metadata : null));
    for (const item of items) item.search = [item.name, item.category, item.className, item.rarity, item.hash, item.set,
      ...item.collectibleHashes, ...item.sources, ...item.bundles.map(bundle => bundle.name)].join(' ').toLowerCase();
    items.sort((a, b) => a.name.localeCompare(b.name) || a.hash - b.hash);
    itemsByHash = new Map(items.map(item => [item.hash, item]));
    decisions = readDecisions() ?? new Map();
    filters[3].insertAdjacentHTML('beforeend', Object.entries(REVIEW_STATES).map(([key, text]) => choice(text, key)).join(''));
    byId('catalog-info').textContent = `Bright Dust estimates and review decisions${catalog.catalogDate ? ` · Catalog dated ${catalog.catalogDate}` : ''}`;
    if (!compatible) message.textContent = 'Catalog prices are available. Bungie images and offer evidence could not be matched to this snapshot.';
    byId('review-controls').hidden = false;
    byId('import-reviews').disabled = false;
    byId('export-reviews').disabled = false;
    render();
  } catch {
    byId('catalog-info').textContent = 'The Eververse catalog could not be loaded.';
    byId('retry-catalog').hidden = false;
  }
}

list.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const focus = { hash: button.closest('[data-item]').dataset.item, action: button.dataset.action };
  const item = itemsByHash.get(Number(focus.hash));
  if (focus.action === 'details') void showItem(item);
  else {
    setDecision(item, focus.action, { suggestedPrice: valueToReview(item) });
    render(focus);
  }
});
form.addEventListener('submit', event => {
  event.preventDefault();
  const priceInput = form.elements.namedItem('suggestedPrice');
  const suggestedPrice = priceInput.valueAsNumber;
  const status = event.submitter?.value ?? 'confirmed';
  if (status === 'confirmed' && !Number.isSafeInteger(suggestedPrice)) {
    priceInput.setCustomValidity('Enter a Bright Dust amount to confirm.');
    priceInput.reportValidity();
    return;
  }
  const focus = { hash: detailItem.hash, action: 'details' };
  setDecision(detailItem, status, { note: form.elements.namedItem('note').value.trim(),
    suggestedPrice: Number.isSafeInteger(suggestedPrice) ? suggestedPrice : null });
  dialog.close();
  render(focus);
});
form.elements.namedItem('suggestedPrice').addEventListener('input', event => event.target.setCustomValidity(''));
dialog.addEventListener('close', () => { if (!dialog.open) definitionRequest?.abort(); });
for (const filter of filters) filter.addEventListener(filter.type === 'search' ? 'input' : 'change', () => { page = 0; render(); });
for (const [id, direction] of [['review-previous', -1], ['review-next', 1]]) {
  byId(id).addEventListener('click', () => {
    if (page + direction < 0 || page + direction >= pageCount) return;
    page += direction;
    render();
    list.querySelector('button')?.focus({ preventScroll: true });
    list.scrollIntoView({ block: 'start' });
  });
}
byId('retry-catalog').addEventListener('click', () => void load());
byId('export-reviews').addEventListener('click', exportReviews);
byId('import-reviews').addEventListener('click', () => byId('import-file').click());
byId('import-file').addEventListener('change', importReviews);
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !catalog) return;
  decisions = readDecisions() ?? decisions;
  render(currentFocus());
});
void load();

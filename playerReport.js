import { escapeHtml as e } from './html.js';
import { bungieImage, createManifestClient, mapConcurrent } from './manifest.js';
import { CLASSES, PLATFORMS, ACTIVITY_MODES, overviewStats, characterSummary, dateText, numeric, statValue, careerGroups, summarizeCareer, catalogueEntries, filterCatalogue, mergeActivities, createReportApi } from './reportData.js';
import { closestTriumphs, objectiveCompletion, activityInsights } from './reportInsights.js';
import { activityInsightsHtml, renderActivityRecords, gearStatsHtml, mountMatchWeapons, commendationsHtml } from './reportExtras.js';
import { drawPerformanceRating, loadGuardianStandings } from './performanceView.js';
import { renderPlayerComparison } from './comparisonView.js';
import { eververseCatalogCoverage, eververseCollection, loadEververseCatalog, valueEververseCollection } from './eververseValue.js?v=6';
import { refreshGuardianScore } from './indexQueue.js';
import { reportTable } from './reportTables.js';

const number = (value, digits = 0) => numeric(value) == null ? 'Unavailable' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const tile = (label, value) => `<div class="report-stat"><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`;
const note = text => `<p class="report-note">${e(text)}</p>`;
const options = (values, selected) => Object.entries(values).map(([id, label]) => `<option value="${e(id)}" ${String(id) === String(selected) ? 'selected' : ''}>${e(label)}</option>`).join('');
function image(path, alt, className = '') {
  const url = bungieImage(path);
  return url ? `<img loading="lazy" src="${e(url)}" alt="${e(alt)}" class="${e(className)}">` : '';
}
function download(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderPlayerReport(container, { user, loaded, bungieName, signal, onScoreRefreshed }) {
  const { membership, profileData } = loaded;
  const profile = profileData.Response;
  const characters = characterSummary(profile);
  const summary = overviewStats(profile);
  const api = createReportApi(membership), manifest = createManifestClient();
  let ratingMembershipId = membership.membershipId;
  let standingsRequest;
  let refreshing = false;
  let refreshMessage = '';
  const loadRating = () => standingsRequest ??= loadGuardianStandings(ratingMembershipId, signal);
  const generatedAt = new Date().toISOString();
  const exported = { schemaVersion: 1, bungieName, membership, generatedAt, profile: profileData, sections: {} };
  const sections = { overview: 'Overview', rating: 'Account rating', characters: 'Characters & gear', career: 'PvP & PvE', activities: 'Activity history', endgame: 'Activity records', records: 'Triumphs & titles', collections: 'Collections', progression: 'Progression & metrics', compare: 'Compare players' };
  const nameUrl = new URL(window.location.href);
  nameUrl.search = new URLSearchParams({ name: bungieName }); nameUrl.hash = '';
  container.innerHTML = `
    <header class="report-header">
      <div><p class="eyebrow">PLAYER DOSSIER</p><h2 class="bungie-name">${e(bungieName)}</h2>
      <p class="report-note">${e(PLATFORMS[membership.membershipType] || 'Destiny 2')} · ${membership.crossSaveOverride ? 'Cross-save active · ' : ''}Last played ${e(dateText(summary.lastPlayed, true))}</p></div>
      <div class="report-actions"><button type="button" data-action="share">Copy link</button><button type="button" data-action="print">Print</button><button type="button" id="downloadRawBtn">Export JSON</button></div>
    </header>
    <p class="report-note">Public Bungie data · Retrieved ${e(dateText(generatedAt, true))}. Private fields are marked unavailable. Character time includes idle time and excludes deleted characters.</p>
    <p class="share-status" aria-live="polite"></p>
    <nav class="report-nav" aria-label="Player report sections">
      <label class="report-section-picker">Report section<select>${options(sections, 'overview')}</select></label>
      <div class="report-tabs">${Object.entries(sections).map(([id, label]) => `<button type="button" data-section="${id}" aria-pressed="${id === 'overview'}" aria-controls="report-${id}">${label}</button>`).join('')}</div>
    </nav>
    ${Object.keys(sections).map(id => `<section id="report-${id}" class="report-panel" aria-label="${sections[id]}" ${id === 'overview' ? '' : 'hidden'}></section>`).join('')}
    <p class="queue-status report-note" role="status"></p>`;
  const panel = id => container.querySelector(`#report-${id}`);
  const overview = panel('overview');
  overview.innerHTML = `<div class="section-heading"><div><p class="eyebrow">AT A GLANCE</p><h3>Guardian overview</h3></div></div>
    <dl class="report-stats">${tile('Guardian Rank', number(summary.rank))}${tile('Highest rank', number(summary.highestRank))}${tile('Highest equipped power', number(summary.power))}${tile('Character time', `${number(summary.hours)} hours`)}${tile('Lifetime Triumph score', number(summary.triumphScore))}${tile('Active Triumph score', number(summary.activeScore))}${tile('Renewed rank', number(summary.renewedRank))}${tile('Collections acquired', summary.hasCollections ? `${number(summary.collectionAcquired)} / ${number(summary.collectionTotal)}` : 'Unavailable')}${tile('Commendation score', number(summary.commendationScore))}<div class="report-stat"><dt>Eververse net worth</dt><dd class="eververse-value" aria-live="polite">Calculating…</dd></div></dl>
    <details class="report-details"><summary>Eververse ownership and pricing</summary><div class="eververse-details">${note('Loading Eververse prices…')}</div></details>
    <h3>Characters</h3><div class="character-section report-character-grid">${characters.map(c => `<article class="character-preview">${image(c.emblemBackgroundPath, `${CLASSES[c.classType] || 'Guardian'} emblem`)}<div><h4>${e(CLASSES[c.classType] || 'Guardian')}</h4><strong class="power-value">${e(number(c.light))} Power</strong><p>${e(number(numeric(c.minutesPlayedTotal) == null ? null : Number(c.minutesPlayedTotal) / 60))} hours · ${e(dateText(c.dateLastPlayed))}</p></div></article>`).join('')}</div>
    <div class="clan-summary"><h3>Clan</h3>${note('Loading clan membership…')}</div>
    <details class="report-details"><summary>Account identity & linked platforms</summary><p>Destiny membership ID: <code>${e(membership.membershipId)}</code></p><ul>${(user.destinyMemberships || []).map(m => `<li>${e(PLATFORMS[m.membershipType] || 'Other')} · ${e(m.displayName || bungieName)} ${m.crossSaveOverride && m.crossSaveOverride !== m.membershipType ? '(cross-save overridden)' : ''}</li>`).join('')}</ul><a href="https://www.bungie.net/7/en/User/Profile/${encodeURIComponent(membership.membershipType)}/${encodeURIComponent(membership.membershipId)}" target="_blank" rel="noopener noreferrer">View Bungie profile ↗</a></details>`;

  const shareStatus = container.querySelector('.share-status');
  const ratingPreview = document.createElement('div');
  ratingPreview.className = 'account-rating-preview';
  ratingPreview.innerHTML = '<div><p class="eyebrow">GUARDIAN STANDINGS</p><p class="rating-preview-value">Performance, Knowledge and commendations</p></div><button type="button">View standings</button>';
  overview.querySelector('.report-stats').after(ratingPreview);
  ratingPreview.querySelector('button').addEventListener('click', () => container.querySelector('.report-nav [data-section=rating]').click());
  container.querySelector('[data-action=share]').addEventListener('click', async () => {
    nameUrl.hash = window.location.hash;
    const compared = nameUrl.hash === '#compare' && exported.sections.comparison?.name;
    if (compared) nameUrl.searchParams.set('compare', compared);
    else nameUrl.searchParams.delete('compare');
    try { await navigator.clipboard.writeText(nameUrl.href); shareStatus.textContent = 'Report link copied.'; }
    catch { shareStatus.textContent = `Report link: ${nameUrl.href}`; }
  });
  container.querySelector('[data-action=print]').addEventListener('click', () => {
    shareStatus.textContent = 'Print includes the sections you have loaded.'; window.print();
  });
  container.querySelector('#downloadRawBtn').addEventListener('click', () => {
    download(exported, `${bungieName.replace(/[^\p{L}\p{N}_-]/gu, '_')}_report.json`);
    shareStatus.textContent = 'Export includes the public profile and sections loaded so far.';
  });

  async function withState(target, work, isCurrent = () => true) {
    target.setAttribute('aria-busy', 'true');
    try { await work(); }
    catch (error) {
      if (signal.aborted || !isCurrent()) return;
      target.innerHTML = `${note(`This section could not load: ${error.message}`)}<button type="button" class="retry-section">Try again</button>`;
      target.querySelector('button').addEventListener('click', () => void withState(target, work, isCurrent), { once: true });
    } finally { if (isCurrent()) target.removeAttribute('aria-busy'); }
  }
  const initialized = new Set(['overview']);
  const loaders = { rating: async () => {
    const standing = await loadRating();
    signal.throwIfAborted();
    displayRating(standing);
  }, characters: loadCharacters, career: loadCareer, activities: loadActivities, endgame: () => renderActivityRecords(panel('endgame'), { api, characters, manifest, signal, onExport: data => { exported.sections.activityRecords = data; } }), records: () => loadCatalogue('records'), collections: () => loadCatalogue('collections'), progression: loadProgression, compare: loadComparison };

  function displayRating(standing) {
    drawPerformanceRating(panel('rating'), { standing, summary, onCompare: () => {
      container.querySelector('.report-nav [data-section=compare]').click();
      panel('compare').querySelector('input')?.focus();
    }, onRefresh: requestScoreRefresh, refreshMessage, refreshing });
    exported.sections.accountRating = standing;
    const row = standing.performance;
    if (row?.points != null) {
      ratingPreview.querySelector('.rating-preview-value').textContent = `${number(row.points, 2)} performance points${row.percentile == null ? '' : ` · ${number(row.percentile, 2)} percentile`}`;
    }
  }

  async function requestScoreRefresh(event) {
    if (refreshing) return;
    refreshing = true;
    const button = event.currentTarget;
    const restoreFocus = document.activeElement === button;
    button.disabled = true;
    const setMessage = message => {
      if (signal.aborted) return;
      refreshMessage = message;
      panel('rating').querySelector('.rating-refresh-status').textContent = message;
    };
    setMessage('Requesting a fresh score…');
    try {
      const result = await refreshGuardianScore(membership, signal, state => setMessage(state === 'indexing'
        ? 'The cloud worker is still indexing this season’s matches.' : 'Score refresh queued. This report will update when it is ready.'));
      signal.throwIfAborted();
      if (result.state === 'updated') {
        ratingMembershipId = result.membershipId;
        standingsRequest = null;
        const standing = await loadRating();
        if (signal.aborted) return;
        refreshMessage = standing.performanceUnavailable ? 'Score saved. The report could not reload yet.'
          : standing.performance?.eligible === false ? 'Score updated. This account is still below the leaderboard entry requirements.'
          : 'Score and leaderboards updated.';
        refreshing = false;
        displayRating(standing);
        if (restoreFocus && !panel('rating').hidden && document.activeElement === document.body) panel('rating').querySelector('.rating-refresh').focus();
        void onScoreRefreshed?.();
      } else setMessage(result.state === 'pending' ? 'The request is still queued in the cloud. You can return to this report later.'
        : 'A verified score could not be calculated from the available public Bungie data.');
    } catch (error) {
      if (!signal.aborted) setMessage(error.code === 'PGRST202' ? 'Manual score updates are temporarily unavailable.'
        : 'Could not check the score refresh. Try again shortly.');
    } finally {
      refreshing = false;
      button.disabled = false;
    }
  }
  const sectionPicker = container.querySelector('.report-section-picker select');
  sectionPicker.addEventListener('change', () => container.querySelector(`[data-section="${sectionPicker.value}"]`)?.click());
  container.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.section;
    sectionPicker.value = id;
    const sectionUrl = new URL(window.location.href);
    sectionUrl.hash = id;
    history.replaceState(null, '', sectionUrl);
    for (const [key] of Object.entries(sections)) panel(key).hidden = key !== id;
    container.querySelectorAll('[data-section]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    if (!initialized.has(id)) {
      initialized.add(id); panel(id).innerHTML = note('Loading public data…');
      void withState(panel(id), loaders[id]);
    }
  }));

  void withState(overview.querySelector('.clan-summary'), async () => {
    const data = await api.clan(signal); signal.throwIfAborted(); exported.sections.clan = data;
    overview.querySelector('.clan-summary').innerHTML = `<h3>Clan</h3>${data?.results?.length ? data.results.map(({ group }) => `<article class="clan-card"><h4><a href="https://www.bungie.net/7/en/Clan/Profile/${encodeURIComponent(group.groupId)}" target="_blank" rel="noopener noreferrer">${e(group.name)} ${group.clanInfo?.clanCallsign ? `[${e(group.clanInfo.clanCallsign)}]` : ''} ↗</a></h4><p>${e(group.motto || '')}</p><p>${e(number(group.memberCount))} members · Founded ${e(dateText(group.creationDate))}</p>${group.about ? `<details><summary>About this clan</summary><p class="preserve-lines">${e(group.about)}</p></details>` : ''}</article>`).join('') : note('No public clan membership found.')}`;
  });

  const collection = eververseCollection(profile);
  const eververseDetails = overview.querySelector('.eververse-details');
  const eververseValue = overview.querySelector('.eververse-value');
  if (collection) void withState(eververseDetails, loadEververseWorth);
  else {
    eververseValue.textContent = 'Unavailable';
    eververseDetails.innerHTML = note('Bungie did not return public Collections data for this player.');
  }

  async function loadEververseWorth() {
    eververseValue.textContent = 'Calculating…';
    let catalog;
    try { catalog = await loadEververseCatalog(signal); }
    catch (error) {
      if (!signal.aborted) eververseValue.textContent = 'Unavailable';
      throw error;
    }
    signal.throwIfAborted();
    const valuation = valueEververseCollection(collection, catalog);
    const catalogCoverage = eververseCatalogCoverage(profile, catalog, valuation);
    exported.sections.eververseNetWorth = { ...valuation, catalogCoverage };
    eververseValue.textContent = valuation.brightDust == null ? 'No verified estimate' : `${number(valuation.brightDust)} Bright Dust`;
    const amount = price => price == null ? 'No verified price' : `${number(price)} Bright Dust`;
    eververseDetails.innerHTML = `${note(`${number(valuation.pricedCount)} of ${number(valuation.ownedCount)} owned Eververse cosmetics have a Bright Dust value${valuation.catalogDate ? ` · Bungie catalog dated ${valuation.catalogDate}` : ''}.`)}
      ${note('Catalog total covers the Eververse cosmetics tracked here. Confirmed missing comes from visible Bungie collection states. Unconfirmed items lack a public ownership result. For the wider Bungie collection, open Collections.')}
      ${valuation.collectionCoverage === 'partial' ? note('Some profile or character Collections are unavailable. The estimate covers visible unlocks.') : ''}
      ${valuation.emoteCoverage === 'unavailable' ? note('Bungie did not return public emote data. This estimate may omit emotes.') : ''}
      ${reportTable(['Cosmetic type', 'Owned', 'Catalog total', 'Confirmed missing', 'Unconfirmed', 'Owned with prices', 'Bright Dust value'],
        catalogCoverage.map(row => [
          e(row.category), e(number(row.owned)), e(number(row.catalogTotal)), e(number(row.confirmedMissing)), e(number(row.unconfirmed)),
          `${e(number(row.priced))}${row.estimated ? `<br><small>${e(number(row.estimated))} estimated</small>` : ''}`,
          e(row.owned ? amount(row.priced ? row.brightDust : null) : '—')
        ]), { caption: 'Eververse ownership and prices by cosmetic type' })}
      ${valuation.items.length ? '<details class="eververse-items"><summary>View owned cosmetics and prices</summary></details>' : ''}
      <details><summary>How Bright Dust values are calculated</summary>
        ${note('Emote prices come from direct Bright Dust offers. Ownership comes from visible Collections or the public emote wheel.')}
        ${note('For matching five-piece Eververse armor sets, each owned piece can count for one fifth of the listed set price. A cheaper standalone offer takes precedence. Each cosmetic counts once.')}
        ${note('Regular cosmetics can use the standard price for their type and rarity. Regular Legendary universal armor pieces use 1,200 Bright Dust. Eligible collaboration set pieces use 1,600 based on historical Fortnite offers. Verified prices take precedence.')}
        ${valuation.standardEstimateCount ? note(`Standard price estimates included: ${number(valuation.standardEstimateCount)}.`) : ''}
        ${valuation.collaborationEstimateCount ? note(`Collaboration set estimates included: ${number(valuation.collaborationEstimateCount)}.`) : ''}
        ${note('Items marked “No verified price” add nothing to the total. Mask ornaments, gameplay rewards, mixed-source rewards, and Bright Engram focusing are excluded.')}
      </details>`;
    const items = eververseDetails.querySelector('.eververse-items');
    items?.addEventListener('toggle', () => {
      if (items.open && !items.querySelector('table')) items.insertAdjacentHTML('beforeend', reportTable(['Cosmetic', 'Type', 'Bright Dust value', 'Price basis'],
        valuation.items.map(item => [e(item.name), e(item.category), e(amount(item.brightDust)),
          e(item.ornamentSet ? `Estimated share of ${item.ornamentSet}` : item.collaborationEstimate ? 'Collaboration set estimate' :
            item.standardEstimate ? 'Standard price estimate' :
            item.brightDust == null ? 'Excluded from total' : 'Individual offer')]),
        { caption: 'Individual Eververse values' }));
    });
  }

  async function safeDefinition(type, hash) {
    try { return await manifest.definition(type, hash, signal); }
    catch { signal.throwIfAborted(); return null; }
  }
  async function loadCharacters() {
    const target = panel('characters');
    const cards = await mapConcurrent(characters, async c => {
      const equipment = profile.characterEquipment?.data?.[c.characterId]?.items;
      const stats = await mapConcurrent(Object.entries(c.stats || {}), async ([hash, value]) => {
        const def = await safeDefinition('DestinyStatDefinition', hash);
        return tile(def?.displayProperties?.name || `Stat ${hash}`, number(value));
      }, signal, 2);
      const title = await safeDefinition('DestinyRecordDefinition', c.titleRecordHash);
      const titleName = title?.titleInfo?.titlesByGenderHash?.[c.genderHash] || title?.titleInfo?.titlesByGender?.[c.genderType === 1 ? 'Female' : 'Male'] || title?.displayProperties?.name;
      const gear = await mapConcurrent(equipment || [], async item => {
        const def = await safeDefinition('DestinyInventoryItemDefinition', item.itemHash);
        const instance = profile.itemComponents?.instances?.data?.[item.itemInstanceId];
        const sockets = profile.itemComponents?.sockets?.data?.[item.itemInstanceId]?.sockets || [];
        return `<article class="gear-item ${def?.inventory?.tierType === 6 ? 'exotic-item' : ''}">${image(def?.displayProperties?.icon, '', 'item-icon')}<div><h5>${e(def?.displayProperties?.name || `Item ${item.itemHash}`)}</h5><p>${e(def?.itemTypeDisplayName || 'Equipped item')}${instance?.primaryStat?.value != null ? ` · ${e(number(instance.primaryStat.value))} Power` : ''}${instance?.damageType ? ` · ${e(({ 1: 'Kinetic', 2: 'Arc', 3: 'Solar', 4: 'Void', 6: 'Stasis', 7: 'Strand' })[instance.damageType] || 'Other damage')}` : ''}</p>${def?.displayProperties?.description ? `<details><summary>Description</summary><p>${e(def.displayProperties.description)}</p></details>` : ''}${sockets.some(s => s.plugHash && s.isEnabled !== false) ? `<button type="button" class="gear-perks" data-instance="${e(item.itemInstanceId)}">View equipped perks & mods</button><div class="perk-list"></div>` : ''}</div></article>`;
      }, signal, 2);
      return `<article class="character-detail"><h3>${e(CLASSES[c.classType] || 'Guardian')} · ${e(number(c.light))} Power</h3>${titleName ? `<p class="title-name">${e(titleName)}</p>` : ''}<p class="report-note">${e(['Human', 'Awoken', 'Exo'][c.raceType] || 'Unknown race')} · Last played ${e(dateText(c.dateLastPlayed, true))} · ${e(number(Number(c.minutesPlayedTotal || 0) / 60))} hours</p><dl class="report-stats compact">${stats.join('')}</dl><h4>Equipped loadout</h4>${equipment ? `<div class="gear-grid">${gear.join('')}</div>` : note('Equipment is unavailable in this public profile.')}</article>`;
    }, signal, 1);
    signal.throwIfAborted(); target.innerHTML = `<h3>Characters & equipped loadouts</h3>${note('A snapshot of currently equipped items. Saved loadouts and private inventory require account authorization.')}${cards.join('')}`;
    // Item stats are already in the public profile. Resolve their labels only
    // when requested, independently of the equipment/perk view.
    const equipmentItems = characters.flatMap(c => profile.characterEquipment?.data?.[c.characterId]?.items || []);
    target.querySelectorAll('.gear-item').forEach((card, index) => {
      const instanceId = equipmentItems[index]?.itemInstanceId;
      if (!instanceId) return;
      const button = document.createElement('button'), statsTarget = document.createElement('div');
      button.type = 'button'; button.className = 'gear-stats'; button.textContent = 'View detailed item stats';
      card.lastElementChild.append(button, statsTarget);
      button.addEventListener('click', () => {
        button.hidden = true;
        void withState(statsTarget, async () => { statsTarget.innerHTML = await gearStatsHtml(instanceId, profile, manifest, signal); });
      }, { once: true });
    });
    target.querySelectorAll('.gear-perks').forEach(button => button.addEventListener('click', () => {
      const perkTarget = button.nextElementSibling;
      button.hidden = true;
      void withState(perkTarget, async () => {
        const sockets = profile.itemComponents?.sockets?.data?.[button.dataset.instance]?.sockets || [];
        const hashes = [...new Set(sockets.filter(s => s.plugHash && s.isEnabled !== false).map(s => s.plugHash))];
        const perks = await mapConcurrent(hashes, async hash => {
          const def = await safeDefinition('DestinyInventoryItemDefinition', hash);
          return `<p><strong>${e(def?.displayProperties?.name || `Plug ${hash}`)}</strong>${def?.displayProperties?.description ? ` — ${e(def.displayProperties.description)}` : ''}</p>`;
        }, signal, 2);
        signal.throwIfAborted(); perkTarget.innerHTML = perks.join('');
      });
    }));
  }

  function careerCard(name, stats) {
    const s = summarizeCareer(stats);
    return `<article class="career-card"><h4>${e(name)}</h4><dl class="report-stats compact">${tile('Activities entered', number(s.games))}${tile('Wins', number(s.wins))}${tile('Win rate', s.winRate == null ? 'Unavailable' : `${number(s.winRate, 1)}%`)}${tile('Kills', number(s.kills))}${tile('Deaths', number(s.deaths))}${tile('Assists', number(s.assists))}${tile('K/D', number(s.kd, 2))}${tile('Efficiency (K+A)/D', number(s.efficiency, 2))}${tile('Precision kills', number(s.precisionKills))}${tile('Longest kill spree', number(s.bestStreak))}${tile('Activity time', s.hours == null ? 'Unavailable' : `${number(s.hours, 1)} h`)}</dl>
    ${Object.keys(stats).some(k => k.startsWith('weaponKills')) ? `<details><summary>Weapon kill breakdown</summary><dl class="report-stats compact">${Object.keys(stats).filter(k => k.startsWith('weaponKills') && statValue(stats, k) != null).map(k => tile(k.replace('weaponKills', '').replace(/([a-z])([A-Z])/g, '$1 $2') || 'All weapons', number(statValue(stats, k)))).join('')}</dl></details>` : ''}</article>`;
  }
  async function loadCareer() {
    const target = panel('career');
    const data = await api.career(signal); signal.throwIfAborted(); exported.sections.career = data;
    const groups = careerGroups(data);
    target.innerHTML = `<h3>Career combat statistics</h3>${note('Bungie historical totals can include deleted characters and have different coverage from character playtime. Missing values are not treated as zero.')}<div class="career-grid">${['allPvP', 'allPvE'].map(key => groups[key]?.allTime ? careerCard(key === 'allPvP' ? 'Crucible · all PvP' : 'Vanguard & world · all PvE', groups[key].allTime) : note(`${key === 'allPvP' ? 'PvP' : 'PvE'} career statistics are unavailable.`)).join('')}</div>
      <h4>Explore a specific mode</h4><div class="report-filters"><label>Character<select class="career-character">${options(Object.fromEntries(characters.map(c => [c.characterId, CLASSES[c.classType] || 'Guardian'])), characters[0]?.characterId)}</select></label><label>Mode<select class="career-mode">${options(ACTIVITY_MODES, 4)}</select></label><button type="button" class="load-mode">Load mode stats</button></div><div class="mode-result"></div>`;
    target.querySelector('.load-mode').addEventListener('click', () => {
      const result = target.querySelector('.mode-result');
      const char = target.querySelector('.career-character').value, mode = target.querySelector('.career-mode').value;
      const button = target.querySelector('.load-mode'); button.disabled = true;
      void withState(result, async () => {
        try {
          const response = await api.modeStats(char, mode, signal); signal.throwIfAborted();
          exported.sections[`mode-${char}-${mode}`] = response;
          const entries = Object.entries(response || {}).filter(([, value]) => value.allTime);
          result.innerHTML = entries.length ? entries.map(([key, value]) => careerCard(`${ACTIVITY_MODES[mode]} · ${key}`, value.allTime)).join('') : note('No public statistics are available for this character and mode.');
        } finally { button.disabled = false; }
      });
    });
  }

  async function loadActivities() {
    const target = panel('activities');
    target.innerHTML = `<h3>Activity history</h3>${note('Browse 25 activities per character per page. All-character pages are merged and deduplicated; these are paginated results, not a complete lifetime total.')}<div class="report-filters"><label>Character<select class="history-character"><option value="all">All characters</option>${options(Object.fromEntries(characters.map(c => [c.characterId, CLASSES[c.classType] || 'Guardian'])))}</select></label><label>Mode<select class="history-mode">${options(ACTIVITY_MODES, 0)}</select></label><button type="button" class="history-apply">Apply filters</button></div><div class="history-result"></div><button type="button" class="history-more">Load older activities</button><div class="match-result"></div>`;
    let page = 0, activities = [], exhausted = new Set(), historyVersion = 0;
    let selected = { character: 'all', mode: '0' };
    const result = target.querySelector('.history-result'), more = target.querySelector('.history-more'), apply = target.querySelector('.history-apply');
    async function fetchPage(reset = false) {
      const version = ++historyVersion;
      if (reset) { page = 0; activities = []; exhausted = new Set(); matchVersion++; target.querySelector('.match-result').replaceChildren(); }
      more.disabled = true; apply.disabled = true;
      try {
        const chosen = characters.filter(c => (selected.character === 'all' || selected.character === c.characterId) && !exhausted.has(c.characterId));
        const pages = await Promise.allSettled(chosen.map(c => api.history(c.characterId, selected.mode, page, signal)));
        signal.throwIfAborted(); if (version !== historyVersion) return;
        const good = pages.filter(p => p.status === 'fulfilled');
        if (!good.length && chosen.length) throw pages.find(p => p.status === 'rejected').reason;
        const failed = [];
        pages.forEach((p, index) => { if (p.status === 'rejected') failed.push(CLASSES[chosen[index].classType] || 'Guardian'); else if ((p.value?.activities?.length || 0) < 25) exhausted.add(chosen[index].characterId); });
        activities = mergeActivities([activities, ...good.map(p => p.value?.activities || [])]);
        const definitions = new Map();
        await mapConcurrent([...new Set(activities.map(a => a.activityDetails?.referenceId).filter(Boolean))], async hash => definitions.set(hash, await safeDefinition('DestinyActivityDefinition', hash)), signal, 3);
        signal.throwIfAborted(); if (version !== historyVersion) return;
        exported.sections.activities = { filters: selected, pagesLoaded: page + 1, partial: failed.length > 0, activities, insights: activityInsights(activities) };
        const rows = activities.map(a => {
          const def = definitions.get(a.activityDetails?.referenceId), values = a.values;
          const standing = statValue(values, 'standing'), completed = statValue(values, 'completed');
          const competitive = [5, 63, 84].includes(a.activityDetails?.mode) || a.activityDetails?.modes?.some(m => [5, 63].includes(m));
          const outcome = competitive && standing === 0 ? 'Victory' : competitive && standing === 1 ? 'Defeat' : completed === 1 ? 'Completed' : completed === 0 ? 'Incomplete' : 'Unavailable';
          const duration = statValue(values, 'activityDurationSeconds') ?? statValue(values, 'timePlayedSeconds');
          const title = e(def?.displayProperties?.name || ACTIVITY_MODES[a.activityDetails?.mode] || 'Activity');
          return [title + (a.activityDetails?.isPrivate ? '<span class="report-note"> · Private match</span>' : ''), e(dateText(a.period, true)), outcome,
            e(number(statValue(values, 'kills'))), e(number(statValue(values, 'deaths'))), duration == null ? 'Unavailable' : `${e(number(duration / 60, 1))} min`,
            `<button type="button" class="match-open" data-id="${e(a.activityDetails.instanceId)}">Match report</button>`];
        });
        result.innerHTML = `${failed.length ? note(`Some history could not load (${failed.join(', ')}). Retry this page before loading older activities.`) : ''}${note(`${activities.length} unique activities loaded · ${page + 1} page(s)`)}${rows.length
          ? reportTable(['Activity', 'Date', 'Result', 'Kills', 'Deaths', 'Duration', 'Details'], rows, { caption: 'Loaded activities' })
          : note('No public activities found. Activity history may be private or this filter may have no results.')}`;
        result.insertAdjacentHTML('afterbegin', activityInsightsHtml(activities));
        // Never skip a failed character's page. Successful rows are deduplicated on retry.
        if (!failed.length) page++;
        more.hidden = !failed.length && characters.filter(c => selected.character === 'all' || selected.character === c.characterId).every(c => exhausted.has(c.characterId));
        more.textContent = failed.length ? 'Retry incomplete page' : 'Load older activities';
        result.querySelectorAll('.match-open').forEach(button => button.addEventListener('click', () => void showMatch(button.dataset.id)));
      } catch (error) {
        if (!signal.aborted) { result.insertAdjacentHTML('beforeend', note(`History request failed: ${error.message}`)); more.hidden = false; more.textContent = 'Retry this page'; }
      } finally { more.disabled = false; apply.disabled = false; }
    }
    apply.addEventListener('click', () => { selected = { character: target.querySelector('.history-character').value, mode: target.querySelector('.history-mode').value }; void fetchPage(true); });
    more.addEventListener('click', () => void fetchPage());
    let matchVersion = 0;
    async function showMatch(id) {
      const version = ++matchVersion, detail = target.querySelector('.match-result');
      detail.innerHTML = note('Loading match report…');
      await withState(detail, async () => {
        const data = await api.match(id, signal); signal.throwIfAborted(); if (version !== matchVersion) return;
        exported.sections[`match-${id}`] = data;
        const rows = (data.entries || []).map(entry => {
          const info = entry.player?.destinyUserInfo || {};
          const name = info.bungieGlobalDisplayName ? `${info.bungieGlobalDisplayName}#${String(info.bungieGlobalDisplayNameCode ?? 0).padStart(4, '0')}` : info.displayName || 'Unknown Guardian';
          return [`<a href="?${new URLSearchParams({ name }).toString()}">${e(name)}</a>`,
            ...['team', 'kills', 'deaths', 'assists', 'score'].map(key => e(number(statValue(entry.values, key))))];
        });
        detail.innerHTML = `<h4>Match report · ${e(dateText(data.period, true))}</h4>${reportTable(['Guardian', 'Team', 'Kills', 'Deaths', 'Assists', 'Score'], rows, { caption: 'Match participants' })}`;
        const weapons = document.createElement('div');
        weapons.className = 'match-weapons'; detail.appendChild(weapons);
        mountMatchWeapons(weapons, data, { manifest, signal, isCurrent: () => version === matchVersion });
        detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, () => version === matchVersion);
    }
    await fetchPage();
  }

  async function loadCatalogue(type) {
    const target = panel(type), records = type === 'records';
    const definitions = await manifest.table(records ? 'DestinyRecordDefinition' : 'DestinyCollectibleDefinition', signal);
    const entries = catalogueEntries(profile, type, definitions); signal.throwIfAborted();
    exported.sections[type] = entries;
    target.innerHTML = `<h3>${records ? 'Triumphs & unlocked titles' : 'Collections'}</h3>${note(records ? 'Completion and redemption are separate. Secret triumph descriptions remain hidden. Titles are listed when Bungie marks them equippable.' : 'Includes visible profile and character collectibles, deduplicated across characters. The denominator is the exposed catalogue, not every item ever released.')}<div class="report-filters"><label>Search ${records ? 'triumphs' : 'collections'}<input class="catalogue-search" type="search" placeholder="Name or details"></label><label>Show<select class="catalogue-filter"><option value="all">All</option><option value="complete">${records ? 'Completed' : 'Acquired'}</option><option value="incomplete">${records ? 'Incomplete' : 'Missing'}</option>${records ? '<option value="titles">Unlocked titles</option>' : ''}</select></label></div><p class="catalogue-count report-note" aria-live="polite"></p><div class="catalogue-grid"></div><button type="button" class="catalogue-more">Show more</button>`;
    let limit = 24;
    function draw() {
      let filtered = filterCatalogue(entries, target.querySelector('input').value, target.querySelector('.catalogue-filter').value, type);
      if (target.querySelector('.catalogue-sort')?.value === 'closest') filtered = closestTriumphs(filtered);
      target.querySelector('.catalogue-count').textContent = `${filtered.length.toLocaleString()} matching · ${Math.min(limit, filtered.length).toLocaleString()} shown`;
      target.querySelector('.catalogue-grid').innerHTML = filtered.slice(0, limit).map(entry => {
        const complete = records ? entry.complete : entry.acquired;
        const progress = entry.objectives?.length ? entry.objectives : entry.intervalObjectives || [];
        const title = entry.definition?.titleInfo?.titlesByGender?.Male || entry.definition?.titleInfo?.titlesByGender?.Female;
        const completion = !entry.obscured ? objectiveCompletion(entry) : null;
        const extra = `${records && completion != null && !entry.complete ? `<p class="report-note">Objective progress: ${e(number(completion, 1))}% (average across objectives)</p>` : ''}${!records && entry.definition?.sourceString ? `<p class="report-note">Source: ${e(entry.definition.sourceString)}</p>` : ''}${records && entry.completedCount != null ? `<p class="report-note">Times completed: ${e(number(entry.completedCount))}</p>` : ''}`;
        return `<article class="catalogue-item">${entry.obscured ? '' : image(entry.definition?.displayProperties?.icon, '', 'item-icon')}<div><h4>${e(entry.name)}</h4><span class="report-badge ${complete ? 'complete' : ''}">${records ? entry.redeemed ? 'Redeemed' : complete ? 'Complete · unclaimed' : 'In progress' : complete ? 'Acquired' : 'Missing'}</span>${entry.titleUnlocked && title ? `<p class="title-name">Title: ${e(title)}</p>` : ''}<p>${e(entry.description)}</p>${extra}${records && !entry.obscured ? progress.map(o => `<p class="report-note">${e(number(o.progress))} / ${e(number(o.completionValue))}${o.complete ? ' · Complete' : ''}</p>`).join('') : ''}</div></article>`;
      }).join('') || note('No matching public entries. This component may be private or unavailable.');
      target.querySelector('.catalogue-more').hidden = limit >= filtered.length;
    }
    if (records) {
      target.querySelector('.report-filters').insertAdjacentHTML('beforeend', '<label>Order<select class="catalogue-sort"><option value="name">Name</option><option value="closest">Closest first</option></select></label>');
      target.querySelector('.catalogue-sort').addEventListener('change', () => { if (target.querySelector('.catalogue-sort').value === 'closest') target.querySelector('.catalogue-filter').value = 'incomplete'; limit = 24; draw(); });
    }
    target.querySelector('input').addEventListener('input', () => { limit = 24; draw(); });
    target.querySelector('.catalogue-filter').addEventListener('change', () => { if (records) target.querySelector('.catalogue-sort').value = 'name'; limit = 24; draw(); });
    target.querySelector('.catalogue-more').addEventListener('click', () => { limit += 24; draw(); });
    draw();
  }

  async function loadProgression() {
    const target = panel('progression');
    const progressionDefinitions = await manifest.table('DestinyProgressionDefinition', signal);
    const sections = await mapConcurrent(characters, async c => {
      const progressions = profile.characterProgressions?.data?.[c.characterId]?.progressions;
      const entries = Object.entries(progressions || {}).filter(([, p]) => p.level != null || p.currentProgress != null);
      const rows = await mapConcurrent(entries, async ([hash, p]) => {
        const def = progressionDefinitions[hash];
        return [e(def?.displayProperties?.name || `Progression ${hash}`), e(number(p.level)),
          `${e(number(p.progressToNextLevel))} / ${e(number(p.nextLevelAt))}`, e(number(p.currentResetCount))];
      }, signal, 3);
      const character = CLASSES[c.classType] || 'Guardian';
      return `<h4>${e(character)}</h4>${rows.length ? reportTable(['Progression', 'Level', 'Progress to next level', 'Resets'], rows,
        { caption: `${character} progression` }) : note('Public progression is unavailable for this character.')}`;
    }, signal, 1);
    signal.throwIfAborted(); target.innerHTML = `<h3>Reputation & progression</h3>${note('Levels and resets are Bungie progression counters. Their meaning varies by activity and season.')}${sections.join('')}<h3>Tracked metrics</h3><div class="metrics-result">${note('Load named metrics such as activity counters and personal records.')}<button type="button" class="load-metrics">Load metrics</button></div>`;
    const commendations = document.createElement('div');
    target.querySelector('.metrics-result').previousElementSibling.before(commendations);
    void withState(commendations, async () => { commendations.innerHTML = `<h3>Commendations</h3>${await commendationsHtml(profile, manifest, signal)}`; });
    target.querySelector('.load-metrics').addEventListener('click', () => {
      const result = target.querySelector('.metrics-result');
      void withState(result, async () => {
        const defs = await manifest.table('DestinyMetricDefinition', signal); signal.throwIfAborted();
        const metrics = Object.entries(profile.metrics?.data?.metrics || {}).map(([hash, item]) => ({ hash, ...item, name: defs[hash]?.displayProperties?.name, description: defs[hash]?.displayProperties?.description })).filter(m => m.name && !defs[m.hash]?.redacted);
        exported.sections.metrics = metrics;
        result.innerHTML = `<label class="metrics-label">Search metrics<input type="search" class="metric-search" placeholder="Name"></label><div class="metric-rows"></div><button type="button" class="metric-more">Show more</button>`;
        let limit = 40;
        function draw() {
          const query = result.querySelector('input').value.toLocaleLowerCase();
          const filtered = metrics.filter(m => m.name.toLocaleLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name));
          result.querySelector('.metric-rows').innerHTML = `<p class="report-note">${filtered.length} matching metrics. Values are raw Bungie counters; some use units specific to that metric.</p><dl class="report-stats compact">${filtered.slice(0, limit).map(m => tile(m.name, number(m.objectiveProgress?.progress))).join('')}</dl>`;
          result.querySelector('.metric-more').hidden = limit >= filtered.length;
        }
        result.querySelector('input').addEventListener('input', () => { limit = 40; draw(); });
        result.querySelector('.metric-more').addEventListener('click', () => { limit += 40; draw(); }); draw();
      });
    });
  }

  function loadComparison() {
    renderPlayerComparison(panel('compare'), {
      primary: { name: bungieName, membership, summary }, loadPrimaryRating: loadRating,
      signal, initialName: new URLSearchParams(window.location.search).get('compare'),
      onResult(comparison) {
        const url = new URL(window.location.href);
        if (comparison) {
          exported.sections.comparison = comparison;
          url.searchParams.set('compare', comparison.name);
        } else {
          delete exported.sections.comparison;
          url.searchParams.delete('compare');
        }
        history.replaceState(null, '', url);
      }
    });
  }
  const linkedSection = window.location.hash.slice(1);
  if (Object.hasOwn(sections, linkedSection)) container.querySelector(`.report-nav [data-section="${linkedSection}"]`)?.click();
  return container.querySelector('.queue-status');
}

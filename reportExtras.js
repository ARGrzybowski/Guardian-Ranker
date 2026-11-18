import { escapeHtml as e } from './html.js';
import { CLASSES, ACTIVITY_MODES, numeric } from './reportData.js';
import { mapConcurrent } from './manifest.js';
import { activityInsights, durationText, aggregateEntries, filterAggregates, matchWeapons, csvText } from './reportInsights.js';

const n = (value, digits = 0) => numeric(value) == null ? 'Unavailable' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const tile = (label, value) => `<div class="report-stat"><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`;
const note = text => `<p class="report-note">${e(text)}</p>`;
const opts = (values, selected = 'all') => Object.entries(values).map(([value, label]) => `<option value="${e(value)}" ${value === selected ? 'selected' : ''}>${e(label)}</option>`).join('');
function saveCSV(headers, rows, filename) {
  const url = URL.createObjectURL(new Blob(['\ufeff', csvText(headers, rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function activityInsightsHtml(activities) {
  const s = activityInsights(activities);
  if (!s.count) return '';
  const days = s.days.slice(-14), maxDay = Math.max(1, ...days.map(d => d.count));
  const partial = [s.kills, s.deaths, s.assists, s.duration].some(v => v.known < s.count);
  return `<div class="activity-insights"><h4>Loaded activity snapshot</h4>${note(`Based only on ${s.count} unique loaded activities; loading older pages expands this sample. ${partial ? 'Some measures have missing data; totals include known values only.' : ''}`)}
    <dl class="report-stats compact">${tile('Kills', n(s.kills.value))}${tile('Deaths', n(s.deaths.value))}${tile('Assists', n(s.assists.value))}${tile(`K/D · ${s.kdSample} complete stat rows`, n(s.kd, 2))}${tile('Recorded time', durationText(s.duration.value))}${tile(`Completion · ${s.completionSample} known results`, s.completionRate == null ? 'Unavailable' : `${n(s.completionRate, 1)}%`)}${tile(`PvP/Gambit wins · ${s.winSample} known results`, s.winRate == null ? 'Unavailable' : `${n(s.winRate, 1)}%`)}</dl>
    <details class="activity-trend"><summary>Activity by day & mode</summary>${note('UTC dates with loaded activity only. Missing dates do not imply zero play. Showing the latest 14 observed dates.')}<div class="activity-day-bars">${days.map(d => `<div class="day-bar-row"><span>${e(d.date)}</span><div><span class="day-bar" style="width:${Math.round(d.count / maxDay * 100)}%"></span></div><strong>${d.count}</strong></div>`).join('')}</div><dl class="report-stats compact">${s.modes.map(m => tile(ACTIVITY_MODES[m.mode] || `Mode ${m.mode}`, n(m.count))).join('')}</dl></details></div>`;
}

export async function renderActivityRecords(target, { api, characters, manifest, signal, onExport }) {
  const definitions = await manifest.table('DestinyActivityDefinition', signal);
  signal.throwIfAborted();
  const responses = new Array(characters.length).fill(null);
  let missing = characters.map((_, i) => i), rows = [], limit = 40;
  target.innerHTML = `<h3>Activity records & endgame</h3>${note('Bungie aggregate statistics for surviving characters. Completions can include checkpoints and are not verified full clears. Activity variants remain separate; deleted characters are excluded.')}<div class="record-coverage" aria-live="polite"></div><div class="report-filters"><label>Search activities<input class="aggregate-search" type="search" placeholder="Raid, dungeon, activity name"></label><label>Category<select class="aggregate-category">${opts({ all: 'All activities', raid: 'Raids', dungeon: 'Dungeons', nightfall: 'Nightfalls', other: 'Other' })}</select></label><label>Character<select class="aggregate-character">${opts({ all: 'All characters', ...Object.fromEntries(characters.map(c => [c.characterId, CLASSES[c.classType] || 'Guardian'])) })}</select></label><label>Sort<select class="aggregate-sort">${opts({ completions: 'Most completions', fastest: 'Fastest completion' })}</select></label><button type="button" class="aggregate-csv">Export filtered CSV</button></div><div class="aggregate-count report-note" aria-live="polite"></div><div class="aggregate-result"></div><button type="button" class="aggregate-more">Show more records</button>`;
  const coverage = target.querySelector('.record-coverage');
  const selection = () => ({ query: target.querySelector('.aggregate-search').value, category: target.querySelector('.aggregate-category').value, character: target.querySelector('.aggregate-character').value, sort: target.querySelector('.aggregate-sort').value });
  function draw() {
    const filtered = filterAggregates(rows, selection());
    target.querySelector('.aggregate-count').textContent = `${filtered.length.toLocaleString()} character/activity records · ${Math.min(limit, filtered.length)} shown`;
    target.querySelector('.aggregate-result').innerHTML = filtered.length ? `<div class="report-table-wrap"><table class="report-table"><caption class="sr-only">Per-character activity records</caption><thead><tr><th>Activity</th><th>Character</th><th>Completions</th><th>Fastest completion</th><th>Kills</th><th>Deaths</th><th>Time played</th></tr></thead><tbody>${filtered.slice(0, limit).map(row => `<tr><td><strong>${e(row.name)}</strong><span class="report-note"> · ${e(row.category)}</span><details><summary>Variant details</summary><p>${e(row.description)}</p><p>Activity hash: ${e(row.hash)}</p></details></td><td>${e(row.characterName)}</td><td>${e(n(row.completions))}</td><td>${e(durationText(row.fastest))}</td><td>${e(n(row.kills))}</td><td>${e(n(row.deaths))}</td><td>${e(durationText(row.seconds))}</td></tr>`).join('')}</tbody></table></div>` : note('No public records match these filters.');
    target.querySelector('.aggregate-more').hidden = filtered.length <= limit;
  }
  async function fetchMissing() {
    coverage.innerHTML = note('Loading activity counters…');
    const indices = [...missing];
    const results = await Promise.allSettled(indices.map(i => api.aggregates(characters[i].characterId, signal)));
    signal.throwIfAborted();
    results.forEach((result, i) => { if (result.status === 'fulfilled') responses[indices[i]] = result.value; });
    missing = characters.map((_, i) => i).filter(i => responses[i] == null);
    rows = aggregateEntries(responses, characters, definitions);
    onExport({ coverage: { charactersLoaded: characters.length - missing.length, charactersTotal: characters.length, missingCharacterIds: missing.map(i => characters[i].characterId) }, rows });
    coverage.innerHTML = note(`${characters.length - missing.length} / ${characters.length} characters loaded.${missing.length ? ` Missing: ${missing.map(i => CLASSES[characters[i].classType] || 'Guardian').join(', ')}.` : ''}`) + (missing.length ? '<button type="button" class="aggregate-retry">Retry missing characters</button>' : '');
    coverage.querySelector('button')?.addEventListener('click', () => { void fetchMissing().catch(showError); }, { once: true });
    draw();
  }
  function showError(error) {
    if (signal.aborted) return;
    coverage.innerHTML = note(`Activity counters could not load: ${error.message}`) + '<button type="button">Retry missing characters</button>';
    coverage.querySelector('button').addEventListener('click', () => void fetchMissing().catch(showError), { once: true });
  }
  target.querySelectorAll('input,select').forEach(control => control.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', () => { limit = 40; draw(); }));
  target.querySelector('.aggregate-more').addEventListener('click', () => { limit += 40; draw(); });
  target.querySelector('.aggregate-csv').addEventListener('click', () => saveCSV(
    ['Activity', 'Activity hash', 'Character', 'Character ID', 'Completions (Bungie)', 'Fastest seconds', 'Kills', 'Deaths', 'Seconds played'],
    filterAggregates(rows, selection()).map(r => [r.name, r.hash, r.characterName, r.characterId, r.completions, r.fastest, r.kills, r.deaths, r.seconds]), 'guardian_activity_records.csv'));
  await fetchMissing();
}

export async function gearStatsHtml(instanceId, profile, manifest, signal) {
  const stats = Object.entries(profile.itemComponents?.stats?.data?.[instanceId]?.stats || {});
  if (!stats.length) return note('Detailed item stats are unavailable.');
  const rows = await mapConcurrent(stats, async ([hash, stat]) => {
    const definition = await manifest.definition('DestinyStatDefinition', hash, signal);
    return tile(definition?.displayProperties?.name || `Stat ${hash}`, n(stat.value));
  }, signal, 2);
  signal.throwIfAborted();
  return `<dl class="report-stats compact item-stats">${rows.join('')}</dl>`;
}

export function mountMatchWeapons(target, data, { manifest, signal, isCurrent }) {
  const entries = data.entries || [];
  const available = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.extended?.weapons?.length);
  target.innerHTML = `<h4>Weapons used in this match</h4>${note('Weapon-specific kills and precision-kill percentage from the match report. This is not shot accuracy. Missing weapons or values are not treated as zero.')}${available.length ? `<label class="metrics-label">Participant<select class="weapon-participant">${available.map(({ entry, index }) => {
    const user = entry.player?.destinyUserInfo || {};
    return `<option value="${index}">${e(user.bungieGlobalDisplayName || user.displayName || `Guardian ${index + 1}`)} · ${e(CLASSES[entry.player?.classType] || 'Guardian')}</option>`;
  }).join('')}</select></label><div class="weapon-result"></div>` : note('Bungie did not expose weapon details for this match.')}`;
  if (!available.length) return;
  let version = 0;
  async function draw() {
    const current = ++version, select = target.querySelector('select'), result = target.querySelector('.weapon-result');
    const weapons = matchWeapons(entries[Number(select.value)]);
    result.innerHTML = note('Resolving weapon names…');
    try {
      const rows = await mapConcurrent(weapons, async weapon => {
        const def = await manifest.definition('DestinyInventoryItemDefinition', weapon.hash, signal);
        return `<tr><td>${e(def?.displayProperties?.name || `Weapon ${weapon.hash}`)}</td><td>${e(n(weapon.kills))}</td><td>${e(n(weapon.precision))}</td><td>${weapon.precisionRate == null ? 'Unavailable' : `${e(n(weapon.precisionRate, 1))}%`}</td></tr>`;
      }, signal, 2);
      signal.throwIfAborted(); if (current !== version || !isCurrent()) return;
      result.innerHTML = `<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Weapon</th><th>Kills</th><th>Precision kills</th><th>Precision-kill percentage</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    } catch (error) {
      if (signal.aborted || current !== version || !isCurrent()) return;
      result.innerHTML = note(`Weapon details could not load: ${error.message}`) + '<button type="button">Retry weapon details</button>';
      result.querySelector('button').addEventListener('click', () => void draw(), { once: true });
    }
  }
  target.querySelector('select').addEventListener('change', () => void draw());
  void draw();
}

export async function commendationsHtml(profile, manifest, signal) {
  const data = profile.profileCommendations?.data;
  if (!data) return note('Public commendations are unavailable.');
  const rows = await mapConcurrent(Object.entries(data.commendationNodeScoresByHash || {}), async ([hash, score]) => {
    const definition = await manifest.definition('DestinySocialCommendationNodeDefinition', hash, signal);
    if (definition?.redacted) return '';
    const percent = numeric(data.commendationNodePercentagesByHash?.[hash]);
    return tile(definition?.displayProperties?.name || `Commendation group ${hash}`, `${n(score)}${percent == null ? '' : ` · ${n(percent)}%`}`);
  }, signal, 2);
  signal.throwIfAborted();
  return `${note('Bungie commendation scores and category percentages. Category scores can overlap in the hierarchy and must not be summed as received-card counts.')}<dl class="report-stats compact">${tile('Total commendation score', n(data.totalScore))}${rows.join('')}</dl>`;
}

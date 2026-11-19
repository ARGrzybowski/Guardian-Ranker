import { searchExactName, loadPlayerProfile, formatBungieName } from './bungieApi.js';
import { overviewStats } from './reportData.js';
import { bestCrucibleSeasonText, loadGuardianStandings } from './performanceView.js';
import { PERFORMANCE_METRICS } from './performanceRating.js';
import { escapeHtml as e } from './html.js';

const measurements = {
  rank: 'Guardian Rank', highestRank: 'Highest Guardian Rank', power: 'Highest equipped power',
  hours: 'Character time (hours)', triumphScore: 'Lifetime Triumph score', activeScore: 'Active Triumph score',
  collectionAcquired: 'Collections acquired', commendationScore: 'Commendation score'
};
const ratingComponents = '100,200,800,900,1400';
const number = (value, digits = 0) => value == null ? 'Unavailable' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const gapFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2, signDisplay: 'exceptZero'
});
const gap = value => value == null ? '—' : gapFormat.format(value);

function table(caption, left, right, gapLabel, rows) {
  return `<div class="report-table-wrap"><table class="report-table"><caption>${e(caption)}</caption><thead><tr>
    <th scope="col">Measurement</th><th scope="col">${e(left)}</th><th scope="col">${e(right)}</th><th scope="col">${e(gapLabel)}</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function ratingComparison(primary, other, leftStanding, rightStanding) {
  const left = leftStanding.performance, right = rightStanding.performance;
  const leftMetrics = new Map(left?.metrics.map(metric => [metric.id, metric.points]));
  const rightMetrics = new Map(right?.metrics.map(metric => [metric.id, metric.points]));
  const delta = (a, b) => a == null || b == null ? null : a - b;
  const sameModel = leftStanding.version === rightStanding.version;
  const performanceDelta = (a, b) => sameModel ? delta(a, b) : null;
  const rows = PERFORMANCE_METRICS.map(metric => {
    const a = leftMetrics.get(metric.id) ?? null, b = rightMetrics.get(metric.id) ?? null;
    return { ...metric, primary: a, compared: b, difference: performanceDelta(a, b) };
  });
  const difference = performanceDelta(left?.points, right?.points);
  const largest = rows.filter(row => row.difference).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)).slice(0, 3);
  const listedGaps = largest.map(row =>
    `<li>${e(row.name)} · ${number(Math.abs(row.difference), 2)} points in favor of ${e(row.difference > 0 ? primary : other)}</li>`).join('');
  const metrics = rows.map(row => `<tr><th scope="row">${e(row.name)}</th><td>${number(row.primary, 2)}</td><td>${number(row.compared, 2)}</td><td>${gap(row.difference)}</td></tr>`).join('');
  const season = row => bestCrucibleSeasonText(row?.metrics.find(metric => metric.id === 'seasonKd'));
  const percentileRow = (label, a, b, differenceFn = delta) => `<tr><th scope="row">${e(label)}</th><td>${number(a?.percentile, 2)}</td><td>${number(b?.percentile, 2)}</td><td>${gap(differenceFn(a?.percentile, b?.percentile))}</td></tr>`;
  return {
    html: `<h4>Performance comparison · ${e(leftStanding.version)}</h4>
    ${table('Points and standings among eligible Guardians', primary, other, 'First − second', `
      <tr><th scope="row">Performance points</th><td>${number(left?.points, 2)}</td><td>${number(right?.points, 2)}</td><td>${gap(difference)}</td></tr>
      <tr><th scope="row">Best past Crucible season</th><td>${e(season(left))}</td><td>${e(season(right))}</td><td>—</td></tr>
      ${percentileRow('Performance percentile', left, right, performanceDelta)}
      ${percentileRow('Knowledge percentile', leftStanding.knowledge, rightStanding.knowledge)}
      ${percentileRow('Commendations percentile', leftStanding.commendations, rightStanding.commendations)}`)}
    ${difference == null ? '<p class="report-note">An overall gap requires verified points for both accounts under the same scoring model.</p>' : ''}
    ${listedGaps ? `<div class="compare-drivers"><h4>Largest point differences</h4><ul>${listedGaps}</ul></div>` : ''}
    <details class="report-details compare-metrics"><summary>See all performance point contributions</summary>
      ${table('Points by metric', primary, other, 'Points (first − second)', metrics)}
    </details>`,
    data: {
      version: leftStanding.version, overallDifference: difference,
      primary: leftStanding, compared: rightStanding, metrics: rows
    }
  };
}

export function renderPlayerComparison(target, { primary, loadPrimaryRating, signal, initialName, onResult }) {
  target.innerHTML = `<h3>Compare Guardians</h3>
    <form class="compare-form report-filters"><label>Full Bungie name<input type="text" name="guardian" placeholder="Guardian#1234" required autocomplete="off"></label><button type="submit">Compare players</button></form>
    <p class="comparison-status report-note" role="status"></p><div class="comparison-result"></div>`;
  const form = target.querySelector('form');
  const result = target.querySelector('.comparison-result');
  const status = target.querySelector('.comparison-status');
  let current;

  async function compare(name) {
    if (!name) return;
    current?.abort();
    current = new AbortController();
    const requestSignal = AbortSignal.any([signal, current.signal]);
    const live = () => !requestSignal.aborted;
    const updateStatus = message => { if (live()) status.textContent = message; };
    result.replaceChildren();
    result.setAttribute('aria-busy', 'true');
    onResult(null);
    updateStatus(`Finding ${name}…`);
    try {
      const user = await searchExactName(name, requestSignal);
      const other = await loadPlayerProfile(user, requestSignal, undefined, ratingComponents);
      requestSignal.throwIfAborted();
      const otherName = formatBungieName(user);
      const profile = other.profileData.Response;
      const stats = overviewStats(profile);
      const identity = { name: otherName, membership: other.membership, summary: stats, comparedAt: new Date().toISOString() };
      const rows = Object.entries(measurements).map(([key, label]) => {
        const left = key === 'collectionAcquired' && !primary.summary.hasCollections ? null : primary.summary[key];
        const right = key === 'collectionAcquired' && !stats.hasCollections ? null : stats[key];
        return `<tr><th scope="row">${e(label)}</th><td>${number(left)}</td><td>${number(right)}</td><td>${gap(left == null || right == null ? null : left - right)}</td></tr>`;
      }).join('');
      result.innerHTML = `<div class="comparison-ratings"></div>
        <details class="report-details compare-profile" open><summary>Public profile stats</summary>
        ${table('Public profile comparison', primary.name, otherName, 'First − second', rows)}</details>
        <a href="?${e(new URLSearchParams({ name: otherName }).toString())}#rating">Open ${e(otherName)}’s rating report →</a>`;
      onResult(identity);
      updateStatus('Loading cloud standings…');
      const left = loadPrimaryRating();
      const sameAccount = primary.membership.membershipId === other.membership.membershipId && primary.membership.membershipType === other.membership.membershipType;
      const right = sameAccount ? left : loadGuardianStandings(other.membership.membershipId, requestSignal);
      const [primaryRating, otherRating] = await Promise.all([left, right]);
      requestSignal.throwIfAborted();
      const comparison = ratingComparison(primary.name, otherName, primaryRating, otherRating);
      result.querySelector('.comparison-ratings').innerHTML = comparison.html;
      onResult({ ...identity, rating: comparison.data });
      updateStatus('Comparison ready.');
    } catch (error) {
      updateStatus(error.message || 'The comparison could not load. Please try again.');
    } finally {
      if (live()) result.removeAttribute('aria-busy');
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    void compare(form.elements.guardian.value.trim());
  });
  if (initialName) {
    form.elements.guardian.value = initialName;
    void compare(initialName);
  }
}

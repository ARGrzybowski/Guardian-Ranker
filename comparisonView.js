import { searchExactName, loadPlayerProfile, formatBungieName } from './bungieApi.js';
import { characterSummary, createReportApi, overviewStats } from './reportData.js';
import { createAccountRatingLoader } from './ratingView.js';
import { escapeHtml as e } from './html.js';

const measurements = {
  rank: 'Guardian Rank', highestRank: 'Highest Guardian Rank', power: 'Highest equipped power',
  hours: 'Character time (hours)', triumphScore: 'Lifetime Triumph score', activeScore: 'Active Triumph score',
  collectionAcquired: 'Collections acquired', commendationScore: 'Commendation score'
};
const ratingComponents = '100,200,800,900,1400';
const number = (value, digits = 0) => value == null ? 'Unavailable' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const score = value => number(Math.floor(value * 10) / 10, 1);
const gapFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1, signDisplay: 'exceptZero'
});
const gap = value => value == null ? '—' : gapFormat.format(Math.sign(value) * Math.round(Math.abs(value) * 10) / 10);

function overallScore({ score: points, tier, range }) {
  if (tier) return `${score(points)} / 1,000 · ${tier.grade}`;
  return `${points == null ? 'Unrated' : 'Provisional ' + score(points)} · range ${score(range.min)}–${score(range.max)}`;
}

function dimensionScore(dimension, player) {
  if (dimension.score == null) return `Incomplete · ${number(dimension.coverage, 1)}% coverage`;
  return `${score(dimension.score)} · ${e(dimension.tier.grade)}<meter min="0" max="100" value="${dimension.score}" aria-label="${e(player)} ${e(dimension.name)}">/100</meter>`;
}

function metricScore(metric) {
  if (metric.score != null) return `${score(metric.score)} · ${metric.tier.grade}`;
  return metric.status === 'partial' ? `At least ${score(metric.observedScore)} · partial` : 'Unavailable';
}

function table(caption, left, right, gapLabel, rows) {
  return `<div class="report-table-wrap"><table class="report-table"><caption>${e(caption)}</caption><thead><tr>
    <th scope="col">Measurement</th><th scope="col">${e(left)}</th><th scope="col">${e(right)}</th><th scope="col">${e(gapLabel)}</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function ratingComparison(primary, other, primaryRating, otherRating) {
  const dimensionByName = new Map(otherRating.dimensions.map(d => [d.name, d]));
  const metricsById = new Map(otherRating.metrics.map(m => [m.id, m]));
  const rows = primaryRating.metrics.map(left => {
    const right = metricsById.get(left.id);
    return { left, right, difference: left.contribution == null || right.contribution == null ? null : left.contribution - right.contribution };
  });
  const comparable = primaryRating.overall.complete && otherRating.overall.complete;
  const difference = comparable ? primaryRating.overall.score - otherRating.overall.score : null;
  const meaningfulGap = row => row.difference != null && Math.round(Math.abs(row.difference) * 10) > 0;
  const largest = rows.filter(meaningfulGap).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)).slice(0, 3);
  const listedGaps = largest.map(({ left, difference }) =>
    `<li>${e(left.name)} · ${e(number(Math.round(Math.abs(difference) * 10) / 10, 1))} overall points in favor of ${e(difference > 0 ? primary : other)}</li>`).join('');
  const dimensions = primaryRating.dimensions.map(left => {
    const right = dimensionByName.get(left.name);
    const delta = left.score == null || right.score == null ? null : left.score - right.score;
    return `<tr><th scope="row">${e(left.name)} <small>(${left.weight}%)</small></th><td>${dimensionScore(left, primary)}</td><td>${dimensionScore(right, other)}</td><td>${gap(delta)}</td></tr>`;
  }).join('');
  const metrics = rows.map(({ left, right, difference }) => `<tr><th scope="row">${e(left.name)} <small>(${left.weight}%)</small></th><td>${metricScore(left)}</td><td>${metricScore(right)}</td><td>${gap(difference)}</td></tr>`).join('');
  return {
    html: `<h4>Account rating comparison · ${e(primaryRating.version)}</h4>
    ${table('Overall rating and public data coverage', primary, other, 'First − second', `
      <tr><th scope="row">Overall rating</th><td>${overallScore(primaryRating.overall)}</td><td>${overallScore(otherRating.overall)}</td><td>${gap(difference)}</td></tr>
      <tr><th scope="row">Rated metric weight</th><td>${primaryRating.overall.coverage}%</td><td>${otherRating.overall.coverage}%</td><td>—</td></tr>`)}
    ${!comparable ? '<p class="report-note">An overall gap requires two complete ratings. You can still compare metrics rated for both players.</p>' : ''}
    ${listedGaps ? `<div class="compare-drivers"><h4>Largest differences in rated metrics</h4><ul>${listedGaps}</ul></div>` : ''}
    ${table('Five account dimensions · scores out of 100', primary, other, 'First − second', dimensions)}
    <details class="report-details compare-metrics"><summary>All ${rows.length} metric scores and point contributions</summary>
      <p>Metric scores are out of 100. The last column shows how many overall points the metric adds to the first player’s lead, after applying its weight.</p>
      ${table('Metric scores and weighted point differences', primary, other, 'Overall points (first − second)', metrics)}
    </details>`,
    data: {
      version: primaryRating.version, overallDifference: difference,
      primary: { overall: primaryRating.overall, dimensions: primaryRating.dimensions },
      compared: { overall: otherRating.overall, dimensions: otherRating.dimensions },
      metrics: rows.map(({ left, right, difference }) => ({
        id: left.id, primaryScore: left.score, comparedScore: right.score,
        primaryStatus: left.status, comparedStatus: right.status, overallPointDifference: difference
      }))
    }
  };
}

export function renderPlayerComparison(target, { primary, loadPrimaryRating, manifest, signal, initialName, onResult }) {
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
      updateStatus('Calculating rating breakdowns…');
      const left = loadPrimaryRating();
      const sameAccount = primary.membership.membershipId === other.membership.membershipId && primary.membership.membershipType === other.membership.membershipType;
      const right = sameAccount ? left : createAccountRatingLoader({
        profile, characters: characterSummary(profile), api: createReportApi(other.membership), manifest, signal: requestSignal
      })();
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

import { escapeHtml as e } from './html.js';
import { RATING_VERSION, RATING_METRICS, RATING_TIERS, KD_ANCHORS, WIN_ANCHORS, calculateAccountRating } from './accountRating.js';
const n = (v, decimals = 1) => v == null ? 'Unavailable' : Number(v).toLocaleString(undefined, { maximumFractionDigits: decimals });
const scoreText = v => n(v == null ? null : Math.floor(v * 10) / 10);
const note = text => `<p class="report-note">${e(text)}</p>`;

export async function renderAccountRating(target, { profile, characters, api, manifest, signal, onResult }) {
  const requests = [
    { id: 'career', name: 'Career combat statistics', run: () => api.career(signal) },
    { id: 'records', name: 'Title definitions', run: () => manifest.table('DestinyRecordDefinition', signal) },
    { id: 'activities', name: 'Activity definitions', run: () => manifest.table('DestinyActivityDefinition', signal) },
    ...characters.map((c, i) => ({ id: `character-${i}`, name: `Character ${i + 1} activity counters`, run: () => api.aggregates(c.characterId, signal) }))
  ];
  const states = new Map();
  async function load() {
    target.setAttribute('aria-busy', 'true');
    const pending = requests.filter(r => !states.get(r.id)?.ok);
    const results = await Promise.allSettled(pending.map(r => r.run()));
    signal.throwIfAborted();
    results.forEach((result, index) => states.set(pending[index].id, result.status === 'fulfilled'
      ? { ok: true, data: result.value } : { ok: false, message: result.reason?.message || 'Unavailable' }));
    const rating = calculateAccountRating({ profile, characters, career: states.get('career')?.data,
      recordDefinitions: states.get('records')?.data, activityDefinitions: states.get('activities')?.data,
      aggregates: characters.map((_, i) => states.get(`character-${i}`)?.data) });
    rating.calculatedAt = new Date().toISOString();
    rating.sourceStatus = requests.map(r => ({ name: r.name, available: Boolean(states.get(r.id)?.ok), error: states.get(r.id)?.message || null }));
    onResult(rating);
    draw(rating);
    target.removeAttribute('aria-busy');
  }

  function draw(rating) {
    const overall = rating.overall;
    const label = overall.complete ? overall.provisional ? 'Provisional overall rating' : 'Overall account rating' : 'Provisional overall rating · range midpoint';
    const failed = rating.sourceStatus.filter(s => !s.available);
    target.innerHTML = `<p class="eyebrow">GUARDIAN ACCOUNT RATING · ${e(RATING_VERSION)}</p><h3>A complete picture of account achievement</h3>
      ${note('Ten metric ratings combine into a 0–1,000 account rating. This measures public achievements and experience against editorial benchmarks, not global standing or matchmaking skill.')}
      <div class="rating-hero"><div><p class="rating-label">${label}</p><div class="overall-rating-score">${overall.score == null ? 'Unrated' : e(scoreText(overall.score))}<span>${overall.score == null ? '' : ' / 1,000'}</span></div><p class="rating-tier">${overall.tier ? `${e(overall.tier.grade)} · ${e(overall.tier.name)}` : 'Provisional · no overall grade assigned'}</p></div>
      <div class="rating-coverage"><strong>${n(overall.coverage, 0)}% metric-weight coverage</strong>${note(`${rating.metrics.filter(m => m.status === 'rated').length} of 10 metrics fully rated. Calculated ${new Date(rating.calculatedAt).toLocaleString()}.`)}${!overall.complete ? note(`Unresolved-data range: ${scoreText(overall.range.min)}–${scoreText(overall.range.max)} / 1,000. This is a missing-data bound, not a statistical confidence interval.`) : ''}</div></div>
      ${overall.reasons.map(note).join('')}${rating.endgameCoverage.unclassified ? note(`${rating.endgameCoverage.unclassified} historical activity records are outside the recognized endgame catalog and excluded. They do not make the account provisional.`) : ''}${!overall.complete ? note('Private or failed metrics stay unrated. The range midpoint is a display convention, not a probability estimate. At least 70% weight coverage is needed to display it; compare complete ratings separately.') : ''}
      ${failed.length ? `<div class="rating-source-errors">${note(`${failed.length} data source(s) unavailable. Successful results are retained.`)}<button type="button" class="rating-retry">Retry unavailable data</button><details><summary>Unavailable sources</summary><ul>${failed.map(s => `<li>${e(s.name)}: ${e(s.error)}</li>`).join('')}</ul></details></div>` : ''}
      <div class="rating-metric-grid">${rating.metrics.map(metricCard).join('')}</div>
      <details class="rating-methodology"><summary>How the rating works · weights, benchmarks & safeguards</summary>
      <p>Overall points = Σ(metric score × metric weight ÷ 10). Weights total 100%. Metrics are scored from 0 to 100, with a maximum contribution of weight × 10 overall points. Calculations use unrounded values; displayed scores are truncated to one decimal.</p>
      <p>Volume metrics interpolate between milestones using log(1 + value), then cap at 100. Guardian Rank interpolates directly. These versioned benchmarks are design choices, not thresholds estimated from a representative player sample.</p>
      <p>PvP performance = 50 + [matches ÷ (matches + 100)] × [(0.65 × K/D rating + 0.35 × win-rate rating) − 50]. Small samples carry an evidence note and moderated score; they do not withhold the overall grade. Zero recorded activities receives zero experience credit; missing activity statistics remain unrated.</p>
      <p>K/D benchmarks: ${e(KD_ANCHORS.map(([x, y]) => `${x} → ${y}`).join('; '))}. Win-rate benchmarks: ${e(WIN_ANCHORS.map(([x, y]) => `${Math.round(x * 100)}% → ${y}`).join('; '))}.</p>
      <div class="report-table-wrap"><table class="report-table"><caption>Metric weights and volume milestones (value → score)</caption><thead><tr><th>Metric</th><th>Weight</th><th>Benchmarks</th></tr></thead><tbody>${RATING_METRICS.map(m => `<tr><th>${e(m.name)}</th><td>${m.weight}%</td><td>${m.anchors ? e(m.anchors.map(([x, y]) => `${n(x, 0)} → ${y}`).join('; ')) : '65% K/D + 35% win rate, sample adjusted'}</td></tr>`).join('')}</tbody></table></div>
      <p>Tiers: ${e([...RATING_TIERS].reverse().map(t => `${t.min}+ = ${t.grade} ${t.name}`).join('; '))}. Overall tier thresholds use the same scale multiplied by 10. An overall grade requires the public inputs for all ten scoped metrics.</p>
      <p>Partial endgame counters or unresolved title definitions provide only a lower bound and never silently become zero. Unavailable weights expand the missing-data range. Hiding a weak metric cannot create a complete high-grade rating.</p>
      <p>Power, total playtime, activity speed and recent login do not earn points: power changes across releases, playtime includes idle time, and checkpoint times are not comparable full runs. Raid/dungeon counters can include checkpoints. Collections include cosmetics. Commendations can reset or be farmed, so their weight is 2%.</p>
      <p>This model has not been population calibrated. Future benchmark changes require a new scoring version; compare accounts only under the same version and coverage rules.</p></details>`;
    target.querySelector('.rating-retry')?.addEventListener('click', event => {
      event.currentTarget.disabled = true;
      void load().catch(error => { if (!signal.aborted) target.querySelector('.rating-source-errors').insertAdjacentHTML('beforeend', note(error.message)); });
    }, { once: true });
  }

  function metricCard(metric) {
    const partial = metric.status === 'partial';
    const shown = partial ? metric.observedScore : metric.score;
    const contribution = metric.contribution == null ? 'Unrated' : `${scoreText(metric.contribution)} / ${metric.weight * 10}`;
    return `<article class="rating-metric" data-rating-metric="${metric.id}"><div class="rating-metric-heading"><h4>${e(metric.name)}</h4><span>${metric.weight}% weight</span></div>
      <div class="metric-rating-score">${shown == null ? 'Unrated' : `${partial ? 'At least ' : ''}${e(scoreText(shown))}<small> / 100</small>`}</div>
      <p class="rating-grade">${metric.tier ? `${e(metric.tier.grade)} · ${e(metric.tier.name)}` : partial ? 'Partial evidence · no grade' : 'Missing public data'}</p>
      ${shown == null ? '' : `<meter min="0" max="100" value="${shown}" aria-label="${e(metric.name)} score">${scoreText(shown)}</meter>`}
      <p>${e(metric.rationale)}</p>${note(metric.id === 'pvpPerformance' ? metric.evidence.noExperience ? metric.evidence.reason : metric.value == null ? metric.evidence.reason : `K/D: ${metric.evidence.kd == null ? 'no recorded deaths' : n(metric.evidence.kd, 2)} · Wins: ${n(metric.evidence.winRate * 100)}% · ${n(metric.evidence.games, 0)} activities · Evidence factor ${n(metric.evidence.reliability * 100)}%.` : `${n(metric.value, 0)} ${metric.unit}`)}
      <p class="metric-contribution">Overall contribution: <strong>${e(contribution)}</strong> points</p>
      ${metric.evidence.reason && !metric.evidence.noExperience ? note(metric.evidence.reason) : ''}
      ${metric.nextMilestone ? note(`Next milestone: ${n(metric.nextMilestone.value, 0)} ${metric.unit} → ${metric.nextMilestone.score}/100.`) : ''}
      <details><summary>Source & limitations</summary><p>${e(metric.source)}</p>${note(metric.caveat)}${metric.anchors ? note(`${metric.linear ? 'Linear' : 'Logarithmic'} interpolation between the published milestones.`) : ''}</details></article>`;
  }
  await load();
}

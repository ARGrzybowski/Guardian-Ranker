import { escapeHtml as e } from './html.js';
import { RATING_VERSION, RATING_METRICS, RATING_TIERS, KD_ANCHORS, WIN_ANCHORS, PRECISION_ANCHORS, ASSIST_ANCHORS, calculateAccountRating } from './accountRating.js';
import { CLASSES } from './reportData.js';
const n = (v, decimals = 1) => v == null ? 'Unavailable' : Number(v).toLocaleString(undefined, { maximumFractionDigits: decimals });
const scoreText = v => n(v == null ? null : Math.floor(v * 10) / 10);
const note = text => `<p class="report-note">${e(text)}</p>`;

export function createAccountRatingLoader({ profile, characters, api, manifest, signal }) {
  const requests = [
    { id: 'career', name: 'Career combat statistics', run: () => api.career(signal) },
    { id: 'records', name: 'Title definitions', run: () => manifest.table('DestinyRecordDefinition', signal) },
    { id: 'activities', name: 'Activity definitions', run: () => manifest.table('DestinyActivityDefinition', signal) },
    ...characters.map((c, i) => ({ id: `character-${i}`, name: `Character ${i + 1} activity counters`, run: () => api.aggregates(c.characterId, signal) }))
  ];
  const states = new Map();
  let current, inFlight;
  return function load({ retry = false } = {}) {
    signal.throwIfAborted();
    if (inFlight) return inFlight;
    if (current && !retry) return Promise.resolve(current);
    inFlight = calculate().finally(() => { inFlight = null; });
    return inFlight;
  };

  async function calculate() {
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
    current = rating;
    return rating;
  }
}

export async function renderAccountRating(target, { loadRating, signal, onResult, onCompare }) {
  async function load(retry = false) {
    target.setAttribute('aria-busy', 'true');
    try {
      const rating = await loadRating({ retry });
      signal.throwIfAborted();
      onResult(rating);
      draw(rating);
    } finally {
      target.removeAttribute('aria-busy');
    }
  }

  function draw(rating) {
    const overall = rating.overall;
    const label = overall.complete ? 'Overall account rating' : overall.score == null ? 'Insufficient data for an overall rating' : 'Provisional overall rating · range midpoint';
    const failed = rating.sourceStatus.filter(s => !s.available);
    target.innerHTML = `<p class="eyebrow">GUARDIAN ACCOUNT RATING · ${e(RATING_VERSION)}</p><h3>A complete picture of account achievement</h3>
      ${note(`${rating.metrics.length} metric ratings across five dimensions combine into a 0–1,000 account rating. This measures public achievements and experience against editorial benchmarks, not global standing or matchmaking skill.`)}
      <button class="rating-compare" type="button">Compare with another Guardian</button>
      <div class="rating-hero"><div><p class="rating-label">${label}</p><div class="overall-rating-score">${overall.score == null ? 'Unrated' : e(scoreText(overall.score))}<span>${overall.score == null ? '' : ' / 1,000'}</span></div><p class="rating-tier">${overall.tier ? `${e(overall.tier.grade)} · ${e(overall.tier.name)}` : 'Provisional · no overall grade assigned'}</p></div>
      <div class="rating-coverage"><strong>${n(overall.coverage, 0)}% metric-weight coverage</strong>${note(`${rating.metrics.filter(m => m.status === 'rated').length} of ${rating.metrics.length} metrics fully rated. Calculated ${new Date(rating.calculatedAt).toLocaleString()}.`)}${!overall.complete ? note(`Unresolved-data range: ${scoreText(overall.range.min)}–${scoreText(overall.range.max)} / 1,000. This is a missing-data bound, not a statistical confidence interval.`) : ''}</div></div>
      ${overall.reasons.map(note).join('')}${rating.endgameCoverage.unclassified ? note(`${rating.endgameCoverage.unclassified} historical activity records are outside the recognized endgame catalog and excluded. They do not make the account provisional.`) : ''}${!overall.complete ? note('Private or failed metrics stay unrated. A provisional score appears once public data covers 70% of metric weight. It shows the midpoint of the possible range.') : ''}
      ${failed.length ? `<div class="rating-source-errors">${note(`${failed.length} data source(s) unavailable. Successful results are retained.`)}<button type="button" class="rating-retry">Retry unavailable data</button><details><summary>Unavailable sources</summary><ul>${failed.map(s => `<li>${e(s.name)}: ${e(s.error)}</li>`).join('')}</ul></details></div>` : ''}
      <h4>Account dimensions</h4><div class="rating-dimensions">${rating.dimensions.map(d => `<article class="rating-dimension"><h5>${e(d.name)}</h5><strong>${d.score == null ? 'Incomplete' : `${scoreText(d.score)} / 100 · ${e(d.tier.grade)}`}</strong>${d.score == null ? note(`${n(d.coverage)}% dimension coverage`) : `<meter min="0" max="100" value="${d.score}" aria-label="${e(d.name)} dimension">${scoreText(d.score)}</meter>`}${note(`${d.weight}% of the overall rating`)}</article>`).join('')}</div>
      ${insights(rating)}
      ${rating.dimensions.map(d => `<section class="rating-metric-group"><h4>${e(d.name)} metrics</h4><div class="rating-metric-grid">${rating.metrics.filter(m => m.group === d.name).map(metricCard).join('')}</div></section>`).join('')}
      <details class="rating-methodology"><summary>Endgame evidence · activity families & classes</summary>
      ${note('Normal, master and prestige activity hashes sharing a PGCR image are grouped into one family. Original activity names are the fallback. Counters can include checkpoints. Ten completions in a family earns repeat-experience credit.')}
      <div class="report-table-wrap"><table class="report-table"><caption>Recognized endgame families</caption><thead><tr><th>Activity</th><th>Type</th><th>Completions</th><th>Repeat milestone</th></tr></thead><tbody>${rating.endgameCoverage.families.map(f => `<tr><th>${e(f.name)}</th><td>${e(f.type)}</td><td>${n(f.completions, 0)}</td><td>${f.completions >= 10 ? '10+ reached' : `${n(10 - f.completions, 0)} to go`}</td></tr>`).join('') || '<tr><td colspan="4">No recognized public completions available.</td></tr>'}</tbody></table></div>
      ${note(rating.endgameCoverage.classCompletions.map(c => `${CLASSES[c.classType]}: ${n(c.completions, 0)} completions${c.completions >= 10 ? ' · developed' : ''}`).join(' / ') || 'No class completion evidence available.')}</details>
      <details class="rating-methodology"><summary>How the rating works · weights, benchmarks & safeguards</summary>
      <p>Overall points = Σ(metric score × metric weight ÷ 10). Weights total 100%. Metrics are scored from 0 to 100, with a maximum contribution of weight × 10 overall points. Calculations use unrounded values; displayed scores are truncated to one decimal.</p>
      <p>Volume metrics interpolate between milestones using log(1 + value), then cap at 100. Guardian Rank interpolates directly. These versioned benchmarks are design choices, not thresholds estimated from a representative player sample.</p>
      <p>PvP performance = 50 + [matches ÷ (matches + 100)] × [(0.65 × K/D rating + 0.35 × win-rate rating) − 50]. Small samples carry an evidence note and moderated score; they do not withhold the overall grade. Zero recorded activities receives zero experience credit; missing activity statistics remain unrated.</p>
      <p>K/D benchmarks: ${e(KD_ANCHORS.map(([x, y]) => `${x} → ${y}`).join('; '))}. Win-rate benchmarks: ${e(WIN_ANCHORS.map(([x, y]) => `${Math.round(x * 100)}% → ${y}`).join('; '))}.</p>
      <p>Precision share = precision kills ÷ all kills, with benchmarks ${e(PRECISION_ANCHORS.map(([x, y]) => `${x}% → ${y}`).join('; '))}. Its score is 50 + [kills ÷ (kills + 500)] × (raw score − 50). Assists use assists ÷ activities, with benchmarks ${e(ASSIST_ANCHORS.map(([x, y]) => `${x} → ${y}`).join('; '))} and activities ÷ (activities + 100) moderation. Explicit zero participation earns zero; unavailable counters remain unrated.</p>
      <div class="report-table-wrap"><table class="report-table"><caption>Metric weights and volume milestones (value → score)</caption><thead><tr><th>Metric</th><th>Weight</th><th>Benchmarks</th></tr></thead><tbody>${RATING_METRICS.map(m => `<tr><th>${e(m.name)}</th><td>${m.weight}%</td><td>${m.anchors ? e(m.anchors.map(([x, y]) => `${n(x, 0)} → ${y}`).join('; ')) : m.id === 'pvpPerformance' ? '65% K/D + 35% win rate, sample adjusted' : m.id === 'pvpAssists' ? 'Assists per activity, sample adjusted' : 'Precision-kill share, sample adjusted'}</td></tr>`).join('')}</tbody></table></div>
      <p>Tiers: ${e([...RATING_TIERS].reverse().map(t => `${t.min}+ = ${t.grade} ${t.name}`).join('; '))}. Overall tier thresholds use the same scale multiplied by 10. An overall grade requires the public inputs for all ${rating.metrics.length} scoped metrics. Dimensions are summaries of these same weights, not additional points.</p>
      <p>Partial endgame counters or unresolved title definitions provide only a lower bound and never silently become zero. Unavailable weights expand the missing-data range. Hiding a weak metric cannot create a complete high-grade rating.</p>
      <p>Power, total playtime, activity speed and recent login do not earn points: power changes across releases, playtime includes idle time, and checkpoint times are not comparable full runs. Raid/dungeon counters can include checkpoints. Collections include cosmetics. Commendations can reset or be farmed, so their weight is 2%.</p>
      <p>This model has not been population calibrated. Future benchmark changes require a new scoring version; compare accounts only under the same version and coverage rules.</p></details>`;
    target.querySelector('.rating-compare').addEventListener('click', onCompare);
    target.querySelector('.rating-retry')?.addEventListener('click', event => {
      event.currentTarget.disabled = true;
      void load(true).catch(error => {
        if (signal.aborted) return;
        target.querySelector('.rating-source-errors')?.insertAdjacentHTML('beforeend', note(error.message));
      });
    }, { once: true });
  }

  function insights(rating) {
    const rated = rating.metrics.filter(m => m.status === 'rated');
    const strengths = [...rated].sort((a, b) => b.score - a.score || b.weight - a.weight).slice(0, 3);
    const opportunities = rated.filter(m => m.nextMilestone).map(m => ({ ...m, gain: (m.nextMilestone.score - m.score) * m.weight / 10 })).sort((a, b) => b.gain - a.gain).slice(0, 3);
    return `<div class="rating-insights"><article><h4>Strongest rated areas</h4><ul>${strengths.map(m => `<li>${e(m.name)} · ${scoreText(m.score)}/100 · ${e(m.tier.grade)}</li>`).join('') || '<li>Waiting for public evidence.</li>'}</ul></article><article><h4>Next milestones</h4><ul>${opportunities.map(m => `<li>${e(m.name)}: ${n(m.nextMilestone.value, 0)} ${e(m.unit)} · up to +${scoreText(m.gain)} overall points from this metric</li>`).join('') || '<li>No further volume milestone in the available metrics.</li>'}</ul>${note('Point gains reflect the listed metric alone.')}</article></div>`;
  }

  function metricCard(metric) {
    const partial = metric.status === 'partial';
    const shown = partial ? metric.observedScore : metric.score;
    const contribution = metric.contribution == null ? 'Unrated' : `${scoreText(metric.contribution)} / ${metric.weight * 10}`;
    return `<article class="rating-metric" data-rating-metric="${metric.id}"><div class="rating-metric-heading"><h4>${e(metric.name)}</h4><span>${metric.weight}% weight</span></div>
      <div class="metric-rating-score">${shown == null ? 'Unrated' : `${partial ? 'At least ' : ''}${e(scoreText(shown))}<small> / 100</small>`}</div>
      <p class="rating-grade">${metric.tier ? `${e(metric.tier.grade)} · ${e(metric.tier.name)}` : partial ? 'Partial evidence · no grade' : 'Missing public data'}</p>
      ${shown == null ? '' : `<meter min="0" max="100" value="${shown}" aria-label="${e(metric.name)} score">${scoreText(shown)}</meter>`}
      <p>${e(metric.rationale)}</p>${note(metric.evidence.detail || (metric.id === 'pvpPerformance' ? metric.evidence.noExperience ? metric.evidence.reason : metric.value == null ? metric.evidence.reason : `K/D: ${metric.evidence.kd == null ? 'no recorded deaths' : n(metric.evidence.kd, 2)} · Wins: ${n(metric.evidence.winRate * 100)}% · ${n(metric.evidence.games, 0)} activities · Evidence factor ${n(metric.evidence.reliability * 100)}%.` : `${n(metric.value, 0)} ${metric.unit}`))}
      <p class="metric-contribution">Overall contribution: <strong>${e(contribution)}</strong> points</p>
      ${metric.evidence.reason && !metric.evidence.noExperience ? note(metric.evidence.reason) : ''}
      ${metric.nextMilestone ? note(`Next milestone: ${n(metric.nextMilestone.value, 0)} ${metric.unit} → ${metric.nextMilestone.score}/100.`) : ''}
      <details><summary>Source & limitations</summary><p>${e(metric.source)}</p>${note(metric.caveat)}${metric.anchors ? note(`${metric.linear ? 'Linear' : 'Logarithmic'} interpolation between the published milestones.`) : ''}</details></article>`;
  }
  await load();
}

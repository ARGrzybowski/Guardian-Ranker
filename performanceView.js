import { getDatabase } from './database.js';
import { escapeHtml as e } from './html.js';
import { PERFORMANCE_METRICS, PERFORMANCE_VERSION } from './performanceRating.js';

const n = (value, digits = 0) => value == null ? 'Unavailable' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const note = message => `<p class="report-note">${e(message)}</p>`;

async function lookup(table, columns, membershipId, signal) {
  const query = getDatabase().from(table).select(columns).eq('membership_id', membershipId);
  const { data, error } = await query.abortSignal(signal).maybeSingle();
  signal.throwIfAborted();
  if (error) throw error;
  return data;
}

export async function loadGuardianStandings(membershipId, signal) {
  const standing = 'standing,cohort_size,percentile';
  const result = await Promise.allSettled([
    lookup('guardian_activity_reports', `rating_version,points,eligible,metrics,last_rated_at,${standing}`, membershipId, signal),
    lookup('guardian_knowledge_rankings', `triumph_score,${standing}`, membershipId, signal),
    lookup('guardian_commendation_rankings', `commendations,${standing}`, membershipId, signal)
  ]);
  signal.throwIfAborted();
  const read = index => result[index].status === 'fulfilled' ? result[index].value : null;
  return {
    version: read(0)?.rating_version ?? PERFORMANCE_VERSION, performance: read(0), knowledge: read(1), commendations: read(2),
    performanceUnavailable: result[0].status !== 'fulfilled',
    knowledgeUnavailable: result[1].status !== 'fulfilled',
    commendationsUnavailable: result[2].status !== 'fulfilled'
  };
}

function standingText(row) {
  return row?.standing == null ? '' : `#${n(row.standing)} of ${n(row.cohort_size)} eligible Guardians`;
}

function cohortDescription(row, fallback) {
  if (row?.percentile != null) return `Matches or exceeds ${n(row.percentile, 2)}% of eligible Guardians`;
  if (row?.standing != null) return 'Percentiles open when 30 Guardians qualify';
  return fallback;
}

function recognitionCard(name, row, rawValue, unit, floor, unavailable) {
  return `<article class="rating-dimension"><h5>${e(name)}</h5>
    <strong>${e(n(rawValue))} ${e(unit)}</strong>
    ${note(unavailable ? 'Standing temporarily unavailable' : cohortDescription(row, 'No eligible public snapshot'))}
    ${row?.standing != null ? note(standingText(row)) : note(floor)}
  </article>`;
}

function metricEvidence(metric) {
  if (metric.events?.length) return metric.events.filter(event => !event.tier).map(event => event.name).join(', ');
  if (metric.families != null && metric.value != null) return `${n(metric.value)} completions across ${n(metric.families)} activity families`;
  if (metric.unit === 'K/D') {
    if (metric.id === 'seasonKd' && !metric.currentComplete) return 'Current-season match history is still indexing.';
    if (metric.matches === 0 && metric.points === 0) return 'No recorded matches';
    if (metric.kills != null && metric.deaths != null) {
      return `${metric.deaths ? n(metric.value, 2) + ' K/D' : 'No recorded deaths'} · ${n(metric.kills)} kills · ${n(metric.deaths)} deaths · ${n(metric.matches)} matches`;
    }
    return 'Public K/D counters unavailable';
  }
  return metric.value == null ? 'Public evidence unavailable' : `${n(metric.value, 2)} ${metric.unit}`;
}

export function bestCrucibleSeasonText(metric) {
  const best = metric?.bestSeason;
  if (!best) return metric?.historyComplete ? 'No scored past season' : 'History still indexing';
  return `${best.name} · ${n(best.points)} points · ${best.value == null ? 'No recorded deaths' : `${n(best.value, 2)} K/D`} · ${n(best.matches)} matches${metric.historyComplete ? '' : ' · history still indexing'}`;
}

function metricBreakdown(metric) {
  if (metric.activities?.length) {
    return `<details><summary>Points by activity</summary><ul>${metric.activities.map(activity =>
      `<li>${e(activity.name)} · ${n(activity.completions)} clears · ${n(activity.points, 2)} points</li>`).join('')}</ul></details>`;
  }
  if (metric.events?.some(event => event.tier)) {
    return `<ul>${metric.events.map(event =>
      `<li>${e(event.name)} · ${e(event.tier)} · ${n(event.points)} points</li>`).join('')}</ul>`;
  }
  return '';
}

export function drawPerformanceRating(target, { standing, summary, onCompare, onRefresh }) {
  const row = standing.performance;
  const previousModel = row && row.rating_version !== PERFORMANCE_VERSION;
  const metrics = (row?.metrics || []).map(metric => metric.id === 'recentKd'
    ? PERFORMANCE_METRICS.find(entry => entry.id === 'seasonKd') : metric);
  const groups = [...new Set(metrics.map(metric => metric.group))];
  const result = row?.points == null ? 'Unrated' : `${n(row.points, 2)} points`;
  let status = 'Waiting for a verified cloud score.';
  if (standing.performanceUnavailable) status = 'Performance data is temporarily unavailable.';
  else if (row?.points == null && row) status = 'Some required public evidence is unavailable.';
  else if (row && !row.eligible) status = 'Qualify with 20 recorded raid, dungeon or Grandmaster clears, 100 Crucible matches, or one verified contest or solo dungeon clear.';
  else if (row?.eligible) status = cohortDescription(row, '');
  target.innerHTML = `<p class="eyebrow">GUARDIAN PERFORMANCE · ${e(standing.version)}</p><h3>Performance rating</h3>
    ${previousModel ? note('Showing the prior scoring model while the revised standings collect 30 verified eligible accounts.') : ''}
    <div class="report-actions"><button class="rating-compare" type="button">Compare with another Guardian</button>
    <button class="rating-refresh" type="button">Refresh standings</button></div>
    <div class="rating-hero"><div><p class="rating-label">Overall performance</p><div class="overall-rating-score">${e(result)}</div>
      <p class="rating-tier">${e(status)}</p></div>
      <div class="rating-coverage">${row?.standing != null ? note(standingText(row)) : ''}
        ${row?.last_rated_at ? note(`Updated ${new Date(row.last_rated_at).toLocaleString()}`) : ''}</div>
    </div>
    <h4>Knowledge and commendations</h4>
    <div class="rating-dimensions">
      ${recognitionCard('Knowledge', standing.knowledge, standing.knowledge?.triumph_score ?? summary.triumphScore, 'Triumph points', 'Requires lifetime Guardian Rank 7 and 10,000 Triumph points.', standing.knowledgeUnavailable)}
      ${recognitionCard('Commendations', standing.commendations, standing.commendations?.commendations ?? summary.commendationScore, 'commendation score', 'Requires lifetime Guardian Rank 7 and 500 commendation score.', standing.commendationsUnavailable)}
    </div>
    ${groups.map(group => `<section class="rating-metric-group"><h4>${e(group)}</h4><div class="rating-metric-grid">
      ${metrics.filter(metric => metric.group === group).map(metric => `<article class="rating-metric">
        <div class="rating-metric-heading"><h4>${e(metric.name)}</h4></div>
        <div class="metric-rating-score">${metric.points == null ? 'Unavailable' : `${n(metric.points, 2)} <small>points</small>`}</div>
        ${metric.id !== 'dungeonSolo' || !metric.events?.length ? note(metricEvidence(metric)) : ''}
        ${metricBreakdown(metric)}
        ${metric.id === 'competitivePeak' ? note('Highest public division score observed by Guardian Ranker since tracking began.') : ''}
        ${metric.id === 'seasonKd' ? `<p class="report-note">${metric.seasonName ? `${e(metric.seasonName)} · ` : ''}All available current-season matches</p>
          <div class="crucible-best-season"><strong>Best past season</strong>${note(bestCrucibleSeasonText(metric))}${note('Past-season scores are informational.')}</div>` : ''}
      </article>`).join('')}
    </div></section>`).join('')}
    ${!previousModel ? `<details class="rating-methodology"><summary>How points and standings work</summary>
      <p>The first clear of each raid, dungeon, named Grandmaster Nightfall and Solo Ops mission earns the most. Each subsequent clear of that same activity earns less than the previous one. The same rule applies to repeat Trials flawless passages. Aggregate completions can include checkpoints.</p>
      <p>Each verified contest raid awards 250 points and each verified contest dungeon awards 200. In each dungeon, a verified solo clear earns 50 points and a solo flawless earns 120. Only the strongest verified solo tier earns credit.</p>
      <p>Time played and aggregate fastest times carry zero points. Speed would require a verified full run and a comparable difficulty and ruleset.</p>
      <p>Crucible points come from the best observed Competitive score, Trials flawless passages, and lifetime and current-season K/D. Past-season points are informational.</p>
      <p>Standings use fresh public snapshots of tracked, eligible Guardians. Each percentile shows the share of its cohort at or below the player’s score. Knowledge and commendations have their own cohorts.</p>
    </details>` : ''}`;
  target.querySelector('.rating-compare').addEventListener('click', onCompare);
  target.querySelector('.rating-refresh').addEventListener('click', onRefresh);
}

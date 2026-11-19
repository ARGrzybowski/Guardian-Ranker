import { bungieRequest } from './bungieApi.js';
import { MONUMENT_START } from './crucibleSeasons.js';
import { escapeHtml as e } from './html.js';
import { bungieImage, createManifestClient } from './manifest.js?v=20261119-sidebar';

const manifest = createManifestClient();
const gameStats = document.getElementById('game-stats');
const get = id => gameStats.querySelector(`#${id}`);
const day = 24 * 60 * 60 * 1000;
const resetFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const seasonDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });

function time(date, formatter = resetFormat) {
  const value = new Date(date);
  return `<time datetime="${value.toISOString()}">${e(formatter.format(value))}</time>`;
}

function nextReset(now, weekly = false) {
  const reset = new Date(now);
  reset.setUTCHours(17, 0, 0, 0);
  if (weekly) reset.setUTCDate(reset.getUTCDate() + (2 - reset.getUTCDay() + 7) % 7);
  return +reset + (+reset <= now ? (weekly ? 7 : 1) * day : 0);
}

function countdown(reset, now) {
  const remaining = Math.ceil((reset - now) / 60000);
  const days = Math.floor(remaining / 1440);
  const hours = Math.floor(remaining % 1440 / 60);
  const minutes = remaining % 60;
  return `${time(reset)} <span class="game-countdown">in ${days ? `${days}d ` : ''}${hours ? `${hours}h ` : ''}${minutes}m</span>`;
}

function renderResets() {
  const now = Date.now();
  const weekly = nextReset(now, true);
  get('weekly-reset-timer').innerHTML = countdown(weekly, now);
  get('daily-reset-timer').innerHTML = countdown(nextReset(now), now);
  get('current-game-week').innerHTML = time(weekly - 7 * day);
}

async function readSeason() {
  const { Response } = await bungieRequest('/Settings/');
  const settings = Response?.destiny2CoreSettings ?? Response;
  if (!settings) throw new Error('Season settings unavailable.');
  const hash = Number(settings.currentSeasonHash ?? Response.currentSeasonHash) >>> 0;
  const season = hash ? await manifest.definition('DestinySeasonDefinition', hash) : null;
  const name = season?.displayProperties?.name?.replace(/^Season:\s*/i, '');
  return { settings, hash, season, name, monument: name === 'Monument of Triumph' };
}

function renderSeason(state) {
  const summary = get('game-season');
  if (!state?.name) {
    summary.textContent = 'Current season unavailable.';
    return;
  }
  const icon = bungieImage(state.season.displayProperties?.icon);
  const title = state.season.seasonNumber ? `Season ${state.season.seasonNumber}: ${state.name}` : state.name;
  summary.innerHTML = `${icon ? `<img src="${e(icon)}" alt="">` : ''}<span>${e(title)}</span>`;
}

// Details fetch their data only when opened. A failed request can be retried by reopening.
function loadWhenOpened(details, target, load) {
  let pending = false;
  let expiresAt = 0;
  details.addEventListener('toggle', async () => {
    if (!details.open || pending || Date.now() < expiresAt) return;
    pending = true;
    target.textContent = 'Loading…';
    try {
      const { html, expires = Infinity } = await load();
      target.innerHTML = html;
      expiresAt = expires;
    } catch {
      target.textContent = 'Bungie data is temporarily unavailable. Reopen this section to retry.';
    } finally {
      pending = false;
    }
  });
}

function fact(label, value) {
  return `<div><dt>${e(label)}</dt><dd>${value}</dd></div>`;
}

async function seasonDetails(state) {
  const { settings, season, monument } = state;
  const [artifact, pass] = await Promise.all([
    manifest.definition('DestinyArtifactDefinition', settings.currentSeasonalArtifactHash).catch(() => null),
    manifest.definition('DestinySeasonPassDefinition', settings.currentSeasonPassHash).catch(() => null)
  ]);
  const start = Date.parse(monument ? MONUMENT_START : season?.startDate);
  const end = Date.parse(season?.endDate);
  const fields = [
    fact('Launched', Number.isFinite(start) ? time(start, seasonDateFormat) : 'Unavailable'),
    fact('End date', monument ? 'No announced end date' : Number.isFinite(end) ? time(end, seasonDateFormat) : 'Unavailable'),
    fact('Seasonal artifact', e(artifact?.displayProperties?.name || 'Unavailable')),
    fact('Reward pass', e(pass?.displayProperties?.name || 'Unavailable'))
  ];
  if (monument) fields.push(fact('Gear Power cap', '550'));
  const source = monument ? '<p class="game-note"><a href="https://help.bungie.net/hc/en-us/articles/50100493304468--13-Monument-of-Triumph-FAQ">Monument of Triumph FAQ</a></p>' : '';
  get('season-download').hidden = !state.hash;
  return { html: `<dl class="game-facts">${fields.join('')}</dl>${source}` };
}

async function liveMilestones() {
  const [{ Response }, definitions] = await Promise.all([
    bungieRequest('/Destiny2/Milestones/'),
    manifest.table('DestinyMilestoneDefinition')
  ]);
  if (!Response) throw new Error('Milestone data unavailable.');
  const now = Date.now();
  const rows = Object.entries(Response).flatMap(([hash, milestone]) => {
    const definition = definitions[milestone.milestoneHash ?? hash];
    const name = definition?.displayProperties?.name;
    const start = Date.parse(milestone.startDate);
    const end = Date.parse(milestone.endDate);
    if (!name || definition.redacted || start > now || end <= now) return [];
    const activities = milestone.activities ?? [];
    const challenges = new Set(activities.flatMap(activity => activity.challengeObjectiveHashes ?? [])).size;
    return [{ name, end, challenges }];
  }).sort((a, b) => b.challenges - a.challenges || a.name.localeCompare(b.name));

  const entries = rows.map(({ name, end, challenges }) => {
    const metadata = [
      challenges ? `${challenges} ${challenges === 1 ? 'challenge' : 'challenges'}` : '',
      Number.isFinite(end) ? `Ends ${time(end)}` : ''
    ].filter(Boolean);
    return `<li><strong>${e(name)}</strong>${metadata.length ? `<span class="game-note">${metadata.join(' · ')}</span>` : ''}</li>`;
  });
  const html = entries.length ? `<ul class="game-milestones-list" role="list">${entries.join('')}</ul>` : '<p>No live milestones listed by Bungie.</p>';
  return { html, expires: Math.min(nextReset(now), ...rows.filter(row => Number.isFinite(row.end)).map(row => row.end)) };
}

async function downloadSeasonData() {
  const button = get('downloadSeasonDataBtn');
  const status = get('season-download-status');
  button.disabled = true;
  status.textContent = 'Preparing download…';
  try {
    const [{ hash }, seasonData] = await Promise.all([currentSeason(), manifest.table('DestinySeasonDefinition')]);
    const blob = new Blob([JSON.stringify({ seasonData, currentSeasonHash: hash }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'season-data.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = '';
  } catch {
    status.textContent = 'Season data could not be downloaded. Try again.';
  } finally {
    button.disabled = false;
  }
}

let seasonRequest;
function currentSeason() {
  seasonRequest ??= readSeason().catch(error => {
    seasonRequest = null;
    throw error;
  });
  return seasonRequest;
}

renderResets();
setInterval(renderResets, 60000);
void currentSeason().then(renderSeason, () => renderSeason(null));
loadWhenOpened(get('game-season-details'), get('game-season-facts'), async () => {
  const state = await currentSeason();
  renderSeason(state);
  return seasonDetails(state);
});
loadWhenOpened(get('game-milestones-details'), get('game-milestones'), liveMilestones);
get('downloadSeasonDataBtn').addEventListener('click', downloadSeasonData);

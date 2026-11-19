import { bungieRequest } from './bungieApi.js';

export const REPORT_COMPONENTS = '100,104,200,202,204,205,300,304,305,800,900,1100,1400';
export const CLASSES = ['Titan', 'Hunter', 'Warlock'];
export const PLATFORMS = { 1: 'Xbox', 2: 'PlayStation', 3: 'Steam', 4: 'Blizzard', 5: 'Stadia', 6: 'Epic Games', 10: 'Demon' };
export const ACTIVITY_MODES = { 0: 'All activities', 2: 'Story', 3: 'Strikes', 4: 'Raids', 5: 'Crucible', 16: 'Nightfalls', 63: 'Gambit', 82: 'Dungeons', 84: 'Trials of Osiris' };

export function numeric(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function statValue(stats, key) { return numeric(stats?.[key]?.basic?.value); }
export function ratio(a, b) { return a == null || b == null || b === 0 ? null : a / b; }
export function dateText(value, time = false) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? (time ? date.toLocaleString() : date.toLocaleDateString()) : 'Unavailable';
}
export function characterSummary(profile) {
  return Object.values(profile.characters?.data || {}).sort((a, b) => (Date.parse(b.dateLastPlayed) || 0) - (Date.parse(a.dateLastPlayed) || 0));
}
export function overviewStats(profile) {
  const characters = characterSummary(profile);
  const records = profile.profileRecords?.data;
  const collections = collectionEntries(profile);
  const minutes = characters.map(c => numeric(c.minutesPlayedTotal));
  return {
    hours: minutes.some(v => v != null) ? Math.floor(minutes.reduce((a, v) => a + (v || 0), 0) / 60) : null,
    lastPlayed: characters[0]?.dateLastPlayed,
    power: characters.length ? Math.max(...characters.map(c => numeric(c.light) || 0)) : null,
    triumphScore: records?.lifetimeScore ?? null,
    activeScore: records?.activeScore ?? null,
    legacyScore: records?.legacyScore ?? null,
    rank: profile.profile?.data?.currentGuardianRank ?? null,
    highestRank: profile.profile?.data?.lifetimeHighestGuardianRank ?? null,
    renewedRank: profile.profile?.data?.renewedGuardianRank ?? null,
    commendationScore: profile.profileCommendations?.data?.totalScore ?? null,
    collectionTotal: collections.length,
    collectionAcquired: collections.filter(c => c.acquired).length,
    hasCollections: profile.profileCollectibles?.data != null || Object.values(profile.characterCollectibles?.data || {}).some(c => c.collectibles != null)
  };
}

// A collectible may live at profile or character scope. Acquired on any visible
// character means acquired; never double count a shared collectible hash.
export function collectionEntries(profile) {
  const merged = new Map();
  const scopes = [profile.profileCollectibles?.data, ...Object.values(profile.characterCollectibles?.data || {})];
  for (const scope of scopes) for (const [hash, item] of Object.entries(scope?.collectibles || {})) {
    const acquired = (item.state & 1) === 0;
    merged.set(hash, { hash, ...item, acquired: acquired || merged.get(hash)?.acquired || false });
  }
  return [...merged.values()];
}
export function recordEntries(profile) {
  const merged = new Map();
  const scopes = [profile.profileRecords?.data, ...Object.values(profile.characterRecords?.data || {})];
  for (const scope of scopes) for (const [hash, record] of Object.entries(scope?.records || {})) {
    if (record.state & 16) continue;
    const entry = { hash, ...record, complete: (record.state & 4) === 0, redeemed: Boolean(record.state & 1), titleUnlocked: Boolean(record.state & 64) };
    const previous = merged.get(hash);
    if (!previous || (entry.complete && !previous.complete) || (entry.redeemed && !previous.redeemed)) merged.set(hash, entry);
  }
  return [...merged.values()];
}
export function catalogueEntries(profile, type, definitions) {
  const entries = type === 'records' ? recordEntries(profile) : collectionEntries(profile);
  return entries.map(entry => {
    const definition = definitions[entry.hash];
    const obscured = type === 'records' && Boolean(entry.state & 8);
    return { ...entry, definition, name: obscured ? 'Secret triumph' : definition?.displayProperties?.name || `Unknown ${type === 'records' ? 'triumph' : 'collectible'} (${entry.hash})`,
      description: obscured ? definition?.stateInfo?.obscuredDescription || 'Keep playing to reveal this triumph.' : definition?.displayProperties?.description || '',
      obscured };
  }).filter(entry => !entry.definition?.redacted && !entry.definition?.displayProperties?.name?.startsWith('Classified'));
}
export function filterCatalogue(entries, query = '', filter = 'all', type = 'records') {
  const search = query.trim().toLocaleLowerCase();
  return entries.filter(e => (!search || `${e.name} ${e.description} ${type === 'collections' ? e.definition?.sourceString || '' : ''}`.toLocaleLowerCase().includes(search)) &&
    (filter === 'all' || (filter === 'complete' && (type === 'records' ? e.complete : e.acquired)) ||
      (filter === 'incomplete' && !(type === 'records' ? e.complete : e.acquired)) || (filter === 'titles' && e.titleUnlocked)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function careerGroups(response) { return response?.mergedAllCharacters?.results || {}; }
export function summarizeCareer(stats = {}) {
  const kills = statValue(stats, 'kills'), deaths = statValue(stats, 'deaths'), assists = statValue(stats, 'assists');
  const games = statValue(stats, 'activitiesEntered'), wins = statValue(stats, 'activitiesWon');
  return { kills, deaths, assists, games, wins,
    kd: statValue(stats, 'killsDeathsRatio') ?? ratio(kills, deaths),
    efficiency: statValue(stats, 'efficiency') ?? (kills == null || assists == null ? null : ratio(kills + assists, deaths)),
    winRate: ratio(wins, games) == null ? null : ratio(wins, games) * 100,
    precisionKills: statValue(stats, 'precisionKills'),
    bestStreak: statValue(stats, 'longestKillSpree'),
    hours: statValue(stats, 'secondsPlayed') == null ? null : statValue(stats, 'secondsPlayed') / 3600 };
}

export function createReportApi(membership, request = bungieRequest) {
  const type = encodeURIComponent(membership.membershipType), id = encodeURIComponent(membership.membershipId);
  return {
    async career(signal) { return (await request(`/Destiny2/${type}/Account/${id}/Stats/?groups=1,2,3`, { signal })).Response; },
    async clan(signal) { return (await request(`/GroupV2/User/${type}/${id}/0/1/`, { signal })).Response; },
    async aggregates(characterId, signal) {
      return (await request(`/Destiny2/${type}/Account/${id}/Character/${encodeURIComponent(characterId)}/Stats/AggregateActivityStats/`, { signal })).Response;
    },
    async history(characterId, mode, page, signal) {
      return (await request(`/Destiny2/${type}/Account/${id}/Character/${encodeURIComponent(characterId)}/Stats/Activities/?count=25&mode=${Number(mode) || 0}&page=${Number(page) || 0}`, { signal })).Response;
    },
    async match(instanceId, signal) {
      if (!/^\d+$/.test(String(instanceId))) throw new Error('Invalid activity ID.');
      return (await request(`/Destiny2/Stats/PostGameCarnageReport/${instanceId}/`, { signal })).Response;
    },
    async modeStats(characterId, mode, signal) {
      return (await request(`/Destiny2/${type}/Account/${id}/Character/${encodeURIComponent(characterId)}/Stats/?modes=${Number(mode)}&groups=1,2,3&periodType=0`, { signal })).Response;
    }
  };
}

export function mergeActivities(pages) {
  const unique = new Map();
  for (const activity of pages.flat()) {
    const id = activity.activityDetails?.instanceId;
    if (id && !unique.has(id)) unique.set(id, activity);
  }
  return [...unique.values()].sort((a, b) => (Date.parse(b.period) || 0) - (Date.parse(a.period) || 0));
}

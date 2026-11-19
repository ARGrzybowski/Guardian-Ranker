import { statValue } from '../reportData.js';
import { activeCrucibleSeason } from '../crucibleSeasons.js';

export const CRUCIBLE_PAGE_SIZE = 100;

function matchStats(row) {
  const id = row.activityDetails?.instanceId;
  const time = Date.parse(row.period);
  if (typeof id !== 'string' || !/^\d{1,20}$/.test(id) || !Number.isFinite(time)) throw new Error('Invalid Crucible match in public history.');
  const counter = key => {
    const value = statValue(row.values, key);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  return { id, time, period: new Date(time).toISOString(), kills: counter('kills'), deaths: counter('deaths') };
}

// Bungie's page offsets move as new matches arrive. Resume on the last read
// page and replay its rows. If that page moved past our tail, start from zero.
async function scanPages(fetchPage, initial, limit, cutoff, matches) {
  const scan = { page: 0, head: null, tail: null, lastId: null, done: false, ...initial };
  if (scan.done) return scan;
  let overlap = scan.page > 0;
  if (overlap) scan.page--;

  for (let index = 0; index < limit; index++) {
    const response = await fetchPage(scan.page);
    if (!response || (response.activities != null && !Array.isArray(response.activities))) throw new Error('Crucible history is unavailable.');
    const rows = (response.activities || []).map(matchStats);
    const first = rows[0], last = rows.at(-1);
    if (rows.some((row, i) => i > 0 && row.time > rows[i - 1].time)) throw new Error('Crucible history pages are out of order.');
    if (overlap && (!first || first.time < scan.tail)) {
      scan.page = 0;
      scan.lastId = null;
      overlap = false;
      continue;
    }
    if (!overlap && last?.id && last.id === scan.lastId) throw new Error('Crucible history repeated a page.');
    overlap = false;
    if (scan.page === 0) scan.head ??= first?.time ?? null;
    for (const row of rows) {
      const prior = matches.get(row.id);
      if (!prior || prior.kills == null || prior.deaths == null) matches.set(row.id, row);
    }
    if (last) {
      scan.tail = scan.tail == null ? last.time : Math.min(scan.tail, last.time);
      scan.lastId = last.id;
    }
    scan.page++;
    if (!rows.length || (cutoff != null && last.time < cutoff)) {
      scan.done = true;
      break;
    }
  }
  return scan;
}

export async function collectCrucibleSeasons({ store, request, member, characters, seasons, now }) {
  const current = activeCrucibleSeason(seasons, now);
  if (!current) throw new Error('The current Crucible season is unknown.');
  const start = Date.parse(current.start);
  const previous = await store.crucibleProgress(member.membership_id);
  const progress = {};
  const matches = new Map();
  let currentComplete = true;
  let historyComplete = true;
  let coveredThrough = -Infinity;

  for (const character of characters) {
    const id = character.characterId;
    const old = previous?.[id];
    const fetchPage = page => request(`/Destiny2/${member.membership_type}/Account/${member.membership_id}/Character/${id}/Stats/Activities/?count=${CRUCIBLE_PAGE_SIZE}&mode=5&page=${page}`);
    const backfill = await scanPages(fetchPage, old?.backfill, 3, null, matches);
    const beforeSeason = Date.parse(character.dateLastPlayed) < start;
    let head = old ? old.head : backfill.head;
    let refresh = old?.refresh ?? null;
    const covered = backfill.done || (backfill.tail != null && backfill.tail < start);
    // Once the season boundary is covered, refresh toward the previous head
    // while the historical scan continues deeper on its own cursor.
    if (old && !beforeSeason && covered) {
      refresh = await scanPages(fetchPage, refresh, 3, head, matches);
      if (refresh.done) {
        head = refresh.head ?? head;
        refresh = null;
      }
    }
    progress[id] = { backfill, head, refresh };
    currentComplete &&= beforeSeason || (covered && !refresh);
    historyComplete &&= backfill.done;
    if (!backfill.done) coveredThrough = Math.max(coveredThrough, backfill.tail ?? Infinity);
  }

  const totals = await store.saveCrucibleProgress(member.membership_id, progress, [...matches.values()].map(({ time, ...row }) => row), seasons, now.toISOString());
  return { seasons, totals, currentComplete, historyComplete, coveredThrough: Number.isFinite(coveredThrough) ? coveredThrough : null };
}

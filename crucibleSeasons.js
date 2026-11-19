export const MONUMENT_START = '2026-06-09T17:00:00Z';
const RENEGADES_START = '2025-12-02T17:00:00Z';

export function crucibleSeasons(definitions) {
  const monument = Date.parse(MONUMENT_START);
  const renegades = Date.parse(RENEGADES_START);
  const seasons = new Map();
  for (const [id, definition] of Object.entries(definitions || {})) {
    const name = definition.displayProperties?.name;
    const start = Date.parse(definition.startDate);
    const end = Date.parse(definition.endDate);
    if (!name || definition.redacted || !Number.isFinite(start) || start === renegades) continue;
    if (start < monument && (!Number.isFinite(end) || end > renegades || end <= start)) continue;
    seasons.set(start, { id, name, start: new Date(start).toISOString(), end: end > start ? new Date(end).toISOString() : null });
  }
  // The manifest relabeled the Renegades season as Monument of Triumph but
  // kept its December start date. The sandbox update actually launched June 9.
  seasons.set(renegades, { id: 'renegades', name: 'Renegades', start: RENEGADES_START, end: MONUMENT_START });
  seasons.set(monument, { id: 'monument', name: 'Monument of Triumph', start: MONUMENT_START, end: null });
  const ordered = [...seasons.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return ordered.map((season, index) => {
    const next = ordered[index + 1];
    return next && (!season.end || Date.parse(season.end) > Date.parse(next.start)) ? { ...season, end: next.start } : season;
  });
}

export function activeCrucibleSeason(seasons, now) {
  return seasons.findLast(season => Date.parse(season.start) <= now && (!season.end || now < Date.parse(season.end)));
}

import { numeric, statValue, ratio, mergeActivities, CLASSES } from './reportData.js';

export function competitiveActivity(activity) {
  const details = activity.activityDetails || {};
  return [5, 63, 84].includes(details.mode) || Boolean(details.modes?.some(mode => [5, 63].includes(mode)));
}

// Sum only known values; an all-missing measure must stay null. Ratios use rows
// containing both numerator and denominator, rather than mixing partial totals.
export function sumKnown(values) {
  const known = values.map(numeric).filter(v => v != null);
  return { value: known.length ? known.reduce((a, b) => a + b, 0) : null, known: known.length };
}
export function activityInsights(input) {
  const activities = mergeActivities([input]);
  const kills = sumKnown(activities.map(a => statValue(a.values, 'kills')));
  const deaths = sumKnown(activities.map(a => statValue(a.values, 'deaths')));
  const assists = sumKnown(activities.map(a => statValue(a.values, 'assists')));
  const duration = sumKnown(activities.map(a => statValue(a.values, 'timePlayedSeconds') ?? statValue(a.values, 'activityDurationSeconds')));
  const paired = activities.filter(a => statValue(a.values, 'kills') != null && statValue(a.values, 'deaths') != null);
  const completed = activities.map(a => statValue(a.values, 'completed')).filter(v => v === 0 || v === 1);
  const standings = activities.filter(competitiveActivity).map(a => statValue(a.values, 'standing')).filter(v => v === 0 || v === 1);
  const byDay = new Map(), byMode = new Map();
  for (const a of activities) {
    const date = new Date(a.period);
    if (Number.isFinite(date.getTime())) {
      const key = date.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) || 0) + 1);
    }
    const mode = a.activityDetails?.mode;
    if (mode != null) byMode.set(mode, (byMode.get(mode) || 0) + 1);
  }
  return { count: activities.length, kills, deaths, assists, duration,
    kd: ratio(sumKnown(paired.map(a => statValue(a.values, 'kills'))).value, sumKnown(paired.map(a => statValue(a.values, 'deaths'))).value),
    kdSample: paired.length,
    completionRate: completed.length ? completed.filter(v => v === 1).length / completed.length * 100 : null,
    completionSample: completed.length,
    winRate: standings.length ? standings.filter(v => v === 0).length / standings.length * 100 : null,
    winSample: standings.length,
    days: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    modes: [...byMode.entries()].sort((a, b) => b[1] - a[1]).map(([mode, count]) => ({ mode, count })) };
}

export function durationText(seconds) {
  const value = numeric(seconds);
  if (value == null || value < 0) return 'Unavailable';
  const rounded = Math.round(value), hours = Math.floor(rounded / 3600), minutes = Math.floor(rounded % 3600 / 60), remaining = rounded % 60;
  return hours ? `${hours}h ${minutes}m ${remaining}s` : `${minutes}m ${remaining}s`;
}

export function aggregateEntries(responses, characters, definitions) {
  const rows = [];
  responses.forEach((data, i) => {
    const seen = new Set();
    for (const activity of data?.activities || []) {
      const hash = String(activity.activityHash);
      if (seen.has(hash)) continue;
      seen.add(hash);
      const definition = definitions[hash];
      if (definition?.redacted) continue;
      const modes = new Set([...(definition?.activityModeTypes || []), definition?.directActivityModeType].filter(v => v != null));
      const fastest = statValue(activity.values, 'activityFastestCompletionSeconds');
      rows.push({ hash, characterId: characters[i].characterId, characterName: CLASSES[characters[i].classType] || 'Guardian',
        name: definition?.displayProperties?.name || `Activity ${hash}`, description: definition?.displayProperties?.description || '',
        category: modes.has(4) ? 'raid' : modes.has(82) ? 'dungeon' : modes.has(16) || modes.has(46) ? 'nightfall' : 'other',
        completions: statValue(activity.values, 'activityCompletions'),
        fastest: fastest != null && fastest > 0 ? fastest : null,
        kills: statValue(activity.values, 'activityKills'), deaths: statValue(activity.values, 'activityDeaths'),
        seconds: statValue(activity.values, 'activitySecondsPlayed'), values: activity.values });
    }
  });
  return rows;
}
export function filterAggregates(rows, { query = '', category = 'all', character = 'all', sort = 'completions' } = {}) {
  const search = query.trim().toLocaleLowerCase();
  const filtered = rows.filter(row => (category === 'all' || row.category === category) && (character === 'all' || row.characterId === character) && (!search || `${row.name} ${row.description}`.toLocaleLowerCase().includes(search)));
  const value = row => sort === 'fastest' ? row.fastest : row.completions;
  return filtered.sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1; if (bv == null) return -1;
    return (sort === 'fastest' ? av - bv : bv - av) || a.name.localeCompare(b.name);
  });
}

export function objectiveCompletion(record) {
  const objectives = record.objectives?.length ? record.objectives : record.intervalObjectives || [];
  const valid = objectives.filter(o => numeric(o.completionValue) > 0 && numeric(o.progress) != null);
  if (!valid.length) return null;
  // Average normalized objectives so a large kill counter cannot hide an unmet
  // binary requirement. This is a display aid, not Bungie's completion flag.
  return valid.reduce((sum, o) => sum + Math.min(1, Math.max(0, Number(o.progress) / Number(o.completionValue))), 0) / valid.length * 100;
}
export function closestTriumphs(entries) {
  return entries.filter(e => !e.complete && !e.obscured && !(e.state & 32))
    .map(e => ({ ...e, completion: objectiveCompletion(e) }))
    .filter(e => e.completion != null && e.completion > 0)
    .sort((a, b) => b.completion - a.completion || a.name.localeCompare(b.name));
}
export function matchWeapons(entry) {
  return (entry.extended?.weapons || []).map(weapon => {
    const kills = statValue(weapon.values, 'uniqueWeaponKills'), precision = statValue(weapon.values, 'uniqueWeaponPrecisionKills');
    return { hash: weapon.referenceId, kills, precision, precisionRate: ratio(precision, kills) == null ? null : ratio(precision, kills) * 100 };
  }).sort((a, b) => (b.kills ?? -1) - (a.kills ?? -1));
}

export function csvText(headers, rows) {
  // Protect text cells against spreadsheet formula interpretation. Numeric
  // values stay numeric; IDs must be supplied as text to preserve precision.
  const cell = value => {
    let text = String(value ?? '');
    if (typeof value === 'string' && (/^[\s]*[=+@-]/.test(text) || /^\d{16,}$/.test(text))) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
}

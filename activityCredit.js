import { statValue } from './reportData.js';

// Bungie's record descriptions require these solo tiers to cover the full
// dungeon without leaving. Generic flawless trackers do not prove a solo run.
export const DUNGEON_SOLO_RECORDS = [
  { name: 'The Shattered Throne', solo: 3899996566, flawless: 3205009787 },
  { name: 'Pit of Heresy', solo: 3841336511, flawless: 3950599483 },
  { name: 'Prophecy', solo: 3002642730, flawless: 3191784400 },
  { name: 'Grasp of Avarice', solo: 678858776, flawless: 3718971745 },
  { name: 'Duality', solo: 755549938, flawless: 4126703847 },
  { name: 'Spire of the Watcher', solo: 1151761978, flawless: 4032136335 },
  { name: 'Ghosts of the Deep', solo: 3584441401, flawless: 2105117002 },
  { name: "Warlord's Ruin", solo: 2905044529, flawless: 238037026 },
  { name: "Vesper's Host", solo: 591040974, flawless: 1553599507 },
  { name: 'Sundered Doctrine', solo: 2236876295, flawless: 28261116 },
  { name: 'Equilibrium', solo: 66379764, flawless: 1204858125 }
];

export function publicRecordProof(profile) {
  const records = profile.profileRecords?.data?.records;
  if (!records) return null;
  const scopes = [records, ...Object.values(profile.characterRecords?.data || {}).map(scope => scope?.records)];
  return hash => scopes.some(scope => {
    const record = scope?.[hash];
    const state = record?.state;
    return Number.isSafeInteger(state) && state >= 0 && !(state & (4 | 16)) && (
      Boolean(state & 1) ||
      (record.objectives?.length > 0 && record.objectives.every(objective => objective.complete === true))
    );
  });
}

export function soloDungeonEvidence(isVerified) {
  if (!isVerified) return { value: null, points: null };
  const events = DUNGEON_SOLO_RECORDS.flatMap(({ name, solo, flawless }) => {
    if (isVerified(flawless)) return [{ name, tier: 'Solo flawless', points: 120 }];
    if (isVerified(solo)) return [{ name, tier: 'Solo', points: 50 }];
    return [];
  });
  return { value: events.length, points: events.reduce((total, event) => total + event.points, 0), events };
}

// Each repeat n independently earns repeatPool / (n * (n - 1)).
// Summing the telescoping terms keeps the cost independent of clear count.
export function diminishingPoints(completions, firstClear, repeatPool) {
  return completions > 0 ? firstClear + repeatPool * (1 - 1 / completions) : 0;
}

export function additionalActivityFamily(definition) {
  if (!definition || definition.redacted) return null;
  if (definition.performanceFamily) return definition.performanceFamily;
  const title = definition.displayProperties?.name;
  if (typeof title !== 'string') return null;
  let type, name;
  if (definition.directActivityModeType === 46 && definition.activityTypeHash === 575572995) {
    name = /^Nightfall Grandmaster:\s*(.+)$/i.exec(title)?.[1]?.trim();
    type = 'grandmaster';
  } else if (definition.activityTypeHash === 3851289711 && definition.matchmaking?.maxParty === 1) {
    name = definition.originalDisplayProperties?.name?.trim() || title.replace(/:\s*Customize$/i, '').trim();
    type = 'soloOps';
  }
  if (!name) return null;
  return { key: `${type}:${name.toLowerCase()}`, type, name };
}

export function additionalActivityEvidence(aggregates, characters, definitions) {
  if (!definitions || !characters.length || aggregates?.length !== characters.length ||
      aggregates.some(result => !Array.isArray(result?.activities))) return null;
  const families = new Map();
  const missingCounters = new Set();
  for (const aggregate of aggregates) {
    const seen = new Set();
    for (const activity of aggregate.activities) {
      const hash = String(activity.activityHash);
      if (seen.has(hash)) continue;
      seen.add(hash);
      const family = additionalActivityFamily(definitions[hash]);
      if (!family) continue;
      const completions = statValue(activity.values, 'activityCompletions');
      if (!Number.isSafeInteger(completions) || completions < 0) {
        missingCounters.add(family.type);
        continue;
      }
      if (completions > 0) families.set(family.key, {
        ...family, completions: (families.get(family.key)?.completions ?? 0) + completions
      });
    }
  }
  return { families: [...families.values()], missingCounters };
}

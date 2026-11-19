import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RATING_METRICS, RATING_VERSION, milestoneScore, ratingTier, pvpEvidence, titleEvidence, endgameEvidence, calculateAccountRating, combineRatings } from '../accountRating.js';

const stats = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { basic: { value } }]));
function fixture() {
  return {
    profile: {
      characters: { data: { c: { characterId: 'c', classType: 0 } } },
      profile: { data: { lifetimeHighestGuardianRank: 8, currentGuardianRank: 7 } },
      profileRecords: { data: { lifetimeScore: 25000, records: { 1: { state: 65 }, 2: { state: 4 } } } },
      profileCollectibles: { data: { collectibles: { 1: { state: 0 }, 2: { state: 1 } } } },
      profileCommendations: { data: { totalScore: 500 } }
    },
    career: { mergedAllCharacters: { results: { allPvP: { allTime: stats({ kills: 200, deaths: 100, activitiesEntered: 100, activitiesWon: 60 }) }, allPvE: { allTime: stats({ activitiesEntered: 2500 }) } } } },
    aggregates: [{ activities: [{ activityHash: 10, values: stats({ activityCompletions: 50 }) }, { activityHash: 11, values: stats({ activityCompletions: 10 }) }] }],
    recordDefinitions: { 1: { titleInfo: { hasTitle: true, titlesByGender: { 0: 'Conqueror', 1: 'Conqueror' } } } },
    activityDefinitions: { 10: { activityModeTypes: [4] }, 11: { directActivityModeType: 82 } }
  };
}
test('rating policy is versioned, ten metrics have weights totaling 100%', () => {
  assert.equal(RATING_VERSION, 'GR-1.1'); assert.equal(RATING_METRICS.length, 10);
  assert.equal(RATING_METRICS.reduce((sum, m) => sum + m.weight, 0), 100);
  assert.equal(new Set(RATING_METRICS.map(m => m.id)).size, 10);
  assert.throws(() => combineRatings([{ weight: 50 }]), /100%/);
});
test('volume curves hit every published anchor, stay monotone, cap and reject invalid inputs', () => {
  for (const m of RATING_METRICS.filter(m => m.anchors)) {
    for (const [value, score] of m.anchors) assert.ok(Math.abs(milestoneScore(value, m.anchors, m.linear) - score) < 1e-8, m.id);
    let previous = -1;
    for (let i = 0; i <= 100; i++) {
      const score = milestoneScore(m.anchors.at(-1)[0] * i / 100, m.anchors, m.linear);
      assert.ok(score >= previous && score >= 0 && score <= 100, m.id); previous = score;
    }
    assert.equal(milestoneScore(1e100, m.anchors, m.linear), 100);
    assert.equal(milestoneScore(null, m.anchors), null); assert.equal(milestoneScore(-1, m.anchors), null);
  }
});
test('full rating matches the weighted formula and tier thresholds use unrounded scores', () => {
  const r = calculateAccountRating(fixture());
  assert.equal(r.overall.coverage, 100); assert.equal(r.overall.provisional, false);
  assert.equal(r.metrics.find(m => m.id === 'triumphs').score, 50);
  assert.equal(r.metrics.find(m => m.id === 'rank').score, 65);
  const expected = r.metrics.reduce((sum, m) => sum + m.weight * m.score / 10, 0);
  assert.ok(Math.abs(r.overall.score - expected) < 1e-8);
  assert.equal(r.overall.range.min, expected); assert.equal(r.overall.range.max, expected);
  assert.equal(ratingTier(89.999).grade, 'S'); assert.equal(ratingTier(90).grade, 'S+'); assert.equal(ratingTier(null), null);
});
test('small PvP samples moderate the metric without withholding the account grade', () => {
  const small = pvpEvidence(stats({ kills: 30, deaths: 1, activitiesEntered: 1, activitiesWon: 1 }));
  const large = pvpEvidence(stats({ kills: 30000, deaths: 1000, activitiesEntered: 1000, activitiesWon: 1000 }));
  assert.ok(small.value > 50 && small.value < 51); assert.ok(large.value > 90);
  const f = fixture(); f.career.mergedAllCharacters.results.allPvP.allTime = stats({ kills: 10, deaths: 2, activitiesEntered: 5, activitiesWon: 4 });
  const r = calculateAccountRating(f);
  assert.equal(r.overall.coverage, 100); assert.equal(r.overall.provisional, false); assert.ok(r.overall.tier);
});
test('published worked example produces 522.75 / 1000 with an established grade', () => {
  const f = fixture();
  f.profile.profileCollectibles.data.collectibles = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [String(i), { state: 0 }]));
  f.profile.profileRecords.data.records = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i), { state: 65 }]));
  f.recordDefinitions = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i), { titleInfo: { hasTitle: true, titlesByGender: { 0: `Title ${i}` } } }]));
  const r = calculateAccountRating(f);
  assert.ok(Math.abs(r.overall.score - 522.75) < 1e-8);
  assert.equal(r.overall.tier.grade, 'B');
});
test('explicit zero PvP participation receives zero experience credit; missing and contradictory data do not', () => {
  assert.equal(pvpEvidence(stats({ activitiesEntered: 0 })).value, 0);
  assert.equal(pvpEvidence({}).value, null);
  assert.equal(pvpEvidence(stats({ activitiesEntered: 0, kills: 10 })).value, null);
  assert.equal(pvpEvidence(stats({ activitiesEntered: 5, kills: 10, deaths: 2, activitiesWon: 6 })).value, null);
  assert.equal(pvpEvidence(stats({ activitiesEntered: 5, kills: 0, deaths: 0, activitiesWon: 3 })).value, null);
  assert.ok(Number.isFinite(pvpEvidence(stats({ activitiesEntered: 2, kills: 30, deaths: 0, activitiesWon: 2 })).value));
});
test('title scoring deduplicates names across scopes and excludes gilding-only and invisible records', () => {
  const f = fixture(); f.profile.profileRecords.data.records = { 1: { state: 65 }, 2: { state: 65 }, 3: { state: 65 }, 4: { state: 81 } };
  f.recordDefinitions[2] = { titleInfo: { titlesByGender: { Male: 'Conqueror' } } };
  f.recordDefinitions[3] = { forTitleGilding: true, titleInfo: { titlesByGender: { Male: 'Gilded' } } };
  assert.equal(titleEvidence(f.profile, f.recordDefinitions).value, 1);
  delete f.recordDefinitions[2]; assert.equal(titleEvidence(f.profile, f.recordDefinitions).partial, false);
});
test('collection scoring merges acquired visible states without counting invisible or duplicate items', () => {
  const f = fixture(); f.profile.characterCollectibles = { data: { c: { collectibles: { 1: { state: 5 }, 2: { state: 0 }, 3: { state: 4 } } } } };
  assert.equal(calculateAccountRating(f).metrics.find(m => m.id === 'collections').value, 2);
  delete f.profile.profileCollectibles;
  assert.equal(calculateAccountRating(f).metrics.find(m => m.id === 'collections').status, 'partial');
});
test('missing characters remain partial while noncatalog activities do not block grades', () => {
  const f = fixture();
  const endgame = endgameEvidence([...f.aggregates, undefined], [{ characterId: 'c' }, { characterId: 'd' }], f.activityDefinitions);
  assert.equal(endgame.raid, 50); assert.equal(endgame.partial, true);
  delete f.activityDefinitions[11];
  const r = calculateAccountRating(f);
  assert.equal(r.metrics.find(m => m.id === 'raids').status, 'rated');
  assert.equal(r.overall.coverage, 100); assert.ok(r.overall.tier);
  assert.ok(r.overall.range.min <= r.overall.range.max);
});
test('privacy does not become a zero metric or a complete inflated grade', () => {
  const f = fixture(), complete = calculateAccountRating(f);
  delete f.profile.profileRecords;
  const partial = calculateAccountRating(f);
  assert.equal(partial.metrics.find(m => m.id === 'triumphs').score, null);
  assert.equal(partial.metrics.find(m => m.id === 'titles').score, null);
  assert.equal(partial.overall.coverage, 75); assert.equal(partial.overall.tier, null);
  assert.ok(partial.overall.range.min <= complete.overall.score);
  assert.ok(partial.overall.range.max >= complete.overall.score);
  const empty = calculateAccountRating({});
  assert.equal(empty.overall.score, null); assert.equal(empty.overall.coverage, 0);
  assert.deepEqual(empty.overall.range, { min: 0, max: 1000 });
});
test('rating is deterministic and ignores power, idle time, recent login and activity speed', () => {
  const f = fixture(), original = calculateAccountRating(f);
  f.profile.characters.data.c.light = 99999; f.profile.characters.data.c.minutesPlayedTotal = '999999999'; f.profile.characters.data.c.dateLastPlayed = '2099-01-01';
  f.aggregates[0].activities[0].values.fastestCompletionMsForActivity = { basic: { value: 1 } };
  assert.deepEqual(calculateAccountRating(f), original);
});
test('a provisional point stays within its evidence bounds even when partial metrics are strong', () => {
  const f = fixture();
  f.aggregates[0].activities[0].values.activityCompletions.basic.value = 750;
  f.profile.characters.data.d = { characterId: 'd', classType: 1 };
  f.aggregates[0].activities[1].values.activityCompletions.basic.value = 1000;
  f.aggregates[0].activities.push({ activityHash: 999, values: stats({ activityCompletions: 1 }) });
  const r = calculateAccountRating(f);
  assert.equal(r.overall.coverage, 75);
  assert.ok(r.overall.score >= r.overall.range.min && r.overall.score <= r.overall.range.max);
  assert.equal(r.overall.score, (r.overall.range.min + r.overall.range.max) / 2);
  assert.equal(r.overall.tier, null);
});
test('malformed flags and missing eligible counters cannot fabricate complete ratings', () => {
  const f = fixture(); f.profile.profileCollectibles.data.collectibles[3] = {};
  f.profile.profileRecords.data.records[3] = { state: null };
  f.activityDefinitions[10] = {};
  f.aggregates[0].activities[1].values.activityCompletions.basic.value = null;
  const r = calculateAccountRating(f);
  assert.equal(r.metrics.find(m => m.id === 'collections').value, 1);
  for (const id of ['collections', 'titles', 'raids', 'dungeons']) assert.equal(r.metrics.find(m => m.id === id).status, 'partial');
  assert.equal(r.overall.tier, null);
});
test('raising an eligible achievement never decreases its metric or complete overall rating', () => {
  const f = fixture(), before = calculateAccountRating(f);
  f.profile.profileRecords.data.lifetimeScore = 100000;
  const after = calculateAccountRating(f);
  assert.ok(after.overall.score >= before.overall.score);
  assert.equal(after.overall.score - before.overall.score, 60);
});

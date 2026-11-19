import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRatingRunner, compactTitles, compactActivities } from '../worker/ratings.mjs';
import { BudgetReached } from '../worker/indexer.mjs';
import { calculateAccountRating } from '../accountRating.js';

const stats = values => Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{basic:{value}}]));
function harness() {
  const profile = { characters:{data:{c:{characterId:'c',classType:0}}},profile:{data:{lifetimeHighestGuardianRank:8}},
    profileRecords:{data:{lifetimeScore:25000,records:{1:{state:65}}}},profileCollectibles:{data:{collectibles:{1:{state:0}}}},profileCommendations:{data:{totalScore:500}} };
  const career = {mergedAllCharacters:{results:{allPvP:{allTime:stats({activitiesEntered:5,activitiesWon:3,kills:10,deaths:5,precisionKills:3,assists:10})},allPvE:{allTime:stats({activitiesEntered:100,kills:1000,precisionKills:300})}}}};
  const records={1:{titleInfo:{titlesByGender:{0:'Conqueror'}}},2:{forTitleGilding:true,titleInfo:{titlesByGender:{0:'Conqueror'}}}};
  const activities={10:{pgcrImage:"/raid.jpg",displayProperties:{name:"Test Raid"},activityModeTypes:[4]},11:{directActivityModeType:82},12:{activityModeTypes:[5]},13:{redacted:true}};
  const aggregate={activities:[{activityHash:10,values:stats({activityCompletions:10})},{activityHash:999,values:stats({activityCompletions:1000})}]};
  const saved=[],failed=[],paths=[];
  let manifest={projection_version:2,ready:true,version:'test',checked_at:'2026-11-19T00:00:00Z',records:compactTitles(records),activities:compactActivities(activities)};
  const store={ dueRatings:async()=>[{membership_id:'123',membership_type:3,last_played:'2026-11-19T00:00:00Z'}],ratingManifest:async()=>manifest,
    saveRatingManifest:async value=>{manifest=value;},saveRating:async(...args)=>saved.push(args),failRating:async(...args)=>failed.push(args) };
  const bungie={request:async path=>{paths.push(path);if(path.includes('/Profile/'))return{Response:profile};if(path.includes('AggregateActivityStats'))return{Response:aggregate};if(path.includes('/Manifest/'))return{Response:{version:'test',jsonWorldComponentContentPaths:{en:{DestinyRecordDefinition:'/records',DestinyActivityDefinition:'/activities'}}}};return{Response:career};},staticJson:async path=>path==='/records'?records:activities};
  return{store,bungie,profile,career,records,activities,aggregate,saved,failed,paths,clearManifest:()=>{manifest=undefined;},now:()=>new Date('2026-11-19T00:01:00Z')};
}
test('cloud ratings use the same version and recognized-catalog score as the browser',async()=>{
  const h=harness();const result=await createRatingRunner()({...h,limit:10});
  assert.equal(result.ratings_saved,1);assert.equal(h.saved[0][1].version,'GR-2.0');
  assert.equal(h.saved[0][1].overall.provisional,false,'legacy activity metadata and small PvP samples do not block grades');
  const browser=calculateAccountRating({profile:h.profile,career:h.career,aggregates:[h.aggregate],recordDefinitions:h.records,activityDefinitions:h.activities});
  assert.equal(h.saved[0][1].overall.score,browser.overall.score);
  assert.ok(h.paths[0].includes('100,200,800,900,1400'));
});
test('cold catalog preparation is checkpointed into two bounded cloud invocations',async()=>{
  const h=harness();h.clearManifest();
  assert.equal((await createRatingRunner()({...h,limit:10})).rating_manifest_prepared,1);
  assert.equal(h.saved.length,0);
  assert.equal((await createRatingRunner()({...h,limit:10})).rating_manifest_prepared,1);
  assert.equal(h.saved.length,0);
  assert.equal((await createRatingRunner()({...h,limit:10})).ratings_saved,1);
});
test('private profiles clear rating eligibility without fabricating scores',async()=>{
  const h=harness();h.profile.characters.data={};
  await createRatingRunner()({...h,limit:10});assert.equal(h.saved.length,0);assert.equal(h.failed[0][2],true);
});
test('source failures are retried later and budget limits do not become profile failures',async()=>{
  const h=harness(),request=h.bungie.request;
  h.bungie.request=async path=>{if(path.includes('/Stats/?'))throw new BudgetReached('stop');return request(path);};
  await assert.rejects(createRatingRunner()({...h,limit:10}),BudgetReached);
  assert.equal(h.failed.length,0);assert.equal(h.saved.length,0);
});
test('compact catalog excludes gilding, non-endgame activities and redactions',()=>{
  const h=harness();assert.deepEqual(Object.keys(compactTitles(h.records)),['1']);
  assert.deepEqual(Object.keys(compactActivities(h.activities)),['10','11']);
});

test('a previous projection is rebuilt even when the Bungie manifest version is unchanged',async()=>{
  const h=harness();
  h.store.ratingManifest=async()=>({ready:true,version:'test',checked_at:h.now().toISOString(),records:compactTitles(h.records),activities:{10:{directActivityModeType:4}}});
  const result=await createRatingRunner()({...h,limit:10});
  assert.equal(result.rating_manifest_prepared,1);assert.equal(h.saved.length,0);
});

test('compact family metadata preserves full browser breadth and class results',async()=>{
  const h=harness();h.activities[14]={directActivityModeType:4,pgcrImage:'/raid.jpg',displayProperties:{name:'Test Raid: Master'}};
  h.aggregate.activities.push({activityHash:14,values:stats({activityCompletions:20})});
  const browser=calculateAccountRating({profile:h.profile,career:h.career,aggregates:[h.aggregate],recordDefinitions:h.records,activityDefinitions:h.activities});
  const projected=calculateAccountRating({profile:h.profile,career:h.career,aggregates:[h.aggregate],recordDefinitions:compactTitles(h.records),activityDefinitions:compactActivities(h.activities)});
  assert.equal(projected.overall.score,browser.overall.score);
  assert.equal(projected.endgameCoverage.raidBreadth,1);
  assert.deepEqual(projected.dimensions,browser.dimensions);
});

test('real catalog exceptions group Crota and Pantheon variants in both views', () => {
  const definitions = {
    1: { directActivityModeType: 82, displayProperties: { name: "Crota's End: Standard" }, pgcrImage: '/img/destiny_content/pgcr/raid_crotas_end.jpg' },
    2: { directActivityModeType: 4, displayProperties: { name: "Crota's End" }, pgcrImage: '/img/destiny_content/pgcr/raid_crotas_end.jpg' },
    3: { directActivityModeType: 4, displayProperties: { name: 'The Pantheon: Oryx Exalted' }, pgcrImage: '/oryx.jpg' },
    4: { directActivityModeType: 4, displayProperties: { name: 'The Pantheon: Nezarec Sublime' }, pgcrImage: '/placeholder.jpg' },
    5: { directActivityModeType: 4, displayProperties: { name: 'Another Raid' }, pgcrImage: '/placeholder.jpg' }
  };
  const input = { characters: [{ characterId: 'c', classType: 0 }],
    aggregates: [{ activities: Object.keys(definitions).map(activityHash => ({ activityHash, values: stats({ activityCompletions: 5 }) })) }] };
  const complete = calculateAccountRating({ ...input, activityDefinitions: definitions }).endgameCoverage;
  const projected = calculateAccountRating({ ...input, activityDefinitions: compactActivities(definitions) }).endgameCoverage;
  assert.deepEqual(projected, complete);
  assert.equal(complete.raid, 25); assert.equal(complete.dungeon, 0);
  assert.equal(complete.raidBreadth, 3); assert.equal(complete.raidDepth, 2);
  assert.equal(complete.families.find(f => f.name === 'The Pantheon').completions, 10);
});

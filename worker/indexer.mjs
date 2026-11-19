import { bungieRequest, searchExactName, loadPlayerProfile, formatBungieName } from '../bungieApi.js';

export class BudgetReached extends Error {}
const isoAfter = (now, hours) => new Date(now.getTime() + hours * 3600000).toISOString();
const identity = member => ({ membership_id: String(member.membershipId), membership_type: member.membershipType, source: 'clan' });
const validMember = member => member && /^[0-9]{1,20}$/.test(String(member.membershipId)) && [1,2,3,4,5,6,10].includes(member.membershipType);
const number = value => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : null;

export function profileSnapshot({ membership, profileData }) {
  const profile = profileData.Response;
  const characters = Object.values(profile.characters.data);
  const user = profile.profile?.data?.userInfo || membership;
  const strongest = characters.reduce((best, char) => Number(char.light) > Number(best.light) ? char : best);
  const recent = characters.reduce((best, char) => Date.parse(char.dateLastPlayed) > Date.parse(best.dateLastPlayed) ? char : best);
  const minutes = characters.map(char => number(char.minutesPlayedTotal));
  const latest = Math.max(...characters.map(char => Date.parse(char.dateLastPlayed) || 0));
  if (!user.bungieGlobalDisplayName || user.bungieGlobalDisplayNameCode == null) throw new Error('Profile has no Bungie name.');
  return {
    membership_id: String(membership.membershipId), membership_type: membership.membershipType,
    character_id: String(recent.characterId),
    bungie_name: formatBungieName(user),
    time_played_hours: minutes.every(value => value !== null) ? Math.floor(minutes.reduce((sum, value) => sum + value, 0) / 60) : null,
    triumph_score: number(profile.profileRecords?.data?.lifetimeScore),
    guardian_rank: number(profile.profile?.data?.currentGuardianRank),
    highest_guardian_rank: number(profile.profile?.data?.lifetimeHighestGuardianRank),
    class_type: ({ 0: 'Titan', 1: 'Hunter', 2: 'Warlock' })[strongest.classType] || 'Unknown',
    light_level: number(strongest.light), last_played: latest ? new Date(latest).toISOString() : null
  };
}

export function createBungieWorker({ apiKey, maxOperations = 300, signal, intervalMs = 500, stopAt = Infinity, clock = () => Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let operations = 0;
  let backoffUntil = 0;
  let slots = Promise.resolve();
  return {
    get operations() { return operations; },
    get backoffUntil() { return backoffUntil; },
    async staticJson(path) {
      if (typeof path !== 'string' || !path.startsWith('/common/destiny2_content/json/en/')) throw new Error('Invalid Bungie catalog path.');
      signal?.throwIfAborted();
      if (clock() >= stopAt) throw new BudgetReached('Worker time budget reached.');
      const response = await fetch(`https://www.bungie.net${path}`, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]) });
      if (!response.ok) throw new Error('Bungie catalog download failed.');
      return response.json();
    },
    async request(path, options = {}) {
      // Serialize reservations, not HTTP responses: concurrent consumers share
      // one paced request budget and cannot burst past it.
      const reservation = slots.then(async () => {
        signal?.throwIfAborted();
        if (operations >= maxOperations || clock() >= stopAt || clock() < backoffUntil) throw new BudgetReached('Worker operation, time, or throttle budget reached.');
        if (operations) await wait(intervalMs);
        if (clock() >= stopAt || clock() < backoffUntil) throw new BudgetReached('Worker time or throttle budget reached.');
        operations++;
      });
      slots = reservation.catch(() => {});
      await reservation;
      try {
        return await bungieRequest(path, { ...options, signal, apiKey, maxAttempts: 2, timeoutMs: 8000 });
      } catch (error) {
        if (error.throttled) {
          backoffUntil = Math.max(backoffUntil,clock()+Math.max(60000,error.retryAfterMs || 0));
          throw new BudgetReached('Bungie requested a cooldown.');
        }
        throw error;
      }
    }
  };
}

// Runs once per invocation. Scheduling lives in the cloud, never on a PC.
export async function runIndexer({ store, bungie, signal, now = () => new Date(), seedNames = [], seedClans = [], maxProfiles = 100, maxDiscoveries = 25, maxClanPages = 20, profileConcurrency = 1, maxActivityScans = 0, maxRatings = 0, rateProfiles }) {
  const summary = { profiles_attempted: 0, profiles_refreshed: 0, cached_identity_hits: 0, seed_errors: 0, profile_errors: 0, discovery_errors: 0, roster_errors: 0, clans_found: 0, roster_members_seen: 0, roster_pages: 0, activity_scans: 0, activity_errors: 0, activity_members_seen: 0 };
  const runId = await store.start();
  if (!runId) return { status: 'already_running' };
  let status = 'completed';
  const request = bungie.request.bind(bungie);
  const refreshOne = async row => {
      summary.profiles_attempted++;
      try {
        let user, loaded;
        let identityCheckedAt = row.identity_checked_at;
        const cachedIdentity = row.membership_type != null && row.identity_checked_at &&
          now().getTime() - Date.parse(row.identity_checked_at) < 86400000;
        if (cachedIdentity) {
          try {
            loaded = await loadPlayerProfile({ destinyMemberships: [{ membershipId: row.membership_id, membershipType: row.membership_type }] }, signal, request, '100,200,900');
            const override = loaded.profileData.Response.profile?.data?.userInfo?.crossSaveOverride;
            if (override && override !== row.membership_type) loaded = null;
            else summary.cached_identity_hits++;
          } catch (error) {
            if (error instanceof BudgetReached || signal?.aborted) throw error;
            if (!error.noPublicCharacters && ![400,404].includes(error.status)) throw error;
          }
        }
        if (!loaded && row.membership_type == null) user = await searchExactName(row.bungie_name || '', signal, request);
        else if (!loaded) {
          const data = await request(`/User/GetMembershipsById/${row.membership_id}/${row.membership_type}/`);
          user = { destinyMemberships: data.Response?.destinyMemberships || [] };
        }
        if (!loaded) {
          loaded = await loadPlayerProfile(user, signal, request, '100,200,900');
          identityCheckedAt = now().toISOString();
        }
        const snapshot = profileSnapshot(loaded);
        snapshot.identity_checked_at = identityCheckedAt;
        const age = snapshot.last_played ? now().getTime() - Date.parse(snapshot.last_played) : Infinity;
        const refreshHours = row.is_leader || age < 86400000 ? 0.25 : age < 7 * 86400000 ? 2 : 24;
        await store.save(row.membership_id, snapshot, isoAfter(now(), refreshHours));
        summary.profiles_refreshed++;
      } catch (error) {
        if (error instanceof BudgetReached || error.databaseFailure || signal?.aborted) throw error;
        summary.profile_errors++;
        // Private profiles leave public rankings. Transient failures retain the
        // last known snapshot with its original freshness timestamp.
        await store.failProfile(row, isoAfter(now(), Math.min(48, 6 * 2 ** Math.min(row.error_count || 0, 3))), Boolean(error.noPublicCharacters));
      }
  };
  const refreshProfiles = async limit => {
    const rows = await store.dueProfiles(now().toISOString(), limit);
    let cursor = 0, failure;
    const consume = async () => {
      while (!failure && cursor < rows.length) {
        const row = rows[cursor++];
        try { await refreshOne(row); } catch (error) { failure ??= error; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(profileConcurrency, rows.length) }, consume));
    // All in-flight writes finish before the database lease is released.
    if (failure) throw failure;
  };
  try {
    if (maxRatings && rateProfiles) {
      try {
        Object.assign(summary, await rateProfiles({ store, bungie, signal, now, limit: maxRatings }));
        if (summary.rating_manifest_prepared) return { status, ...summary };
        // Preserve time for discovery instead of spending the entire remaining
        // window on the first profile tranche during rating backfills.
        maxProfiles = Math.max(0,maxProfiles-(summary.ratings_attempted || 0)*4);
      } catch (error) {
        if (error.ratingSummary) Object.assign(summary,error.ratingSummary);
        if (error instanceof BudgetReached || error.databaseFailure || signal?.aborted) throw error;
        summary.rating_errors = (summary.rating_errors || 0) + 1;
      }
    }
    for (const name of seedNames) {
      try {
        const user = await searchExactName(name, signal, request);
        await store.insert('guardian_index', user.destinyMemberships.filter(validMember).map(member => ({ ...identity(member), source: 'seed' })));
      } catch (error) {
        if (error instanceof BudgetReached || error.databaseFailure || signal?.aborted) throw error;
        summary.seed_errors++;
      }
    }
    await store.insert('guardian_index_clans', seedClans.map(clan_id => ({ clan_id })));

    await refreshProfiles(Math.ceil(maxProfiles * 0.75));

    for (const row of await store.dueDiscovery(now().toISOString(), maxDiscoveries)) {
      try {
        const data = await request(`/GroupV2/User/${row.membership_type}/${row.membership_id}/0/1/`);
        const clans = (data.Response?.results || []).map(result => result.group).filter(group => group?.groupType === 1 && /^[0-9]{1,20}$/.test(String(group.groupId)));
        await store.insert('guardian_index_clans', clans.map(group => ({ clan_id: String(group.groupId), name: group.name })));
        summary.clans_found += clans.length;
        await store.patch('guardian_index', 'membership_id', row.membership_id, { next_discovery_at: isoAfter(now(), 24) });
      } catch (error) {
        if (error instanceof BudgetReached || error.databaseFailure || signal?.aborted) throw error;
        summary.discovery_errors++;
        await store.patch('guardian_index', 'membership_id', row.membership_id, { next_discovery_at: isoAfter(now(), 6) });
      }
    }

    const clans = await store.dueClans(now().toISOString(), maxClanPages);
    for (const clan of clans) {
      let page = clan.next_page;
      while (summary.roster_pages < maxClanPages) {
        try {
          const data = await request(`/GroupV2/${clan.clan_id}/Members/?currentpage=${page}`);
          const roster = data.Response;
          if (!Array.isArray(roster?.results)) throw new Error('Invalid clan roster.');
          const members = [...new Map(roster.results.map(row => row.destinyUserInfo).filter(validMember).map(member => [String(member.membershipId), identity(member)])).values()];
          await store.insert('guardian_index', members);
          summary.roster_members_seen += members.length;
          summary.roster_pages++;
          // Checkpoint every page. Neither a budget limit nor a crash drops the
          // remaining members; the next cloud run resumes at this cursor.
          const complete = roster.hasMore === false || (roster.hasMore == null && roster.results.length === 0);
          if (!complete && !roster.results.length) throw new Error('Empty roster page with hasMore set.');
          await store.patch('guardian_index_clans', 'clan_id', clan.clan_id, complete
            ? { next_page: 1, next_scan_at: isoAfter(now(), 24), last_completed_at: now().toISOString(), last_error: null }
            : { next_page: page + 1, next_scan_at: now().toISOString(), last_error: null });
          if (complete) break;
          page++;
        } catch (error) {
          if (error instanceof BudgetReached || error.databaseFailure || signal?.aborted) throw error;
          summary.roster_errors++;
          await store.patch('guardian_index_clans', 'clan_id', clan.clan_id, { next_scan_at: isoAfter(now(), 6), last_error: 'Clan roster request failed' });
          break;
        }
      }
      if (summary.roster_pages >= maxClanPages) break;
    }
    if (maxActivityScans) {
      for (const row of await store.dueActivities(now().toISOString(), maxActivityScans)) {
        try {
          const history = await request(`/Destiny2/${row.membership_type}/Account/${row.membership_id}/Character/${row.character_id}/Stats/Activities/?count=3&page=0`);
          const activity = (history.Response?.activities || []).find(item => !item.activityDetails?.isPrivate);
          const activityId = activity?.activityDetails?.instanceId;
          if (activityId && /^[0-9]{1,20}$/.test(String(activityId)) && !(await store.activitySeen(String(activityId)))) {
            const report = await request(`/Destiny2/Stats/PostGameCarnageReport/${activityId}/`);
            if (!Array.isArray(report.Response?.entries)) throw new Error('Invalid activity report.');
            const members = [...new Map(report.Response.entries.map(entry => entry.player?.destinyUserInfo).filter(validMember).map(member => [String(member.membershipId), { ...identity(member), source: 'activity' }])).values()];
            await store.insert('guardian_index', members);
            await store.insert('guardian_index_activities', [{ activity_id: String(activityId) }]);
            summary.activity_members_seen += members.length;
          }
          summary.activity_scans++;
          await store.patch('guardian_index', 'membership_id', row.membership_id, { next_activity_scan_at: isoAfter(now(), 6) });
        } catch (error) {
          if (error instanceof BudgetReached || error.databaseFailure || signal?.aborted) throw error;
          summary.activity_errors++;
          await store.patch('guardian_index', 'membership_id', row.membership_id, { next_activity_scan_at: isoAfter(now(), 1) });
        }
      }
    }
    if (summary.profiles_attempted < maxProfiles) await refreshProfiles(maxProfiles - summary.profiles_attempted);
    if (summary.profile_errors || summary.discovery_errors || summary.roster_errors || summary.seed_errors || summary.activity_errors || summary.rating_errors || summary.ratings_partial) status = 'partial';
  } catch (error) {
    if (error instanceof BudgetReached) status = 'budget_reached';
    else { status = 'failed'; throw error; }
  } finally {
    summary.bungie_operations = bungie.operations;
    if (bungie.backoffUntil) await store.backoff(new Date(bungie.backoffUntil).toISOString());
    await store.finish(runId, status, summary);
  }
  return { status, ...summary };
}

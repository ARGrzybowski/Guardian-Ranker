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
  const minutes = characters.map(char => number(char.minutesPlayedTotal));
  const latest = Math.max(...characters.map(char => Date.parse(char.dateLastPlayed) || 0));
  if (!user.bungieGlobalDisplayName || user.bungieGlobalDisplayNameCode == null) throw new Error('Profile has no Bungie name.');
  return {
    membership_id: String(membership.membershipId), membership_type: membership.membershipType,
    bungie_name: formatBungieName(user),
    time_played_hours: minutes.every(value => value !== null) ? Math.floor(minutes.reduce((sum, value) => sum + value, 0) / 60) : null,
    triumph_score: number(profile.profileRecords?.data?.lifetimeScore),
    guardian_rank: number(profile.profile?.data?.currentGuardianRank),
    highest_guardian_rank: number(profile.profile?.data?.lifetimeHighestGuardianRank),
    class_type: ({ 0: 'Titan', 1: 'Hunter', 2: 'Warlock' })[strongest.classType] || 'Unknown',
    light_level: number(strongest.light), last_played: latest ? new Date(latest).toISOString() : null
  };
}

export function createBungieWorker({ apiKey, maxOperations = 300, signal, intervalMs = 500, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let operations = 0;
  return {
    get operations() { return operations; },
    async request(path, options = {}) {
      signal?.throwIfAborted();
      if (operations >= maxOperations) throw new BudgetReached('Bungie operation budget reached.');
      if (operations++) await wait(intervalMs);
      return bungieRequest(path, { ...options, signal, apiKey });
    }
  };
}

// Runs once per invocation. The scheduler lives in GitHub Actions, never on a PC.
export async function runIndexer({ store, bungie, signal, now = () => new Date(), seedNames = [], seedClans = [], maxProfiles = 100, maxDiscoveries = 25, maxClanPages = 20 }) {
  const summary = { profiles_attempted: 0, profiles_refreshed: 0, seed_errors: 0, profile_errors: 0, discovery_errors: 0, roster_errors: 0, clans_found: 0, roster_members_seen: 0, roster_pages: 0 };
  const runId = await store.start();
  if (!runId) return { status: 'already_running' };
  let status = 'completed';
  const request = bungie.request.bind(bungie);
  const refreshProfiles = async limit => {
    // Refresh old due accounts first. Stable due times prevent new clan imports
    // from starving previously indexed players on later runs.
    for (const row of await store.dueProfiles(now().toISOString(), limit)) {
      summary.profiles_attempted++;
      try {
        let user;
        if (row.membership_type == null) user = await searchExactName(row.bungie_name || '', signal, request);
        else {
          const data = await request(`/User/GetMembershipsById/${row.membership_id}/${row.membership_type}/`);
          user = { destinyMemberships: data.Response?.destinyMemberships || [] };
        }
        const loaded = await loadPlayerProfile(user, signal, request);
        const snapshot = profileSnapshot(loaded);
        const active = snapshot.last_played && now().getTime() - Date.parse(snapshot.last_played) < 7 * 86400000;
        await store.save(row.membership_id, snapshot, isoAfter(now(), active ? 6 : 48));
        summary.profiles_refreshed++;
      } catch (error) {
        if (error instanceof BudgetReached || error.databaseFailure || signal?.aborted) throw error;
        summary.profile_errors++;
        // Private profiles leave public rankings. Transient failures retain the
        // last known snapshot with its original freshness timestamp.
        await store.failProfile(row, isoAfter(now(), Math.min(48, 6 * 2 ** Math.min(row.error_count || 0, 3))), Boolean(error.noPublicCharacters));
      }
    }

  };
  try {
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

    await refreshProfiles(maxProfiles);

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
    if (summary.profiles_attempted < maxProfiles) await refreshProfiles(maxProfiles - summary.profiles_attempted);
    if (summary.profile_errors || summary.discovery_errors || summary.roster_errors || summary.seed_errors) status = 'partial';
  } catch (error) {
    if (error instanceof BudgetReached) status = 'budget_reached';
    else { status = 'failed'; throw error; }
  } finally {
    summary.bungie_operations = bungie.operations;
    await store.finish(runId, status, summary);
  }
  return { status, ...summary };
}

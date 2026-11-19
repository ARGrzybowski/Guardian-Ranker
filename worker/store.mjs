// This module is server-only. Never import it into a browser entry point.
export class IndexStore {
  constructor({ url, key, fetchImpl = fetch, signal }) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1') throw new Error('Supabase URL must use HTTPS.');
    this.url = `${parsed.origin}/rest/v1/`;
    this.key = key;
    this.fetch = fetchImpl;
    this.signal = signal;
  }
  async request(path, { method = 'GET', body, prefer } = {}) {
    const response = await this.fetch(this.url + path, {
      method, headers: { apikey: this.key, ...(!this.key.startsWith('sb_secret_') ? { Authorization: `Bearer ${this.key}` } : {}),
        'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([...(this.signal ? [this.signal] : []), AbortSignal.timeout(15000)])
    });
    if (!response.ok) {
      // Do not log response bodies, request headers, or credentials into Actions logs.
      const error = new Error(`Index database request failed (HTTP ${response.status}). Check the migration and worker secret.`);
      error.databaseFailure = true;
      throw error;
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  rpc(name, body) { return this.request(`rpc/${name}`, { method: 'POST', body }); }
  select(table, filters) { return this.request(`${table}?${new URLSearchParams(filters)}`); }
  insert(table, rows) {
    if (!rows.length) return Promise.resolve();
    const conflict = { guardian_index_clans: 'clan_id', guardian_index_activities: 'activity_id', guardian_index: 'membership_id' }[table];
    return this.request(`${table}?on_conflict=${conflict}`, {
      method: 'POST', body: rows, prefer: 'resolution=ignore-duplicates,return=minimal'
    });
  }
  patch(table, key, id, values) {
    return this.request(`${table}?${new URLSearchParams({ [key]: `eq.${id}` })}`, { method: 'PATCH', body: values, prefer: 'return=minimal' });
  }
  start() { return this.rpc('start_guardian_index_run', {}); }
  backoff(until) { return this.patch('guardian_index_lease','singleton','true',{backoff_until:until}); }
  finish(id, status, summary) {
    // Release the lease even if the run's overall deadline has expired.
    const cleanup = new IndexStore({ url: this.url, key: this.key, fetchImpl: this.fetch });
    return cleanup.rpc('finish_guardian_index_run', { p_run_id: id, p_status: status, p_summary: summary });
  }
  dueProfiles(now, limit) {
    return this.rpc('get_guardians_due', { p_now: now, p_limit: limit });
  }
  dueDiscovery(now, limit) {
    return this.select('guardian_index', { select: 'membership_id,membership_type', canonical_membership_id: 'is.null', membership_type: 'not.is.null', next_discovery_at: `lte.${now}`, order: 'next_discovery_at.asc,membership_id.asc', limit });
  }
  dueClans(now, limit) {
    return this.select('guardian_index_clans', { select: '*', next_scan_at: `lte.${now}`, order: 'next_scan_at.asc,clan_id.asc', limit });
  }
  dueActivities(now, limit) {
    return this.select('guardian_index', { select: 'membership_id,membership_type,character_id', canonical_membership_id: 'is.null', profile_status: 'eq.public', character_id: 'not.is.null', next_activity_scan_at: `lte.${now}`, order: 'next_activity_scan_at.asc,membership_id.asc', limit });
  }
  async activitySeen(id) {
    return (await this.select('guardian_index_activities', { select: 'activity_id', activity_id: `eq.${id}`, limit: 1 })).length > 0;
  }
  dueRatings(now, limit, version) { return this.rpc('get_guardian_ratings_due', { p_now: now, p_limit: limit, p_version: version }); }
  async ratingManifest() { return (await this.select('guardian_rating_manifest', { select: 'payload', singleton: 'eq.true' }))[0]?.payload; }
  saveRatingManifest(payload) { return this.request('guardian_rating_manifest?on_conflict=singleton', { method: 'POST', body: { singleton: true, payload }, prefer: 'resolution=merge-duplicates,return=minimal' }); }
  saveRating(id, rating, manifestVersion, nextRating) {
    return this.request('guardian_account_ratings?on_conflict=membership_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: {
      membership_id: id, score: rating.overall.score, grade: rating.overall.tier?.grade || null, rating_version: rating.version,
      coverage: rating.overall.coverage, provisional: rating.overall.provisional, last_rated_at: new Date().toISOString(), next_rating_at: nextRating,
      lower_bound: rating.overall.range.min, upper_bound: rating.overall.range.max, manifest_version: manifestVersion, error_count: 0, last_error: null,
      metric_scores: rating.metrics.map(m => ({ id: m.id, value: m.value, score: m.score, status: m.status, weight: m.weight, grade: m.tier?.grade || null }))
    } });
  }
  failRating(row, nextRating, isPrivate) {
    return this.rpc('fail_guardian_rating', { p_id: row.membership_id, p_next: nextRating, p_private: isPrivate });
  }
  duePerformance(now, limit) {
    return this.rpc('get_guardian_performance_due', { p_now: now, p_limit: limit });
  }
  async performanceCatalog() {
    return (await this.select('guardian_performance_catalog', { select: 'payload', singleton: 'eq.true' }))[0]?.payload;
  }
  savePerformanceCatalog(payload) {
    return this.request('guardian_performance_catalog?on_conflict=singleton', {
      method: 'POST', body: { singleton: true, payload }, prefer: 'resolution=merge-duplicates,return=minimal'
    });
  }
  savePerformance(id, rating, nextRating) {
    return this.request('guardian_performance?on_conflict=membership_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        membership_id: id, credit_version: rating.version, precise_points: rating.points,
        credit_eligible: rating.eligible, credit_metrics: rating.metrics,
        competitive_peak: rating.competitivePeak, commendations: rating.commendations,
        credit_rated_at: rating.calculatedAt, next_rating_at: nextRating, consecutive_errors: 0
      }
    });
  }
  failPerformance(id, nextRating, isPrivate) {
    return this.rpc('fail_guardian_performance', { p_id: id, p_next: nextRating, p_private: isPrivate });
  }
  save(requestedId, snapshot, nextRefresh) {
    return this.rpc('save_guardian_snapshot', { p_requested_id: requestedId, p_snapshot: snapshot, p_next_refresh_at: nextRefresh });
  }
  failProfile(row, nextRefresh, isPrivate) {
    return this.patch('guardian_index', 'membership_id', row.membership_id, {
      next_refresh_at: nextRefresh, error_count: row.error_count + 1,
      last_error: isPrivate ? 'No public characters' : 'Bungie request failed',
      ...(isPrivate ? { profile_status: 'private' } : {})
    });
  }
}

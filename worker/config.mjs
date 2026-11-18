export function readWorkerConfiguration(env) {
  if (env.GITHUB_ACTIONS !== 'true') throw new Error('Run the indexer through GitHub Actions, not on a personal computer.');
  for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BUNGIE_API_KEY']) {
    if (!env[name]) throw new Error(`Missing GitHub Actions configuration: ${name}`);
  }
  // Catch the common mistake of copying the public anon key into the worker.
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key.startsWith('sb_secret_')) {
    let role;
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role; } catch { /* Invalid key. */ }
    if (role !== 'service_role') throw new Error('The worker requires a Supabase server secret or service_role key, not the public anon key.');
  }
  const list = name => (env[name] || '').split(',').map(value => value.trim()).filter(Boolean);
  const seedNames = list('INDEXER_SEED_NAMES'), seedClans = list('INDEXER_SEED_CLANS');
  if (seedNames.length > 20 || seedClans.length > 20) throw new Error('Configure at most 20 seed names and 20 seed clans.');
  if (seedClans.some(id => !/^[0-9]{1,20}$/.test(id))) throw new Error('INDEXER_SEED_CLANS must contain numeric clan IDs.');
  return { url: env.SUPABASE_URL, key, apiKey: env.BUNGIE_API_KEY, seedNames, seedClans };
}

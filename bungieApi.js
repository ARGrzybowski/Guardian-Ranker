export const API_KEY = '12ecbda2bf10444b8b8058f825f33a43';
const PLATFORM_URL = 'https://www.bungie.net/Platform';

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// Retry transient failures, but never scan indefinitely or leave a request hanging.
export async function bungieRequest(path, { signal, body, apiKey = API_KEY, maxAttempts = 3, timeoutMs = 15000 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    signal?.throwIfAborted();
    let retryAfter = 300 * (attempt + 1);
    try {
      const response = await fetch(`${PLATFORM_URL}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-API-Key': apiKey, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)])
      });
      const data = await response.json();
      signal?.throwIfAborted();
      if (response.ok && data.ErrorCode === 1) return data;

      const error = new Error(data.Message || `Bungie API error: HTTP ${response.status}`);
      error.status = response.status;
      error.retryable = response.status === 429 || response.status >= 500 || data.ThrottleSeconds > 0;
      const retryHeader = response.headers?.get('Retry-After');
      const headerDelay = retryHeader ? (Number.isFinite(Number(retryHeader))
        ? Number(retryHeader) * 1000 : Date.parse(retryHeader) - Date.now()) : 0;
      retryAfter = Math.max(retryAfter, (Number(data.ThrottleSeconds) || 0) * 1000, headerDelay || 0);
      error.retryAfterMs = retryAfter;
      error.throttled = response.status === 429 || data.ThrottleSeconds > 0;
      // Long throttles should be shown to the user instead of automatically retried early.
      if (retryAfter > 10000) error.retryable = false;
      throw error;
    } catch (error) {
      signal?.throwIfAborted();
      if (error.retryable === false || attempt === maxAttempts - 1) throw error;
    }
    await delay(retryAfter, signal);
  }
}

export function parseBungieName(value) {
  const match = value.trim().match(/^(.+)#(\d{4})$/u);
  return match ? { displayName: match[1], displayNameCode: Number(match[2]) } : null;
}

export function formatBungieName(user) {
  return `${user.bungieGlobalDisplayName}#${String(user.bungieGlobalDisplayNameCode).padStart(4, '0')}`;
}

export async function searchExactName(value, signal, request = bungieRequest) {
  const name = parseBungieName(value);
  if (!name) throw new Error('Enter a full Bungie name, such as Guardian#1234.');
  // The exact endpoint has no prefix-result pagination limit. All = -1.
  const { Response: memberships } = await request('/Destiny2/SearchDestinyPlayerByBungieName/-1/', {
    signal, body: name
  });
  if (!memberships?.length) throw new Error(`No Destiny 2 account found for ${value}.`);
  const identity = memberships.find(m => m.bungieGlobalDisplayName) || {};
  return {
    bungieGlobalDisplayName: identity.bungieGlobalDisplayName || name.displayName,
    bungieGlobalDisplayNameCode: identity.bungieGlobalDisplayNameCode ?? name.displayNameCode,
    destinyMemberships: memberships
  };
}

export async function searchNameSuggestions(prefix, signal) {
  const { Response } = await bungieRequest(`/User/Search/Prefix/${encodeURIComponent(prefix)}/0/`, { signal });
  return Response;
}

export async function loadPlayerProfile(user, signal, request = bungieRequest) {
  const memberships = (user.destinyMemberships || []).filter(m =>
    m.membershipId && m.membershipType > 0 && m.membershipType !== 254 &&
    (!m.crossSaveOverride || m.crossSaveOverride === m.membershipType)
  );
  if (!memberships.length) throw new Error('No active Destiny 2 membership found.');
  const profiles = [];
  let lastError;
  for (const membership of memberships) {
    signal?.throwIfAborted();
    try {
      const profileData = await request(
        `/Destiny2/${membership.membershipType}/Profile/${membership.membershipId}/?components=100,200,800,900`,
        { signal }
      );
      const characters = Object.values(profileData.Response?.characters?.data || {});
      if (!characters.length) continue;
      profiles.push({ membership, profileData, lastPlayed: Math.max(...characters.map(c => Date.parse(c.dateLastPlayed) || 0)) });
      // The active cross-save profile is authoritative, regardless of platform order.
      if (membership.crossSaveOverride === membership.membershipType) return profiles.at(-1);
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error;
    }
  }
  if (profiles.length) return profiles.sort((a, b) => b.lastPlayed - a.lastPlayed)[0];
  const error = lastError || new Error('No public characters are available. This account may be private or have no Destiny 2 characters.');
  if (!lastError) error.noPublicCharacters = true;
  throw error;
}

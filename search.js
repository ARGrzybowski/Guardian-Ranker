import { searchExactName, searchNameSuggestions, loadPlayerProfile, parseBungieName, formatBungieName } from './bungieApi.js';
import { loadLeaderboards } from './leaderboard.js';
import { queueGuardian } from './indexQueue.js';
import { escapeHtml } from './html.js';

const input = document.getElementById('nameInput');
const suggestions = document.getElementById('suggestions');
const results = document.getElementById('results');
const searchBtn = document.getElementById('searchBtn');
const classTypeMap = { 0: 'Titan', 1: 'Hunter', 2: 'Warlock' };
let timeoutId;
let activeController;
let searchVersion = 0;

function clearSuggestions() {
  suggestions.replaceChildren();
  suggestions.classList.remove('show');
}

function suggestionMessage(message) {
  const li = document.createElement('li');
  li.textContent = message;
  suggestions.appendChild(li);
  suggestions.classList.add('show');
}

// Invalidate immediately, before the debounce expires, so stale responses cannot render.
function handleSearch(value, useDelay = true) {
  clearTimeout(timeoutId);
  activeController?.abort();
  activeController = new AbortController();
  const { signal } = activeController;
  const version = ++searchVersion;
  clearSuggestions();
  results.textContent = '';
  value = value.trim();
  if (value.length < 2) return;
  const exact = parseBungieName(value);
  if (value.includes('#') && !exact) {
    if (!useDelay) results.textContent = 'Enter the full four-digit Bungie code, such as Guardian#1234.';
    return;
  }
  const run = async () => {
    try {
      if (exact) {
        results.innerHTML = '<div class="loading-spinner"><div></div></div>';
        const user = await searchExactName(value, signal);
        const loaded = await loadPlayerProfile(user, signal);
        if (version !== searchVersion) return;
        renderProfile(user, loaded, version);
      } else {
        const response = await searchNameSuggestions(value, signal);
        if (version !== searchVersion) return;
        clearSuggestions();
        for (const user of response?.searchResults || []) {
          const name = formatBungieName(user);
          const li = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'suggestion-button';
          button.textContent = name;
          button.addEventListener('click', () => {
            input.value = name;
            handleSearch(name, false);
          });
          li.appendChild(button);
          suggestions.appendChild(li);
        }
        if (!response?.searchResults?.length) suggestionMessage('No matching names. Try the full Guardian#1234 name.');
        else {
          suggestions.classList.add('show');
          if (response.hasMore) suggestionMessage('More matches exist. Keep typing or enter the full Guardian#1234 name.');
        }
      }
    } catch (error) {
      if (signal.aborted || version !== searchVersion) return;
      if (exact) results.textContent = error.message;
      else suggestionMessage(error.message);
    }
  };
  if (useDelay) timeoutId = setTimeout(run, 300);
  else void run();
}

input.addEventListener('input', () => handleSearch(input.value));
input.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleSearch(input.value, false);
  }
});
searchBtn.addEventListener('click', () => handleSearch(input.value, false));

const formatStat = value => value == null ? 'Unavailable' : escapeHtml(value.toLocaleString());

function renderProfile(user, { membership: mem, profileData }, version) {
  const bungieName = formatBungieName(user);
  const { membershipId, membershipType, displayName, iconPath } = mem;
  const iconUrl = `https://www.bungie.net${iconPath || ''}`;
  const chars = profileData.Response.characters.data;
  const totalMinutes = Object.values(chars).reduce((sum, c) => sum + (parseInt(c.minutesPlayedTotal) || 0), 0);
  const playTimeHours = Math.floor(totalMinutes / 60);
  const triumphScore = profileData.Response.profileRecords?.data?.lifetimeScore ?? null;
  const currentGuardianRank = profileData.Response.profile?.data?.currentGuardianRank ?? null;
  const highestGuardianRank = profileData.Response.profile?.data?.lifetimeHighestGuardianRank ?? null;
  const lastLogin = Object.values(chars).map(c => new Date(c.dateLastPlayed)).sort((a, b) => b - a)[0]?.toLocaleDateString() || 'N/A';
  const collectibles = profileData.Response.profileCollectibles?.data?.collectibles;
  const hasCollections = collectibles != null;
  const totalCount = Object.keys(collectibles || {}).length;
  const collectedCount = Object.values(collectibles || {}).filter(info => (info.state & 1) === 0).length;

    // Build HTML for character details
    const characterDetailsHTML = Object.entries(chars)
      .map(([_, char]) => {
        const emblemUrl = `https://www.bungie.net${char.emblemBackgroundPath}`;
        const className = classTypeMap[char.classType] || 'Unknown';
        const power = char.light;
        const lastPlayed = new Date(char.dateLastPlayed).toLocaleDateString();
        const isHigh = power > 200;
        const powerClass = isHigh ? 'high-power' : '';
        const powerDisplay = isHigh ? `${power}+` : power;
        return `
          <div style="position: relative; margin-bottom: 30px; max-width: 500px;">
            <img src="${escapeHtml(emblemUrl)}" alt="Emblem" style="width: 100%; border-radius: 8px; display: block;">
            <div style="
              position: absolute;
              top: 50%;
              left: 20%;
              transform: translateY(-75%);
              color: white;
              font-size: 18px;
              padding: 6px 12px;
              border-radius: 6px;
              text-align: left;
              width: calc(50%);
              box-sizing: border-box;
              background: rgba(0, 0, 0, 0.4);
              display: flex;
              align-items: center;
            ">
              <span style="flex-shrink: 0; min-width: 100px;">${className}:</span>
              <span class="stat-value ${powerClass}" style="text-align: right;">${escapeHtml(powerDisplay)}</span>
            </div>
            <div style="margin-top: 8px; font-size: 14px;">Last Login: ${lastPlayed}</div>
          </div>
        `;
      })
      .join('');

    // Render user card with all stats
    results.innerHTML = '';
    const userCard = document.createElement('div');
    userCard.classList.add('user-card');
    userCard.innerHTML = `
      <div class="user-header">
        <img src="${escapeHtml(iconUrl)}" alt="Platform" class="platform-icon">
        <div class="user-info">
          <div class="bungie-name">${escapeHtml(bungieName)}</div>
          <div class="display-name">${escapeHtml(displayName)}</div>
        </div>
      </div>
      <div class="character-section">
        <h3>Characters</h3>
        ${characterDetailsHTML}
      </div>
      <div class="stats-container">
        <div class="stat-group"><div class="stat-label">Time Played</div><div class="stat-value">${playTimeHours.toLocaleString()} hours</div></div>
        <div class="stat-group"><div class="stat-label">Last Login</div><div class="stat-value">${lastLogin}</div></div>
        <div class="stat-group"><div class="stat-label">Triumph Score</div><div class="stat-value">${formatStat(triumphScore)}</div></div>
        <div class="stat-group"><div class="stat-label">Guardian Rank</div><div class="stat-value">${formatStat(currentGuardianRank)}</div></div>
        <div class="stat-group"><div class="stat-label">Highest Guardian Rank</div><div class="stat-value">${formatStat(highestGuardianRank)}</div></div>
        <div class="stat-group"><div class="stat-label">Collections</div><div class="stat-value">${hasCollections ? `${collectedCount.toLocaleString()} / ${totalCount.toLocaleString()}` : 'Unavailable'}</div></div>
      </div>
      <button id="downloadRawBtn" style="margin-top: 20px;">Download Raw Data</button>
    `;
    results.appendChild(userCard);


  document.getElementById('downloadRawBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ user, profile: profileData }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bungieName.replace('#', '_')}_raw_data.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Visitors submit identities only. The cloud worker fetches trusted scores.
  const saveStatus = document.createElement('p');
  saveStatus.setAttribute('role', 'status');
  userCard.appendChild(saveStatus);
  void (async () => {
    try {
      await queueGuardian(membershipId, membershipType);
      if (version === searchVersion) saveStatus.textContent = 'Account tracked. Leaderboard scores update during scheduled cloud refreshes.';
    } catch (error) {
      if (version !== searchVersion) return;
      saveStatus.textContent = error.code === 'PGRST202'
        ? 'Profile loaded. Automatic leaderboard indexing is not enabled yet.'
        : 'Profile loaded. This account could not be queued for indexing. Please try again later.';
    }
    await loadLeaderboards();
  })();
}

const initialName = new URLSearchParams(window.location.search).get('name');
if (initialName) {
  input.value = initialName;
  handleSearch(initialName, false);
}

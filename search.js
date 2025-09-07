import { upsertPlayer, loadLeaderboard, addOrUpdatePlayer } from './leaderboard.js';
import { upsertHighestCharacter, loadHighestCharacterLeaderboard } from './highestCharacter.js';

const API_KEY = '12ecbda2bf10444b8b8058f825f33a43';
const input = document.getElementById('nameInput');
const suggestions = document.getElementById('suggestions');
const results = document.getElementById('results');
const searchBtn = document.getElementById('searchBtn');
const classTypeMap = { 0: 'Titan', 1: 'Hunter', 2: 'Warlock' };

let timeoutId = null;
let seasonData = null;
let currentSeasonHash = null;

// small helpers and limits
const MAX_GLOBAL_PAGES = 50;
const MAX_PREFIX_PAGES = 10;
const FALLBACK_WINDOW = 5;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// performs a small, fail-fast paged Prefix search starting at startP
async function prefixFallback(name, code, startP = 0) {
  console.log(`Prefix fallback starting at page ${startP}`);
  let consecutive5xx = 0;
  const end = Math.min(startP + FALLBACK_WINDOW, MAX_PREFIX_PAGES);
  for (let p = startP; p < end; p++) {
    try {
      await sleep(250);
      const prefixRes = await fetch(
        `https://www.bungie.net/Platform/User/Search/Prefix/${encodeURIComponent(name)}/${p}/`,
        { headers: { 'X-API-Key': API_KEY } }
      );
      if (!prefixRes.ok) {
        console.warn(`Prefix page ${p} HTTP ${prefixRes.status}`);
        if (prefixRes.status >= 500) {
          consecutive5xx++;
          if (consecutive5xx >= 2) {
            console.warn('Prefix fallback aborting after repeated 5xx.');
            break;
          }
          continue;
        }
        break; // client error - stop fallback
      }

      consecutive5xx = 0;
      const prefixData = await prefixRes.json();
      if (prefixData.ErrorCode !== 1) continue;
      const pfResults = prefixData.Response?.searchResults || [];
      const exact = pfResults.find(u =>
        u.bungieGlobalDisplayName.toLowerCase() === name.toLowerCase() &&
        String(u.bungieGlobalDisplayNameCode).padStart(4, '0') === String(code).padStart(4, '0')
      );
      if (exact) return exact;
      if (pfResults.length === 0) break;
    } catch (err) {
      console.warn('Prefix fallback error on page', p, err);
      break; // network/unexpected, abort fallback
    }
  }
  return null;
}

// robust GlobalName search that fails fast on a bad page and falls back once
async function searchByGlobalName(name, code, startPage = 0) {
  try {
    results.innerHTML = `<div class="loading-spinner"><div></div></div>`;
    console.log(`Searching for: ${name}#${code} (start ${startPage})`);

    let page = startPage;
    while (page < MAX_GLOBAL_PAGES) {
      console.log('Checking GlobalName page', page);

      let attempts = 0;
      let data = null;
      let lastWas5xx = false;

      // try this page with a few retries for transient 5xx/network errors
      while (attempts < 3) {
        try {
          if (page > 0 && attempts === 0) await sleep(300);
          const res = await fetch(
            `https://www.bungie.net/Platform/User/Search/GlobalName/${page}/`,
            {
              method: 'POST',
              headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ displayNamePrefix: name })
            }
          );

          if (!res.ok) {
            console.warn(`Page ${page} response status ${res.status}`);
            if (res.status >= 500) {
              lastWas5xx = true;
              attempts++;
              await sleep(300 * attempts);
              continue;
            }
            // client error - abort search entirely
            results.textContent = `API Error: HTTP ${res.status}`;
            return;
          }

          data = await res.json();
          break;
        } catch (err) {
          attempts++;
          console.warn(`Request error page ${page} attempt ${attempts}`, err);
          await sleep(300 * attempts);
        }
      }

      // if we couldn't get data for this page, do a single prefix fallback and stop
      if (!data) {
        console.warn(`Page ${page} failed after retries. Running single prefix fallback and stopping.`);
        const fallbackResult = await prefixFallback(name, code, page);
        if (fallbackResult) {
          results.innerHTML = '';
          showUser(fallbackResult);
          return;
        }
        break; // stop scanning GlobalName pages
      }

      if (data.ErrorCode !== 1) {
        console.warn(`API Error on page ${page}:`, data.ErrorStatus);
        // respect throttle hint if present, otherwise continue to next page
        if (data.ThrottleSeconds && data.ThrottleSeconds > 0) {
          await sleep((data.ThrottleSeconds + 1) * 1000);
        } else {
          // non-success, try next page (but don't treat as catastrophic)
          page++;
        }
        continue;
      }

      const pageResults = data.Response.searchResults || [];
      console.log(`Page ${page} results: ${pageResults.length}`);

      const exact = pageResults.find(u =>
        u.bungieGlobalDisplayName.toLowerCase() === name.toLowerCase() &&
        String(u.bungieGlobalDisplayNameCode).padStart(4, '0') === String(code).padStart(4, '0')
      );

      if (exact) {
        results.innerHTML = '';
        showUser(exact);
        return;
      }

      // end of globalname results if this page is empty
      if (pageResults.length === 0) {
        console.log('End of GlobalName results at page', page);
        break;
      }

      page++;
    }

    // not found after scanning/fallback
    results.textContent = 'No users found (may be beyond scanned pages or private).';
  } catch (err) {
    console.error('Search error:', err);
    results.textContent = `Error: ${err.message}`;
  }
}

function toManifestKey(hash) {
  return typeof hash === 'number' ? (hash >>> 0).toString() : String(hash);
}

input.addEventListener('input', e => {
  clearTimeout(timeoutId);
  const value = e.target.value.trim();
  if (value.length < 2) {
    suggestions.innerHTML = '';
    suggestions.classList.remove('show');
    return;
  }
  const m = value.match(/^(.+?)#(\d{4})$/);
  if (m) searchByGlobalName(m[1], m[2]);
  else searchPrefix(value);
});

searchBtn.addEventListener('click', () => {
  clearTimeout(timeoutId);
  handleSearch(input.value.trim(), false);
});

function handleSearch(value, useDelay = true) {
  suggestions.innerHTML = '';
  suggestions.classList.remove('show');
  results.textContent = '';
  if (value.length < 2) return;
  const m = value.match(/^(.+?)#(\d{4})$/);
  const doSearch = async () => {
    await searchPrefix(value);
    if (m) searchByGlobalName(m[1], m[2]);
  };
  if (useDelay) timeoutId = setTimeout(doSearch, 300);
  else doSearch();
}

async function searchPrefix(prefix) {
  try {
    const res = await fetch(`https://www.bungie.net/Platform/User/Search/Prefix/${encodeURIComponent(prefix)}/0/`, {
      headers: { 'X-API-Key': API_KEY }
    });
    const data = await res.json();
    if (data.ErrorCode !== 1) {
      suggestions.innerHTML = '<li>API Error</li>';
      suggestions.classList.add('show');
      return;
    }
    const users = data.Response.searchResults || [];
    if (!users.length) {
      suggestions.innerHTML = '<li>No users found.</li>';
      suggestions.classList.add('show');
      return;
    }
    suggestions.innerHTML = '';
    users.forEach(u => {
      const name = `${u.bungieGlobalDisplayName}#${u.bungieGlobalDisplayNameCode.toString().padStart(4, '0')}`;
      const li = document.createElement('li');
      li.textContent = name;
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => {
        input.value = name;
        suggestions.innerHTML = '';
        suggestions.classList.remove('show');
        const m = name.match(/^(.+?)#(\d{4})$/);
        if (m) searchByGlobalName(m[1], m[2]);
      });
      suggestions.appendChild(li);
    });
    suggestions.classList.add('show');
  } catch (err) {
    suggestions.innerHTML = `<li>Error: ${err.message}</li>`;
    suggestions.classList.add('show');
  }
}

async function showUser(user) {
  results.innerHTML = `<div class="user-card"><div class="loading-spinner"><div></div></div></div>`;

  const bungieName = `${user.bungieGlobalDisplayName}#${user.bungieGlobalDisplayNameCode
    .toString()
    .padStart(4, '0')}`;
  const mem = user.destinyMemberships?.[0];
  if (!mem) {
    results.textContent = 'No Destiny 2 membership found.';
    return;
  }
  const { membershipId, membershipType, displayName, iconPath } = mem;
  const iconUrl = `https://www.bungie.net${iconPath}`;

  try {
    const components = [
      100, 200, 201, 202, 203, 204, 205, 300, 301, 302, 303, 304, 305, 306, 307,
      308, 309, 310, 311, 400, 401, 402, 403, 500, 600, 700, 800, 900, 1000,
      1100, 1200
    ];
    const profileRes = await fetch(
      `https://www.bungie.net/Platform/Destiny2/${membershipType}/Profile/${membershipId}/?components=${components.join(',')}`,
      { headers: { 'X-API-Key': API_KEY } }
    );
    const profileData = await profileRes.json();

    if (profileData.ErrorCode !== 1) {
      results.textContent = `Bungie API Error: ${profileData.Message}`;
      return;
    }

    if (!profileData.Response || !profileData.Response.characters) {
      results.textContent = 'Profile data unavailable. The profile may be private or not exist.';
      return;
    }

    const chars = profileData.Response.characters?.data || {};
    const totalMinutes = Object.values(chars).reduce(
      (sum, c) => sum + (parseInt(c.minutesPlayedTotal) || 0),
      0
    );
    const playTimeHours = Math.floor(totalMinutes / 60);
    const triumphScore =
      profileData.Response.profileRecords?.data?.lifetimeScore ?? 'Unknown';

    const currentGuardianRank =
      profileData.Response.profile?.data?.currentGuardianRank ?? 'Unavailable';
    const highestGuardianRank =
      profileData.Response.profile?.data?.lifetimeHighestGuardianRank ?? 'Unavailable';

    const player = {
      bungie_name: bungieName,
      membership_id: membershipId,
      time_played_hours: playTimeHours,
      triumph_score: triumphScore,
      guardian_rank: currentGuardianRank,
      highest_guardian_rank: highestGuardianRank
    };

    const highestChar = Object.values(chars).reduce((best, c) => {
      return (!best || parseInt(c.light) > parseInt(best.light)) ? c : best;
    }, null);

    await addOrUpdatePlayer(player);
    await upsertHighestCharacter({
      bungie_name: bungieName,
      membership_id: membershipId,
      character_id: highestChar.characterId,
      character_class: classTypeMap[highestChar.classType] || 'Unknown',
      character_light: highestChar.light,
      emblem_path: highestChar.emblemBackgroundPath,
      last_played: highestChar.dateLastPlayed
    });
    await loadLeaderboard();
    await loadHighestCharacterLeaderboard();

    const lastLogin =
      Object.values(chars)
        .map(c => new Date(c.dateLastPlayed))
        .sort((a, b) => b - a)[0]
        ?.toLocaleDateString() || 'N/A';
    const charCount = Object.keys(chars).length;
    currentSeasonHash = profileData.Response.profile?.data?.currentSeasonHash || null;

    const collectibles = profileData.Response.profileCollectibles?.data?.collectibles || {};
    let collectedCount = 0;
    let totalCount = 0;
    for (const info of Object.values(collectibles)) {
      totalCount++;
      if ((info.state & 1) === 0) collectedCount++;
    }

    const charProgRes = await fetch(
      `https://www.bungie.net/Platform/Destiny2/${membershipType}/Profile/${membershipId}/Character/0/?components=900`,
      { headers: { 'X-API-Key': API_KEY } }
    );
    const charProgData = await charProgRes.json();

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
            <img src="${emblemUrl}" alt="Emblem" style="width: 100%; border-radius: 8px; display: block;">
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
              <span class="stat-value ${powerClass}" style="text-align: right;">${powerDisplay}</span>
            </div>
            <div style="margin-top: 8px; font-size: 14px;">Last Login: ${lastPlayed}</div>
          </div>
        `;
      })
      .join('');

    results.innerHTML = '';
    const userCard = document.createElement('div');
    userCard.classList.add('user-card');
    userCard.innerHTML = `
      <div class="user-header">
        <img src="${iconUrl}" alt="Platform" class="platform-icon">
        <div class="user-info">
          <div class="bungie-name">${bungieName}</div>
          <div class="display-name">${displayName}</div>
        </div>
      </div>
      <div class="character-section">
        <h3>Characters</h3>
        ${characterDetailsHTML}
      </div>
      <div class="stats-container">
        <div class="stat-group"><div class="stat-label">Time Played</div><div class="stat-value">${playTimeHours.toLocaleString()} hours</div></div>
        <div class="stat-group"><div class="stat-label">Last Login</div><div class="stat-value">${lastLogin}</div></div>
        <div class="stat-group"><div class="stat-label">Triumph Score</div><div class="stat-value">${triumphScore.toLocaleString()}</div></div>
        <div class="stat-group"><div class="stat-label">Guardian Rank</div><div class="stat-value">${currentGuardianRank}</div></div>
        <div class="stat-group"><div class="stat-label">Highest Guardian Rank</div><div class="stat-value">${highestGuardianRank}</div></div>
        <div class="stat-group"><div class="stat-label">Collections</div><div class="stat-value">${collectedCount.toLocaleString()} / ${totalCount.toLocaleString()}</div></div>
      </div>
      <button id="downloadRawBtn" style="margin-top: 20px;">Download Raw Data</button>
    `;
    results.appendChild(userCard);

    document.getElementById('downloadRawBtn').addEventListener('click', () => {
      const fullData = { user, profile: profileData, characterProgressions: charProgData };
      const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${bungieName.replace('#', '_')}_raw_data.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  } catch (err) {
    results.textContent = `Profile fetch error: ${err.message}`;
  }
}

// Add this function to read the name from the URL
function getParameterByName(name, url = window.location.href) {
  name = name.replace(/[\[\]]/g, '\\$&');
  var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
    results = regex.exec(url);
  if (!results) return null;
  if (!results[2]) return '';
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

// Call handleSearch on page load if the 'name' parameter is present
window.addEventListener('load', () => {
  const name = getParameterByName('name');
  if (name) {
    document.getElementById('nameInput').value = name;
    handleSearch(name, false); // Search immediately without delay
  }
});

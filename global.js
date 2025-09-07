const API_KEY = '12ecbda2bf10444b8b8058f825f33a43';
const input = document.getElementById('nameInput');
const suggestions = document.getElementById('suggestions');
const results = document.getElementById('results');
const searchBtn = document.getElementById('searchBtn');

let timeoutId = null;
let seasonData = null;
let currentSeasonHash = null;

function toManifestKey(hash) {
  return typeof hash === 'number' ? (hash >>> 0).toString() : String(hash);
}

(async function initSeasonData() {
  renderGlobalGameStats(null); // placeholder first

  try {
    console.log('[initSeasonData] Fetching Destiny2 Manifest...');
    const manifestRes = await fetch('https://www.bungie.net/Platform/Destiny2/Manifest/', {
      headers: { 'X-API-Key': API_KEY }
    });
    const manifest = await manifestRes.json();
    console.log('[initSeasonData] Manifest response:', manifest);

    const seasonDefPath = manifest?.Response?.jsonWorldComponentContentPaths?.en?.DestinySeasonDefinition;
    if (!seasonDefPath) {
      console.error('[initSeasonData] No seasonDefPath found in manifest!');
      return;
    }
    console.log('[initSeasonData] Season definition path:', seasonDefPath);

    seasonData = await (await fetch(`https://www.bungie.net${seasonDefPath}`)).json();
    console.log('[initSeasonData] Loaded seasonData keys:', Object.keys(seasonData).length);

    console.log('[initSeasonData] Fetching Destiny2 Settings...');
    const settingsRes = await fetch('https://www.bungie.net/Platform/Settings/', {
      headers: { 'X-API-Key': API_KEY }
    });
    const settingsData = await settingsRes.json();
    console.log('[initSeasonData] Settings response:', settingsData);

    // Unified assignment to avoid overwriting
    const settingsResponse = settingsData.Response;
    currentSeasonHash = settingsResponse?.destiny2CoreSettings?.currentSeasonHash
                         || settingsResponse?.currentSeasonHash
                         || null;

    if (currentSeasonHash) {
      console.log('[initSeasonData] Using currentSeasonHash:', currentSeasonHash);
      console.log('[initSeasonData] Normalized key:', toManifestKey(currentSeasonHash));
    } else {
      console.warn('[initSeasonData] No currentSeasonHash found in settings.');
    }

    renderGlobalGameStats(currentSeasonHash);
  } catch (err) {
    console.error('[initSeasonData] Failed to fetch season data or settings:', err);
    renderGlobalGameStats(null);
  }
})();

function getSeasonInfo(seasonHash) {
  if (!seasonData) {
    console.warn('[getSeasonInfo] seasonData not loaded yet.');
    return { name: 'Loading...', number: '?', image: null, startDate: null, endDate: null };
  }
  const seasonDefs = seasonData.DestinySeasonDefinition || seasonData.definitions || seasonData;
  const key = toManifestKey(seasonHash);

  console.log('[getSeasonInfo] Looking up season with:', {
    rawHash: seasonHash,
    normalizedKey: key,
    sampleKeys: Object.keys(seasonDefs).slice(0, 5)
  });

  const season = seasonDefs?.[key];

  if (!season) {
    console.warn(`[getSeasonInfo] No season found for hash ${seasonHash} (key: ${key})`);
    return {
      name: `Unknown Season (${seasonHash})`,
      number: '?',
      image: null,
      startDate: null,
      endDate: null
    };
  }

  return {
    name: season.displayProperties?.name || `Unknown Season (${seasonHash})`,
    number: season.seasonNumber ?? '?',
    image: season.displayProperties?.icon ? `https://www.bungie.net${season.displayProperties.icon}` : null,
    startDate: season.startDate || null,
    endDate: season.endDate || null
  };
}

function startWeeklyResetCountdown() {
  const timerEl = document.getElementById('weekly-reset-timer');
  if (!timerEl) return;

  function update() {
    const { nextReset, days, hours, minutes } = getNextWeeklyReset();
    timerEl.textContent = `${nextReset.toLocaleString()} (in ${days}d ${hours}h ${minutes}m)`;
  }

  update();
  setInterval(update, 60000); // update every minute
}

function getNextWeeklyReset() {
  const now = new Date();
  const nextReset = new Date(now);

  nextReset.setUTCHours(17, 0, 0, 0); // Tuesday 17:00 UTC
  const day = nextReset.getUTCDay();
  const daysUntilTuesday = day <= 2 ? 2 - day : 9 - day;

  if (daysUntilTuesday > 0) {
    nextReset.setUTCDate(nextReset.getUTCDate() + daysUntilTuesday);
  } else if (now >= nextReset) {
    nextReset.setUTCDate(nextReset.getUTCDate() + 7);
  }

  const diff = nextReset - now;
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / (3600 * 24));
  const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return { nextReset, days, hours, minutes };
}

function renderGlobalGameStats(seasonHash) {
  const gameStats = document.querySelector('#game-stats .stats-container');
  if (!gameStats) {
    console.error('[renderGlobalGameStats] Could not find #game-stats .stats-container');
    return;
  }

  console.log('[renderGlobalGameStats] Rendering with seasonHash:', seasonHash);

  // Weekly Reset block
  const weeklyBlock = `
    <div class="stat-group">
      <div class="stat-label">Weekly Reset</div>
      <div id="weekly-reset-timer" style="white-space: normal;">
        Loading weekly reset time...
      </div>
    </div>
  `;

  // Debug download button
  const debugButton = `
    <div class="stat-group">
      <button id="downloadSeasonDataBtn" style="width: 50%; margin-top: 4px; padding: 2px 4px;">
        Debug Data
      </button>
    </div>
  `;

  if (!seasonHash || !seasonData) {
    console.warn('[renderGlobalGameStats] Missing seasonHash or seasonData, showing placeholder.');
    gameStats.innerHTML = `
      <div class="stat-group">
        <div class="stat-label">Season</div>
        <div class="stat-value season-info">
          <span>Loading season information...</span>
        </div>
      </div>
      ${weeklyBlock}
      ${debugButton}
    `;
    startWeeklyResetCountdown();
    attachDebugDownload();
    return;
  }

  const s = getSeasonInfo(seasonHash);
  const start = s.startDate ? new Date(s.startDate).toLocaleDateString() : 'Unknown';
  const end = s.endDate ? new Date(s.endDate).toLocaleDateString() : 'Unknown';

  console.log('[renderGlobalGameStats] Season info resolved to:', s);

  gameStats.innerHTML = `
    <div class="stat-group">
      <div class="stat-label">Season</div>
      <div class="stat-value season-info" style="display: flex; flex-direction: column; align-items: flex-start;">
        <div style="display: flex; align-items: center; gap: 10px;">
          ${s.image ? `<img src="${s.image}" alt="Season Icon" style="height: 24px;">` : ''}
          <span style="font-weight: bold; font-size: 1.05em;">
  Season ${s.number}: ${s.name.replace(/Season:\s*/i, '')}
</span>

        </div>
        <div style="margin-top: 6px; font-size: 0.8em; color: #888;">
          ${start} - ${end}
        </div>
      </div>
    </div>
    ${weeklyBlock}
    ${debugButton}
  `;

  startWeeklyResetCountdown();
  attachDebugDownload();
}

function attachDebugDownload() {
  const btn = document.getElementById('downloadSeasonDataBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ seasonData, currentSeasonHash }, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'season-debug.json';
    a.click();
    URL.revokeObjectURL(url);
  });
}

// Initial render
renderGlobalGameStats(currentSeasonHash);

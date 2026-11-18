import { searchExactName, searchNameSuggestions, loadPlayerProfile, parseBungieName, formatBungieName } from './bungieApi.js';
import { loadLeaderboards } from './leaderboard.js';
import { queueGuardian } from './indexQueue.js';
import { renderPlayerReport } from './playerReport.js';
import { REPORT_COMPONENTS } from './reportData.js';

const input = document.getElementById('nameInput');
const suggestions = document.getElementById('suggestions');
const results = document.getElementById('results');
const searchBtn = document.getElementById('searchBtn');
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
        const loaded = await loadPlayerProfile(user, signal, undefined, REPORT_COMPONENTS);
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

function renderProfile(user, loaded, version) {
  const { membershipId, membershipType } = loaded.membership;
  const saveStatus = renderPlayerReport(results, {
    user, loaded, bungieName: formatBungieName(user), signal: activeController.signal
  });
  const url = new URL(window.location.href);
  url.searchParams.set('name', formatBungieName(user));
  history.replaceState(null, '', url);
  document.title = `${formatBungieName(user)} · Guardian Ranker`;
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
    if (version === searchVersion) await loadLeaderboards();
  })();
}
const initialName = new URLSearchParams(window.location.search).get('name');
if (initialName) {
  input.value = initialName;
  handleSearch(initialName, false);
}

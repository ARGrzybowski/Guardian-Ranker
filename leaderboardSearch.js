const tables = [
  ['account-rating-body', 'toggleAccountRatingBtn'],
  ['eververse-board-body'],
  ['leaderboard-body', 'toggleLeaderboardBtn'],
  ['commendation-body', 'toggleCommendationsBtn'],
  ['guardian-rank-body', 'toggleGuardianRankBtn'],
  ['highest-character-body', 'toggleHighestCharacterBtn'],
  ['time-played-body', 'toggleTimePlayedBtn']
];
let lastSearchedPlayer = null;

function highlightMatches(expand = false) {
  let firstMatch;
  for (const [tableId, buttonId] of tables) {
    const tbody = document.getElementById(tableId);
    const rows = Array.from(tbody?.querySelectorAll('tr') || []);
    let found = false;
    for (const row of rows) {
      const matches = Boolean(lastSearchedPlayer && row.cells[1]?.textContent.trim().toLowerCase() === lastSearchedPlayer.toLowerCase());
      row.classList.toggle('highlight', matches);
      if (matches) { found = true; firstMatch ??= row; }
    }
    const button = buttonId && document.getElementById(buttonId);
    if (expand && !found && button?.getAttribute('aria-expanded') === 'false') button.click();
  }
  return firstMatch;
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('leaderboardSearch');
  const search = () => {
    lastSearchedPlayer = input.value.trim();
    highlightMatches(true);
    const match = highlightMatches();
    if (match) match.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else if (lastSearchedPlayer) alert(`${lastSearchedPlayer} not found in the loaded leaderboards.`);
  };
  document.getElementById('leaderboardSearchBtn')?.addEventListener('click', search);
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); search(); }
  });
});
// Also reapply highlights when asynchronous loads or Show More replace the rows.
document.addEventListener('leaderboards:rendered', () => highlightMatches());

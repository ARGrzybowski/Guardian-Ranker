// leaderboardSearch.js

let lastSearchedPlayer = null;

function highlightAndScroll(tableId, playerName, toggleBtnId) {
  const tbody = document.getElementById(tableId);
  const rows = tbody?.getElementsByTagName("tr") || [];
  let found = false;

  for (let row of rows) {
    const nameCell = row.cells[1]; // Bungie Name is always the 2nd column
    if (nameCell && nameCell.textContent.trim().toLowerCase() === playerName.toLowerCase()) {
      // Reset highlights in this table
      Array.from(rows).forEach(r => r.classList.remove("highlight"));

      // Highlight the row
      row.classList.add("highlight");

      // Scroll to it
      if (!found) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      found = true;
    }
  }

  // If not found, expand and search again
  if (!found && toggleBtnId) {
    const toggleBtn = document.getElementById(toggleBtnId);
    if (toggleBtn && toggleBtn.textContent.includes("Show More")) {
      toggleBtn.click(); // expand the table
      setTimeout(() => highlightAndScroll(tableId, playerName, null), 300);
      // retry once after expanding
    }
  }

  return found;
}

document.addEventListener("DOMContentLoaded", () => {
  const searchBtn = document.getElementById("leaderboardSearchBtn");
  const input = document.getElementById("leaderboardSearch");

  if (searchBtn && input) {
    searchBtn.addEventListener("click", () => {
      const playerName = input.value.trim();
      if (!playerName) return;

      lastSearchedPlayer = playerName;

      // Try all leaderboards
      const found1 = highlightAndScroll("leaderboard-body", playerName, "toggleLeaderboardBtn");
      const found2 = highlightAndScroll("guardian-rank-body", playerName, "toggleGuardianRankBtn");
      const found3 = highlightAndScroll("highest-character-body", playerName, "toggleHighestCharacterBtn");
      const found4 = highlightAndScroll("time-played-body", playerName, "toggleTimePlayedBtn");

      // If none found at all
      setTimeout(() => {
        if (!document.querySelector(".highlight")) {
          alert(`${playerName} not found in any leaderboard.`);
        }
      }, 400);
    });
  }

  // Re-highlight after clicking any Show More / Show Less
  ["toggleLeaderboardBtn", "toggleGuardianRankBtn", "toggleHighestCharacterBtn", "toggleTimePlayedBtn"].forEach(btnId => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener("click", () => {
        if (lastSearchedPlayer) {
          setTimeout(() => {
            highlightAndScroll("leaderboard-body", lastSearchedPlayer);
            highlightAndScroll("guardian-rank-body", lastSearchedPlayer);
            highlightAndScroll("highest-character-body", lastSearchedPlayer);
            highlightAndScroll("time-played-body", lastSearchedPlayer);
          }, 300);
        }
      });
    }
  });
});

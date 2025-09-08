// leaderboard.js

// Supabase client setup
const SUPABASE_URL = 'https://vmwdspxtlryiypqacmmx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtd2RzcHh0bHJ5aXlwcWFjbW14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5NDE0ODIsImV4cCI6MjA3MDUxNzQ4Mn0.6iGGFoRCTtvV-EI7ZRER_EmjQfDnY2EY3OujcsS3soE';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

export async function upsertPlayer(player) {
  try {
    const { data, error } = await supabaseClient
      .from('leaderboard')
      .upsert(
        {
          bungie_name: player.bungie_name,
          membership_id: player.membership_id,
          time_played_hours: player.time_played_hours,
          triumph_score: player.triumph_score,
          guardian_rank: player.guardian_rank,
          highest_guardian_rank: player.highest_guardian_rank,
          last_updated: new Date().toISOString()
        },
        { onConflict: ['membership_id'], returning: 'representation' } // <-- important
      );

    if (error) throw error;
    console.log('[Leaderboard] Upserted player:', player.bungie_name, data);
    return data[0]; // return updated row
  } catch (err) {
    console.error('[Leaderboard] Upsert error:', err);
    return null;
  }
}

async function addOrUpdatePlayer(player) {
  const updatedRow = await upsertPlayer(player);
  if (!updatedRow) return;

  // Update Triumph Score Leaderboard
  fullLeaderboard = fullLeaderboard.filter(p => p.membership_id !== updatedRow.membership_id);
  fullLeaderboard.push(updatedRow);
  fullLeaderboard.sort((a, b) => b.triumph_score - a.triumph_score);
  renderLeaderboard(showingAll);

  // Update Guardian Rank Leaderboard
  fullGuardianRankBoard = fullGuardianRankBoard.filter(p => p.membership_id !== updatedRow.membership_id);
  fullGuardianRankBoard.push(updatedRow);
  fullGuardianRankBoard.sort((a, b) => b.guardian_rank - a.guardian_rank);
  renderGuardianRankLeaderboard(showingAllGuardianRanks);
}

// ------------------------------
// Triumph Score Leaderboard
// ------------------------------
let fullLeaderboard = [];
let showingAll = false;

export async function loadLeaderboard() {
  try {
    const { data, error } = await supabaseClient
      .from('leaderboard')
      .select('bungie_name, time_played_hours, triumph_score')
      .order('triumph_score', { ascending: false });

    if (error) throw error;

    fullLeaderboard = data;
    renderLeaderboard(false);
  } catch (err) {
    console.error('[Leaderboard] Load error:', err);
  }
}

function renderLeaderboard(showAll) {
  const tbody = document.getElementById('leaderboard-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  const rowsToShow = showAll ? fullLeaderboard : fullLeaderboard.slice(0, 5);
  rowsToShow.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td><a href="index.html?name=${encodeURIComponent(row.bungie_name)}" style="color: inherit; text-decoration: none;">${row.bungie_name}</a></td>
      <td>${row.triumph_score}</td>
    `;
    tbody.appendChild(tr);
  });
  const btn = document.getElementById('toggleLeaderboardBtn');
  if (btn) btn.textContent = showAll ? 'Show Less' : 'Show More';
}

// ------------------------------
// Guardian Rank Leaderboard
// ------------------------------
let fullGuardianRankBoard = [];
let showingAllGuardianRanks = false;

export async function loadGuardianRankLeaderboard() {
  try {
    const { data, error } = await supabaseClient
      .from('leaderboard')
      .select('bungie_name, guardian_rank')
      .order('guardian_rank', { ascending: false });

    if (error) throw error;

    fullGuardianRankBoard = data;
    renderGuardianRankLeaderboard(false);
  } catch (err) {
    console.error('[GuardianRank] Load error:', err);
  }
}

function renderGuardianRankLeaderboard(showAll) {
  const tbody = document.getElementById('guardian-rank-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  const rowsToShow = showAll ? fullGuardianRankBoard : fullGuardianRankBoard.slice(0, 5);
  rowsToShow.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td><a href="index.html?name=${encodeURIComponent(row.bungie_name)}" style="color: inherit; text-decoration: none;">${row.bungie_name}</a></td>
      <td>${row.guardian_rank}</td>
    `;
    tbody.appendChild(tr);
  });
  const btn = document.getElementById('toggleGuardianRankBtn');
  if (btn) btn.textContent = showAll ? 'Show Less' : 'Show More';
}

// ------------------------------
// Power Level Leaderboard
// ------------------------------
let fullPowerBoard = [];
let showingAllPower = false;

export async function loadPowerLeaderboard() {
  try {
    const { data, error } = await supabaseClient
      .from('highest_character')
      .select('bungie_name, character_class, character_light')
      .order('character_light', { ascending: false });

    if (error) throw error;

    fullPowerBoard = data;
    renderPowerLeaderboard(false);
  } catch (err) {
    console.error('[PowerLeaderboard] Load error:', err);
  }
}

function renderPowerLeaderboard(showAll) {
  const tbody = document.getElementById('highest-character-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  const rowsToShow = showAll ? fullPowerBoard : fullPowerBoard.slice(0, 5);
  rowsToShow.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td><a href="index.html?name=${encodeURIComponent(row.bungie_name)}" style="color: inherit; text-decoration: none;">${row.bungie_name}</a></td>
      <td>${row.character_class}</td>
      <td>${row.character_light}</td>
    `;
    tbody.appendChild(tr);
  });
  const btn = document.getElementById('toggleHighestCharacterBtn');
  if (btn) btn.textContent = showAll ? 'Show Less' : 'Show More';
}

// ------------------------------
// Time Played Leaderboard
// ------------------------------
let fullTimePlayedBoard = [];
let showingAllTimePlayed = false;

export async function loadTimePlayedLeaderboard() {
  try {
    const { data, error } = await supabaseClient
      .from('leaderboard')
      .select('bungie_name, time_played_hours')
      .order('time_played_hours', { ascending: false });

    if (error) throw error;

    fullTimePlayedBoard = data;
    renderTimePlayedLeaderboard(false);
  } catch (err) {
    console.error('[TimePlayedLeaderboard] Load error:', err);
  }
}

function renderTimePlayedLeaderboard(showAll) {
  const tbody = document.getElementById('time-played-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  const rowsToShow = showAll ? fullTimePlayedBoard : fullTimePlayedBoard.slice(0, 5);
  rowsToShow.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td><a href="index.html?name=${encodeURIComponent(row.bungie_name)}" style="color: inherit; text-decoration: none;">${row.bungie_name}</a></td>
      <td>${row.time_played_hours}</td>
    `;
    tbody.appendChild(tr);
  });
  const btn = document.getElementById('toggleTimePlayedBtn');
  if (btn) btn.textContent = showAll ? 'Show Less' : 'Show More';
}

// ------------------------------
// Setup on page load
// ------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Triumph score leaderboard
  loadLeaderboard();
  const btn1 = document.getElementById('toggleLeaderboardBtn');
  if (btn1) {
    btn1.addEventListener('click', () => {
      showingAll = !showingAll;
      renderLeaderboard(showingAll);
    });
  }

  // Guardian rank leaderboard
  loadGuardianRankLeaderboard();
  const btn2 = document.getElementById('toggleGuardianRankBtn');
  if (btn2) {
    btn2.addEventListener('click', () => {
      showingAllGuardianRanks = !showingAllGuardianRanks;
      renderGuardianRankLeaderboard(showingAllGuardianRanks);
    });
  }

  // Power leaderboard
  loadPowerLeaderboard();
  const btnPower = document.getElementById('toggleHighestCharacterBtn');
  if (btnPower) {
    btnPower.addEventListener('click', () => {
      showingAllPower = !showingAllPower;
      renderPowerLeaderboard(showingAllPower);
    });
  }

  // Time played leaderboard
  loadTimePlayedLeaderboard();
  const btnTime = document.getElementById('toggleTimePlayedBtn');
  if (btnTime) {
    btnTime.addEventListener('click', () => {
      showingAllTimePlayed = !showingAllTimePlayed;
      renderTimePlayedLeaderboard(showingAllTimePlayed);
    });
  }
});

export { fullLeaderboard, fullGuardianRankBoard };
export { addOrUpdatePlayer };

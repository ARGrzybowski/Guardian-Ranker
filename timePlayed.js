// timePlayed.js

const SUPABASE_URL = 'https://vmwdspxtlryiypqacmmx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtd2RzcHh0bHJ5aXlwcWFjbW14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5NDE0ODIsImV4cCI6MjA3MDUxNzQ4Mn0.6iGGFoRCTtvV-EI7ZRER_EmjQfDnY2EY3OujcsS3soE';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let fullTimePlayed = [];
let showingAllTimePlayed = false;

// Load table
export async function loadTimePlayed() {
  try {
    const { data, error } = await supabaseClient
      .from('leaderboard')
      .select('bungie_name, time_played_hours')
      .order('time_played_hours', { ascending: false });

    if (error) throw error;
    fullTimePlayed = data || [];
    renderTimePlayed(showingAllTimePlayed);
  } catch (e) {
    console.error('[TimePlayed] Load error:', e);
  }
}

function formatPlaytime(hoursTotal) {
  const days = Math.floor(hoursTotal / 24);
  const hours = Math.floor(hoursTotal % 24);

  if (days > 0) {
    return `${days}<span class="time-unit">Days</span> ${hours}<span class="time-unit">Hours</span>`;
  }
  return `${hours}<span class="time-unit">Hours</span>`;
}

function renderTimePlayed(showAll) {
  const tbody = document.getElementById('time-played-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  const rows = showAll ? fullTimePlayed : fullTimePlayed.slice(0, 5);

  rows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    const formatted = formatPlaytime(row.time_played_hours);

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><a href="index.html?name=${encodeURIComponent(row.bungie_name)}" style="color: inherit; text-decoration: none;">${row.bungie_name}</a></td>
      <td>${formatted}</td>
    `;
    tbody.appendChild(tr);
  });

  const btn = document.getElementById('toggleTimePlayedBtn');
  if (btn) btn.textContent = showAll ? 'Show Less' : 'Show More';
}

document.addEventListener('DOMContentLoaded', () => {
  loadTimePlayed();
  const btn = document.getElementById('toggleTimePlayedBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      showingAllTimePlayed = !showingAllTimePlayed;
      renderTimePlayed(showingAllTimePlayed);
    });
  }
});

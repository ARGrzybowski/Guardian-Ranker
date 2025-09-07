// highestCharacter.js

// ------------------------------
// Supabase client setup
// ------------------------------
const SUPABASE_URL = 'https://vmwdspxtlryiypqacmmx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtd2RzcHh0bHJ5aXlwcWFjbW14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5NDE0ODIsImV4cCI6MjA3MDUxNzQ4Mn0.6iGGFoRCTtvV-EI7ZRER_EmjQfDnY2EY3OujcsS3soE'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ------------------------------
// Highest Character Leaderboard
// ------------------------------
let fullHighestCharacterBoard = [];
let showingAllHighestChars = false;

// Insert or update a player’s highest-level character info
export async function upsertHighestCharacter(player) {
  try {
    const { data, error } = await supabaseClient
      .from('highest_character')
      .upsert(
        {
          bungie_name: player.bungie_name,
          membership_id: player.membership_id,
          character_id: player.character_id,
          class_type: player.character_class,
          light_level: player.character_light,
          emblem_path: player.emblem_path,
          last_played: player.last_played,
          updated_at: new Date().toISOString()
        },
        { onConflict: ['membership_id'], returning: 'representation' }
      );

    if (error) throw error;

    if (data && data.length > 0) {
      console.log('[HighestCharacter] Upserted:', player.membership_id, data[0]);
      return data[0];
    } else {
      console.log('[HighestCharacter] Upserted (no data returned):', player.membership_id);
      return player; // fallback
    }
  } catch (err) {
    console.error('[HighestCharacter] Upsert error:', err);
    return null;
  }
}


export async function loadHighestCharacterLeaderboard() {
  try {
    const { data, error } = await supabaseClient
      .from('highest_character')
      .select('membership_id, bungie_name, class_type, light_level') // Added bungie_name
      .order('light_level', { ascending: false });

    if (error) throw error;

    fullHighestCharacterBoard = data;
    renderHighestCharacterLeaderboard(false);
  } catch (err) {
    console.error('[HighestCharacter] Load error:', err);
  }
}

function renderHighestCharacterLeaderboard(showAll) {
  const tbody = document.getElementById('highest-character-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  const rowsToShow = showAll
    ? fullHighestCharacterBoard
    : fullHighestCharacterBoard.slice(0, 5);

  rowsToShow.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td><a href="index.html?name=${encodeURIComponent(row.bungie_name)}" style="color: inherit; text-decoration: none;">${row.bungie_name}</a></td>
      <td>${row.class_type}</td>
      <td>${row.light_level}</td>
    `;
    tbody.appendChild(tr);
  });

  const btn = document.getElementById('toggleHighestCharacterBtn');
  if (btn) {
    btn.textContent = showAll ? 'Show Less' : 'Show More';
  }
}

// ------------------------------
// Setup on page load
// ------------------------------
document.addEventListener('DOMContentLoaded', () => {
  loadHighestCharacterLeaderboard();

  const btn = document.getElementById('toggleHighestCharacterBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      showingAllHighestChars = !showingAllHighestChars;
      renderHighestCharacterLeaderboard(showingAllHighestChars);
    });
  }
});

export { fullHighestCharacterBoard };

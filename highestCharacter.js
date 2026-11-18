import { getDatabase } from './database.js';
export { loadPowerLeaderboard as loadHighestCharacterLeaderboard } from './leaderboard.js';

export async function upsertHighestCharacter(player) {
  const row = {
    bungie_name: player.bungie_name, membership_id: player.membership_id,
    character_id: player.character_id, class_type: player.character_class,
    light_level: player.character_light, emblem_path: player.emblem_path,
    last_played: player.last_played, updated_at: new Date().toISOString()
  };
  const { error } = await getDatabase().from('highest_character').upsert(row, { onConflict: 'membership_id' });
  if (error) throw error;
  return row;
}

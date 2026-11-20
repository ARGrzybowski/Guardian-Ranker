import { getDatabase } from './database.js';
import { PERFORMANCE_VERSION } from './performanceRating.js';

export function formatPlaytime(value) {
  if (value == null) return 'Unavailable';
  const hours = Math.floor(Number(value));
  const days = Math.floor(hours / 24);
  return days ? `${days}d ${hours % 24}h` : `${hours}h`;
}

const boards = {
  rating: { source: 'guardian_activity_rankings', score: 'points', fields: ['points', 'percentile'], body: 'account-rating-body', button: 'toggleAccountRatingBtn' },
  eververse: { source: 'guardian_eververse_rankings', score: 'eververse_bright_dust', fields: ['eververse_bright_dust'], body: 'eververse-board-body' },
  triumph: { source: 'guardian_knowledge_rankings', score: 'triumph_score', fields: ['triumph_score', 'percentile'], body: 'leaderboard-body', button: 'toggleLeaderboardBtn' },
  commendations: { source: 'guardian_commendation_rankings', score: 'commendations', fields: ['commendations', 'percentile'], body: 'commendation-body', button: 'toggleCommendationsBtn' },
  guardian: { table: 'leaderboard', score: 'guardian_rank', fields: ['guardian_rank'], body: 'guardian-rank-body', button: 'toggleGuardianRankBtn' },
  power: { table: 'highest_character', score: 'light_level', fields: ['class_type', 'light_level'], body: 'highest-character-body', button: 'toggleHighestCharacterBtn' },
  time: { table: 'leaderboard', score: 'time_played_hours', fields: ['time_played_hours'], body: 'time-played-body', button: 'toggleTimePlayedBtn' }
};
for (const board of Object.values(boards)) Object.assign(board, { rows: [], showAll: false, version: 0 });

function renderBoard(board, errorMessage) {
  const tbody = document.getElementById(board.body);
  if (!tbody) return;
  tbody.replaceChildren();
  const rows = board.showAll ? board.rows : board.rows.slice(0, 5);
  let tiedStanding = 1;
  for (const [index, row] of rows.entries()) {
    const tr = document.createElement('tr');
    if (row.last_refreshed_at) tr.title = `Refreshed ${new Date(row.last_refreshed_at).toLocaleString()}`;
    const rank = document.createElement('td');
    if (index && row[board.score] !== rows[index - 1][board.score]) tiedStanding = index + 1;
    rank.textContent = row.standing ?? (board === boards.eververse ? tiedStanding : index + 1);
    tr.appendChild(rank);
    const nameCell = document.createElement('td');
    const link = document.createElement('a');
    link.href = `index.html?name=${encodeURIComponent(row.bungie_name)}${board === boards.eververse ? '#eververse' : board.source ? '#rating' : ''}`;
    link.textContent = row.bungie_name;
    link.style.color = 'inherit';
    link.style.textDecoration = 'none';
    nameCell.appendChild(link);
    tr.appendChild(nameCell);
    for (const field of board.fields) {
      const td = document.createElement('td');
      const value = row[field];
      if (field === 'time_played_hours') td.textContent = formatPlaytime(value);
      else if (board.source) td.textContent = value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
      else td.textContent = value ?? 'Unavailable';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = board.fields.length + 2;
    td.textContent = errorMessage || (board.source ? 'Waiting for eligible cloud results.' : 'No players saved yet.');
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  const button = board.button && document.getElementById(board.button);
  if (button) {
    button.textContent = board.showAll ? 'Show Less' : 'Show More';
    button.setAttribute('aria-expanded', String(board.showAll));
  }
  const ratingStatus = board === boards.rating && document.getElementById('rating-index-status');
  if (ratingStatus) {
    const count = Number(board.rows[0]?.cohort_size ?? board.rows.length);
    const version = board.rows[0]?.rating_version ?? PERFORMANCE_VERSION;
    const state = version !== PERFORMANCE_VERSION ? 'The revised model is collecting 30 eligible scores.' : count < 30 ? 'Percentiles open when 30 qualify.' : 'Percentiles reflect this tracked group.';
    ratingStatus.textContent = errorMessage || `${count.toLocaleString()} eligible Guardians with verified ${version} points. ${state}`;
  }
  document.dispatchEvent(new Event('leaderboards:rendered'));
}

async function loadBoard(board) {
  const tbody = document.getElementById(board.body);
  if (!tbody) return;
  const version = ++board.version;
  try {
    const rows = [];
    let table = board.source || 'guardian_rankings';
    // Supabase caps a single response. Read all pages in a stable order.
    const preview = board === boards.eververse || Boolean(tbody.closest('.home-leaderboards'));
    const pageSize = preview ? 5 : 1000;
    const standings = board.source && board !== boards.eververse;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await getDatabase().from(table)
        .select(['membership_id', 'bungie_name', ...board.fields, ...(standings ? ['standing', 'cohort_size'] : []), ...(board === boards.rating ? ['rating_version'] : []), ...(table.startsWith('guardian_') ? ['last_refreshed_at'] : [])].join(','))
        .order(board.score, { ascending: false, nullsFirst: false })
        .order('membership_id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (version !== board.version) return;
      // Roll out the frontend safely before the SQL migration is installed.
      if (table === 'guardian_rankings' && ['PGRST205', '42P01'].includes(error?.code)) {
        table = board.table;
        rows.length = 0;
        offset = -pageSize;
        continue;
      }
      if (error) throw error;
      rows.push(...(data || []));
      if (preview || !data || data.length < pageSize) break;
    }
    board.rows = rows;
    renderBoard(board);
  } catch (error) {
    if (version !== board.version) return;
    console.error('[Leaderboard] Load error:', error);
    renderBoard(board, 'Leaderboard unavailable. Please try again later.');
  }
}

export const loadLeaderboard = () => loadBoard(boards.triumph);
export const loadAccountRatingLeaderboard = () => loadBoard(boards.rating);
export const loadGuardianRankLeaderboard = () => loadBoard(boards.guardian);
export const loadPowerLeaderboard = () => loadBoard(boards.power);
export const loadTimePlayedLeaderboard = () => loadBoard(boards.time);
export async function loadIndexStatus() {
  const element = document.getElementById('index-status');
  if (!element) return;
  try {
    const { data, error } = await getDatabase().from('guardian_index_status').select('*').single();
    if (error) {
      element.textContent = ['PGRST205', '42P01'].includes(error.code)
        ? 'Automatic indexing is not enabled yet. Showing previously searched players.'
        : 'Leaderboard coverage is temporarily unavailable.';
      return;
    }
    const count = Number(data.indexed_count);
    const queued = Math.max(0, Number(data.tracked_count) - count);
    const updated = data.last_refreshed_at ? ` Latest profile refresh: ${new Date(data.last_refreshed_at).toLocaleString()}.` : ' Waiting for the first cloud refresh.';
    const freshness = data.fresh_24h_count == null ? '' : ` ${Number(data.fresh_24h_count).toLocaleString()} updated in 24 hours; ${Number(data.due_count).toLocaleString()} due for refresh.`;
    element.textContent = `${count.toLocaleString()} indexed Guardians; ${queued.toLocaleString()} waiting for a public profile.${freshness} Rankings cover tracked accounts.${updated}`;
  } catch {
    element.textContent = 'Leaderboard coverage is temporarily unavailable.';
  }
}
export const loadLeaderboards = () => Promise.all([loadIndexStatus(), ...Object.values(boards).map(loadBoard)]);

document.addEventListener('DOMContentLoaded', () => {
  for (const board of Object.values(boards)) {
    if (!board.button) continue;
    document.getElementById(board.button)?.addEventListener('click', () => {
      board.showAll = !board.showAll;
      renderBoard(board);
    });
  }
  void loadLeaderboards();
});

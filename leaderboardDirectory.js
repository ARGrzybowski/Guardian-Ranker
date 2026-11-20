import { getDatabase } from './database.js';

const PAGE_SIZE = 25;
const labels = {
  points: 'Points', clears: 'Clears', activities: 'Activities', events: 'Contest clears', dungeons: 'Dungeons',
  passages: 'Passages', kd: 'K/D', kills: 'Kills', rank: 'Guardian Rank', power: 'Power',
  proof: 'Achievement', solo: 'Best solo tier', bright_dust: 'Bright Dust'
};
const number = (value, digits = 0) => Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });

function scoreText(unit, score) {
  if (unit === 'proof') return 'Verified clear';
  if (unit === 'solo') return Number(score) === 2 ? 'Solo flawless' : 'Solo';
  return number(score, unit === 'points' || unit === 'kd' ? 2 : 0);
}

function node(tag, text = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function option(value, label) {
  const element = node('option', label);
  element.value = value;
  return element;
}

function guardianLink(name, board) {
  const link = node('a', name);
  const section = board.unit === 'bright_dust' ? '#eververse' : board.category === 'Profiles' ? '#overview' : '#rating';
  link.href = 'index.html?' + new URLSearchParams({ name }) + section;
  return link;
}

async function loadCatalog(db) {
  const boards = [];
  const batch = 250;
  for (let offset = 0; ; offset += batch) {
    const { data, error } = await db.from('guardian_specialty_catalog')
      .select('board_id,category,title,unit,description')
      .order('category').order('title').order('board_id')
      .range(offset, offset + batch - 1);
    if (error) throw error;
    boards.push(...(data || []));
    if ((data?.length ?? 0) < batch) return boards;
  }
}

async function mountDirectory(root) {
  const element = id => root.querySelector('#' + id);
  const controls = root.querySelector('.board-directory-controls');
  const results = root.querySelector('.board-directory-results');
  const category = element('board-category'), filter = element('board-filter'), choice = element('board-choice');
  const status = element('board-directory-status'), rows = element('board-rows'), match = element('board-match');
  const pageStatus = element('board-page-status');
  const previous = element('board-previous'), next = element('board-next');
  const retry = element('board-retry');
  const player = element('board-player'), find = root.querySelector('.board-find');
  let current, request, offset = 0, queryName = '';

  try {
    const db = getDatabase();
    const catalog = await loadCatalog(db);
    if (!catalog.length) {
      status.textContent = 'No specialty leaderboards are available yet.';
      return;
    }
    const byId = new Map(catalog.map(board => [board.board_id, board]));
    const requested = new URL(location.href).searchParams.get('board');
    const initial = byId.get(requested) || byId.get('raid.points') || catalog[0];
    for (const group of [...new Set(catalog.map(board => board.category))]) category.append(option(group, group));
    controls.hidden = false;

    function showMatch(found) {
      match.replaceChildren();
      if (!queryName) return;
      if (found) match.append(guardianLink(found.bungie_name, current),
        ` · Rank #${number(found.standing)} · ${scoreText(current.unit, found.score)}`);
      else match.textContent = `${queryName} is outside this board’s recorded results.`;
    }

    async function loadPage() {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const board = current;
      const start = offset;
      previous.disabled = next.disabled = true;
      retry.hidden = true;
      results.setAttribute('aria-busy', 'true');
      pageStatus.textContent = 'Loading standings…';
      match.replaceChildren();
      rows.replaceChildren();
      try {
        const { data, error } = await db.rpc('get_guardian_specialty_board', {
          p_board: board.board_id, p_offset: start, p_limit: PAGE_SIZE, p_guardian: queryName || null
        }).abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error || !data) throw error || new Error('Unknown board');
        const total = Number(data.total);
        if (start >= total && start > 0) {
          offset = total ? Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE : 0;
          return loadPage();
        }
        for (const entry of data.rows) {
          const row = node('tr');
          const name = node('td');
          name.append(guardianLink(entry.bungie_name, board));
          row.append(node('td', number(entry.standing)), name, node('td', scoreText(board.unit, entry.score)));
          rows.append(row);
        }
        pageStatus.textContent = total
          ? `${number(start + 1)}–${number(start + data.rows.length)} of ${number(total)} Guardians`
          : 'No recent verified results for this board.';
        previous.disabled = start === 0;
        next.disabled = start + PAGE_SIZE >= total;
        showMatch(data.match);
      } catch {
        if (!controller.signal.aborted) {
          pageStatus.textContent = 'Standings temporarily unavailable.';
          retry.hidden = false;
        }
      } finally {
        if (request === controller) results.removeAttribute('aria-busy');
      }
    }

    function selectBoard(board, remember = true) {
      current = board;
      offset = 0;
      queryName = '';
      choice.value = board.board_id;
      for (const [id, value] of Object.entries({
        'board-title': board.title, 'board-unit': labels[board.unit] || 'Score', 'board-description': board.description
      })) element(id).textContent = value;
      results.hidden = false;
      if (remember) {
        const url = new URL(location.href);
        url.searchParams.set('board', board.board_id);
        history.replaceState(null, '', url);
      }
      void loadPage();
    }

    function filterBoards(preferred = current, remember = true) {
      const term = filter.value.trim().toLowerCase();
      const visible = catalog.filter(board => (!category.value || board.category === category.value) &&
        (!term || `${board.title} ${board.category}`.toLowerCase().includes(term)));
      choice.replaceChildren(...visible.map(board => option(board.board_id, board.title)));
      status.textContent = visible.length === catalog.length
        ? `${number(catalog.length)} specialty leaderboards`
        : `${number(visible.length)} of ${number(catalog.length)} leaderboards`;
      choice.disabled = visible.length === 0;
      if (!visible.length) {
        request?.abort();
        results.removeAttribute('aria-busy');
        results.hidden = true;
        return;
      }
      const selected = visible.includes(preferred) ? preferred : visible[0];
      if (results.hidden || selected !== current) selectBoard(selected, remember);
      else choice.value = selected.board_id;
    }

    choice.addEventListener('change', () => selectBoard(byId.get(choice.value)));
    category.addEventListener('change', () => filterBoards());
    filter.addEventListener('input', () => filterBoards());
    previous.addEventListener('click', () => { offset = Math.max(0, offset - PAGE_SIZE); void loadPage(); });
    next.addEventListener('click', () => { offset += PAGE_SIZE; void loadPage(); });
    retry.addEventListener('click', () => void loadPage());
    find.addEventListener('submit', event => {
      event.preventDefault();
      queryName = player.value.trim();
      void loadPage();
    });
    filterBoards(initial, false);
  } catch {
    status.textContent = 'The leaderboard directory is temporarily unavailable.';
  }
}

const directory = document.getElementById('discover');
if (directory) void mountDirectory(directory);

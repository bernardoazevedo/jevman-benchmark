import { jointLeaders, type Community, type Leaderboard, type LeaderboardEntry } from '../shared/leaderboard';
import { logoFor, makerOf } from './logos';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

const margin = (e: LeaderboardEntry) => (e.scoreStdError === undefined ? '' : `± ${Math.round(2 * e.scoreStdError).toLocaleString('en-US')}`);

/**
 * The leaderboard table on the main page: rank (=1 for models tied within the margin of error), model and maker, mean
 * score with its margin, then survival, latency, backup moves and cost. Watch plays that model; self-reported
 * submissions follow, marked as such.
 */
export function renderLeaderboard(table: HTMLTableElement, sub: HTMLElement, board: Leaderboard, community: Community | null, onWatch: (model: string) => void, canWatch: (model: string) => boolean): void {
  const tied = new Set(jointLeaders(board.entries).map((e) => e.model));
  const all = [...board.entries, ...(community?.entries ?? [])];
  const top = Math.max(1, ...all.map((e) => e.meanScore));
  const date = new Date(board.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  sub.textContent = `${board.settings.gamesPerModel} games per model against the classic ghosts. Last run ${date}.`;

  const head = el('thead');
  const hr = el('tr');
  for (const [label, cls] of [['#', ''], ['Model', ''], ['Mean score ± 95%', ''], ['Survival', 'r hide-n'], ['Latency', 'r hide-n'], ['Backup moves', 'r hide-n'], ['Cost / game', 'r hide-n'], ['', '']]) {
    hr.append(el('th', label, cls || undefined));
  }
  head.append(hr);

  const row = (e: LeaderboardEntry, rank: string, opts: { tie: boolean; by?: string; self?: boolean }) => {
    const tr = el('tr', undefined, [opts.tie ? 'tie' : '', opts.self ? 'self' : ''].filter(Boolean).join(' ') || undefined);
    const mdl = el('div', undefined, 'mdl');
    const logo = logoFor(e.model);
    if (logo) mdl.append(logo);
    const who = el('div');
    who.append(el('b', e.name), el('small', opts.self ? `Self-reported by ${opts.by}` : (makerOf(e.model) ?? '')), el('span', `${e.meanScore.toLocaleString('en-US')} ${margin(e)}`, 'score-m'));
    mdl.append(who);
    const scw = el('div', undefined, 'scw');
    const bar = el('span', undefined, 'bar');
    const fill = el('i');
    fill.style.width = `${((e.meanScore / top) * 100).toFixed(1)}%`;
    bar.append(fill);
    const n = el('span', `${e.meanScore.toLocaleString('en-US')} `, 'n');
    n.append(el('span', margin(e), 'pm'));
    scw.append(bar, n);
    const cell = (text: string, cls = 'n r hide-n') => el('td', text, cls);
    const act = el('td', undefined, 'act');
    if (canWatch(e.model)) {
      const watch = el('button', 'Watch');
      watch.type = 'button';
      watch.setAttribute('aria-label', `Watch ${e.name} play`);
      watch.addEventListener('click', () => onWatch(e.model));
      act.append(watch);
    }
    const tdModel = el('td');
    tdModel.append(mdl);
    const tdScore = el('td', undefined, 'hide-n');
    tdScore.append(scw);
    tr.append(
      el('td', rank, 'rk'),
      tdModel,
      tdScore,
      cell(`${e.meanSurvivedSeconds.toFixed(1)} s`),
      cell(e.meanLatencyMs === null ? '–' : `${e.meanLatencyMs} ms`),
      cell(`${(e.fallbackRate * 100).toFixed(1)}%`),
      cell(`$${e.costPerGame.toFixed(4)}`),
      act,
    );
    return tr;
  };

  const body = el('tbody');
  board.entries.forEach((e, i) => body.append(row(e, tied.has(e.model) ? '=1' : String(i + 1), { tie: tied.has(e.model) })));
  for (const e of community?.entries ?? []) body.append(row(e, '·', { tie: false, by: e.by, self: true }));
  // The "Mean score" column hides on narrow screens; the score then sits under the model's name.
  head.querySelector('th:nth-child(3)')!.className = 'hide-n';
  table.replaceChildren(head, body);
}

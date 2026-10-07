import type { Leaderboard } from '../shared/leaderboard';
import { modelName } from '../shared/models';
import { logoFor } from './logos';
import type { GameSummary } from './stats';
import { GHOST_IDS, type GhostId } from './types';
import { versus } from './versus';

/** Which model plays each ghost. */
export type Lineup = Record<GhostId, string>;

export const GHOST_NAMES: Record<GhostId, string> = { blinky: 'Blinky', pinky: 'Pinky', inky: 'Inky', clyde: 'Clyde' };
const GHOST_FILL: Record<GhostId, string> = { blinky: '#e53935', pinky: '#f48fb1', inky: '#26c6da', clyde: '#ffa726' };

/** The mixed lineup: a different AI behind each ghost, like the arcade original where every ghost had its own mind. */
const MIXED: Lineup = { blinky: 'opper/clef', pinky: 'typesafe/jev-1.13.0', inky: 'opper/kev-4b', clyde: 'openai/gpt-6-luna-decisions' };
const SOLO = ['typesafe/jev-1.13.0', 'opper/clef', 'opper/kev-4b', 'openai/gpt-6-luna-decisions'];

const allOf = (model: string): Lineup => Object.fromEntries(GHOST_IDS.map((g) => [g, model])) as Lineup;
const sameLineup = (a: Lineup, b: Lineup) => GHOST_IDS.every((g) => a[g] === b[g]);
const short = (model: string) => modelName(model).replace(/ 1\.13$/, '').replace(/ 4B$/, '');

/** The presets the picker offers, limited to the models this key can use. */
export function presets(offered: string[]): { key: string; label: string; lineup: Lineup }[] {
  const has = (m: string) => offered.includes(m);
  const out: { key: string; label: string; lineup: Lineup }[] = [];
  if (GHOST_IDS.every((g) => has(MIXED[g]))) out.push({ key: 'mixed', label: 'Mixed', lineup: MIXED });
  for (const m of SOLO) if (has(m)) out.push({ key: m, label: `All ${short(m)}`, lineup: allOf(m) });
  return out;
}

/** The lineup a new visitor starts with: mixed when every model in it is offered, else everyone on the first model. */
export const defaultLineup = (offered: string[]): Lineup => presets(offered)[0]?.lineup ?? allOf(offered[0]);

/** Tapping a ghost moves it to the next model on the list. */
export const nextModel = (current: string, offered: string[]): string => offered[(offered.indexOf(current) + 1) % offered.length];

/** "Clef, jev, Kev and GPT-6 Luna": the distinct models of a lineup, in ghost order. */
export function lineupNames(lineup: Lineup): string {
  const names = [...new Set(GHOST_IDS.map((g) => short(lineup[g])))];
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

/** A ghost in its arcade colour, for the picker, the game-over card and the activity log. */
export function ghostIcon(id: GhostId): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('aria-hidden', 'true');
  const shape = (tag: string, attrs: Record<string, string>) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.append(e);
  };
  shape('path', { d: 'M1 13.2V6.4a6 6 0 0 1 12 0v6.8l-2-1.6-2 1.6-2-1.6-2 1.6-2-1.6Z', fill: GHOST_FILL[id] });
  for (const [cx, px] of [[4.9, 5.4], [9.3, 9.8]]) {
    shape('circle', { cx: String(cx), cy: '6.2', r: '1.7', fill: '#fff' });
    shape('circle', { cx: String(px), cy: '6.5', r: '0.85', fill: '#1f3fd8' });
  }
  return svg;
}

function show(root: HTMLElement, card: HTMLElement, focus?: HTMLElement): void {
  root.replaceChildren(card);
  root.hidden = false;
  focus?.focus({ preventScroll: true });
}

export function hideOverlay(root: HTMLElement): void {
  root.hidden = true;
  root.replaceChildren();
}

export interface PickerOptions {
  lineup: () => Lineup;
  offered: string[];
  /** Whether a game against AI ghosts can start (the free credits, a sign-in or a local key pay for it). */
  canPlay: boolean;
  /** Who pays, in a line under Start (or why nobody can). */
  costNote: string;
  loginAvailable: boolean;
  onChange: (lineup: Lineup) => void;
  onStart: () => void;
  onClassic: () => void;
  onLogin: () => void;
  onBack: () => void;
}

export interface Picker {
  /** "Waking up …" on Start while the models wake; null restores it. */
  busy: (note: string | null) => void;
  /** A line under Start (e.g. a model that would not wake), or null to clear it. */
  note: (text: string | null) => void;
  /** What Space/Enter does. */
  action: () => void;
}

/** "Who plays the ghosts?": the four ghosts with their models, presets, and Start. */
export function showPicker(root: HTMLElement, o: PickerOptions): Picker {
  const card = el('div', undefined, 'card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Who plays the ghosts?');
  const close = el('button', '×', 'close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', o.onBack);
  card.append(close, el('h3', 'Who plays the ghosts?'));
  const grid = el('div', undefined, 'lineup');
  const chips = el('div', undefined, 'presets');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Lineups');
  const all = presets(o.offered);
  const render = () => {
    const lineup = o.lineup();
    grid.replaceChildren(
      ...GHOST_IDS.map((g) => {
        const b = el('button', undefined, 'gh');
        b.type = 'button';
        b.title = `Switch ${GHOST_NAMES[g]}'s AI model`;
        b.setAttribute('aria-label', `${GHOST_NAMES[g]}: ${modelName(lineup[g])}. Switch model`);
        const label = el('span', undefined, 'gl');
        const logo = logoFor(lineup[g]);
        if (logo) label.append(logo);
        label.append(el('b', short(lineup[g])));
        b.append(ghostIcon(g), el('span', GHOST_NAMES[g], 'gn'), label);
        b.addEventListener('click', () => {
          o.onChange({ ...lineup, [g]: nextModel(lineup[g], o.offered) });
          render();
        });
        return b;
      }),
    );
    chips.replaceChildren(
      ...all.map((p) => {
        const b = el('button', p.label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(sameLineup(p.lineup, lineup)));
        b.addEventListener('click', () => {
          o.onChange({ ...p.lineup });
          render();
        });
        return b;
      }),
    );
  };
  render();
  card.append(grid, chips, el('p', 'Tap a ghost to switch its AI model.', 'hint'));
  const status = el('p', undefined, 'hint');
  status.setAttribute('aria-live', 'polite');
  let start: HTMLButtonElement;
  if (o.canPlay) {
    start = el('button', 'Start game', 'go');
    start.type = 'button';
    start.addEventListener('click', o.onStart);
    const back = el('button', 'Back to watching', 'go line');
    back.type = 'button';
    back.addEventListener('click', o.onBack);
    const row = el('div', undefined, 'btns');
    row.append(back, start);
    card.append(row, el('p', o.costNote, 'hint'));
  } else {
    start = el('button', 'Log in to play', 'go');
    start.type = 'button';
    start.disabled = !o.loginAvailable;
    start.addEventListener('click', o.onLogin);
    const classic = el('button', 'Play the classic ghosts instead (free)', 'go line');
    classic.type = 'button';
    classic.addEventListener('click', o.onClassic);
    card.append(start, el('p', o.costNote, 'hint warn'), classic);
  }
  card.append(status);
  show(root, card, start);
  return {
    busy: (note) => {
      if (!o.canPlay) return;
      start.toggleAttribute('aria-disabled', note !== null);
      start.textContent = note ?? 'Start game';
    },
    note: (text) => {
      status.textContent = text ?? '';
    },
    action: () => start.click(),
  };
}

export interface GameOverOptions {
  summary: GameSummary;
  /** The ghosts' models in a game against AI ghosts; null for the classic ghosts. */
  lineup: Lineup | null;
  board: Leaderboard | null;
  newBest?: boolean;
  onPlayAgain: () => void;
  onShare: () => Promise<'shared' | 'copied' | 'failed' | 'cancelled'>;
  onReview: (() => void) | null;
  onBack: () => void;
}

/** The game-over card: the score, then who caught you (AI ghosts) or where you'd rank (classic ghosts). */
export function showGameOver(root: HTMLElement, o: GameOverOptions): void {
  const s = o.summary;
  const card = el('div', undefined, 'card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Game over');
  card.append(el('span', o.newBest ? 'Game over · new personal best' : 'Game over', 'eyebrow'), el('span', s.score.toLocaleString('en-US'), 'big-score'));
  if (o.lineup) {
    card.append(el('p', `You lasted ${clock(s.seconds)} against ${lineupNames(o.lineup)}.`, 'hint'));
    const by = new Map<GhostId, number>();
    for (const d of s.deaths) if (d.ghost) by.set(d.ghost, (by.get(d.ghost) ?? 0) + 1);
    if (by.size) {
      const list = el('ul', undefined, 'caught');
      for (const [g, n] of [...by].sort((a, b) => b[1] - a[1])) {
        const li = el('li');
        li.append(ghostIcon(g), el('span', `${GHOST_NAMES[g]} (${short(o.lineup[g])}) caught you`), el('span', `×${n}`, 'x'));
        list.append(li);
      }
      card.append(list);
    }
  } else if (o.board?.entries.length) {
    // The classic ghosts are the benchmark's own game: place the score among the models.
    const v = versus(o.board, s.score);
    card.append(el('p', v.beaten.length ? `You beat ${v.beaten.length} of ${v.total} AIs.` : 'No AI beaten yet. Try again!', 'hint'));
    const rows = [...o.board.entries.map((e) => ({ name: e.name, model: e.model, score: e.meanScore })), { name: 'You', model: '', score: s.score }].sort((a, b) => b.score - a.score);
    const list = el('ol', undefined, 'ladder');
    rows.forEach((r, i) => {
      const li = el('li', undefined, r.model ? (r.score < s.score ? 'beat' : '') : 'you');
      const nm = el('span', undefined, 'nm');
      const logo = r.model ? logoFor(r.model) : null;
      if (logo) nm.append(logo);
      else if (!r.model) nm.append(el('span', undefined, 'pac'));
      nm.append(r.name);
      li.append(el('span', String(i + 1), 'r'), nm, el('span', r.score.toLocaleString('en-US'), 's'));
      list.append(li);
    });
    card.append(list);
  }
  const btns = el('div', undefined, 'btns');
  const again = el('button', 'Play again', 'go');
  again.type = 'button';
  again.addEventListener('click', o.onPlayAgain);
  const share = el('button', 'Share', 'go line');
  share.type = 'button';
  share.addEventListener('click', () => {
    void o.onShare().then((r) => {
      if (r !== 'cancelled') share.textContent = r === 'copied' ? 'Copied!' : r === 'shared' ? 'Shared!' : 'Could not share';
    });
  });
  btns.append(again, share);
  card.append(btns);
  if (o.onReview) {
    const review = el('button', 'Review their moves ↓', 'linkbtn');
    review.type = 'button';
    review.addEventListener('click', o.onReview);
    card.append(review);
  }
  const back = el('button', 'Back to watching', 'linkbtn');
  back.type = 'button';
  back.addEventListener('click', o.onBack);
  card.append(back);
  show(root, card, again);
}

/** The end of a game you watched: the AI's score next to its benchmark average. */
export function showWatchOver(root: HTMLElement, o: { model: string; score: number; average: number | null; onAgain: () => void; onPlay: () => void }): void {
  const card = el('div', undefined, 'card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Game over');
  card.append(el('span', 'Game over', 'eyebrow'), el('span', o.score.toLocaleString('en-US'), 'big-score'));
  card.append(el('p', o.average === null ? `${modelName(o.model)} scored ${o.score.toLocaleString('en-US')}.` : `${modelName(o.model)} scored ${o.score.toLocaleString('en-US')}. Its benchmark average is ${o.average.toLocaleString('en-US')}.`, 'hint'));
  const btns = el('div', undefined, 'btns');
  const again = el('button', 'Watch again', 'go line');
  again.type = 'button';
  again.addEventListener('click', o.onAgain);
  const play = el('button', '▶ Play against the AIs', 'go');
  play.type = 'button';
  play.addEventListener('click', o.onPlay);
  btns.append(again, play);
  card.append(btns);
  show(root, card, play);
}

/** What Share posts after a game against AI ghosts. */
export function aiShareText(s: GameSummary, lineup: Lineup, url: string): string {
  return `I lasted ${clock(s.seconds)} and scored ${s.score.toLocaleString('en-US')} at Pac-Man against ${lineupNames(lineup)} playing the ghosts 🟡\nCan you beat the AIs? ${url}`;
}

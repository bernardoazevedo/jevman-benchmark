import './opper-chrome.css';
import './style.css';
import { ActivityLog, type Subject } from './activity';
import { accountNotice, fetchMe, POOL_EMPTY_NOTICE, poolAmount, renderAccount, renderDrawerAccount, signIn, takeAuthError, updatePoolAmount, walletNotice, type AccountView } from './auth';
import { initialChoice, modelOptions, requestModel, type ModelChoice } from './choice';
import { DemoPlayer, loadRecording } from './demo';
import { greedyChoice, optionFeatures } from './features';
import { logoFor } from './logos';
import { aiShareText, defaultLineup, GHOST_NAMES, hideOverlay, lineupNames, showGameOver, showPicker, showWatchOver, type Lineup, type Picker } from './overlay';
import { appPath, SHARE_URL } from './paths';
import { drawGame, FRUIT_EMOJI, TILE } from './render';
import { renderLeaderboard } from './results';
import { Scheduler } from './scheduler';
import { createGame, fruitForLevel, jevActors, step, type Controls, type GameState } from './sim';
import { GameStats } from './stats';
import { Thinking } from './thinking';
import { attachTouch } from './touch';
import { createHttpTransport, warmUp, type TransportHooks } from './transport';
import { GHOST_IDS, type Dir } from './types';
import { shareText, versus } from './versus';
import { ModelWarming } from './warming';
import type { Community, Leaderboard } from '../shared/leaderboard';
import { DEFAULT_MODEL, modelName } from '../shared/models';

const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
};
/** Chip order under the board: jev first (its recorded benchmark game plays when the page opens), then by rank. */
const WATCH_ORDER = ['typesafe/jev-1.13.0', 'opper/clef', 'opper/clef-flash', 'openai/gpt-6-luna-decisions', 'opper/kev-4b', 'berget/convaiinnovations/laya'];
const LINEUP_KEY = 'jevman.ghosts';
const BEST_KEY = 'jevman.best';
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// The recorded benchmark game downloads alongside /api/me; it plays when the page opens, for everyone.
const recording = loadRecording(appPath('/demo/jev-demo.json'));
const me = await fetchMe();
const authError = takeAuthError();
const rec = await recording;

const canvas = $<HTMLCanvasElement>('#game');
let state: GameState = createGame();
canvas.width = state.maze.width * TILE;
canvas.height = state.maze.height * TILE;
const ctx = canvas.getContext('2d')!;
const boardEl = $('.board');
const overlayEl = $('#overlay');
const playCta = $<HTMLButtonElement>('#play-cta');
const plateLabel = $('#plate-label');
const scoreEl = $('#score');
const levelEl = $('#level');
const livesEl = $('#lives');
const fruitEl = $('#fruit');
const pausedEl = $('#paused');
const noticeEl = $('#notice');
const dpad = $('#dpad');
const chipsEl = $('#watch-chips');
const thinking = new Thinking();
const LOG_KEY = 'jevman.log';
const tvEl = $('#tv');
const logToggle = $<HTMLButtonElement>('#log-toggle');
/** The activity log opens beside the board (below it on a phone); the choice is remembered. */
const log = new ActivityLog($('#activity'), {
  onOpenChange: (open) => {
    tvEl.classList.toggle('log-open', open);
    logToggle.setAttribute('aria-expanded', String(open));
    logToggle.setAttribute('aria-label', open ? 'Hide the activity log' : 'Show the activity log');
    try {
      localStorage.setItem(LOG_KEY, open ? '1' : '0');
    } catch {
      // not remembered
    }
  },
});
logToggle.addEventListener('click', () => log.setOpen(!log.isOpen));
try {
  if (localStorage.getItem(LOG_KEY) === '1') log.setOpen(true);
} catch {
  // folded, as for everyone new
}

// The phone menu: opper.ai's sheet from the bottom.
const drawer = $('#oc-drawer');
const menuButton = document.getElementById('oc-menu-button');
const setDrawer = (open: boolean) => {
  drawer.hidden = !open;
  menuButton?.setAttribute('aria-expanded', String(open));
};
menuButton?.addEventListener('click', () => setDrawer(drawer.hidden !== false));
drawer.addEventListener('click', (e) => {
  if ((e.target as Element).closest('[data-close], a')) setDrawer(false);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !drawer.hidden) setDrawer(false);
});

// ---------- the account, top right ----------
const accountEl = $('#account');
let account: AccountView = {
  kind: me.mode === 'player' ? 'player' : me.mode === 'pool' ? 'pool' : me.mode === 'dev' ? 'dev' : me.pool ? 'pool-empty' : 'signed-out',
  me,
};
const showAccount = (view: AccountView) => {
  account = view;
  renderAccount(accountEl, view);
  renderDrawerAccount($('#oc-drawer-account'), view);
};
showAccount({ ...account, notice: accountNotice(me, authError, false) });
// The free credits tick down while people play: refresh the amount now and then, while the page is in view.
if (me.mode === 'pool') {
  setInterval(() => {
    if (document.hidden || account.kind !== 'pool') return;
    void fetchMe().then((fresh) => {
      if (account.kind !== 'pool') return;
      if (fresh.mode === 'pool') updatePoolAmount(accountEl, fresh.pool?.remainingUsd ?? null);
      else if (fresh.mode === 'none' && fresh.pool && !fresh.unavailable) showAccount({ kind: 'pool-empty', me: fresh });
    });
  }, 60_000);
}

let noticeTimer = 0;
/** A note over the top of the board (so nothing below it moves), gone after a while. */
const notice = (text: string | null) => {
  noticeEl.textContent = text ?? '';
  noticeEl.hidden = !text;
  clearTimeout(noticeTimer);
  if (text) noticeTimer = window.setTimeout(() => (noticeEl.hidden = true), 10_000);
};

// ---------- models ----------
const offered = modelOptions(me).map((o) => o.id);
const defaultModel = me.defaultModel ?? DEFAULT_MODEL;
/** Whether live AI games can be paid for: the free credits, a signed-in player's wallet, or a local key. */
let canUseAI = me.mode !== 'none';
const base: ModelChoice = initialChoice(me, null);
let choice: ModelChoice = { ...base };

function loadLineup(): Lineup {
  try {
    const saved = JSON.parse(localStorage.getItem(LINEUP_KEY) ?? 'null') as Partial<Lineup> | null;
    if (saved && GHOST_IDS.every((g) => typeof saved[g] === 'string' && offered.includes(saved[g]!))) return saved as Lineup;
  } catch {
    // nothing stored, or blocked storage
  }
  return defaultLineup(offered);
}
let lineup: Lineup = loadLineup();
const saveLineup = (l: Lineup) => {
  try {
    localStorage.setItem(LINEUP_KEY, JSON.stringify(l));
  } catch {
    // not remembered
  }
};

// ---------- calls ----------
let poolNoticeShown = false;
const hooks: TransportHooks = {
  onPoolEmpty: () => {
    canUseAI = false;
    if (poolNoticeShown) return;
    poolNoticeShown = true;
    showAccount({ kind: 'pool-empty', me: { ...me, mode: 'none', pool: { open: false, remainingUsd: 0 } } });
    notice(`${POOL_EMPTY_NOTICE} The AIs fall back to a simple rule until then.`);
  },
  onSignedOut: () => {
    canUseAI = me.mode === 'pool';
    showAccount({ kind: me.pool ? 'pool' : 'signed-out', me });
    notice('Your Opper sign-in has expired. Log in again to keep playing on your account.');
  },
  onWalletEmpty: (url) => {
    showAccount({ ...account, ...walletNotice(url) });
    notice('Your Opper wallet is empty. Top it up to keep playing.');
  },
};
const transport = createHttpTransport(hooks);
const warmProblems = new Map<string, string>();
const warming = new ModelWarming({
  warmUp: async (m) => {
    const r = await warmUp(m === defaultModel ? undefined : m, hooks);
    if (r.ok) warmProblems.delete(m);
    else if (r.account) warmProblems.set(m, r.error);
    return r.ok;
  },
  now: () => Date.now(),
});
const problemOf = (models: string[]) => models.map((m) => warmProblems.get(m)).find((p) => p !== undefined);

// ---------- what is on the board ----------
type Mode = { kind: 'recording' } | { kind: 'watch'; model: string } | { kind: 'play'; lineup: Lineup | null };
let mode: Mode = { kind: 'recording' };
let demo: DemoPlayer | null = null;
/** Whether a live game runs (anything but the recording). */
let live = false;
let paused = false;
let gameId = 0;
let gameOverShown = false;
/** Seconds of play in the live game, and in the recording (which keeps its place while something else plays). */
let playT = 0;
let recordingT = 0;
let clockMs = 0;
let last = performance.now();
let picker: Picker | null = null;
/** What Space/Enter does while a card is open. */
let overlayAction: (() => void) | null = null;

let stats = new GameStats();
const slots = { inFlight: 0 };
const newScheduler = (gameStats: GameStats) =>
  new Scheduler({
    transport,
    slots,
    // Four ghosts on four different models are four requests at once.
    maxInFlight: 4,
    actors: jevActors,
    modelFor: (actor) => requestModel(choice, actor, defaultModel),
    now: () => clockMs,
    onEvent: (e) => {
      if (gameStats !== stats) return; // an answer for a game that has ended
      if (e.type === 'call' && e.model) warming.touch(e.model === 'jev-1.13.0' ? DEFAULT_MODEL : e.model);
      log.handle(e, playT);
      if (e.type === 'decision') thinking.add(e.decision, performance.now());
      stats.onSchedulerEvent(e);
    },
  });
let scheduler = newScheduler(stats);
// The characters no AI plays follow the classic rules.
const controls: Controls = {
  decide: (point, s) => (jevActors(s).includes(point.actor) ? scheduler.decide(point, s) : greedyChoice(s, point, optionFeatures(s, point))),
};

const short = (model: string) => modelName(model).replace(/ 1\.13$/, '');
/** The line above the board: who is playing whom. */
function setPlate(label: string | null = null): void {
  if (label !== null) {
    plateLabel.textContent = label;
    return;
  }
  const b = (text: string) => Object.assign(document.createElement('b'), { textContent: text });
  if (mode.kind === 'recording' || mode.kind === 'watch') {
    const model = mode.kind === 'watch' ? mode.model : (rec?.model ?? DEFAULT_MODEL);
    plateLabel.replaceChildren(b(modelName(model)), ' vs the classic ghosts');
  } else {
    plateLabel.replaceChildren(b('You'), mode.lineup ? ` vs ${lineupNames(mode.lineup)}` : ' vs the classic ghosts');
  }
}

function renderChips(): void {
  const current = mode.kind === 'recording' ? (rec?.model ?? null) : mode.kind === 'watch' ? mode.model : null;
  chipsEl.replaceChildren(
    ...WATCH_ORDER.filter((m) => offered.includes(m) || m === rec?.model).map((m) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(m === current));
      const logo = logoFor(m);
      if (logo) chip.append(logo);
      chip.append(modelName(m));
      chip.title = m === rec?.model ? `${modelName(m)}'s recorded benchmark game` : `Watch ${modelName(m)} play live`;
      chip.addEventListener('click', () => watch(m));
      return chip;
    }),
  );
}

const setPaused = (p: boolean) => {
  paused = p;
  pausedEl.hidden = !p;
};
const dim = (on: boolean) => boardEl.classList.toggle('dim', on);

/** Ends whatever was running: answers still in flight reach the old scheduler and are ignored. */
function retire(): void {
  gameId += 1;
  scheduler.reset();
  stats = new GameStats();
  scheduler = newScheduler(stats);
  thinking.clear();
  live = false;
}

/** One player for the recording, so coming back to jev picks up where it was instead of starting over. */
let recordingPlayer: DemoPlayer | null = null;
const recordingSubject: Subject = { kind: 'pacman', model: rec?.model ?? DEFAULT_MODEL, recorded: true };

/** The recorded benchmark game: plays when the page opens, costs nothing. */
function showRecording(): void {
  retire();
  picker = null;
  overlayAction = null;
  hideOverlay(overlayEl);
  dim(false);
  mode = { kind: 'recording' };
  playCta.hidden = false;
  setPaused(false);
  if (rec) {
    recordingPlayer ??= new DemoPlayer(rec, {
      onLoop: () => {
        recordingT = 0;
        thinking.clear();
        log.begin(recordingSubject);
      },
    });
    demo = recordingPlayer;
    state = demo.state;
    log.begin(recordingSubject);
  } else {
    demo = null;
    state = createGame();
  }
  setPlate();
  renderChips();
}

/** A live game: an AI playing Pac-Man (watch), or you against AI ghosts or the classic ghosts (play). */
function startGame(next: Exclude<Mode, { kind: 'recording' }>): void {
  retire();
  demo = null;
  picker = null;
  overlayAction = null;
  mode = next;
  choice = next.kind === 'watch' ? { ...base, pacman: next.model } : next.lineup ? { ...base, ...next.lineup } : { ...base };
  state = createGame({ pacmanControl: next.kind === 'watch' ? 'jev' : 'keyboard', ghostsByAI: next.kind === 'play' && next.lineup !== null });
  log.begin(next.kind === 'watch' ? { kind: 'pacman', model: next.model } : next.lineup ? { kind: 'ghosts', lineup: next.lineup } : { kind: 'classic' });
  hideOverlay(overlayEl);
  dim(false);
  // Watching anything, the way to play stays on the board; playing, it is out of the way.
  playCta.hidden = next.kind === 'play';
  gameOverShown = false;
  playT = 0;
  live = true;
  setPaused(document.hidden);
  setPlate();
  renderChips();
}

/** The models a live game needs, woken first (an idle one can take seconds to answer its first call). */
function wakeThen(models: string[], onWaiting: (cold: string[]) => void, start: () => void, onFail: (msg: string) => void): void {
  const id = gameId;
  void warming.warmAll(() => models, onWaiting).then((failed) => {
    if (id !== gameId) return; // something else started meanwhile
    if (failed.length) return onFail(problemOf(failed) ?? `${failed.map(modelName).join(' and ')} didn't wake up in time. Try again in a moment.`);
    start();
  });
}

/** A chip under the board (or Watch in the leaderboard): the recording for jev, a live game for the others. */
function watch(model: string): void {
  notice(null);
  if (rec && model === rec.model) return showRecording();
  if (!canUseAI) return notice(`${account.kind === 'pool-empty' ? 'The free credits are used up. ' : ''}Log in to watch ${modelName(model)} play live on your own Opper account.`);
  retire();
  hideOverlay(overlayEl);
  dim(false);
  picker = null;
  overlayAction = null;
  playCta.hidden = false;
  mode = { kind: 'watch', model };
  renderChips();
  setPlate(`Waking up ${modelName(model)}…`);
  wakeThen(
    [model],
    () => {},
    () => startGame({ kind: 'watch', model }),
    (msg) => {
      notice(msg);
      showRecording();
    },
  );
}

const costNote = (): string => {
  if (!canUseAI) return `${account.kind === 'pool-empty' ? 'The free credits are used up. ' : ''}Log in to play on your own Opper account, about 2¢ a game.`;
  if (account.kind === 'player') return 'On your Opper account, about 2¢ a game.';
  if (account.kind === 'dev') return 'On the local key from .env.';
  const left = poolAmount(account.me.pool?.remainingUsd ?? null);
  return `Free while the shared credits last${left ? ` (${left} left)` : ''}. About 2¢ a game.`;
};

/** "▶ Play against the AIs": who plays the ghosts, then Start. */
function openPicker(): void {
  if (picker) return;
  notice(null);
  dim(true);
  playCta.hidden = true;
  const ghostModels = () => [...new Set(GHOST_IDS.map((g) => lineup[g]))];
  const p = showPicker(overlayEl, {
    lineup: () => lineup,
    offered,
    canPlay: canUseAI,
    costNote: costNote(),
    loginAvailable: me.loginAvailable,
    onChange: (l) => {
      lineup = l;
      saveLineup(l);
      // Wake them while the player is still choosing: one tiny call each.
      if (canUseAI) for (const m of ghostModels()) void warming.warm(m);
    },
    onStart: () => {
      const l = { ...lineup };
      const models = ghostModels();
      const id = gameId;
      void warming.warmAll(() => models, (cold) => p.busy(`Waking up ${cold.map(short).join(' and ')}…`)).then((failed) => {
        if (id !== gameId || picker !== p) return; // closed or replaced meanwhile
        const awake = models.filter((m) => !failed.includes(m));
        if (!awake.length) {
          p.busy(null);
          return p.note(problemOf(failed) ?? `${failed.map(modelName).join(' and ')} didn't wake up in time. Try again in a moment.`);
        }
        // One sleepy model shouldn't hold up the game: an awake one plays its ghosts this time.
        const stand = awake.includes(defaultModel) ? defaultModel : awake[0];
        const played = Object.fromEntries(GHOST_IDS.map((g) => [g, failed.includes(l[g]) ? stand : l[g]])) as Lineup;
        startGame({ kind: 'play', lineup: played });
        const stood = GHOST_IDS.filter((g) => played[g] !== l[g]).map((g) => GHOST_NAMES[g]);
        if (stood.length) notice(`${failed.map(modelName).join(' and ')} didn't wake up in time, so ${modelName(stand)} plays ${stood.join(' and ')} this game.`);
      });
    },
    onClassic: () => startGame({ kind: 'play', lineup: null }),
    onLogin: signIn,
    onBack: closePicker,
  });
  picker = p;
  overlayAction = p.action;
  if (canUseAI) for (const m of ghostModels()) void warming.warm(m);
}
function closePicker(): void {
  picker = null;
  overlayAction = null;
  hideOverlay(overlayEl);
  dim(false);
  playCta.hidden = mode.kind === 'play';
}

// ---------- game over ----------
let board: Leaderboard | null = null;
const readBest = (): number => {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeBest = (score: number) => {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // not remembered
  }
};
const touchScreen = matchMedia('(pointer: coarse)').matches;
/** The system share sheet on phones (where people share from), else the clipboard. */
async function shareScore(text: string): Promise<'shared' | 'copied' | 'failed' | 'cancelled'> {
  if (navigator.share && touchScreen) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

function gameOver(): void {
  gameOverShown = true;
  dim(true);
  const summary = stats.summary(state);
  if (mode.kind === 'watch') {
    const model = mode.model;
    const average = board?.entries.find((e) => e.model === model)?.meanScore ?? null;
    overlayAction = () => watch(model);
    return showWatchOver(overlayEl, { model, score: state.score, average, onAgain: () => watch(model), onPlay: openPicker });
  }
  if (mode.kind !== 'play') return;
  const l = mode.lineup;
  let newBest = false;
  if (!l) {
    // The classic ghosts are the benchmark's own game: a personal best counts there.
    newBest = summary.score > readBest();
    if (newBest) writeBest(summary.score);
  }
  const again = () => startGame({ kind: 'play', lineup: l });
  overlayAction = again;
  showGameOver(overlayEl, {
    summary,
    lineup: l,
    board,
    newBest,
    onPlayAgain: again,
    onShare: () => shareScore(l ? aiShareText(summary, l, SHARE_URL) : board ? shareText(versus(board, summary.score), SHARE_URL) : `I scored ${summary.score} at jevman 🟡 ${SHARE_URL}`),
    onReview: l
      ? () => {
          log.setOpen(true);
          tvEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      : null,
    onBack: showRecording,
  });
}

// ---------- controls ----------
function togglePause(): void {
  if (!overlayEl.hidden) return;
  if (paused && live) {
    // Models doze off during a long pause: wake them before the game goes on.
    const id = gameId;
    const models = [...new Set(jevActors(state).map((a) => choice[a]))];
    setPlate('Waking up…');
    void warming.warmAll(() => models, () => {}).then((failed) => {
      if (id !== gameId) return;
      setPlate();
      if (failed.length) return notice(problemOf(failed) ?? 'The AIs did not wake up, so the game stays paused. Press play to try again.');
      setPaused(false);
    });
    return;
  }
  setPaused(!paused);
}
// A click on the game pauses it, another resumes (not on its cards, the Play button or a note).
boardEl.addEventListener('click', (e) => {
  if ((e.target as Element).closest('.overlay, .play-cta, .board-notice')) return;
  togglePause();
});
playCta.addEventListener('click', openPicker);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && live && !paused && overlayEl.hidden) setPaused(true);
});
const steer = (dir: Dir) => {
  if (live && state.pacmanControl === 'keyboard') state.keyDir = dir;
};
attachTouch(boardEl, dpad, steer, () => live && state.pacmanControl === 'keyboard' && overlayEl.hidden === true);

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || typeof e.key !== 'string') return;
  if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const dir = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
  if (dir && live && state.pacmanControl === 'keyboard' && overlayEl.hidden === true) {
    steer(dir);
    e.preventDefault();
    return;
  }
  if (e.repeat) return;
  const onControl = e.target instanceof Element && e.target.closest('a, button, input, select, textarea, summary, [tabindex]') !== null;
  if ((e.key === ' ' || e.key === 'Enter') && !onControl) {
    if (overlayAction) {
      e.preventDefault();
      overlayAction();
    } else if (mode.kind !== 'play' && overlayEl.hidden) {
      e.preventDefault();
      openPicker();
    }
    return;
  }
  if (e.key === 'Escape' && picker) return closePicker();
  const k = e.key.toLowerCase();
  if (k === 'p') togglePause();
});

// ---------- the leaderboard below ----------
const NO_SUBMISSIONS: Community = { generatedAt: '', benchVersion: 0, entries: [] };
void Promise.all([
  fetch(appPath('/leaderboard.json')).then((r) => (r.ok ? (r.json() as Promise<Leaderboard>) : null)),
  fetch(appPath('/community.json'))
    .then((r) => (r.ok ? (r.json() as Promise<Community>) : NO_SUBMISSIONS))
    .catch(() => NO_SUBMISSIONS),
])
  .then(([b, community]) => {
    if (!b) return;
    board = b;
    renderLeaderboard(
      $<HTMLTableElement>('#leaderboard-table'),
      $('#leaderboard-sub'),
      b,
      community,
      (model) => {
        watch(model);
        $('.stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      (model) => offered.includes(model) || model === rec?.model,
    );
  })
  .catch(() => {
    $('#leaderboard-sub').textContent = 'The leaderboard could not be loaded. Try again in a moment.';
  });

// ---------- the frame loop ----------
function tick(dt: number): void {
  if (demo) {
    for (const e of demo.advance(dt)) {
      log.handle(e, recordingT);
      if (e.type === 'decision') thinking.add(e.decision, performance.now());
    }
    state = demo.state;
    if (state.status === 'playing') recordingT += dt;
    return;
  }
  if (!live || gameOverShown) return;
  clockMs += dt * 1000;
  scheduler.update(state);
  stats.beforeStep(state);
  step(state, dt, controls);
  stats.afterStep(state, dt);
  if (state.status === 'playing') playT += dt;
  if (state.status === 'gameover') gameOver();
}

const setText = (el: HTMLElement, text: string) => {
  if (el.textContent !== text) el.textContent = text;
};
let shownLives = -1;
function frame(now: number): void {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  if (!paused) tick(dt);
  drawGame(ctx, state, now / 1000, false); // paused shows as a badge over the board, not on the maze
  if (state.status === 'playing' && !paused) thinking.draw(ctx, now);
  log.observe(state, demo ? recordingT : playT);
  setText(scoreEl, state.score.toLocaleString('en-US'));
  setText(levelEl, String(state.level));
  const fruit = fruitForLevel(state.level);
  setText(fruitEl, `${FRUIT_EMOJI[fruit.kind] ?? ''} ${fruit.points}`);
  if (state.lives !== shownLives) {
    shownLives = state.lives;
    livesEl.replaceChildren(...Array.from({ length: Math.max(0, state.lives) }, () => Object.assign(document.createElement('span'), { className: 'pac' })));
  }
  const steering = live && state.pacmanControl === 'keyboard' && overlayEl.hidden === true;
  if (dpad.hidden === (touchScreen && steering)) dpad.hidden = !(touchScreen && steering);
  boardEl.classList.toggle('steering', steering);
  requestAnimationFrame(frame);
}

// From an old "Watch Clef play" link (?pacman=…): straight to that model.
const linked = new URLSearchParams(location.search).get('pacman');
showRecording();
if (linked && offered.includes(linked) && linked !== rec?.model) watch(linked);
requestAnimationFrame(frame);

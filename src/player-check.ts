import { Replay, type Recording } from './replay';

/** Longest game a check replays: about half an hour of frames at 60 a second. */
export const MAX_PLAYER_FRAMES = 120_000;
/** The longest step the game takes (the page caps a frame at 0.05 s). */
const MAX_STEP = 0.05;
const DIRS = new Set(['up', 'down', 'left', 'right']);

export type PlayerCheck = { ok: true; score: number } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const frameNo = (v: unknown, frames: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < frames;

/**
 * A player's game against AI ghosts, replayed from its recording: its steering, the ghosts' answers and its frame
 * steps. The score is the replay's, never the one the page claims; a recording that doesn't replay to its own final
 * state is refused. Bundled for the server at build time (vite build --ssr), so the server needs no game code of its own.
 */
export function checkPlayerGame(raw: unknown): PlayerCheck {
  const bad = (error: string): PlayerCheck => ({ ok: false, error });
  if (!isObject(raw) || raw.version !== 1) return bad('not a recording');
  const setup = raw.setup;
  if (!isObject(setup) || setup.pacmanControl !== 'keyboard' || setup.ghostsByAI !== true) return bad('not a game against AI ghosts');
  const frames = raw.frames;
  if (!Array.isArray(frames) || frames.length === 0 || frames.length > MAX_PLAYER_FRAMES) return bad('bad frames');
  if (!frames.every((dt) => typeof dt === 'number' && Number.isFinite(dt) && dt > 0 && dt <= MAX_STEP)) return bad('bad frame steps');
  const keys = raw.keys ?? [];
  if (!Array.isArray(keys) || !keys.every((k) => Array.isArray(k) && k.length === 2 && frameNo(k[0], frames.length) && (k[1] === null || DIRS.has(k[1] as string)))) return bad('bad steering');
  const decisions = raw.decisions;
  if (!Array.isArray(decisions) || !decisions.every((d) => Array.isArray(d) && d.length === 3 && frameNo(d[0], frames.length) && typeof d[1] === 'string' && DIRS.has(d[2] as string))) return bad('bad decisions');
  const final = raw.final;
  if (!isObject(final) || !Number.isInteger(final.score)) return bad('bad final state');
  const rec: Recording = { version: 1, recordedAt: String(raw.recordedAt ?? ''), model: 'player', frames, decisions, events: [], final: final as Recording['final'], setup: { pacmanControl: 'keyboard', ghostsByAI: true }, keys };
  const replay = new Replay(rec);
  while (!replay.done) replay.stepFrame();
  const s = replay.state;
  if (s.score !== final.score || s.lives !== final.lives || s.level !== final.level || replay.frame !== final.frames) return bad('the game does not replay to its score');
  if (s.status !== 'gameover') return bad('the game is not over');
  return { ok: true, score: s.score };
}

import { describe, expect, it } from 'vitest';
import { checkPlayerGame } from '../src/player-check';
import { playAndRecord } from './support/player-game';

describe('checkPlayerGame (the high-score check)', () => {
  const { state, recording } = playAndRecord(42, 20000);

  it('accepts a finished game and returns the score its replay reaches', () => {
    expect(state.status).toBe('gameover');
    expect(checkPlayerGame(JSON.parse(JSON.stringify(recording)))).toEqual({ ok: true, score: state.score });
  });

  it('refuses a claimed score the game did not reach', () => {
    const r = checkPlayerGame({ ...recording, final: { ...recording.final, score: recording.final.score + 10_000 } });
    expect(r.ok).toBe(false);
  });

  it('refuses a game that is not over, odd steps, and anything that is not a game against AI ghosts', () => {
    expect(checkPlayerGame({ ...recording, frames: recording.frames.slice(0, 50), final: { ...recording.final, frames: 50 } }).ok).toBe(false);
    expect(checkPlayerGame({ ...recording, frames: recording.frames.map(() => 1) }).ok).toBe(false);
    expect(checkPlayerGame({ ...recording, setup: { pacmanControl: 'jev', ghostsByAI: false } }).ok).toBe(false);
    expect(checkPlayerGame(null).ok).toBe(false);
  });
});

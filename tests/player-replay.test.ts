import { describe, expect, it } from 'vitest';
import { greedyChoice, optionFeatures } from '../src/features';
import { Recorder, Replay, roundDt } from '../src/replay';
import { createGame, step, type Controls } from '../src/sim';
import type { Dir } from '../src/types';

/** A player's game the way the page records it: steering read before each step, the ghosts' answers through Controls. */
function playAndRecord(seed: number, maxFrames = 6000) {
  const state = createGame({ pacmanControl: 'keyboard', ghostsByAI: true });
  const rec = new Recorder();
  const ghosts: Controls = { decide: (point, s) => greedyChoice(s, point, optionFeatures(s, point)) };
  let frame = 0;
  const controls = rec.wrap(ghosts, () => frame);
  const dirs: Dir[] = ['up', 'left', 'down', 'right'];
  let r = seed;
  const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let f = 0; f < maxFrames && state.status !== 'gameover'; f++) {
    if (f % 23 === 0) state.keyDir = dirs[Math.floor(rand() * 4)]!; // the player presses a key now and then
    const dt = roundDt(1 / 60 + rand() * 0.004);
    frame = rec.frames.length;
    rec.key(frame, state.keyDir);
    rec.frames.push(dt);
    step(state, dt, controls);
    rec.settle(state.keyDir);
  }
  return { state, recording: rec.finish(state, 'player', { pacmanControl: 'keyboard', ghostsByAI: true }) };
}

describe("a player's game", () => {
  it('replays to the same score, lives and level from its steering and the ghosts answers', () => {
    for (const seed of [1, 7, 42]) {
      const { state, recording } = playAndRecord(seed);
      expect(recording.keys!.length).toBeGreaterThan(5);
      const replay = new Replay(recording);
      while (!replay.done) replay.stepFrame();
      expect({ score: replay.state.score, lives: replay.state.lives, level: replay.state.level }).toEqual({ score: state.score, lives: state.lives, level: state.level });
      expect({ score: replay.state.score, lives: replay.state.lives, level: replay.state.level, frames: replay.frame }).toEqual(recording.final);
    }
  });

  it('does not replay to the same score if the steering is changed', () => {
    const { recording } = playAndRecord(7);
    const tampered = { ...recording, keys: recording.keys!.map(([f, d], i) => [f, i % 2 ? d : null] as [number, Dir | null]) };
    const replay = new Replay(tampered);
    while (!replay.done) replay.stepFrame();
    expect(replay.state.score).not.toBe(recording.final.score);
  });
});

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../server/auth';
import { BOARD_SIZE, cleanInitials, HighScores } from '../server/highscores';
import { createJevMiddleware } from '../server/routes';
import { sealSession } from '../server/session';
import { boardOf, MIXED_LINEUP } from '../shared/lineups';
import { checkPlayerGame } from '../src/player-check';
import { playAndRecord, TEST_SECRET } from './support/player-game';

const SECRET = TEST_SECRET;
const entry = (initials: string, score: number) => ({ initials, score, at: '2026-10-08T00:00:00.000Z', who: 'x' });

describe('HighScores', () => {
  it('keeps the ten best per board, best first, and never shows who', () => {
    const h = new HighScores(null);
    for (let i = 1; i <= 12; i++) h.add('mixed', { ...entry('AAA', i * 100), who: `p${i}` });
    const board = h.view().mixed!;
    expect(board).toHaveLength(BOARD_SIZE);
    expect(board[0]!.score).toBe(1200);
    expect(board.at(-1)!.score).toBe(300);
    expect(board[0]).not.toHaveProperty('who');
    expect(h.placeFor('mixed', 250)).toBeNull();
    expect(h.placeFor('mixed', 1250)).toBe(1);
  });

  it('keeps one line per account per board: its best', () => {
    const h = new HighScores(null);
    expect(h.add('mixed', { ...entry('AAA', 500), who: 'same' })).toBe(1);
    expect(h.add('mixed', { ...entry('AAA', 300), who: 'same' })).toBe(1);
    expect(h.add('mixed', { ...entry('AAA', 900), who: 'same' })).toBe(1);
    expect(h.view().mixed).toEqual([{ initials: 'AAA', score: 900, at: '2026-10-08T00:00:00.000Z' }]);
  });

  it('survives a restart through its file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-hs-'));
    const file = join(dir, 'scores.json');
    new HighScores(file).add('opper/clef', entry('BOB', 4200));
    expect(new HighScores(file).view()['opper/clef']).toEqual([{ initials: 'BOB', score: 4200, at: '2026-10-08T00:00:00.000Z' }]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('takes three letters only', () => {
    expect(cleanInitials('abc')).toBe('ABC');
    expect(cleanInitials('AB')).toBeNull();
    expect(cleanInitials('A1C')).toBeNull();
  });

  it('puts the presets on boards and leaves custom mixes off', () => {
    expect(boardOf(MIXED_LINEUP)).toBe('mixed');
    expect(boardOf({ blinky: 'opper/clef', pinky: 'opper/clef', inky: 'opper/clef', clyde: 'opper/clef' })).toBe('opper/clef');
    expect(boardOf({ blinky: 'opper/clef', pinky: 'opper/clef', inky: 'opper/kev-4b', clyde: 'opper/clef' })).toBeNull();
  });
});

describe('/api/highscores', () => {
  const mount = () => {
    const highScores = new HighScores(null);
    const handler = createJevMiddleware({ SESSION_SECRET: SECRET, OPPER_BASE_URL: 'https://api.opper.ai' }, { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, { quiet: true, highScores, loadPlayerCheck: async () => checkPlayerGame });
    return { handler, highScores };
  };
  const call = async (handler: ReturnType<typeof mount>['handler'], method: string, headers: Record<string, string>, payload?: unknown) => {
    const res = { statusCode: 200, headersSent: false, headers: {} as Record<string, unknown>, setHeader(k: string, v: unknown) { this.headers[k] = v; }, end: vi.fn() };
    const req = Object.assign(new EventEmitter(), { method, url: '/api/highscores', headers });
    handler(req as never, res as never, vi.fn());
    if (payload !== undefined) {
      req.emit('data', JSON.stringify(payload));
      req.emit('end');
    }
    await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
    return { status: res.statusCode, body: JSON.parse(res.end.mock.calls[0]![0] as string) };
  };
  const signedIn = { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${sealSession({ v: 1, apiKey: 'k', user: { email: 'player@example.com' }, issuedAt: Date.now() }, SECRET)}` };
  const { state, recording } = playAndRecord(42, 20000);

  it('lists the boards to anyone', async () => {
    const { handler } = mount();
    const r = await call(handler, 'GET', {});
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.boards)).toContain('mixed');
  });

  it('asks a signed-out player to sign in', async () => {
    const { handler } = mount();
    const r = await call(handler, 'POST', { 'content-type': 'application/json' }, { board: 'mixed', initials: 'ABC', recording });
    expect(r.status).toBe(401);
    expect(r.body.signedOut).toBe(true);
  });

  it("puts a signed-in player's checked game on the board, with the replay's score", async () => {
    const { handler, highScores } = mount();
    const r = await call(handler, 'POST', signedIn, { board: 'mixed', initials: 'jev', recording });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ place: 1, score: state.score });
    expect(highScores.view().mixed![0]).toMatchObject({ initials: 'JEV', score: state.score });
  });

  it('refuses a game that does not check out, and bad initials or boards', async () => {
    const { handler, highScores } = mount();
    expect((await call(handler, 'POST', signedIn, { board: 'mixed', initials: 'ABC', recording: { ...recording, final: { ...recording.final, score: 99_999 } } })).status).toBe(422);
    expect((await call(handler, 'POST', signedIn, { board: 'mixed', initials: 'A!', recording })).status).toBe(400);
    expect((await call(handler, 'POST', signedIn, { board: 'nope', initials: 'ABC', recording })).status).toBe(400);
    // played against Mixed, entered for All Clef
    expect((await call(handler, 'POST', signedIn, { board: 'opper/clef', initials: 'ABC', recording })).status).toBe(422);
    expect(highScores.view().mixed).toEqual([]);
  });
});

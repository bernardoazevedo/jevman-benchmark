import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BOARD_KEYS } from '../shared/lineups.ts';

/** One line on a board: three initials, the score, when, and a hash of the account (to trace abuse, never shown). */
export interface ScoreEntry {
  initials: string;
  score: number;
  at: string;
  who: string;
}
/** A board as the page sees it. */
export type PublicEntry = Omit<ScoreEntry, 'who'>;

export const BOARD_SIZE = 10;

/** Three letters A to Z, upper-cased, or null. */
export function cleanInitials(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

/** A signed-in player's account as a short hash: enough to find their entries, without storing who they are. */
export function accountHash(user: { email?: string; name?: string } | undefined, secret: string): string {
  return createHash('sha256').update(`${secret}:${user?.email ?? user?.name ?? 'unknown'}`).digest('hex').slice(0, 16);
}

/**
 * The player high-score boards, one per lineup, top ten each. Kept in memory and saved to a file on the server's own
 * disk: the service runs as one task, so that is enough, but a redeploy starts the boards afresh. (A bucket would
 * keep them: swap load and save.)
 */
export class HighScores {
  private readonly boards: Record<string, ScoreEntry[]> = {};
  private readonly file: string | null;
  private readonly warn: (msg: string) => void;

  constructor(file: string | null, warn: (msg: string) => void = () => {}) {
    this.file = file;
    this.warn = warn;
    for (const k of BOARD_KEYS) this.boards[k] = [];
    if (file) this.load(file);
  }

  /** Every board, best first, without the account hashes. */
  view(): Record<string, PublicEntry[]> {
    return Object.fromEntries(BOARD_KEYS.map((k) => [k, this.boards[k]!.map(({ initials, score, at }) => ({ initials, score, at }))]));
  }

  /** The place a score would take on a board (1 to 10), or null if it would not make it. */
  placeFor(board: string, score: number): number | null {
    const list = this.boards[board];
    if (!list || score <= 0) return null;
    const place = list.filter((e) => e.score >= score).length + 1;
    return place <= BOARD_SIZE ? place : null;
  }

  /** Puts a score on its board; its place, or null if it didn't make the top ten. */
  add(board: string, entry: ScoreEntry): number | null {
    const place = this.placeFor(board, entry.score);
    if (place === null) return null;
    const list = this.boards[board]!;
    list.splice(place - 1, 0, entry);
    list.length = Math.min(list.length, BOARD_SIZE);
    this.save();
    return place;
  }

  private load(file: string): void {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      for (const k of BOARD_KEYS) {
        const list = data[k];
        if (!Array.isArray(list)) continue;
        this.boards[k] = list
          .filter((e): e is ScoreEntry => !!e && typeof e === 'object' && cleanInitials((e as ScoreEntry).initials) !== null && Number.isInteger((e as ScoreEntry).score))
          .sort((a, b) => b.score - a.score)
          .slice(0, BOARD_SIZE);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') this.warn(`[highscores] could not read ${file}: ${(err as Error).message}`);
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.boards));
      renameSync(tmp, this.file); // whole or not at all
    } catch (err) {
      this.warn(`[highscores] could not save ${this.file}: ${(err as Error).message}`);
    }
  }
}

/** The boards' file: JEV_HIGHSCORES_FILE, else one in the system's temp folder. */
export const highScoresFile = (env: Record<string, string | undefined>): string => env.JEV_HIGHSCORES_FILE || join(tmpdir(), 'jevman-highscores.json');

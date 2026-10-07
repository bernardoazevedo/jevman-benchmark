import type { HttpRequest } from './auth.ts';

/**
 * The free credits: a public Opper key (OPPER_POOL_API_KEY) that pays for signed-out visitors until the money behind
 * it runs out. The key's organization balance is the pool, so topping up that organization on Opper refills it; there
 * is nothing to manage here. Opper itself stops the key at zero (HTTP 402), so the numbers below only steer the page:
 * the counter, and saying "sign in" before a game fails instead of after.
 */

/** How often the balance is read from Opper (GET /v3/me); in between, each call's cost is subtracted locally. */
export const POOL_REFRESH_MS = 30_000;
/** Largest /api/decide body the pool pays for. A real request is at most ~5 KB (four questions); the cap is 3×. */
export const MAX_POOL_BODY_BYTES = 16 * 1024;
/** Most questions in one pool request: Pac-Man and the four ghosts never ask more than four at once. */
export const MAX_POOL_QUESTIONS = 5;
export const POOL_EMPTY_MESSAGE = 'The free credits are used up. Sign in with Opper to keep playing on your own account.';

export interface PoolStatus {
  /** Whether the pool pays for signed-out play right now. */
  open: boolean;
  /** The balance in USD, or null when Opper doesn't show it to this key (its owner lacks billing:read). */
  remainingUsd: number | null;
}

export interface PoolDeps {
  apiKey: string;
  opperUrl: string;
  fetch: typeof fetch;
  now: () => number;
  log?: (line: string) => void;
  refreshMs?: number;
}

/** What GET /v3/me says about the key's money: blocked means Opper rejects new spend. */
export function statusFromMe(body: unknown): PoolStatus | null {
  if (!body || typeof body !== 'object') return null;
  const me = body as { blocked?: unknown; balance?: { balance_cents?: unknown } };
  const cents = typeof me.balance?.balance_cents === 'number' && Number.isFinite(me.balance.balance_cents) ? me.balance.balance_cents : null;
  const blocked = me.blocked === true;
  return { open: !blocked && (cents === null || cents > 0), remainingUsd: cents === null ? null : Math.max(0, cents) / 100 };
}

export class Pool {
  private status: PoolStatus = { open: true, remainingUsd: null };
  private checkedAt = Number.NEGATIVE_INFINITY;
  private pending: Promise<PoolStatus> | null = null;
  private readonly refreshMs: number;

  constructor(private readonly deps: PoolDeps) {
    this.refreshMs = deps.refreshMs ?? POOL_REFRESH_MS;
  }

  get apiKey(): string {
    return this.deps.apiKey;
  }

  /** The last known status; starts a background refresh once it is older than refreshMs. */
  current(): PoolStatus {
    if (this.deps.now() - this.checkedAt >= this.refreshMs) void this.refresh();
    return { ...this.status };
  }

  /** Reads the balance from Opper now (one request at a time). A failed read keeps the last status: Opper still stops the key at zero. */
  refresh(): Promise<PoolStatus> {
    this.pending ??= (async () => {
      try {
        const res = await this.deps.fetch(`${this.deps.opperUrl.replace(/\/+$/, '')}/v3/me`, {
          headers: { Authorization: `Bearer ${this.deps.apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (res.status === 401) {
          this.deps.log?.('[pool] OPPER_POOL_API_KEY was rejected by Opper; the free credits are off');
          this.status = { open: false, remainingUsd: 0 };
        } else if (res.ok) {
          const next = statusFromMe(await res.json());
          if (next) this.status = next;
        } else {
          this.deps.log?.(`[pool] reading the balance failed: HTTP ${res.status}`);
        }
      } catch (err) {
        this.deps.log?.(`[pool] reading the balance failed: ${(err as Error)?.message ?? String(err)}`);
      } finally {
        this.checkedAt = this.deps.now();
        this.pending = null;
      }
      return { ...this.status };
    })();
    return this.pending;
  }

  /** A call the pool paid for: keeps the counter moving between refreshes, and asks Opper again once it reaches zero. */
  spent(costUsd: number | null): void {
    if (costUsd === null || !Number.isFinite(costUsd) || costUsd <= 0 || this.status.remainingUsd === null) return;
    this.status = { ...this.status, remainingUsd: Math.max(0, this.status.remainingUsd - costUsd) };
    if (this.status.remainingUsd === 0) void this.refresh();
  }

  /** Opper refused a call for money (402): closed until the next refresh finds a top-up. */
  exhausted(): void {
    this.status = { open: false, remainingUsd: 0 };
    this.checkedAt = this.deps.now();
  }
}

export function poolFromEnv(env: Record<string, string | undefined>, opperUrl: string, log: (line: string) => void): Pool | undefined {
  const apiKey = env.OPPER_POOL_API_KEY?.trim();
  if (!apiKey) return undefined;
  const pool = new Pool({ apiKey, opperUrl, fetch, now: () => Date.now(), log });
  void pool.refresh();
  return pool;
}

/**
 * Fair use of the pool, per visitor (IP address): a request rate that fits a real game, and a daily amount. They are
 * kept in memory, so each server counts on its own; the pool's own balance is the hard limit.
 */
export interface LimitSettings {
  /** USD of pool money one visitor can use per UTC day. */
  dailyUsd: number;
  /** Requests per second, sustained, and the burst on top. A game against four AI ghosts makes about four a second. */
  ratePerSec: number;
  burst: number;
}

export const DEFAULT_LIMITS: LimitSettings = { dailyUsd: 1, ratePerSec: 8, burst: 40 };
export type LimitVerdict = 'ok' | 'rate' | 'daily';
const MAX_TRACKED = 50_000;

export class VisitorLimits {
  private day = '';
  private readonly spentToday = new Map<string, number>();
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly settings: LimitSettings = DEFAULT_LIMITS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private rollDay(): void {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.spentToday.clear();
    }
  }

  /** Takes one request from the visitor's allowance, or says which limit it hit. */
  take(visitor: string): LimitVerdict {
    this.rollDay();
    if ((this.spentToday.get(visitor) ?? 0) >= this.settings.dailyUsd) return 'daily';
    const now = this.now();
    if (this.buckets.size > MAX_TRACKED) this.buckets.clear();
    const b = this.buckets.get(visitor) ?? { tokens: this.settings.burst, at: now };
    b.tokens = Math.min(this.settings.burst, b.tokens + ((now - b.at) / 1000) * this.settings.ratePerSec);
    b.at = now;
    this.buckets.set(visitor, b);
    if (b.tokens < 1) return 'rate';
    b.tokens -= 1;
    return 'ok';
  }

  spent(visitor: string, costUsd: number | null): void {
    if (costUsd === null || !Number.isFinite(costUsd) || costUsd <= 0) return;
    this.rollDay();
    if (this.spentToday.size > MAX_TRACKED) this.spentToday.clear();
    this.spentToday.set(visitor, (this.spentToday.get(visitor) ?? 0) + costUsd);
  }
}

export function limitsFromEnv(env: Record<string, string | undefined>): LimitSettings {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return v !== undefined && v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    dailyUsd: num(env.JEV_POOL_VISITOR_DAILY_USD, DEFAULT_LIMITS.dailyUsd),
    ratePerSec: DEFAULT_LIMITS.ratePerSec,
    burst: DEFAULT_LIMITS.burst,
  };
}

/**
 * The visitor's IP address. Behind proxies that each append to X-Forwarded-For (on Opper's ECS: CloudFront, then the
 * load balancer), the address the first trusted proxy saw is `trustedProxies` entries from the end; anything before it
 * was sent by the client and can be made up. With no trusted proxies, the connection's own address.
 */
export function clientIp(req: HttpRequest, trustedProxies: number): string {
  if (trustedProxies > 0) {
    const raw = req.headers['x-forwarded-for'];
    const hops = (Array.isArray(raw) ? raw.join(',') : (raw ?? '')).split(',').map((s) => s.trim()).filter(Boolean);
    const ip = hops[hops.length - trustedProxies];
    if (ip) return ip;
  }
  return req.remoteAddress ?? 'unknown';
}

/** JEV_TRUSTED_PROXIES, else 2 in production (CloudFront and the load balancer), else 0. */
export function trustedProxiesFromEnv(env: Record<string, string | undefined>): number {
  const n = Number(env.JEV_TRUSTED_PROXIES);
  if (env.JEV_TRUSTED_PROXIES !== undefined && env.JEV_TRUSTED_PROXIES.trim() !== '' && Number.isInteger(n) && n >= 0) return n;
  return env.NODE_ENV === 'production' ? 2 : 0;
}

/** Whether a decide body is the shape and size a real game sends (the pool pays only for that). */
export function poolAcceptsBody(raw: string): boolean {
  if (Buffer.byteLength(raw, 'utf8') > MAX_POOL_BODY_BYTES) return false;
  try {
    const parsed = JSON.parse(raw) as { questions?: unknown };
    const q = parsed?.questions;
    return !!q && typeof q === 'object' && !Array.isArray(q) && Object.keys(q).length <= MAX_POOL_QUESTIONS;
  } catch {
    return false;
  }
}

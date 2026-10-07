import { appPath } from './paths';

export interface Me {
  /** player: signed in; pool: signed out, playing on the free credits; dev: the local key; none: signed out, no AI. */
  mode: 'player' | 'pool' | 'dev' | 'none';
  /** The free credits, when the server has them: open while their balance lasts. */
  pool?: { open: boolean; remainingUsd: number | null };
  user?: { name?: string; email?: string };
  projectName?: string;
  walletUrl: string;
  loginAvailable: boolean;
  /** True when /api/me could not be read, so the server's real state is unknown. */
  unavailable?: boolean;
  /** In dev mode: whether the server's key calls Opper or TypeSafe directly. */
  devProvider?: 'opper' | 'typesafe';
  /** The decision models this key can play, and the one the server uses when the game names none. */
  models?: string[];
  defaultModel?: string;
}

export type AccountView = {
  kind: 'player' | 'pool' | 'pool-empty' | 'dev' | 'demo' | 'signed-out' | 'free';
  me: Me;
  notice?: string;
  /** Makes the notice a link (opened in a new tab), e.g. to the wallet. */
  noticeLink?: string;
};

const DEFAULT_WALLET_URL = 'https://platform.opper.ai/wallet';
const ME_TIMEOUT_MS = 2500;

// A transient failure must not read as "not configured", so sign-in stays enabled.
const fallbackMe = (): Me => ({ mode: 'none', walletUrl: DEFAULT_WALLET_URL, loginAvailable: true, unavailable: true });

const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

function httpsUrl(v: unknown): string {
  if (typeof v !== 'string') return DEFAULT_WALLET_URL;
  try {
    return new URL(v).protocol === 'https:' ? v : DEFAULT_WALLET_URL;
  } catch {
    return DEFAULT_WALLET_URL;
  }
}

function parseMe(body: unknown): Me | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.mode !== 'player' && b.mode !== 'pool' && b.mode !== 'dev' && b.mode !== 'none') return null;
  const me: Me = { mode: b.mode, walletUrl: httpsUrl(b.walletUrl), loginAvailable: b.loginAvailable === true };
  if (typeof b.user === 'object' && b.user !== null) {
    const u = b.user as Record<string, unknown>;
    me.user = { name: text(u.name), email: text(u.email) };
  }
  const projectName = text(b.projectName);
  if (projectName) me.projectName = projectName;
  if (b.devProvider === 'opper' || b.devProvider === 'typesafe') me.devProvider = b.devProvider;
  const defaultModel = text(b.defaultModel);
  if (defaultModel) me.defaultModel = defaultModel;
  if (typeof b.pool === 'object' && b.pool !== null) {
    const p = b.pool as Record<string, unknown>;
    const usd = typeof p.remainingUsd === 'number' && Number.isFinite(p.remainingUsd) ? Math.max(0, p.remainingUsd) : null;
    me.pool = { open: p.open === true, remainingUsd: usd };
  }
  if (Array.isArray(b.models)) me.models = b.models.filter((m): m is string => typeof m === 'string' && m.length > 0).slice(0, 20);
  return me;
}

export async function fetchMe(): Promise<Me> {
  try {
    const res = await fetch(appPath('/api/me'), { signal: AbortSignal.timeout(ME_TIMEOUT_MS) });
    if (res.ok) return parseMe(await res.json()) ?? fallbackMe();
  } catch {
    // offline, timed out, or bad JSON: behave as signed out
  }
  return fallbackMe();
}

export function signIn(): void {
  window.location.href = appPath('/auth/login');
}

export async function signOut(): Promise<void> {
  await fetch(appPath('/auth/logout'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  window.location.reload();
}

const AUTH_ERRORS: Record<string, string> = {
  state: 'Sign-in could not be verified (it may have timed out). Please try again.',
  denied: 'Sign-in was cancelled.',
  exchange: 'Opper sign-in failed. Please try again.',
};

/** Reads and removes `?auth_error=` from the address bar. */
export function takeAuthError(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('auth_error');
  if (!code) return null;
  url.searchParams.delete('auth_error');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  return AUTH_ERRORS[code] ?? 'Sign-in failed. Please try again.';
}

/** The notice the account bar starts with: a sign-in error, else a warning that /api/me was unreachable. */
export function accountNotice(me: Me, authError: string | null, demo: boolean): string | undefined {
  if (authError) return authError;
  if (me.unavailable) return demo ? "Couldn't reach the server — showing the recorded demo" : "Couldn't reach the server";
  return undefined;
}

/** The notice once the free credits ran out during a visit (or the visitor used their share for today). */
export const POOL_EMPTY_NOTICE = 'The free credits are used up. Sign in to keep playing on your own Opper account.';

/** The free credits as the header shows them, e.g. "$84.12". */
export const poolAmount = (usd: number | null): string | null => (usd === null ? null : `$${usd.toFixed(2)}`);

/** Updates the free-credits amount in the header in place (no re-render, so nothing is announced). */
export function updatePoolAmount(root: HTMLElement, usd: number | null): void {
  const credits = root.querySelector<HTMLElement>('.credits:not(.empty)');
  const amount = poolAmount(usd);
  if (credits && amount && credits.textContent !== amount) {
    credits.textContent = amount;
    credits.setAttribute('aria-label', `${amount} free credits. ${credits.dataset.tip ?? ''}`);
  }
}

/** Closes a signed-in player's menu when the page is clicked anywhere else (registered once, on first render). */
let menuCloser = false;
function closeMenusOnOutsideClick(): void {
  if (menuCloser) return;
  menuCloser = true;
  document.addEventListener('click', (e) => {
    for (const menu of document.querySelectorAll<HTMLDetailsElement>('details.user-menu[open]')) {
      if (!menu.contains(e.target as Node)) menu.open = false;
    }
  });
}

/** The notice for a player whose Opper wallet ran dry (HTTP 402 from /api/decide). */
export function walletNotice(walletUrl: string): { notice: string; noticeLink: string } {
  return { notice: 'Your Opper wallet is empty — top up to keep playing', noticeLink: httpsUrl(walletUrl) };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function signInButton(me: Me): HTMLButtonElement {
  const b = el('button', 'Sign in with Opper', 'signin');
  b.disabled = !me.loginAvailable;
  b.title = me.loginAvailable ? 'To watch the AI play live or face AI ghosts; calls bill your own Opper wallet' : 'Login with Opper is not configured on this server';
  b.addEventListener('click', signIn);
  return b;
}

/**
 * The account area of the page header, kept short: who is signed in (or that a local key plays) and the one action
 * that matters, signing in. What signing in costs is explained in the Play dialog.
 */
export function renderAccount(root: HTMLElement, view: AccountView): void {
  const { me } = view;
  const text = el('div', undefined, 'account-text');
  const actions = el('div', undefined, 'account-actions');
  // With a notice, "Try again" takes the place of the view's own sign-in button.
  const retry = Boolean(view.notice) && view.kind !== 'player';
  if (view.kind === 'player') {
    // As on AI Roundtable: an initial, the name, and a menu with the wallet and signing out.
    const who = me.user?.name ?? me.user?.email ?? 'Opper user';
    const menu = el('details', undefined, 'user-menu');
    const summary = el('summary');
    summary.title = `${me.projectName ? `Project ${me.projectName}. ` : ''}You play on your own Opper account.`;
    summary.append(el('span', who.trim().charAt(0).toUpperCase() || '?', 'avatar'), el('span', who, 'name'), el('span', '', 'chevron'));
    const list = el('div', undefined, 'menu');
    const wallet = el('a', 'Wallet ↗');
    wallet.href = me.walletUrl;
    wallet.target = '_blank';
    wallet.rel = 'noopener';
    const out = el('button', 'Sign out');
    out.type = 'button';
    out.addEventListener('click', () => void signOut());
    list.append(wallet, out);
    menu.append(summary, list);
    text.append(menu);
    closeMenusOnOutsideClick();
  } else if (view.kind === 'pool' || view.kind === 'pool-empty') {
    // Signed out: the free credits' balance stands where a signed-in player's name goes, explained on hover.
    const empty = view.kind === 'pool-empty';
    const amount = empty ? '$0.00' : (poolAmount(me.pool?.remainingUsd ?? null) ?? 'Free');
    const credits = el('span', amount, empty ? 'credits empty' : 'credits');
    credits.tabIndex = 0;
    credits.dataset.tip = empty ? POOL_EMPTY_NOTICE : 'Free credits: a shared pool for everyone to try';
    credits.setAttribute('aria-label', `${amount} free credits. ${credits.dataset.tip}`);
    // The amount ticks down while people play; that is not news for a screen reader.
    credits.setAttribute('aria-live', 'off');
    text.append(credits);
    if (!retry || empty) actions.append(signInButton(me));
  } else if (view.kind === 'dev') {
    const p = el('p', undefined, 'status');
    p.append(el('span', 'Local key', 'badge'));
    p.title = me.devProvider === 'typesafe' ? 'Playing with your TypeSafe key from .env: calls go straight to TypeSafe.' : 'Playing with the local dev key from .env: calls go through Opper with your key.';
    text.append(p);
    if (me.loginAvailable && !retry) actions.append(signInButton(me));
  } else {
    // Demo, the free game, or signed out: one quiet sign-in (Play is the page's main action).
    if (view.kind === 'signed-out') text.append(el('p', 'Signed out', 'status'));
    if (!retry) actions.append(signInButton(me));
  }
  if (view.notice) {
    // No role="alert": the account area itself is an aria-live="polite" region.
    const notice = el('p', undefined, 'notice');
    if (view.noticeLink) {
      const link = el('a', `${view.notice} ↗`);
      link.href = view.noticeLink;
      link.target = '_blank';
      link.rel = 'noopener';
      notice.append(link);
    } else notice.textContent = view.notice;
    text.append(notice);
    if (retry) {
      const again = signInButton(me);
      again.textContent = 'Try again';
      actions.prepend(again);
    }
  }
  root.dataset.kind = view.kind;
  root.replaceChildren(text, ...(actions.childElementCount ? [actions] : []));
}

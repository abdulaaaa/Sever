// Matching, schedules and other shared helpers.
import { DEFAULT_BLOCKS, DEFAULT_SETTINGS, DEFAULT_FOCUS_CONFIG } from './defaults';
import { DEV_MODE, EXTRA_SITES } from './config';
import { watchTokens, watchSquash, watchMatch, type WatchTerm } from './watch';
import type {
  Block,
  Schedule,
  Settings,
  ExtensionState,
  DecisionResult,
  AttemptSummary,
  PendingUsage,
  AttemptRecord,
  Session,
  Cache,
  FocusState,
  FocusDay,
  TrackingState
} from '../types';

export const ALIASES: Record<string, string> = { 'twitter.com': 'x.com' };
const SUB = /^(www|m|mobile|old|new|web)\./;

export function normHost(h: string): string {
  h = (h || '').toLowerCase();
  while (SUB.test(h)) h = h.replace(SUB, '');
  return ALIASES[h] || h;
}

// "https://M.Facebook.com/Nadia.Anwar/?x=1" -> "facebook.com/nadia.anwar/"
export function normalize(url: string): string {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    return normHost(u.hostname) + u.pathname.toLowerCase();
  } catch {
    return '';
  }
}

// Turn whatever was typed or pasted into a target like "x.com/someone" or "x.com".
export function cleanTarget(input: string, kind: 'site' | 'page'): string | null {
  let s = (input || '').trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z]+:\/\//.test(s)) s = 'https://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = normHost(u.hostname);
  if (!host.includes('.')) return null;
  if (kind === 'site') return host;
  const path = u.pathname.replace(/\/+$/, '');
  return host + path;
}

export const isSiteTarget = (t: string): boolean => !t.includes('/');

// A site target matches the site and its subdomains. A page target matches the
// page and anything under it, on the site and its subdomains, but not a longer
// name (x.com/ab does not match x.com/abc). Kept in step with pageRegex.
export function matches(url: string, target: string): boolean {
  const n = normalize(url);
  if (!n) return false;
  const cut = n.indexOf('/');
  const onHost = (h: string): boolean => n.slice(0, cut) === h || n.slice(0, cut).endsWith('.' + h);
  if (isSiteTarget(target)) return onHost(target);
  const i = target.indexOf('/');
  const path = n.slice(cut);
  const want = target.slice(i);
  return onHost(target.slice(0, i)) && (path === want || path.startsWith(want + '/'));
}

export function domainsFor(host: string): string[] {
  return [host, ...Object.keys(ALIASES).filter((k) => ALIASES[k] === host)];
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Regular expression used by Chrome's built-in blocker for a page target.
export function pageRegex(target: string): string {
  const i = target.indexOf('/');
  const host = target.slice(0, i);
  const path = target.slice(i);
  return (
    '^https?://([a-z0-9-]+\\.)*(' +
    domainsFor(host).map(esc).join('|') +
    ')' +
    esc(path) +
    '([/?#]|$)'
  );
}

// ---------- schedules ----------
const mins = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

export function schedActive(s: Schedule | null, date: Date = new Date()): boolean {
  if (!s) return false;
  const days = s.days && s.days.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
  const st = mins(s.start),
    en = mins(s.end);
  const now = date.getHours() * 60 + date.getMinutes();
  const d = date.getDay(),
    y = (d + 6) % 7;
  if (st === en) return days.includes(d);
  if (st < en) return days.includes(d) && now >= st && now < en;
  return (days.includes(d) && now >= st) || (days.includes(y) && now < en);
}

export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const n = h % 12 === 0 ? 12 : h % 12;
  return `${n}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function daysLabel(days: number[] | undefined): string {
  const d = [...new Set(days && days.length ? days : [0, 1, 2, 3, 4, 5, 6])].sort();
  const key = d.join('');
  if (key === '0123456') return 'every day';
  if (key === '12345') return 'on weekdays';
  if (key === '06') return 'on weekends';
  return (
    'on ' +
    [1, 2, 3, 4, 5, 6, 0]
      .filter((x) => d.includes(x))
      .map((x) => DAY_NAMES[x])
      .join(', ')
  );
}

export const scheduleLabel = (s: Schedule): string =>
  `${timeLabel(s.start)} to ${timeLabel(s.end)}, ${daysLabel(s.days)}`;

// ---------- settings lock ----------
export function isSettingsLocked(settings: Settings, date: Date = new Date()): boolean {
  if (DEV_MODE) return false; // Dev mode bypasses lock
  if (!settings.settings_unlock_schedule) return false; // No schedule = never locked
  return !schedActive(settings.settings_unlock_schedule, date); // Locked when NOT in unlock window
}

export function nextUnlockTime(schedule: Schedule, now: Date = new Date()): string {
  const days = schedule.days && schedule.days.length ? schedule.days : [0, 1, 2, 3, 4, 5, 6];
  const st = mins(schedule.start);
  const currentDay = now.getDay();
  const currentMins = now.getHours() * 60 + now.getMinutes();

  // Check if unlock is later today
  if (days.includes(currentDay) && currentMins < st) {
    return `today at ${timeLabel(schedule.start)}`;
  }

  // Find the next day in the schedule
  for (let i = 1; i <= 7; i++) {
    const checkDay = (currentDay + i) % 7;
    if (days.includes(checkDay)) {
      const dayName = DAY_NAMES[checkDay];
      if (i === 1) return `tomorrow at ${timeLabel(schedule.start)}`;
      return `${dayName} at ${timeLabel(schedule.start)}`;
    }
  }

  return timeLabel(schedule.start);
}

// ---------- dates and counts ----------
export function dayKey(date: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function summarize(times: number[] = [], now: Date = new Date()): AttemptSummary {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const week = new Date(today);
  week.setDate(week.getDate() - ((week.getDay() + 6) % 7));
  return {
    total: times.length,
    today: times.filter((t) => t >= today.getTime()).length,
    week: times.filter((t) => t >= week.getTime()).length
  };
}

// ---------- current state ----------
interface StorageData {
  cache?: Cache;
  pendingUsage?: PendingUsage;
  pendingAttempts?: AttemptRecord[];
  session?: Session;
  lastError?: string;
  syncedAt?: number;
  focus?: FocusState;
}

export async function loadState(): Promise<ExtensionState> {
  const s = (await chrome.storage.local.get([
    'cache',
    'pendingUsage',
    'pendingAttempts',
    'session',
    'lastError',
    'syncedAt',
    'focus'
  ])) as StorageData;

  const blocks = s.cache?.blocks ?? DEFAULT_BLOCKS;
  const settings = s.cache?.settings ?? DEFAULT_SETTINGS;
  const day = dayKey();
  const serverUsed = s.cache?.usage?.day === day ? s.cache.usage.seconds : 0;
  const pending = (s.pendingUsage || {})[day] || 0;
  const used = serverUsed + pending;
  const limit = settings.daily_limit_minutes * 60;

  return {
    blocks,
    settings,
    used,
    limit,
    out: used >= limit,
    session: s.session || null,
    pendingAttempts: s.pendingAttempts || [],
    lastError: s.lastError || null,
    syncedAt: s.syncedAt || null,
    usingDefaults: !s.cache,
    focus: s.focus || null,
    focusConfig: { ...DEFAULT_FOCUS_CONFIG, ...settings.focus_config }
  };
}

// The budget site this address belongs to, e.g. "instagram.com", or null.
export function budgetSiteFor(url: string, settings: Settings): string | null {
  return settings.budget_sites.map(normHost).find((d) => matches(url, d)) ?? null;
}

export function isBudgetSite(url: string, settings: Settings): boolean {
  return budgetSiteFor(url, settings) !== null;
}

// The tracked-only site this address belongs to, e.g. "youtube.com", or null.
export function extraSiteFor(url: string): string | null {
  return EXTRA_SITES.find((d) => matches(url, d)) ?? null;
}

// ---------- people watch ----------
const PROFILE_PREFIXES = new Set([
  'in',
  'u',
  'user',
  'users',
  'people',
  'profile',
  'profiles',
  'channel',
  'c',
  'pub'
]);
const SEARCH_PARAMS = [
  'q',
  'query',
  'search_query',
  'keywords',
  'keyword',
  'k',
  'p',
  'text',
  'search',
  's',
  'term',
  'wd'
];
const SEARCH_HOSTS = [
  'bing.com',
  'duckduckgo.com',
  'yahoo.com',
  'brave.com',
  'ecosia.org',
  'startpage.com',
  'youtube.com',
  'kagi.com',
  'yandex.com',
  'baidu.com'
];

type WatchState = Pick<ExtensionState, 'blocks' | 'settings'>;

// "/in/jane-doe/details" -> "jane-doe"
function profileName(path: string): string {
  const segs = path.split('/').filter(Boolean);
  return (PROFILE_PREFIXES.has(segs[0]) ? segs[1] : segs[0]) || '';
}

// Everything that counts as looking a blocked person up: their full name,
// the usernames in their blocked links, and any extra terms from settings.
// A first name on its own is never a term.
export function watchTerms(st: WatchState): WatchTerm[] {
  const out: WatchTerm[] = [];
  const seen = new Set<string>();
  const add = (b: Block, raw: string, min: number): void => {
    const term = watchSquash(raw);
    if (term.length < min || seen.has(term)) return;
    seen.add(term);
    out.push({ person: b.person!, id: b.id, term });
  };

  for (const b of st.blocks) {
    if (!b.person || b.kind === 'allow') continue;
    const words = watchTokens(b.person);
    if (words.length > 1) {
      add(b, words.join(' '), 5);
      add(b, [...words].reverse().join(' '), 5);
      add(b, words[0] + words[words.length - 1], 5);
      add(b, words[words.length - 1] + words[0], 5);
    }
    const i = b.target.indexOf('/');
    if (i > 0) add(b, profileName(b.target.slice(i)), 4);
    for (const extra of st.settings.person_terms?.[b.person] || []) add(b, extra, 3);
  }
  return out;
}

// Sites where profile addresses and typing are checked: the daily-limit
// sites and any site a blocked person's page is on.
function watchHosts(st: WatchState): string[] {
  const hosts = st.blocks.filter((b) => b.person).map((b) => b.target.split('/')[0]);
  return [...new Set([...st.settings.budget_sites.map(normHost), ...hosts])];
}

// Should typing be checked on this page? Search engines and social sites only.
export function isWatchScope(url: string, st: WatchState): boolean {
  const n = normalize(url);
  if (!n) return false;
  const host = n.slice(0, n.indexOf('/'));
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return true;
  return [...SEARCH_HOSTS, ...watchHosts(st)].some((h) => host === h || host.endsWith('.' + h));
}

// Is this address a search for a blocked person, or a profile that resembles one?
export function watchUrl(url: string, st: WatchState): WatchTerm | null {
  const terms = watchTerms(st);
  if (!terms.length) return null;
  try {
    const u = new URL(url);
    for (const p of SEARCH_PARAMS) {
      const hit = watchMatch(u.searchParams.get(p) || '', terms);
      if (hit) return hit;
    }
    if (watchHosts(st).some((h) => matches(url, h))) {
      for (const seg of decodeURIComponent(u.pathname).split('/')) {
        const hit = watchMatch(seg, terms);
        if (hit) return hit;
      }
    }
  } catch {
    return null;
  }
  return null;
}

// ---------- lock-in mode ----------
const YOUTUBE = 'youtube.com';
// The only parts of YouTube closed during a session; search and watching stay open.
// Feed pages, Shorts, and a channel's Shorts tab ("/@name/shorts").
export const FOCUS_YT_BLOCKED = '(feed|shorts|[^?#]*/shorts)';
const FOCUS_YT_RE = new RegExp(`^([a-z0-9-]+\\.)*youtube\\.com/${FOCUS_YT_BLOCKED}(/|$)`);

export const isYouTube = (url: string): boolean => matches(url, YOUTUBE);

// What to count time against while this address is in front, or null for nothing.
export function trackingFor(
  url: string | null,
  st: Pick<ExtensionState, 'settings' | 'out' | 'focus'>,
  now: number
): TrackingState | null {
  if (!url) return null;
  // YouTube while the timer runs is logged with the session, not counted against the daily limit.
  if (st.focus?.phase === 'focus' && isYouTube(url)) return { since: now, focusVideo: true };
  const site = budgetSiteFor(url, st.settings);
  if (site) return st.out ? null : { since: now, site };
  const extra = extraSiteFor(url);
  return extra ? { since: now, site: extra, extra: true } : null;
}

// "https://www.youtube.com/watch?v=abc&t=158s" -> "abc"
export function videoId(link: string): string | null {
  try {
    const u = new URL(link);
    if (normHost(u.hostname) === 'youtu.be') return u.pathname.slice(1) || null;
    if (!isYouTube(link)) return null;
    // "/watch?v=ID", or "/live/ID", "/shorts/ID", "/embed/ID"
    return (
      u.searchParams.get('v') || u.pathname.match(/^\/(live|shorts|embed)\/([\w-]+)/)?.[2] || null
    );
  } catch {
    return null;
  }
}

export const FOCUS_KEYS = [
  'seconds',
  'sessions',
  'video',
  'done',
  'partly',
  'pulled',
  'early'
] as const;

export const emptyFocusDay = (): FocusDay => ({
  seconds: 0,
  sessions: 0,
  video: 0,
  done: 0,
  partly: 0,
  pulled: 0,
  early: 0
});

// Time left in the current phase, in ms.
export function focusLeft(f: FocusState, now: number = Date.now()): number {
  return Math.max(0, f.phase === 'paused' ? f.remainingMs || 0 : f.endsAt - now);
}

// Sites blocked for a whole session: the daily-limit sites, the lock-in list,
// and whatever was on either when the session started. YouTube itself is
// handled on its own.
export function focusSites(
  st: Pick<ExtensionState, 'settings' | 'focusConfig' | 'focus'>
): string[] {
  const all = [...st.settings.budget_sites, ...st.focusConfig.sites, ...(st.focus?.sites || [])];
  return [...new Set(all.map(normHost))].filter((d) => d !== YOUTUBE);
}

// What should happen to this address right now?
// Returns null (allowed), { id } for a block, { focus: true } or { budget: true }.
export function decide(
  url: string,
  st: ExtensionState,
  date: Date = new Date()
): DecisionResult | null {
  if (!normalize(url)) return null;
  const { blocks, settings, out } = st;
  if (blocks.some((b) => b.kind === 'allow' && matches(url, b.target))) return null;
  const always = blocks.filter((b) => b.kind !== 'allow' && !b.schedule);
  always.sort((a, b) => (b.person ? 1 : 0) - (a.person ? 1 : 0));
  for (const b of always) if (matches(url, b.target)) return { id: b.id };
  for (const b of blocks) {
    if (b.kind !== 'allow' && b.schedule && schedActive(b.schedule, date) && matches(url, b.target))
      return { id: b.id };
  }
  const hit = watchUrl(url, st);
  if (hit) return { id: hit.id, watch: true };
  if (st.focus) {
    const yt = isYouTube(url);
    if (focusSites(st).some((d) => matches(url, d)) || (yt && FOCUS_YT_RE.test(normalize(url))))
      return { focus: true };
    // While the timer runs, YouTube is for work and ignores the daily limit.
    if (yt && st.focus.phase === 'focus') return null;
  }
  if (out && isBudgetSite(url, settings)) return { budget: true };
  return null;
}

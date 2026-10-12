import { DEFAULT_BLOCKS, DEFAULT_SETTINGS } from '../lib/utils/defaults';
import {
  loadState,
  decide,
  matches,
  isBudgetSite,
  trackingFor,
  watchTerms,
  isWatchScope,
  isYouTube,
  videoId,
  focusLeft,
  focusSites,
  FOCUS_YT_BLOCKED,
  FOCUS_KEYS,
  emptyFocusDay,
  domainsFor,
  pageRegex,
  isSiteTarget,
  schedActive,
  dayKey
} from '../lib/utils/common';
import {
  fetchBlocks,
  fetchSettings,
  fetchUsage,
  insertBlocks,
  insertSettings,
  addUsage,
  addSiteUsage,
  addFocus,
  flushPendingAttempts
} from '../lib/services/supa';
import type {
  ExtensionState,
  DecisionResult,
  PendingUsage,
  PendingSiteUsage,
  AttemptRecord,
  TrackingState,
  FocusState,
  FocusUnrated,
  FocusDay,
  FocusLog,
  WarnedState
} from '../lib/types';

const TICK_CAP_MS = 75_000; // never count more than this between two checks (sleep, etc.)

// Run tasks one at a time so they never trip over each other.
let queue: Promise<void> = Promise.resolve();
const serial = (fn: () => Promise<void>): Promise<void> =>
  (queue = queue.then(fn, fn).catch((e) => console.warn('Sever:', e)));

// ---------- syncing with Supabase ----------
async function flushPending(): Promise<number | null> {
  const data = (await chrome.storage.local.get(['pendingAttempts', 'pendingUsage'])) as {
    pendingAttempts?: AttemptRecord[];
    pendingUsage?: PendingUsage;
  };
  const pendingAttempts = data.pendingAttempts || [];
  const pendingUsage = data.pendingUsage || {};

  if (pendingAttempts.length) {
    await flushPendingAttempts(pendingAttempts);
    await chrome.storage.local.set({ pendingAttempts: [] });
  }

  let latest: number | null = null;
  for (const day of Object.keys(pendingUsage)) {
    while (pendingUsage[day] >= 1) {
      const send = Math.min(600, Math.floor(pendingUsage[day]));
      const total = await addUsage(day, send);
      pendingUsage[day] -= send;
      await chrome.storage.local.set({ pendingUsage });
      if (day === dayKey()) latest = total;
    }
    if (day !== dayKey()) delete pendingUsage[day];
  }
  await chrome.storage.local.set({ pendingUsage });
  return latest;
}

// Per-site time for the analytics page. Kept apart from flushPending so a
// failure here never holds up the daily limit.
async function flushSiteUsage(): Promise<void> {
  const { pendingSiteUsage = {} } = (await chrome.storage.local.get('pendingSiteUsage')) as {
    pendingSiteUsage?: PendingSiteUsage;
  };

  for (const day of Object.keys(pendingSiteUsage)) {
    for (const site of Object.keys(pendingSiteUsage[day])) {
      const send = Math.floor(pendingSiteUsage[day][site]);
      if (send < 1) continue;
      await addSiteUsage(day, site, send);
      pendingSiteUsage[day][site] -= send;
      await chrome.storage.local.set({ pendingSiteUsage });
    }
    if (day !== dayKey()) delete pendingSiteUsage[day];
  }
  await chrome.storage.local.set({ pendingSiteUsage });
}

// Lock-in history. Like flushSiteUsage, a failure here never holds up the daily limit.
async function flushFocus(): Promise<void> {
  const { pendingFocus = {}, focusLog } = (await chrome.storage.local.get([
    'pendingFocus',
    'focusLog'
  ])) as {
    pendingFocus?: FocusLog;
    focusLog?: FocusLog;
  };

  // History recorded before it was synced.
  if (focusLog) {
    for (const [day, d] of Object.entries(focusLog)) {
      const p = (pendingFocus[day] ||= emptyFocusDay());
      for (const k of FOCUS_KEYS) p[k] += d[k] || 0;
    }
    await chrome.storage.local.set({ pendingFocus });
    await chrome.storage.local.remove('focusLog');
  }

  for (const day of Object.keys(pendingFocus)) {
    const d = pendingFocus[day];
    const send = { ...d, seconds: Math.floor(d.seconds), video: Math.floor(d.video) };
    if (FOCUS_KEYS.some((k) => send[k] > 0)) {
      // Sent at least once: if the write below fails after a successful send,
      // the day is sent again and counted twice. Same trade-off as flushPending.
      await addFocus(day, send);
      pendingFocus[day] = {
        ...emptyFocusDay(),
        seconds: d.seconds - send.seconds,
        video: d.video - send.video
      };
      await chrome.storage.local.set({ pendingFocus });
    }
    if (day !== dayKey()) delete pendingFocus[day];
  }
  await chrome.storage.local.set({ pendingFocus });
}

async function sync(): Promise<void> {
  try {
    // Move counts from the previous version into the database.
    const { visits } = (await chrome.storage.local.get('visits')) as {
      visits?: Record<string, number[]>;
    };
    if (visits) {
      const { pendingAttempts = [] } = (await chrome.storage.local.get('pendingAttempts')) as {
        pendingAttempts?: AttemptRecord[];
      };
      for (const [target, times] of Object.entries(visits)) {
        for (const t of times) pendingAttempts.push({ target, at: new Date(t).toISOString() });
      }
      await chrome.storage.local.set({ pendingAttempts });
      await chrome.storage.local.remove('visits');
    }

    await flushPending();
    await flushSiteUsage().catch((e) => console.warn('Sever: site usage not synced:', e));
    await flushFocus().catch((e) => console.warn('Sever: lock-in history not synced:', e));
    const day = dayKey();
    let [blocks, settingsRows, usageRows] = await Promise.all([
      fetchBlocks(),
      fetchSettings(),
      fetchUsage(day)
    ]);

    // First sign-in ever: copy the starting blocks and settings into the database.
    if (!settingsRows.length) {
      if (!blocks.length) {
        const rows = DEFAULT_BLOCKS.map(({ id, ...b }) => b);
        blocks = await insertBlocks(rows);
      }
      settingsRows = await insertSettings([DEFAULT_SETTINGS]);
    }

    const s = settingsRows[0];
    await chrome.storage.local.set({
      cache: {
        blocks,
        settings: {
          daily_limit_minutes: s.daily_limit_minutes,
          budget_sites: s.budget_sites,
          settings_unlock_schedule: s.settings_unlock_schedule || null,
          person_terms: s.person_terms || {},
          focus_config: s.focus_config || {}
        },
        usage: { day, seconds: usageRows[0]?.seconds || 0 }
      },
      syncedAt: Date.now(),
      lastError: null
    });
  } catch (e) {
    await chrome.storage.local.set({ lastError: String((e as Error).message || e) });
  }
}

// ---------- blocking rules ----------
type ResourceType = chrome.declarativeNetRequest.ResourceType;

interface RuleCondition {
  requestDomains?: string[];
  regexFilter?: string;
  resourceTypes: ResourceType[];
}

const condition = (target: string): RuleCondition =>
  isSiteTarget(target)
    ? { requestDomains: domainsFor(target), resourceTypes: ['main_frame' as ResourceType] }
    : { regexFilter: pageRegex(target), resourceTypes: ['main_frame' as ResourceType] };

const redirect = (query: string): chrome.declarativeNetRequest.RuleAction => ({
  type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
  redirect: { extensionPath: `/src/pages/blocked/index.html?${query}` }
});

async function applyRules(st: ExtensionState): Promise<void> {
  const now = new Date();
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  let id = 1;

  for (const b of st.blocks) {
    if (b.kind === 'allow') {
      rules.push({
        id: id++,
        priority: 100,
        action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
        condition: condition(b.target)
      });
    } else if (!b.schedule) {
      rules.push({
        id: id++,
        priority: b.person ? 60 : 50,
        action: redirect(`id=${b.id}`),
        condition: condition(b.target)
      });
    } else if (schedActive(b.schedule, now)) {
      rules.push({
        id: id++,
        priority: 20,
        action: redirect(`id=${b.id}`),
        condition: condition(b.target)
      });
    }
  }

  if (st.out) {
    const domains = [...new Set(st.settings.budget_sites.flatMap((d) => domainsFor(d)))];
    if (domains.length) {
      rules.push({
        id: id++,
        priority: 10,
        action: redirect('budget=1'),
        condition: { requestDomains: domains, resourceTypes: ['main_frame' as ResourceType] }
      });
    }
  }

  if (st.focus) {
    const domains = [...new Set(focusSites(st).flatMap((d) => domainsFor(d)))];
    if (domains.length) {
      rules.push({
        id: id++,
        priority: 15,
        action: redirect('focus=1'),
        condition: { requestDomains: domains, resourceTypes: ['main_frame' as ResourceType] }
      });
    }
    rules.push({
      id: id++,
      priority: 15,
      action: redirect('focus=1'),
      condition: {
        regexFilter: `^https?://([a-z0-9-]+\\.)*youtube\\.com/${FOCUS_YT_BLOCKED}([/?#]|$)`,
        resourceTypes: ['main_frame' as ResourceType]
      }
    });
    // While the timer runs, the rest of YouTube stays open even with the daily limit used up.
    if (st.focus.phase === 'focus') {
      rules.push({
        id: id++,
        priority: 12,
        action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
        condition: {
          requestDomains: ['youtube.com'],
          resourceTypes: ['main_frame' as ResourceType]
        }
      });
    }
  }

  const key = JSON.stringify(rules);
  const { rulesKey } = (await chrome.storage.session.get('rulesKey')) as { rulesKey?: string };
  if (key === rulesKey) return;

  const old = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map((r) => r.id),
    addRules: rules
  });
  await chrome.storage.session.set({ rulesKey: key });
}

const blockedUrl = (d: DecisionResult, extra: string = ''): string =>
  chrome.runtime.getURL(
    'src/pages/blocked/index.html?' +
      (d.focus ? 'focus=1' : d.budget ? 'budget=1' : `id=${d.id}`) +
      (d.watch ? '&w=1' : '') +
      extra
  );

// Send tabs that are already open to the blocked screen if they're now blocked.
async function sweep(st: ExtensionState): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  const audio = await audioTabId();
  for (const tab of tabs) {
    // The session's audio tab keeps playing through a pause, whatever the daily limit says.
    if (!tab.url || !tab.id || tab.id === audio || (st.focus && tab.url.endsWith(AUDIO_MARK)))
      continue;
    const d = decide(tab.url, st);
    if (d) chrome.tabs.update(tab.id, { url: blockedUrl(d, '&n=1') }).catch(() => {});
  }
}

// ---------- social media time ----------
// The address in the focused tab right now, or null if time shouldn't count.
async function activeUrl(st: ExtensionState): Promise<string | null> {
  const idle = await chrome.idle.queryState(60);
  if (idle !== 'active') return null;
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (!win || !win.focused) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab?.url || decide(tab.url, st)) return null;
  if (st.blocks.some((b) => b.kind === 'allow' && matches(tab.url!, b.target))) return null;
  return tab.url;
}

async function track(): Promise<ExtensionState> {
  const now = Date.now();
  const { tracking } = (await chrome.storage.session.get('tracking')) as {
    tracking?: TrackingState;
  };

  if (tracking) {
    const secs = Math.min(now - tracking.since, TICK_CAP_MS) / 1000;
    if (secs > 0 && tracking.focusVideo) {
      await logFocus((d) => {
        d.video += secs;
      });
    } else if (secs > 0) {
      const { pendingUsage = {}, pendingSiteUsage = {} } = (await chrome.storage.local.get([
        'pendingUsage',
        'pendingSiteUsage'
      ])) as {
        pendingUsage?: PendingUsage;
        pendingSiteUsage?: PendingSiteUsage;
      };
      const day = dayKey();
      // YouTube and WhatsApp are recorded per site only, so they never use up the daily limit.
      if (!tracking.extra) pendingUsage[day] = (pendingUsage[day] || 0) + secs;
      if (tracking.site) {
        const sites = (pendingSiteUsage[day] ||= {});
        sites[tracking.site] = (sites[tracking.site] || 0) + secs;
      }
      await chrome.storage.local.set({ pendingUsage, pendingSiteUsage });
    }
  }

  const st = await loadState();
  const url = await activeUrl(st);
  await chrome.storage.session.set({ tracking: trackingFor(url, st, now) });
  return st;
}

// Is time being counted against the daily limit right now?
const countingNow = (t?: TrackingState | null): boolean => !!t && !t.focusVideo && !t.extra;

// ---------- lock-in mode ----------
const ICON = chrome.runtime.getURL('src/assets/icons/128.png');
const PAUSE_NAG_MS = 10 * 60_000;
const BEAT_MS = 60_000; // the heartbeat is written by the one-minute tick
const OVERDUE_MS = 2 * 60_000; // a timer that ran out this long ago ended with the browser closed or asleep
const AUDIO_MARK = '#sever-audio'; // on the audio tab's address; the content script looks for it too

const notify = (id: string, title: string, message: string): void => {
  chrome.notifications.create(id, { type: 'basic', iconUrl: ICON, title, message });
};

async function getFocus(): Promise<FocusState | null> {
  const { focus } = (await chrome.storage.local.get('focus')) as { focus?: FocusState | null };
  return focus || null;
}

// The tab playing the session's audio. Kept in session storage so it is
// forgotten when the browser restarts: tab ids are only unique within one run.
async function audioTabId(): Promise<number | null> {
  const { focusAudioTab } = (await chrome.storage.session.get('focusAudioTab')) as {
    focusAudioTab?: number;
  };
  return focusAudioTab ?? null;
}

async function closeAudioTab(): Promise<void> {
  const id = await audioTabId();
  await chrome.storage.session.remove('focusAudioTab');
  const known = id === null ? null : await chrome.tabs.get(id).catch(() => null);
  // After a browser restart the id is gone but the tab may have been restored: find it by its marker.
  const marked = await chrome.tabs.query({ url: '*://*.youtube.com/*' }).catch(() => []);
  for (const tab of [known, ...marked.filter((t) => t.url?.endsWith(AUDIO_MARK))]) {
    // Only if it's still on YouTube: the tab may have been put to another use.
    if (tab?.id !== undefined && tab.url && isYouTube(tab.url))
      chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// Queue a change to a day's lock-in history (today by default); it is sent to
// the database on the next sync. `also` is saved in the same write, so a
// session's state and its history entry can never get out of step.
async function logFocus(
  change: (d: FocusDay) => void,
  day: string = dayKey(),
  also: Record<string, unknown> = {}
): Promise<void> {
  const { pendingFocus = {} } = (await chrome.storage.local.get('pendingFocus')) as {
    pendingFocus?: FocusLog;
  };
  change((pendingFocus[day] ||= emptyFocusDay()));
  await chrome.storage.local.set({ pendingFocus, ...also });
}

async function focusStart(task: string, minutes: number): Promise<void> {
  if (await getFocus()) return;
  const st = await loadState();
  const totalMs =
    Math.min(480, Math.max(1, Math.round(minutes) || st.focusConfig.minutes)) * 60_000;
  const now = Date.now();

  await chrome.storage.local.set({
    // The blocked sites are fixed here, so removing one from settings mid-session doesn't open it.
    focus: {
      task: task.slice(0, 80),
      totalMs,
      phase: 'focus',
      endsAt: now + totalMs,
      sites: focusSites(st)
    },
    focusBeat: now,
    focusUnrated: null
  });
  await chrome.alarms.create('focus', { when: now + totalMs });
  await refresh({ doSync: false });

  // The session's audio: the saved video from the start, in a pinned background
  // tab. Opened after the rules are in place, so it isn't caught by a block the session lifts.
  const id = videoId(st.focusConfig.video);
  if (!id) return;
  const tab = await chrome.tabs
    .create({
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${AUDIO_MARK}`,
      active: false,
      pinned: true
    })
    .catch(() => null);
  if (tab?.id !== undefined) await chrome.storage.session.set({ focusAudioTab: tab.id });
}

async function focusPause(): Promise<void> {
  const f = await getFocus();
  if (f?.phase !== 'focus') return;
  await chrome.storage.local.set({
    focus: { ...f, phase: 'paused', remainingMs: focusLeft(f), pausedAt: Date.now() }
  });
  await chrome.alarms.clear('focus');
  await chrome.alarms.create('focusNag', { when: Date.now() + PAUSE_NAG_MS });
  await refresh({ doSync: false, doSweep: false });
}

async function focusResume(): Promise<void> {
  const f = await getFocus();
  if (f?.phase !== 'paused') return;
  const now = Date.now();
  const endsAt = now + focusLeft(f);
  await chrome.storage.local.set({
    focus: { ...f, phase: 'focus', endsAt, remainingMs: undefined, pausedAt: undefined },
    focusBeat: now
  });
  await chrome.alarms.clear('focusNag');
  await chrome.alarms.create('focus', { when: endsAt });
  await refresh({ doSync: false, doSweep: false });
}

// End the focus part of a session: early (no break) or because the timer ran out.
async function focusFinish(early: boolean): Promise<void> {
  const f = await getFocus();
  if (!f || f.phase === 'break') return;
  const now = Date.now();
  let left = focusLeft(f, now);
  let day = dayKey();
  let stopped = Math.min(now, f.endsAt); // when the timer stopped running

  // The timer ran out a while ago, with the browser closed or asleep. Count
  // only the time up to the last heartbeat, under the day it stopped, and skip the break.
  const overdue = f.phase === 'focus' && now - f.endsAt > OVERDUE_MS;
  if (overdue) {
    const { focusBeat } = (await chrome.storage.local.get('focusBeat')) as { focusBeat?: number };
    const seen = Math.min(f.endsAt, (focusBeat ?? f.endsAt) + BEAT_MS);
    left = f.endsAt - seen;
    day = dayKey(new Date(seen));
    stopped = seen;
  }
  // Ending in the moment after the timer ran out isn't ending early.
  if (left === 0) early = false;

  const { focusConfig } = await loadState();
  const breakMs = (Number(focusConfig.breakMinutes) || 0) * 60_000;
  const next: FocusState | null =
    early || overdue || breakMs <= 0
      ? null
      : { task: f.task, totalMs: f.totalMs, phase: 'break', endsAt: now + breakMs, sites: f.sites };

  // Close off YouTube time here, at the moment the timer stopped, so the
  // track() that follows can't count the stretch after it.
  const { tracking } = (await chrome.storage.session.get('tracking')) as {
    tracking?: TrackingState;
  };
  let video = 0;
  if (tracking?.focusVideo) {
    video = Math.min(Math.max(0, stopped - tracking.since), TICK_CAP_MS) / 1000;
    await chrome.storage.session.set({ tracking: null });
  }

  await logFocus(
    (d) => {
      d.seconds += (f.totalMs - left) / 1000;
      d.video += video;
      d.sessions += 1;
      if (early) d.early += 1;
    },
    day,
    { focus: next, ...(early ? {} : { focusUnrated: { task: f.task, day } }) }
  );

  await closeAudioTab();
  await chrome.alarms.clear('focus');
  await chrome.alarms.clear('focusNag');
  if (next) {
    await chrome.alarms.create('focus', { when: next.endsAt });
    notify(
      'focus-done',
      'Session done',
      `"${f.task}": take a ${focusConfig.breakMinutes}-minute break.`
    );
  } else if (!early && !overdue) {
    notify('focus-done', 'Session done', `"${f.task}": time's up.`);
  }
  await refresh({ doSync: false });
}

async function focusBreakEnd(announce: boolean): Promise<void> {
  const f = await getFocus();
  if (f?.phase !== 'break') return;
  await chrome.storage.local.set({ focus: null });
  await chrome.alarms.clear('focus');
  if (announce) notify('focus-break', 'Break over', 'Ready for the next one?');
  await refresh({ doSync: false });
}

// Keep the heartbeat going, and move the session on if its timer has run out.
// Also catches up after the browser was closed.
async function focusTick(): Promise<void> {
  const f = await getFocus();
  if (!f || f.phase === 'paused') return;
  const now = Date.now();
  if (now < f.endsAt) {
    if (f.phase === 'focus') await chrome.storage.local.set({ focusBeat: now });
    return;
  }
  if (f.phase === 'focus') await focusFinish(false);
  else await focusBreakEnd(now - f.endsAt < OVERDUE_MS);
}

const focusTickSafe = (): Promise<void> =>
  focusTick().catch((e) => console.warn('Sever: lock-in check failed:', e));

// Format badge text - show MM:SS when under 10 min, otherwise just minutes
function formatBadge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 600) {
    // Under 10 minutes, show MM:SS
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
  return String(Math.ceil(s / 60)); // Just minutes
}

// Real-time badge ticker
let badgeInterval: ReturnType<typeof setInterval> | null = null;
let badgeStartTime: number | null = null;
let badgeStartRemaining: number = 0;

function startBadgeTicker(remaining: number): void {
  stopBadgeTicker();
  badgeStartTime = Date.now();
  badgeStartRemaining = remaining;

  badgeInterval = setInterval(async () => {
    const elapsed = (Date.now() - badgeStartTime!) / 1000;
    const current = Math.max(0, badgeStartRemaining - elapsed);
    const text = formatBadge(current);
    const mins = current / 60;
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({
      color: current === 0 ? '#b3261e' : mins <= 10 ? '#c26401' : '#5f6368'
    });
  }, 1000);
}

function stopBadgeTicker(): void {
  if (badgeInterval) {
    clearInterval(badgeInterval);
    badgeInterval = null;
  }
}

async function updateBadge(st: ExtensionState, isTracking: boolean = false): Promise<void> {
  // While locked in, the badge shows the session: minutes left, or || when paused.
  if (st.focus && st.focus.phase !== 'break') {
    stopBadgeTicker();
    const paused = st.focus.phase === 'paused';
    await chrome.action.setBadgeText({
      text: paused ? '||' : String(Math.ceil(focusLeft(st.focus) / 60_000))
    });
    await chrome.action.setBadgeBackgroundColor({ color: paused ? '#5f6368' : '#b4441f' });
    await chrome.action.setTitle({ title: `Sever: locked in on "${st.focus.task}"` });
    return;
  }

  const remaining = Math.max(0, st.limit - st.used);
  const left = Math.ceil(remaining / 60);

  if (isTracking && remaining > 0) {
    // Start real-time ticker
    startBadgeTicker(remaining);
  } else {
    // Stop ticker and show static badge
    stopBadgeTicker();
    const text = remaining < 600 ? formatBadge(remaining) : String(left);
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({
      color: left === 0 ? '#b3261e' : left <= 10 ? '#c26401' : '#5f6368'
    });
  }

  await chrome.action.setTitle({ title: `Sever: ${left} min of social media left today` });

  const day = dayKey();
  let { warned } = (await chrome.storage.local.get('warned')) as { warned?: WarnedState };
  if (!warned || warned.day !== day) warned = { day, list: [] };

  for (const m of [10, 5]) {
    if (left <= m && left > 0 && !warned.list.includes(m) && st.used > 0) {
      warned.list.push(m);
      chrome.notifications.create(`warn-${day}-${m}`, {
        type: 'basic',
        iconUrl: ICON,
        title: 'Social media time',
        message: `${left} minute${left === 1 ? '' : 's'} left today.`
      });
    }
  }
  await chrome.storage.local.set({ warned });
}

interface RefreshOptions {
  doSync?: boolean;
  doSweep?: boolean;
}

// Track, sync, refresh rules, sweep open tabs, update the badge.
async function refresh({ doSync = true, doSweep = true }: RefreshOptions = {}): Promise<void> {
  await track();
  if (doSync) await sync();
  const st = await loadState();
  await applyRules(st);
  if (doSweep) await sweep(st);
  const { tracking } = (await chrome.storage.session.get('tracking')) as {
    tracking?: TrackingState;
  };
  await updateBadge(st, countingNow(tracking));
}

// ---------- events ----------
async function ensureAlarm(): Promise<void> {
  if (!(await chrome.alarms.get('tick'))) {
    await chrome.alarms.create('tick', { periodInMinutes: 1 });
  }
}

chrome.idle.setDetectionInterval(60);

chrome.runtime.onInstalled.addListener(() => {
  serial(async () => {
    await ensureAlarm();
    await focusTickSafe();
    await refresh();
  });
});

chrome.runtime.onStartup.addListener(() => {
  serial(async () => {
    await ensureAlarm();
    await focusTickSafe();
    await refresh();
  });
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'tick') {
    serial(async () => {
      await focusTickSafe();
      await refresh();
    });
  }
  if (a.name === 'focus') serial(focusTickSafe);
  if (a.name === 'focusNag') {
    serial(async () => {
      const f = await getFocus();
      if (f?.phase === 'paused')
        notify(
          'focus-nag',
          'Still paused',
          `"${f.task}" has been paused for 10 minutes. Resume or end it from the Sever popup.`
        );
    });
  }
});

// Initial run
serial(async () => {
  await ensureAlarm();
  await focusTickSafe();
  await refresh({ doSync: false, doSweep: false });
});

// Time tracking follows what you're looking at.
const retrack = (): void => {
  serial(async () => {
    const before = await loadState();
    const st = await track();
    if (st.out !== before.out) await refresh({ doSync: false });
  });
};

chrome.tabs.onActivated.addListener(retrack);
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.url || info.status === 'complete') retrack();
});
chrome.windows.onFocusChanged.addListener(retrack);
chrome.idle.onStateChanged.addListener(retrack);

// Pages reached by clicking inside a site change the address without a new page load.
async function check(
  details: chrome.webNavigation.WebNavigationFramedCallbackDetails
): Promise<void> {
  if (details.frameId !== 0) return;
  const st = await loadState();
  const d = decide(details.url, st);
  if (d) chrome.tabs.update(details.tabId, { url: blockedUrl(d) }).catch(() => {});
}

const WEB: chrome.webNavigation.WebNavigationEventFilter = {
  url: [{ schemes: ['http', 'https'] }]
};

chrome.webNavigation.onHistoryStateUpdated.addListener(check, WEB);
chrome.webNavigation.onCommitted.addListener(check, WEB);

// Messages from the settings page and popup.
interface Message {
  type: string;
  id?: string;
  task?: string;
  minutes?: number;
  outcome?: 'done' | 'partly' | 'pulled';
}

chrome.runtime.onMessage.addListener(
  (
    msg: Message,
    sender: chrome.runtime.MessageSender,
    reply: (response: unknown) => void
  ): boolean | undefined => {
    if (msg?.type === 'sync') {
      serial(() => refresh()).then(() => reply({ ok: true }));
      return true;
    }

    if (msg?.type === 'getTimeLeft') {
      serial(async () => {
        const st = await loadState();
        const { tracking } = (await chrome.storage.session.get('tracking')) as {
          tracking?: TrackingState;
        };

        // Calculate live usage including time since last track() call
        let liveUsed = st.used;
        if (tracking && countingNow(tracking)) {
          const elapsed = (Date.now() - tracking.since) / 1000;
          liveUsed += Math.min(elapsed, TICK_CAP_MS / 1000);
        }

        const remaining = Math.max(0, st.limit - liveUsed);
        reply({
          remaining, // seconds (float) - live value
          limit: st.limit,
          used: liveUsed,
          out: liveUsed >= st.limit,
          tracking: countingNow(tracking)
        });
      });
      return true; // Keep channel open for async response
    }

    if (msg?.type === 'checkNow') {
      // Force immediate refresh when timer hits zero
      serial(() => refresh()).then(() => reply({ ok: true }));
      return true;
    }

    if (msg?.type === 'isTrackingNow') {
      // Check if we're currently tracking time (on a budget site)
      serial(async () => {
        const { tracking } = (await chrome.storage.session.get('tracking')) as {
          tracking?: TrackingState;
        };
        reply({ tracking: countingNow(tracking) });
      });
      return true;
    }

    // Lock-in mode. Changes are only accepted from the extension's own pages, never a content script.
    const ownPage = !!sender.url?.startsWith(chrome.runtime.getURL(''));
    if (msg?.type === 'focusStart' && ownPage) {
      serial(() => focusStart(String(msg.task || '').trim() || 'Focus', Number(msg.minutes))).then(
        () => reply({ ok: true })
      );
      return true;
    }
    if (
      (msg?.type === 'focusPause' ||
        msg?.type === 'focusResume' ||
        msg?.type === 'focusEnd' ||
        msg?.type === 'focusSkipBreak') &&
      ownPage
    ) {
      const act = {
        focusPause,
        focusResume,
        focusEnd: () => focusFinish(true),
        focusSkipBreak: () => focusBreakEnd(false)
      }[msg.type];
      serial(act).then(() => reply({ ok: true }));
      return true;
    }
    if (msg?.type === 'focusOutcome' && ownPage) {
      serial(async () => {
        const { focusUnrated } = (await chrome.storage.local.get('focusUnrated')) as {
          focusUnrated?: FocusUnrated | null;
        };
        const outcome = msg.outcome;
        if (!focusUnrated || !outcome || !['done', 'partly', 'pulled'].includes(outcome)) return;
        await logFocus(
          (d) => {
            d[outcome] += 1;
          },
          focusUnrated.day,
          { focusUnrated: null }
        );
      }).then(() => reply({ ok: true }));
      return true;
    }
    // From the lock-in content script: is this the tab playing the session's audio?
    if (msg?.type === 'focusTab') {
      audioTabId().then((id) => reply({ audio: id !== null && id === sender.tab?.id }));
      return true;
    }

    // From the typing check: which names to watch for on this page, if any.
    if (msg?.type === 'watchConfig') {
      serial(async () => {
        const st = await loadState();
        const url = sender.tab?.url || '';
        const allowed = st.blocks.some((b) => b.kind === 'allow' && matches(url, b.target));
        const active = !allowed && isWatchScope(url, st);
        reply({ active, terms: active ? watchTerms(st) : [] });
      });
      return true;
    }

    // A blocked person's name was typed into a page.
    if (msg?.type === 'watchHit') {
      if (sender.tab?.id && msg.id) {
        chrome.tabs
          .update(sender.tab.id, { url: blockedUrl({ id: msg.id, watch: true }) })
          .catch(() => {});
      }
      return undefined;
    }

    if (msg?.type === 'shouldShowCountdown') {
      serial(async () => {
        const st = await loadState();

        // Don't show if out of time, or while a lock-in session has its own pill
        if (st.out || st.focus) {
          reply({ show: false });
          return;
        }

        const url = sender.tab?.url;
        if (!url) {
          reply({ show: false });
          return;
        }

        // Check if URL is blocked (would show blocked page instead)
        const decision = decide(url, st);
        if (decision) {
          reply({ show: false });
          return;
        }

        // Check if URL is on an allow-list (never show countdown on allowed pages)
        if (st.blocks.some((b) => b.kind === 'allow' && matches(url, b.target))) {
          reply({ show: false });
          return;
        }

        // Only show on budget sites
        reply({ show: isBudgetSite(url, st.settings) });
      });
      return true;
    }

    return undefined;
  }
);

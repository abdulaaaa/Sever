import { DEFAULT_BLOCKS, DEFAULT_SETTINGS } from '../lib/utils/defaults';
import {
  loadState,
  decide,
  matches,
  isBudgetSite,
  budgetSiteFor,
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
  flushPendingAttempts
} from '../lib/services/supa';
import type {
  Block,
  Settings,
  ExtensionState,
  DecisionResult,
  PendingUsage,
  PendingSiteUsage,
  AttemptRecord,
  TrackingState,
  WarnedState
} from '../lib/types';

const TICK_CAP_MS = 75_000; // never count more than this between two checks (sleep, etc.)

// Run tasks one at a time so they never trip over each other.
let queue: Promise<void> = Promise.resolve();
const serial = (fn: () => Promise<void>): Promise<void> =>
  (queue = queue.then(fn, fn).catch((e) => console.warn("Sever:", e)));

// ---------- syncing with Supabase ----------
async function flushPending(): Promise<number | null> {
  const data = await chrome.storage.local.get(["pendingAttempts", "pendingUsage"]) as {
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
  const { pendingSiteUsage = {} } = await chrome.storage.local.get("pendingSiteUsage") as { pendingSiteUsage?: PendingSiteUsage };

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

async function sync(): Promise<void> {
  try {
    // Move counts from the previous version into the database.
    const { visits } = await chrome.storage.local.get("visits") as { visits?: Record<string, number[]> };
    if (visits) {
      const { pendingAttempts = [] } = await chrome.storage.local.get("pendingAttempts") as { pendingAttempts?: AttemptRecord[] };
      for (const [target, times] of Object.entries(visits)) {
        for (const t of times) pendingAttempts.push({ target, at: new Date(t).toISOString() });
      }
      await chrome.storage.local.set({ pendingAttempts });
      await chrome.storage.local.remove("visits");
    }

    await flushPending();
    await flushSiteUsage().catch((e) => console.warn("Sever: site usage not synced:", e));
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
          settings_unlock_schedule: s.settings_unlock_schedule || null
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
    ? { requestDomains: domainsFor(target), resourceTypes: ["main_frame" as ResourceType] }
    : { regexFilter: pageRegex(target), resourceTypes: ["main_frame" as ResourceType] };

const redirect = (query: string): chrome.declarativeNetRequest.RuleAction => ({
  type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
  redirect: { extensionPath: `/src/pages/blocked/index.html?${query}` }
});

async function applyRules(st: ExtensionState): Promise<void> {
  const now = new Date();
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  let id = 1;

  for (const b of st.blocks) {
    if (b.kind === "allow") {
      rules.push({ id: id++, priority: 100, action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW }, condition: condition(b.target) });
    } else if (!b.schedule) {
      rules.push({ id: id++, priority: b.person ? 60 : 50, action: redirect(`id=${b.id}`), condition: condition(b.target) });
    } else if (schedActive(b.schedule, now)) {
      rules.push({ id: id++, priority: 20, action: redirect(`id=${b.id}`), condition: condition(b.target) });
    }
  }

  if (st.out) {
    const domains = [...new Set(st.settings.budget_sites.flatMap((d) => domainsFor(d)))];
    if (domains.length) {
      rules.push({
        id: id++,
        priority: 10,
        action: redirect("budget=1"),
        condition: { requestDomains: domains, resourceTypes: ["main_frame" as ResourceType] }
      });
    }
  }

  const key = JSON.stringify(rules);
  const { rulesKey } = await chrome.storage.session.get("rulesKey") as { rulesKey?: string };
  if (key === rulesKey) return;

  const old = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map((r) => r.id),
    addRules: rules
  });
  await chrome.storage.session.set({ rulesKey: key });
}

const blockedUrl = (d: DecisionResult, extra: string = ""): string =>
  chrome.runtime.getURL("src/pages/blocked/index.html?" + (d.budget ? "budget=1" : `id=${d.id}`) + extra);

// Send tabs that are already open to the blocked screen if they're now blocked.
async function sweep(st: ExtensionState): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) {
    if (!tab.url || !tab.id) continue;
    const d = decide(tab.url, st);
    if (d) chrome.tabs.update(tab.id, { url: blockedUrl(d, "&n=1") }).catch(() => {});
  }
}

// ---------- social media time ----------
// The budget site in the focused tab right now, or null if time shouldn't count.
async function budgetSiteNow(st: ExtensionState): Promise<string | null> {
  const idle = await chrome.idle.queryState(60);
  if (idle !== "active") return null;
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (!win || !win.focused) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab?.url || decide(tab.url, st)) return null;
  if (st.blocks.some((b) => b.kind === "allow" && matches(tab.url!, b.target))) return null;
  return budgetSiteFor(tab.url, st.settings);
}

async function track(): Promise<ExtensionState> {
  const now = Date.now();
  const { tracking } = await chrome.storage.session.get("tracking") as { tracking?: TrackingState };

  if (tracking) {
    const secs = Math.min(now - tracking.since, TICK_CAP_MS) / 1000;
    if (secs > 0) {
      const { pendingUsage = {}, pendingSiteUsage = {} } = await chrome.storage.local.get(["pendingUsage", "pendingSiteUsage"]) as {
        pendingUsage?: PendingUsage;
        pendingSiteUsage?: PendingSiteUsage;
      };
      const day = dayKey();
      pendingUsage[day] = (pendingUsage[day] || 0) + secs;
      if (tracking.site) {
        const sites = (pendingSiteUsage[day] ||= {});
        sites[tracking.site] = (sites[tracking.site] || 0) + secs;
      }
      await chrome.storage.local.set({ pendingUsage, pendingSiteUsage });
    }
  }

  const st = await loadState();
  const site = st.out ? null : await budgetSiteNow(st);

  await chrome.storage.session.set({ tracking: site ? { since: now, site } : null });
  return st;
}

// Format badge text - show MM:SS when under 10 min, otherwise just minutes
function formatBadge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 600) { // Under 10 minutes, show MM:SS
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
      color: current === 0 ? "#b3261e" : mins <= 10 ? "#c26401" : "#5f6368"
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
      color: left === 0 ? "#b3261e" : left <= 10 ? "#c26401" : "#5f6368"
    });
  }

  await chrome.action.setTitle({ title: `Sever: ${left} min of social media left today` });

  const day = dayKey();
  let { warned } = await chrome.storage.local.get("warned") as { warned?: WarnedState };
  if (!warned || warned.day !== day) warned = { day, list: [] };

  for (const m of [10, 5]) {
    if (left <= m && left > 0 && !warned.list.includes(m) && st.used > 0) {
      warned.list.push(m);
      chrome.notifications.create(`warn-${day}-${m}`, {
        type: "basic",
        iconUrl: "icons/128.png",
        title: "Social media time",
        message: `${left} minute${left === 1 ? "" : "s"} left today.`
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
  const { tracking } = await chrome.storage.session.get("tracking") as { tracking?: TrackingState };
  await updateBadge(st, !!tracking);
}

// ---------- events ----------
async function ensureAlarm(): Promise<void> {
  if (!(await chrome.alarms.get("tick"))) {
    await chrome.alarms.create("tick", { periodInMinutes: 1 });
  }
}

chrome.idle.setDetectionInterval(60);

chrome.runtime.onInstalled.addListener(() => {
  serial(async () => {
    await ensureAlarm();
    await refresh();
  });
});

chrome.runtime.onStartup.addListener(() => {
  serial(async () => {
    await ensureAlarm();
    await refresh();
  });
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "tick") serial(() => refresh());
});

// Initial run
serial(async () => {
  await ensureAlarm();
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
  if (info.url || info.status === "complete") retrack();
});
chrome.windows.onFocusChanged.addListener(retrack);
chrome.idle.onStateChanged.addListener(retrack);

// Pages reached by clicking inside a site change the address without a new page load.
async function check(details: chrome.webNavigation.WebNavigationFramedCallbackDetails): Promise<void> {
  if (details.frameId !== 0) return;
  const st = await loadState();
  const d = decide(details.url, st);
  if (d) chrome.tabs.update(details.tabId, { url: blockedUrl(d) }).catch(() => {});
}

const WEB: chrome.webNavigation.WebNavigationEventFilter = {
  url: [{ schemes: ["http", "https"] }]
};

chrome.webNavigation.onHistoryStateUpdated.addListener(check, WEB);
chrome.webNavigation.onCommitted.addListener(check, WEB);

// Messages from the settings page and popup.
interface Message {
  type: string;
}

chrome.runtime.onMessage.addListener((
  msg: Message,
  sender: chrome.runtime.MessageSender,
  reply: (response: unknown) => void
): boolean | undefined => {
  if (msg?.type === "sync") {
    serial(() => refresh()).then(() => reply({ ok: true }));
    return true;
  }

  if (msg?.type === "getTimeLeft") {
    serial(async () => {
      const st = await loadState();
      const { tracking } = await chrome.storage.session.get("tracking") as { tracking?: TrackingState };

      // Calculate live usage including time since last track() call
      let liveUsed = st.used;
      if (tracking) {
        const elapsed = (Date.now() - tracking.since) / 1000;
        liveUsed += Math.min(elapsed, TICK_CAP_MS / 1000);
      }

      const remaining = Math.max(0, st.limit - liveUsed);
      reply({
        remaining,      // seconds (float) - live value
        limit: st.limit,
        used: liveUsed,
        out: liveUsed >= st.limit,
        tracking: !!tracking
      });
    });
    return true; // Keep channel open for async response
  }

  if (msg?.type === "checkNow") {
    // Force immediate refresh when timer hits zero
    serial(() => refresh()).then(() => reply({ ok: true }));
    return true;
  }

  if (msg?.type === "isTrackingNow") {
    // Check if we're currently tracking time (on a budget site)
    serial(async () => {
      const { tracking } = await chrome.storage.session.get("tracking") as { tracking?: TrackingState };
      reply({ tracking: !!tracking });
    });
    return true;
  }

  if (msg?.type === "shouldShowCountdown") {
    serial(async () => {
      const st = await loadState();

      // Don't show if out of time
      if (st.out) {
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
      if (st.blocks.some(b => b.kind === "allow" && matches(url, b.target))) {
        reply({ show: false });
        return;
      }

      // Only show on budget sites
      reply({ show: isBudgetSite(url, st.settings) });
    });
    return true;
  }

  return undefined;
});

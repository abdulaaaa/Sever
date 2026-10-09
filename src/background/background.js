import { DEFAULT_BLOCKS, DEFAULT_SETTINGS } from "../utils/defaults.js";
import { loadState, decide, matches, isBudgetSite, domainsFor, pageRegex, isSiteTarget, schedActive, dayKey } from "../utils/common.js";
import { api, getSession } from "../services/supa.js";

const TICK_CAP_MS = 75_000; // never count more than this between two checks (sleep, etc.)

// Run tasks one at a time so they never trip over each other.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn).catch((e) => console.warn("Page Blocker:", e)));

// ---------- syncing with Supabase ----------
async function flushPending() {
  const { pendingAttempts = [], pendingUsage = {} } = await chrome.storage.local.get(["pendingAttempts", "pendingUsage"]);
  if (pendingAttempts.length) {
    await api("attempts", { method: "POST", body: pendingAttempts, prefer: "return=minimal" });
    await chrome.storage.local.set({ pendingAttempts: [] });
  }
  let latest = null;
  for (const day of Object.keys(pendingUsage)) {
    while (pendingUsage[day] >= 1) {
      const send = Math.min(600, Math.floor(pendingUsage[day]));
      const total = await api("rpc/add_usage", { method: "POST", body: { p_day: day, p_seconds: send } });
      pendingUsage[day] -= send;
      await chrome.storage.local.set({ pendingUsage });
      if (day === dayKey()) latest = total;
    }
    if (day !== dayKey()) delete pendingUsage[day];
  }
  await chrome.storage.local.set({ pendingUsage });
  return latest;
}

async function sync() {
  const session = await getSession();
  if (!session) return;
  try {
    // Move counts from the previous version into the database.
    const { visits } = await chrome.storage.local.get("visits");
    if (visits) {
      const { pendingAttempts = [] } = await chrome.storage.local.get("pendingAttempts");
      for (const [target, times] of Object.entries(visits)) {
        for (const t of times) pendingAttempts.push({ target, at: new Date(t).toISOString() });
      }
      await chrome.storage.local.set({ pendingAttempts });
      await chrome.storage.local.remove("visits");
    }

    await flushPending();
    const day = dayKey();
    let [blocks, settingsRows, usageRows] = await Promise.all([
      api("blocks?select=*&order=created_at.asc"),
      api("settings?select=*"),
      api(`usage?select=seconds&day=eq.${day}`)
    ]);

    // First sign-in ever: copy the starting blocks and settings into the database.
    if (!settingsRows.length) {
      if (!blocks.length) {
        const rows = DEFAULT_BLOCKS.map(({ id, ...b }) => b);
        blocks = await api("blocks", { method: "POST", body: rows, prefer: "return=representation" });
      }
      settingsRows = await api("settings", { method: "POST", body: [DEFAULT_SETTINGS], prefer: "return=representation" });
    }

    const s = settingsRows[0];
    await chrome.storage.local.set({
      cache: {
        blocks,
        settings: { daily_limit_minutes: s.daily_limit_minutes, budget_sites: s.budget_sites },
        usage: { day, seconds: usageRows[0]?.seconds || 0 }
      },
      syncedAt: Date.now(),
      lastError: null
    });
  } catch (e) {
    await chrome.storage.local.set({ lastError: String(e.message || e) });
  }
}

// ---------- blocking rules ----------
const condition = (target) =>
  isSiteTarget(target)
    ? { requestDomains: domainsFor(target), resourceTypes: ["main_frame"] }
    : { regexFilter: pageRegex(target), resourceTypes: ["main_frame"] };

const redirect = (query) => ({ type: "redirect", redirect: { extensionPath: `/src/pages/blocked/blocked.html?${query}` } });

async function applyRules(st) {
  const now = new Date();
  const rules = [];
  let id = 1;
  for (const b of st.blocks) {
    if (b.kind === "allow") rules.push({ id: id++, priority: 100, action: { type: "allow" }, condition: condition(b.target) });
    else if (!b.schedule) rules.push({ id: id++, priority: b.person ? 60 : 50, action: redirect(`id=${b.id}`), condition: condition(b.target) });
    else if (schedActive(b.schedule, now)) rules.push({ id: id++, priority: 20, action: redirect(`id=${b.id}`), condition: condition(b.target) });
  }
  if (st.out) {
    const domains = [...new Set(st.settings.budget_sites.flatMap((d) => domainsFor(d)))];
    if (domains.length) rules.push({ id: id++, priority: 10, action: redirect("budget=1"), condition: { requestDomains: domains, resourceTypes: ["main_frame"] } });
  }
  const key = JSON.stringify(rules);
  const { rulesKey } = await chrome.storage.session.get("rulesKey");
  if (key === rulesKey) return;
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules: rules });
  await chrome.storage.session.set({ rulesKey: key });
}

const blockedUrl = (d, extra = "") =>
  chrome.runtime.getURL("src/pages/blocked/blocked.html?" + (d.budget ? "budget=1" : `id=${d.id}`) + extra);

// Send tabs that are already open to the blocked screen if they're now blocked.
async function sweep(st) {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) {
    const d = decide(tab.url, st);
    if (d) chrome.tabs.update(tab.id, { url: blockedUrl(d, "&n=1") }).catch(() => {});
  }
}

// ---------- social media time ----------
async function onBudgetSiteNow(st) {
  const idle = await chrome.idle.queryState(60);
  if (idle !== "active") return false;
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (!win || !win.focused) return false;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab?.url || decide(tab.url, st)) return false;
  if (st.blocks.some((b) => b.kind === "allow" && matches(tab.url, b.target))) return false;
  return isBudgetSite(tab.url, st.settings);
}

async function track() {
  const now = Date.now();
  const { tracking } = await chrome.storage.session.get("tracking");
  if (tracking) {
    const secs = Math.min(now - tracking.since, TICK_CAP_MS) / 1000;
    if (secs > 0) {
      const { pendingUsage = {} } = await chrome.storage.local.get("pendingUsage");
      const day = dayKey();
      pendingUsage[day] = (pendingUsage[day] || 0) + secs;
      await chrome.storage.local.set({ pendingUsage });
    }
  }
  const st = await loadState();
  const on = !st.out && (await onBudgetSiteNow(st));
  await chrome.storage.session.set({ tracking: on ? { since: now } : null });
  return st;
}

async function updateBadge(st) {
  const left = Math.max(0, Math.ceil((st.limit - st.used) / 60));
  await chrome.action.setBadgeText({ text: String(left) });
  await chrome.action.setBadgeBackgroundColor({ color: left === 0 ? "#b3261e" : left <= 10 ? "#c26401" : "#5f6368" });
  await chrome.action.setTitle({ title: `Page Blocker: ${left} min of social media left today` });

  const day = dayKey();
  let { warned } = await chrome.storage.local.get("warned");
  if (!warned || warned.day !== day) warned = { day, list: [] };
  for (const m of [10, 5]) {
    if (left <= m && left > 0 && !warned.list.includes(m) && st.used > 0) {
      warned.list.push(m);
      chrome.notifications.create(`warn-${day}-${m}`, {
        type: "basic", iconUrl: "icons/128.png", title: "Social media time",
        message: `${left} minute${left === 1 ? "" : "s"} left today.`
      });
    }
  }
  await chrome.storage.local.set({ warned });
}

// Track, sync, refresh rules, sweep open tabs, update the badge.
async function refresh({ doSync = true, doSweep = true } = {}) {
  await track();
  if (doSync) await sync();
  const st = await loadState();
  await applyRules(st);
  if (doSweep) await sweep(st);
  await updateBadge(st);
}

// ---------- events ----------
async function ensureAlarm() {
  if (!(await chrome.alarms.get("tick"))) await chrome.alarms.create("tick", { periodInMinutes: 1 });
}

chrome.idle.setDetectionInterval(60);
chrome.runtime.onInstalled.addListener(() => serial(async () => { await ensureAlarm(); await refresh(); }));
chrome.runtime.onStartup.addListener(() => serial(async () => { await ensureAlarm(); await refresh(); }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "tick") serial(() => refresh()); });
serial(async () => { await ensureAlarm(); await refresh({ doSync: false, doSweep: false }); });

// Time tracking follows what you're looking at.
const retrack = () => serial(async () => {
  const before = await loadState();
  const st = await track();
  if (st.out !== before.out) await refresh({ doSync: false });
});
chrome.tabs.onActivated.addListener(retrack);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.url || info.status === "complete") retrack(); });
chrome.windows.onFocusChanged.addListener(retrack);
chrome.idle.onStateChanged.addListener(retrack);

// Pages reached by clicking inside a site change the address without a new page load.
async function check(details) {
  if (details.frameId !== 0) return;
  const st = await loadState();
  const d = decide(details.url, st);
  if (d) chrome.tabs.update(details.tabId, { url: blockedUrl(d) }).catch(() => {});
}
const WEB = { url: [{ schemes: ["http", "https"] }] };
chrome.webNavigation.onHistoryStateUpdated.addListener(check, WEB);
chrome.webNavigation.onCommitted.addListener(check, WEB);

// Messages from the settings page and popup.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === "sync") {
    serial(() => refresh()).then(() => reply({ ok: true }));
    return true;
  }
});

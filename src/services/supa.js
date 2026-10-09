// A small Supabase client: sign-in, token refresh and database requests.
import { SUPABASE_URL, SUPABASE_KEY } from "../utils/config.js";

let refreshing = null;

async function saveSession(j) {
  const session = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: { id: j.user.id, email: j.user.email }
  };
  await chrome.storage.local.set({ session });
  return session;
}

async function authRequest(path, body) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error_description || j.msg || j.message || `Request failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return j;
}

export async function signIn(email, password) {
  const j = await authRequest("token?grant_type=password", { email, password });
  return (await saveSession(j)).user;
}

export async function signOut() {
  const { session } = await chrome.storage.local.get("session");
  await chrome.storage.local.remove("session");
  if (session) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` }
    }).catch(() => {});
  }
}

export async function getSession() {
  return (await chrome.storage.local.get("session")).session || null;
}

async function accessToken() {
  const s = await getSession();
  if (!s) return null;
  if (s.expires_at * 1000 - Date.now() > 60_000) return s.access_token;
  if (!refreshing) {
    refreshing = authRequest("token?grant_type=refresh_token", { refresh_token: s.refresh_token })
      .then(saveSession)
      .catch(async (e) => {
        // A rejected refresh token means the sign-in is no longer valid.
        if (e.status === 400 || e.status === 401) await chrome.storage.local.remove("session");
        throw e;
      })
      .finally(() => (refreshing = null));
  }
  return (await refreshing).access_token;
}

// Request to the database. path is relative to /rest/v1/.
export async function api(path, { method = "GET", body, prefer, range } = {}) {
  const token = await accessToken();
  if (!token) throw new Error("signed-out");
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  if (range) headers.Range = range;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Database error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

// Fetch every row of a query, 1000 at a time.
export async function apiAll(path) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await api(path, { range: `${from}-${from + 999}` });
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

// Record attempts on blocked people pages. Falls back to a local queue when offline.
export async function recordAttempt(target) {
  const row = { target, at: new Date().toISOString() };
  try {
    await api("attempts", { method: "POST", body: [row], prefer: "return=minimal" });
  } catch {
    const { pendingAttempts = [] } = await chrome.storage.local.get("pendingAttempts");
    pendingAttempts.push(row);
    await chrome.storage.local.set({ pendingAttempts });
  }
}

// All attempt times, grouped by target: { "x.com/someone": [ms, ms, ...] }
export async function loadAttempts(target) {
  const out = {};
  const add = (t, at) => (out[t] = out[t] || []).push(new Date(at).getTime());
  let server = null;
  try {
    const q = "attempts?select=target,at&order=at.asc" + (target ? "&target=eq." + encodeURIComponent(target) : "");
    server = await apiAll(q);
    if (!target) await chrome.storage.local.set({ attemptsCache: server });
  } catch {
    server = (await chrome.storage.local.get("attemptsCache")).attemptsCache || [];
    if (target) server = server.filter((r) => r.target === target);
  }
  server.forEach((r) => add(r.target, r.at));
  const { pendingAttempts = [] } = await chrome.storage.local.get("pendingAttempts");
  pendingAttempts.filter((r) => !target || r.target === target).forEach((r) => add(r.target, r.at));
  return out;
}

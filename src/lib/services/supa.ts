// A small Supabase client: sign-in, token refresh and database requests.
import { SUPABASE_URL, SUPABASE_KEY } from '../utils/config';
import type { Session, AttemptRecord, AttemptsMap } from '../types';

let refreshing: Promise<Session> | null = null;

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: {
    id: string;
    email: string;
  };
}

interface AuthError extends Error {
  status?: number;
}

async function saveSession(j: AuthResponse): Promise<Session> {
  const session: Session = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: { id: j.user.id, email: j.user.email }
  };
  await chrome.storage.local.set({ session });
  return session;
}

async function authRequest(path: string, body: Record<string, string>): Promise<AuthResponse> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err: AuthError = new Error(j.error_description || j.msg || j.message || `Request failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return j;
}

export async function signIn(email: string, password: string): Promise<{ id: string; email: string }> {
  const j = await authRequest("token?grant_type=password", { email, password });
  return (await saveSession(j)).user;
}

export async function verifyPassword(password: string): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  try {
    await authRequest("token?grant_type=password", { email: session.user.email, password });
    return true;
  } catch {
    return false;
  }
}

export async function signOut(): Promise<void> {
  const { session } = await chrome.storage.local.get("session") as { session?: Session };
  await chrome.storage.local.remove("session");
  if (session) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` }
    }).catch(() => {});
  }
}

export async function getSession(): Promise<Session | null> {
  const { session } = await chrome.storage.local.get("session") as { session?: Session };
  return session || null;
}

async function accessToken(): Promise<string | null> {
  const s = await getSession();
  if (!s) return null;
  if (s.expires_at * 1000 - Date.now() > 60_000) return s.access_token;
  if (!refreshing) {
    refreshing = authRequest("token?grant_type=refresh_token", { refresh_token: s.refresh_token })
      .then(saveSession)
      .catch(async (e: AuthError) => {
        // A rejected refresh token means the sign-in is no longer valid.
        if (e.status === 400 || e.status === 401) await chrome.storage.local.remove("session");
        throw e;
      })
      .finally(() => { refreshing = null; });
  }
  return (await refreshing).access_token;
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  prefer?: string;
  range?: string;
}

// Request to the database. path is relative to /rest/v1/.
export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, prefer, range } = options;
  const token = await accessToken();
  if (!token) throw new Error("signed-out");

  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  if (prefer) headers.Prefer = prefer;
  if (range) headers.Range = range;

  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!r.ok) throw new Error(`Database error ${r.status}: ${(await r.text()).slice(0, 200)}`);

  const text = await r.text();
  return text ? JSON.parse(text) : (null as unknown as T);
}

// Fetch every row of a query, 1000 at a time.
export async function apiAll<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await api<T[]>(path, { range: `${from}-${from + 999}` });
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

// Record attempts on blocked people pages. Falls back to a local queue when offline.
export async function recordAttempt(target: string): Promise<void> {
  const row: AttemptRecord = { target, at: new Date().toISOString() };
  try {
    await api("attempts", { method: "POST", body: [row], prefer: "return=minimal" });
  } catch {
    const { pendingAttempts = [] } = await chrome.storage.local.get("pendingAttempts") as { pendingAttempts?: AttemptRecord[] };
    pendingAttempts.push(row);
    await chrome.storage.local.set({ pendingAttempts });
  }
}

interface AttemptRow {
  target: string;
  at: string;
}

// All attempt times, grouped by target: { "x.com/someone": [ms, ms, ...] }
export async function loadAttempts(target?: string): Promise<AttemptsMap> {
  const out: AttemptsMap = {};
  const add = (t: string, at: string): void => {
    (out[t] = out[t] || []).push(new Date(at).getTime());
  };

  let server: AttemptRow[] | null = null;
  try {
    const q = "attempts?select=target,at&order=at.asc" + (target ? "&target=eq." + encodeURIComponent(target) : "");
    server = await apiAll<AttemptRow>(q);
    if (!target) await chrome.storage.local.set({ attemptsCache: server });
  } catch {
    const { attemptsCache } = await chrome.storage.local.get("attemptsCache") as { attemptsCache?: AttemptRow[] };
    server = attemptsCache || [];
    if (target) server = server.filter((r) => r.target === target);
  }

  server.forEach((r) => add(r.target, r.at));

  const { pendingAttempts = [] } = await chrome.storage.local.get("pendingAttempts") as { pendingAttempts?: AttemptRecord[] };
  pendingAttempts.filter((r) => !target || r.target === target).forEach((r) => add(r.target, r.at));

  return out;
}

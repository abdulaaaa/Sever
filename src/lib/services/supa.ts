// Supabase client using official SDK for type-safe database operations
import { createClient } from '@supabase/supabase-js';
import { refreshRejected } from './session';
import { SUPABASE_URL, SUPABASE_KEY } from '../utils/config';
import type {
  Session,
  Block,
  Settings,
  AttemptRecord,
  AttemptsMap,
  SiteUsageRow,
  UsageDayRow,
  FocusDay,
  FocusDayRow
} from '../types';

// Initialize SDK client. Tokens are refreshed in withAuth, which also saves them; the SDK's own
// timer would replace the refresh token in memory only and leave a used one in storage.
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Session management (still use chrome.storage for persistence)
export async function getSession(): Promise<Session | null> {
  const { session } = (await chrome.storage.local.get('session')) as { session?: Session };
  return session || null;
}

// Swaps a nearly expired session for a new one and saves it.
async function refreshSession(session: Session): Promise<void> {
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: session.refresh_token
  });
  if (data.session) {
    const newSession: Session = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.session.expires_in || 3600),
      user: { id: data.session.user.id, email: data.session.user.email || '' }
    };
    await chrome.storage.local.set({ session: newSession });
    return;
  }
  if (!refreshRejected(error)) throw new Error('Could not refresh the session');

  // Another page or the background worker may have refreshed first and saved a newer session.
  const latest = await getSession();
  if (latest && latest.refresh_token !== session.refresh_token) {
    await supabase.auth.setSession({
      access_token: latest.access_token,
      refresh_token: latest.refresh_token
    });
    return;
  }
  await chrome.storage.local.remove('session');
  throw new Error('Session expired');
}

// Helper to execute database operations with auth
async function withAuth<T>(fn: () => Promise<T>): Promise<T> {
  const session = await getSession();
  if (!session) throw new Error('signed-out');

  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at - now < 60) {
    await refreshSession(session);
  } else {
    await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token
    });
  }

  return fn();
}

// Database operations
export async function fetchBlocks(): Promise<Block[]> {
  return withAuth(async () => {
    const { data, error } = await supabase
      .from('blocks')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw new Error(`Database error: ${error.message}`);
    return data || [];
  });
}

export async function fetchSettings(): Promise<Settings[]> {
  return withAuth(async () => {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) throw new Error(`Database error: ${error.message}`);
    return data || [];
  });
}

export async function fetchUsage(day: string): Promise<Pick<UsageDayRow, 'seconds'>[]> {
  return withAuth(async () => {
    const { data, error } = await supabase.from('usage').select('seconds').eq('day', day);

    if (error) throw new Error(`Database error: ${error.message}`);
    return data || [];
  });
}

export async function insertBlocks(rows: Omit<Block, 'id'>[]): Promise<Block[]> {
  return withAuth(async () => {
    const { data, error } = await supabase.from('blocks').insert(rows).select();

    if (error) throw new Error(`Database error: ${error.message}`);
    return data || [];
  });
}

export async function insertSettings(rows: Settings[]): Promise<Settings[]> {
  return withAuth(async () => {
    const { data, error } = await supabase.from('settings').insert(rows).select();

    if (error) throw new Error(`Database error: ${error.message}`);
    return data || [];
  });
}

export async function updateSettings(userId: string, updates: Partial<Settings>): Promise<void> {
  return withAuth(async () => {
    const { error } = await supabase
      .from('settings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) throw new Error(`Database error: ${error.message}`);
  });
}

export async function insertBlock(row: Partial<Block>): Promise<void> {
  return withAuth(async () => {
    const { error } = await supabase.from('blocks').insert([row]);
    if (error) throw new Error(`Database error: ${error.message}`);
  });
}

export async function deleteBlock(id: string): Promise<void> {
  return withAuth(async () => {
    const { error } = await supabase.from('blocks').delete().eq('id', id);
    if (error) throw new Error(`Database error: ${error.message}`);
  });
}

export async function updateBlock(id: string, updates: Partial<Block>): Promise<void> {
  return withAuth(async () => {
    const { error } = await supabase.from('blocks').update(updates).eq('id', id);
    if (error) throw new Error(`Database error: ${error.message}`);
  });
}

export async function addUsage(day: string, seconds: number): Promise<number> {
  return withAuth(async () => {
    const { data, error } = await supabase.rpc('add_usage', {
      p_day: day,
      p_seconds: seconds
    });

    if (error) throw new Error(`Database error: ${error.message}`);
    return data;
  });
}

export async function addSiteUsage(day: string, site: string, seconds: number): Promise<void> {
  return withAuth(async () => {
    const { error } = await supabase.rpc('add_site_usage', {
      p_day: day,
      p_site: site,
      p_seconds: seconds
    });

    if (error) throw new Error(`Database error: ${error.message}`);
  });
}

export async function fetchSiteUsageSince(fromDay: string): Promise<SiteUsageRow[]> {
  return withAuth(async () => {
    const { data, error } = await supabase
      .from('site_usage')
      .select('day, site, seconds')
      .gte('day', fromDay)
      .order('day', { ascending: false }); // newest first, so a row cap can only drop the oldest days

    if (error) throw new Error(`Database error: ${error.message}`);
    return data || [];
  });
}

export async function fetchUsageSince(fromDay: string): Promise<UsageDayRow[]> {
  return withAuth(async () => {
    const { data, error } = await supabase
      .from('usage')
      .select('day, seconds')
      .gte('day', fromDay)
      .order('day', { ascending: true });

    if (error) throw new Error(`Database error: ${error.message}`);
    return data || [];
  });
}

// Add to a day's lock-in history.
export async function addFocus(day: string, d: FocusDay): Promise<void> {
  return withAuth(async () => {
    const { error } = await supabase.rpc('add_focus', {
      p_day: day,
      p_seconds: d.seconds,
      p_sessions: d.sessions,
      p_video: d.video,
      p_done: d.done,
      p_partly: d.partly,
      p_pulled: d.pulled,
      p_early: d.early
    });

    if (error) throw new Error(`Database error: ${error.message}`);
  });
}

export async function fetchFocusSince(fromDay: string): Promise<FocusDayRow[]> {
  return withAuth(async () => {
    const { data, error } = await supabase
      .from('focus_days')
      .select('day, seconds, sessions, video, done, partly, pulled, early')
      .gte('day', fromDay)
      .order('day', { ascending: false });

    if (error) throw new Error(`Database error: ${error.message}`);
    return data || [];
  });
}

export async function flushPendingAttempts(attempts: AttemptRecord[]): Promise<void> {
  return withAuth(async () => {
    const { error } = await supabase.from('attempts').insert(attempts);
    if (error) throw new Error(`Database error: ${error.message}`);
  });
}

export async function recordAttempt(target: string): Promise<void> {
  const row: AttemptRecord = { target, at: new Date().toISOString() };
  try {
    await withAuth(async () => {
      const { error } = await supabase.from('attempts').insert([row]);
      if (error) throw error;
    });
  } catch {
    const { pendingAttempts = [] } = (await chrome.storage.local.get('pendingAttempts')) as {
      pendingAttempts?: AttemptRecord[];
    };
    pendingAttempts.push(row);
    await chrome.storage.local.set({ pendingAttempts });
  }
}

// Move attempts saved under one name to another, e.g. when a person is renamed.
export async function renameAttemptTarget(from: string, to: string): Promise<void> {
  const { pendingAttempts = [] } = (await chrome.storage.local.get('pendingAttempts')) as {
    pendingAttempts?: AttemptRecord[];
  };
  if (pendingAttempts.some((r) => r.target === from)) {
    await chrome.storage.local.set({
      pendingAttempts: pendingAttempts.map((r) => (r.target === from ? { ...r, target: to } : r))
    });
  }
  return withAuth(async () => {
    const { error } = await supabase.from('attempts').update({ target: to }).eq('target', from);
    if (error) throw new Error(`Database error: ${error.message}`);
  });
}

interface AttemptRow {
  target: string;
  at: string;
}

export async function loadAttempts(target?: string): Promise<AttemptsMap> {
  const out: AttemptsMap = {};
  const add = (t: string, at: string): void => {
    (out[t] = out[t] || []).push(new Date(at).getTime());
  };

  let server: AttemptRow[] | null = null;
  try {
    server = await withAuth(async () => {
      // Fetch every row, 1000 at a time: the database caps what one request
      // returns, and a capped count would silently stop going up.
      const rows: AttemptRow[] = [];
      for (let from = 0; ; from += 1000) {
        let query = supabase
          .from('attempts')
          .select('target, at')
          .order('at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + 999);

        if (target) {
          query = query.eq('target', target);
        }

        const { data, error } = await query;
        if (error) throw error;

        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }

      if (!target) {
        await chrome.storage.local.set({ attemptsCache: rows });
      }

      return rows;
    });
  } catch {
    const { attemptsCache } = (await chrome.storage.local.get('attemptsCache')) as {
      attemptsCache?: AttemptRow[];
    };
    server = attemptsCache || [];
    if (target) server = server.filter((r) => r.target === target);
  }

  server.forEach((r) => add(r.target, r.at));

  const { pendingAttempts = [] } = (await chrome.storage.local.get('pendingAttempts')) as {
    pendingAttempts?: AttemptRecord[];
  };
  pendingAttempts.filter((r) => !target || r.target === target).forEach((r) => add(r.target, r.at));

  return out;
}

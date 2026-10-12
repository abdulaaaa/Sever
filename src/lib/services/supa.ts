// Supabase client using official SDK for type-safe database operations
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../utils/config';
import type { Session, Block, AttemptRecord, AttemptsMap, SiteUsageRow, UsageDayRow } from '../types';

// Initialize SDK client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: true }
});

// Session management (still use chrome.storage for persistence)
export async function getSession(): Promise<Session | null> {
  const { session } = await chrome.storage.local.get("session") as { session?: Session };
  return session || null;
}

async function setSupabaseSession(session: Session | null): Promise<void> {
  if (session) {
    await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token
    });
  }
}

// Helper to execute database operations with auth
async function withAuth<T>(fn: () => Promise<T>): Promise<T> {
  const session = await getSession();
  if (!session) throw new Error("signed-out");

  await setSupabaseSession(session);

  // Check if token needs refresh
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at - now < 60) {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: session.refresh_token
    });
    if (error) {
      await chrome.storage.local.remove("session");
      throw new Error("Session expired");
    }
    if (data.session) {
      const newSession: Session = {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (data.session.expires_in || 3600),
        user: { id: data.session.user.id, email: data.session.user.email || '' }
      };
      await chrome.storage.local.set({ session: newSession });
    }
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

export async function fetchSettings(): Promise<any[]> {
  return withAuth(async () => {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) throw new Error(`Database error: ${error.message}`);
    return data || [];
  });
}

export async function fetchUsage(day: string): Promise<any[]> {
  return withAuth(async () => {
    const { data, error } = await supabase
      .from('usage')
      .select('seconds')
      .eq('day', day);

    if (error) throw new Error(`Database error: ${error.message}`);
    return data || [];
  });
}

export async function insertBlocks(rows: any[]): Promise<Block[]> {
  return withAuth(async () => {
    const { data, error } = await supabase
      .from('blocks')
      .insert(rows)
      .select();

    if (error) throw new Error(`Database error: ${error.message}`);
    return data || [];
  });
}

export async function insertSettings(rows: any[]): Promise<any[]> {
  return withAuth(async () => {
    const { data, error } = await supabase
      .from('settings')
      .insert(rows)
      .select();

    if (error) throw new Error(`Database error: ${error.message}`);
    return data || [];
  });
}

export async function updateSettings(userId: string, updates: any): Promise<void> {
  return withAuth(async () => {
    const { error } = await supabase
      .from('settings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) throw new Error(`Database error: ${error.message}`);
  });
}

export async function insertBlock(row: any): Promise<void> {
  return withAuth(async () => {
    const { error } = await supabase.from('blocks').insert([row]);
    if (error) throw new Error(`Database error: ${error.message}`);
  });
}

export async function deleteBlock(id: string): Promise<void> {
  return withAuth(async () => {
    const { error} = await supabase.from('blocks').delete().eq('id', id);
    if (error) throw new Error(`Database error: ${error.message}`);
  });
}

export async function updateBlock(id: string, updates: any): Promise<void> {
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
      .order('day', { ascending: true })
      .limit(5000);

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
    const { pendingAttempts = [] } = await chrome.storage.local.get("pendingAttempts") as { pendingAttempts?: AttemptRecord[] };
    pendingAttempts.push(row);
    await chrome.storage.local.set({ pendingAttempts });
  }
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
      let query = supabase
        .from('attempts')
        .select('target, at')
        .order('at', { ascending: true });

      if (target) {
        query = query.eq('target', target);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (!target && data) {
        await chrome.storage.local.set({ attemptsCache: data });
      }

      return data || [];
    });
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

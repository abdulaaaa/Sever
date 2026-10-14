// Schedule for time-based blocks
export interface Schedule {
  start: string; // "HH:MM" format
  end: string; // "HH:MM" format
  days: number[]; // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
}

// Block kinds
export type BlockKind = 'page' | 'site' | 'allow';

// A block rule
export interface Block {
  id: string;
  kind: BlockKind;
  target: string;
  person: string | null;
  schedule: Schedule | null;
  created_at?: string;
}

// User settings
export interface Settings {
  daily_limit_minutes: number;
  budget_sites: string[];
  settings_unlock_schedule?: Schedule | null; // When settings CAN be changed (null = always unlocked)
  person_terms?: Record<string, string[]>; // Extra names/usernames to watch for, by person
  focus_config?: Partial<FocusConfig>; // Lock-in mode settings
}

// Supabase session
export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: {
    id: string;
    email: string;
  };
}

// Cache stored in chrome.storage.local
export interface Cache {
  blocks: Block[];
  settings: Settings;
  usage: {
    day: string;
    seconds: number;
    // Today's seconds per limited iPhone app, e.g. { 'instagram.com': 600 }. Already in seconds.
    phone?: Record<string, number>;
  };
}

// Extension state loaded from storage
export interface ExtensionState {
  blocks: Block[];
  settings: Settings;
  used: number; // website time plus the phone time held back
  limit: number;
  out: boolean;
  web: number; // website seconds today
  phone: number; // seconds actually used in the limited iPhone apps today
  held: number; // seconds held back for those apps
  session: Session | null;
  pendingAttempts: AttemptRecord[];
  lastError: string | null;
  syncedAt: number | null;
  usingDefaults: boolean;
  focus: FocusState | null;
  focusConfig: FocusConfig;
}

// A lock-in session. The running session lives in chrome.storage.local on this
// device; its settings and history are synced.
export interface FocusState {
  task: string;
  totalMs: number; // planned length
  phase: 'focus' | 'paused' | 'break';
  endsAt: number; // when the focus or break ends (ms); not used while paused
  remainingMs?: number; // time left, while paused
  pausedAt?: number;
  sites?: string[]; // what was blocked when the session started; later removals don't unblock
}

// A finished session still waiting for its "how did it go?" answer
export interface FocusUnrated {
  task: string;
  day: string;
}

export interface FocusConfig {
  minutes: number; // default session length
  breakMinutes: number;
  video: string; // YouTube link played during a session, or ""
  sites: string[]; // blocked during a session, on top of the daily-limit sites
}

// One day of lock-in history
export interface FocusDay {
  seconds: number; // time locked in
  sessions: number;
  video: number; // seconds on YouTube while locked in
  done: number;
  partly: number;
  pulled: number;
  early: number; // sessions ended before the timer
}

export interface FocusLog {
  [day: string]: FocusDay;
}

// One row of lock-in history from the database
export interface FocusDayRow extends FocusDay {
  day: string;
}

// Attempt record for tracking blocked page visits
export interface AttemptRecord {
  target: string;
  at: string; // ISO timestamp
}

// Pending usage to sync with server
export interface PendingUsage {
  [day: string]: number; // day key -> seconds
}

// Pending per-site usage to sync with server
export interface PendingSiteUsage {
  [day: string]: { [site: string]: number }; // day key -> site -> seconds
}

// One row of per-site usage from the database
export interface SiteUsageRow {
  day: string;
  site: string;
  seconds: number;
}

// One row of total usage from the database
export interface UsageDayRow {
  day: string;
  seconds: number;
}

// Decision result from decide() function
export interface DecisionResult {
  id?: string;
  budget?: boolean;
  watch?: boolean; // a search or lookalike profile for a blocked person
  focus?: boolean; // blocked for the length of a lock-in session
}

// Tracking state stored in session storage
export interface TrackingState {
  since: number; // timestamp
  site?: string; // budget site or tracked-only site being counted
  extra?: boolean; // tracked-only site: recorded per site, not counted against the limit
  focusVideo?: boolean; // YouTube during a lock-in session: logged, not counted against the limit
}

// Replies to chrome.runtime.sendMessage
export interface GetTimeLeftResponse {
  remaining: number;
  limit: number;
  used: number;
  out: boolean;
  tracking: boolean;
}

export interface ShouldShowCountdownResponse {
  show: boolean;
}

// Attempts loaded from API
export interface AttemptsMap {
  [target: string]: number[]; // target -> array of timestamps
}

// Summary of attempts
export interface AttemptSummary {
  total: number;
  today: number;
  week: number;
}

// Warning state for notifications
export interface WarnedState {
  day: string;
  list: number[];
}

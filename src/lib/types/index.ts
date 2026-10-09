// Schedule for time-based blocks
export interface Schedule {
  start: string;  // "HH:MM" format
  end: string;    // "HH:MM" format
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
  settings_unlock_schedule?: Schedule | null;  // When settings CAN be changed (null = always unlocked)
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
  };
}

// Extension state loaded from storage
export interface ExtensionState {
  blocks: Block[];
  settings: Settings;
  used: number;
  limit: number;
  out: boolean;
  session: Session | null;
  pendingAttempts: AttemptRecord[];
  lastError: string | null;
  syncedAt: number | null;
  usingDefaults: boolean;
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

// Decision result from decide() function
export interface DecisionResult {
  id?: string;
  budget?: boolean;
}

// Tracking state stored in session storage
export interface TrackingState {
  since: number; // timestamp
}

// Message types for chrome.runtime.sendMessage
export type MessageType =
  | 'sync'
  | 'getTimeLeft'
  | 'checkNow'
  | 'isTrackingNow'
  | 'shouldShowCountdown';

export interface SyncMessage {
  type: 'sync';
}

export interface GetTimeLeftMessage {
  type: 'getTimeLeft';
}

export interface GetTimeLeftResponse {
  remaining: number;
  limit: number;
  used: number;
  out: boolean;
  tracking: boolean;
}

export interface CheckNowMessage {
  type: 'checkNow';
}

export interface IsTrackingNowMessage {
  type: 'isTrackingNow';
}

export interface IsTrackingNowResponse {
  tracking: boolean;
}

export interface ShouldShowCountdownMessage {
  type: 'shouldShowCountdown';
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

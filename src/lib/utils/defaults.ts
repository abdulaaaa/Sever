// Starting blocks. Used before you sign in for the first time, and copied
// into your Supabase database the first time you sign in.
// After that, manage everything from the extension's settings page.

import type { Block, Schedule, Settings, FocusConfig } from '../types';

const NIGHT: Schedule = { start: "21:00", end: "12:00", days: [0, 1, 2, 3, 4, 5, 6] };

export const DEFAULT_BLOCKS: Block[] = [
  // Person blocks removed for privacy - add them through the extension's Settings page after signing in
  // Example: { kind: "page", target: "instagram.com/username", person: "Name" }

  // Block specific settings/profile pages on social media
  { kind: "page", target: "x.com/settings/content_you_see" },
  { kind: "page", target: "reddit.com/settings/profile" },

  // Block major social media sites during nighttime (9pm to noon)
  { kind: "site", target: "x.com", schedule: NIGHT },
  { kind: "site", target: "linkedin.com", schedule: NIGHT },
  { kind: "site", target: "instagram.com", schedule: NIGHT },
  { kind: "site", target: "facebook.com", schedule: NIGHT },
  { kind: "site", target: "reddit.com", schedule: NIGHT },

  // Always allow LinkedIn jobs even during blocked times
  { kind: "allow", target: "linkedin.com/jobs" }
].map((b, i) => ({ id: "default-" + (i + 1), person: null, schedule: null, ...b })) as Block[];

export const DEFAULT_SETTINGS: Settings = {
  daily_limit_minutes: 60,
  budget_sites: [
    "x.com", "reddit.com", "instagram.com", "facebook.com", "linkedin.com",
    "tiktok.com", "threads.net", "threads.com", "snapchat.com", "pinterest.com", "tumblr.com"
  ],
  settings_unlock_schedule: null  // null = no lock (always unlocked)
};

export const DEFAULT_FOCUS_CONFIG: FocusConfig = {
  minutes: 60,
  breakMinutes: 10,
  video: "https://www.youtube.com/watch?v=Dq-h8LIe6II",
  sites: []
};

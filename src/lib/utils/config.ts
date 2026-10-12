// Supabase configuration from environment variables
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

// Dev mode bypasses settings lock
export const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true';

// Sites whose time is recorded for the analytics page but never counted against the daily limit
export const EXTRA_SITES = ['youtube.com', 'whatsapp.com'];
// That time is stored under its own site key ("extra:youtube.com"), so it stays apart from
// limit time even if one of these is later added to or removed from the daily-limit sites.
export const EXTRA_PREFIX = 'extra:';

// iPhone apps whose time is sent by iOS Shortcuts automations and added to site_usage by the
// phone_event database function (see README). The browser never matches URLs against these;
// the keys ("extra:phone:youtube.com") only tell the analytics page what to show.
export const PHONE_SITES = ['youtube.com', 'whatsapp.com'];
export const PHONE_PREFIX = EXTRA_PREFIX + 'phone:';

// Validate configuration at runtime
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Sever: Missing Supabase configuration. Check your .env file.');
}

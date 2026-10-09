// Supabase configuration from environment variables
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

// Dev mode bypasses settings lock
export const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true';

// Validate configuration at runtime
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Sever: Missing Supabase configuration. Check your .env file.');
}

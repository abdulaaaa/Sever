import { isAuthApiError } from '@supabase/supabase-js';

// Kept apart from supa.ts so it can be tested without creating a Supabase client.

// True only when the server itself turned the refresh token down. A dropped connection, a
// timeout, a server fault or a rate limit says nothing about the session, so it is kept.
export function refreshRejected(error: unknown): boolean {
  return isAuthApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 429;
}

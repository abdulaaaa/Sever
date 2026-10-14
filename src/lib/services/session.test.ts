import { describe, it, expect } from 'vitest';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { refreshRejected } from './session';

describe('refreshRejected', () => {
  it('is true when the server turns the refresh token down', () => {
    expect(refreshRejected(new AuthApiError('Invalid Refresh Token', 400, 'invalid_grant'))).toBe(
      true
    );
    expect(refreshRejected(new AuthApiError('Unauthorized', 401, undefined))).toBe(true);
  });

  it('is false when the server could not be reached', () => {
    expect(refreshRejected(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(false);
    expect(refreshRejected(new AuthRetryableFetchError('Bad gateway', 502))).toBe(false);
    expect(refreshRejected(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('is false for a rate limit or a server fault', () => {
    expect(refreshRejected(new AuthApiError('Too many requests', 429, undefined))).toBe(false);
    expect(refreshRejected(new AuthApiError('Server error', 500, undefined))).toBe(false);
  });

  it('is false when there is no error', () => {
    expect(refreshRejected(null)).toBe(false);
  });
});

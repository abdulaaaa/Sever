import { describe, expect, it, vi } from 'vitest';
import { SUPABASE_URL, SUPABASE_KEY, DEV_MODE } from './config';
import {
  normHost,
  normalize,
  cleanTarget,
  isSiteTarget,
  matches,
  domainsFor,
  pageRegex,
  schedActive,
  timeLabel,
  daysLabel,
  scheduleLabel,
  isSettingsLocked,
  nextUnlockTime,
  dayKey,
  summarize,
  budgetSiteFor,
  isBudgetSite,
  watchTerms,
  isWatchScope,
  watchUrl,
  isYouTube,
  videoId,
  FOCUS_KEYS,
  emptyFocusDay,
  focusLeft,
  focusSites,
  decide
} from './common';
import { DEFAULT_BLOCKS, DEFAULT_SETTINGS, DEFAULT_FOCUS_CONFIG } from './defaults';
import type { Block, ExtensionState, FocusState, Schedule, Settings } from '../types';

describe('test environment', () => {
  it('uses stub configuration, not the real .env', () => {
    expect(SUPABASE_URL).toBe('http://localhost:54321');
    expect(SUPABASE_KEY).toBe('test-key');
    expect(DEV_MODE).toBe(false);
  });

  it('loads common.ts without a configuration error', async () => {
    const error = vi.spyOn(console, 'error');
    vi.resetModules();
    await import('./common');
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('normHost', () => {
  it('lowercases and strips known subdomain prefixes, repeatedly', () => {
    expect(normHost('WWW.Facebook.com')).toBe('facebook.com');
    expect(normHost('www.m.facebook.com')).toBe('facebook.com');
    expect(normHost('old.reddit.com')).toBe('reddit.com');
    expect(normHost('new.reddit.com')).toBe('reddit.com');
  });

  it('leaves other subdomains alone', () => {
    expect(normHost('news.ycombinator.com')).toBe('news.ycombinator.com');
    expect(normHost('api.x.com')).toBe('api.x.com');
  });

  it('applies aliases after stripping', () => {
    expect(normHost('twitter.com')).toBe('x.com');
    expect(normHost('mobile.twitter.com')).toBe('x.com');
  });

  it('returns an empty string for empty input', () => {
    expect(normHost('')).toBe('');
  });
});

describe('normalize', () => {
  it('returns host plus lowercased path, without query or hash', () => {
    expect(normalize('https://M.Facebook.com/Nadia.Anwar/?x=1')).toBe('facebook.com/nadia.anwar/');
    expect(normalize('http://x.com/a#b')).toBe('x.com/a');
    expect(normalize('https://x.com')).toBe('x.com/');
  });

  it('returns an empty string for invalid or non-http addresses', () => {
    expect(normalize('not a url')).toBe('');
    expect(normalize('')).toBe('');
    expect(normalize('chrome://extensions')).toBe('');
    expect(normalize('ftp://x.com/a')).toBe('');
  });
});

describe('cleanTarget', () => {
  it('reduces any input to the host for a site', () => {
    expect(cleanTarget('https://www.instagram.com/foo/bar?x=1', 'site')).toBe('instagram.com');
    expect(cleanTarget('  Twitter.com  ', 'site')).toBe('x.com');
  });

  it('keeps the path for a page and drops trailing slashes', () => {
    expect(cleanTarget('Twitter.com/SomeOne/', 'page')).toBe('x.com/someone');
    expect(cleanTarget('https://x.com/a/b//', 'page')).toBe('x.com/a/b');
    expect(cleanTarget('x.com', 'page')).toBe('x.com');
  });

  it('returns null for empty, invalid or dotless input', () => {
    expect(cleanTarget('', 'site')).toBeNull();
    expect(cleanTarget('   ', 'page')).toBeNull();
    expect(cleanTarget('localhost', 'site')).toBeNull();
    expect(cleanTarget('exa mple.com', 'site')).toBeNull();
    expect(cleanTarget('http://', 'site')).toBeNull();
  });
});

describe('isSiteTarget', () => {
  it('treats a target with no slash as a site', () => {
    expect(isSiteTarget('x.com')).toBe(true);
    expect(isSiteTarget('x.com/someone')).toBe(false);
  });
});

describe('matches', () => {
  it('matches a site target on the site and its subdomains', () => {
    expect(matches('https://www.x.com/home', 'x.com')).toBe(true);
    expect(matches('https://api.x.com/', 'x.com')).toBe(true);
    expect(matches('https://twitter.com/someone', 'x.com')).toBe(true);
  });

  it('does not match a different site that ends with the same letters', () => {
    expect(matches('https://notx.com/', 'x.com')).toBe(false);
    expect(matches('https://x.com.evil.org/', 'x.com')).toBe(false);
  });

  it('matches a page target on the page and anything under it', () => {
    expect(matches('https://x.com/ab', 'x.com/ab')).toBe(true);
    expect(matches('https://x.com/ab/', 'x.com/ab')).toBe(true);
    expect(matches('https://x.com/ab/photos', 'x.com/ab')).toBe(true);
    expect(matches('https://X.com/AB?tab=1', 'x.com/ab')).toBe(true);
  });

  it('does not match a longer name or another page', () => {
    expect(matches('https://x.com/abc', 'x.com/ab')).toBe(false);
    expect(matches('https://x.com/', 'x.com/ab')).toBe(false);
  });

  it('matches a page target on subdomains, as the Chrome rule does', () => {
    expect(matches('https://uk.linkedin.com/in/jane', 'linkedin.com/in/jane')).toBe(true);
    expect(matches('https://uk.linkedin.com/in/jane/details', 'linkedin.com/in/jane')).toBe(true);
    expect(matches('https://uk.linkedin.com/in/janet', 'linkedin.com/in/jane')).toBe(false);
    expect(matches('https://notlinkedin.com/in/jane', 'linkedin.com/in/jane')).toBe(false);
  });

  it('agrees with pageRegex on every address', () => {
    const target = 'x.com/ab';
    const re = new RegExp(pageRegex(target));
    const urls = [
      'https://x.com/ab',
      'https://x.com/ab/',
      'https://x.com/ab/photos',
      'https://x.com/ab?tab=1',
      'https://x.com/abc',
      'https://x.com/',
      'https://www.x.com/ab',
      'https://api.x.com/ab',
      'https://a.b.x.com/ab/c',
      'https://twitter.com/ab',
      'https://mobile.twitter.com/ab',
      'https://notx.com/ab',
      'https://x.com.evil.org/ab'
    ];
    for (const url of urls) expect([url, matches(url, target)]).toEqual([url, re.test(url)]);
  });

  it('never matches an invalid address', () => {
    expect(matches('not a url', 'x.com')).toBe(false);
    expect(matches('chrome://extensions', 'extensions')).toBe(false);
  });
});

describe('domainsFor', () => {
  it('adds the aliases that point at a host', () => {
    expect(domainsFor('x.com')).toEqual(['x.com', 'twitter.com']);
    expect(domainsFor('reddit.com')).toEqual(['reddit.com']);
  });
});

describe('pageRegex', () => {
  const re = new RegExp(pageRegex('x.com/ab'));

  it('matches the page, its sub-pages, aliases and subdomains', () => {
    expect(re.test('https://x.com/ab')).toBe(true);
    expect(re.test('http://x.com/ab/photos')).toBe(true);
    expect(re.test('https://www.x.com/ab?tab=1')).toBe(true);
    expect(re.test('https://twitter.com/ab#top')).toBe(true);
  });

  it('does not match a longer name or a lookalike host', () => {
    expect(re.test('https://x.com/abc')).toBe(false);
    expect(re.test('https://notx.com/ab')).toBe(false);
  });

  it('escapes dots in the host and path', () => {
    const dotted = new RegExp(pageRegex('a.com/b.c'));
    expect(dotted.test('https://a.com/b.c')).toBe(true);
    expect(dotted.test('https://a.com/bxc')).toBe(false);
    expect(dotted.test('https://axcom/b.c')).toBe(false);
  });
});

// Dates are built with the local constructor so the tests pass in any time zone.
// January 2026: the 4th is a Sunday, the 5th a Monday, the 10th a Saturday.
const at = (day: number, h = 0, m = 0): Date => new Date(2026, 0, day, h, m);

const WEEKDAYS = [1, 2, 3, 4, 5];
const OFFICE: Schedule = { start: '09:00', end: '17:00', days: WEEKDAYS };

describe('schedActive', () => {
  it('is false with no schedule', () => {
    expect(schedActive(null, at(5, 10))).toBe(false);
  });

  it('includes the start minute and excludes the end minute', () => {
    expect(schedActive(OFFICE, at(5, 8, 59))).toBe(false);
    expect(schedActive(OFFICE, at(5, 9, 0))).toBe(true);
    expect(schedActive(OFFICE, at(5, 16, 59))).toBe(true);
    expect(schedActive(OFFICE, at(5, 17, 0))).toBe(false);
  });

  it('respects the days of the week', () => {
    expect(schedActive(OFFICE, at(4, 10))).toBe(false);
    expect(schedActive(OFFICE, at(10, 10))).toBe(false);
  });

  it('carries an overnight window into the next morning', () => {
    const mondayNight: Schedule = { start: '21:00', end: '12:00', days: [1] };
    expect(schedActive(mondayNight, at(5, 21, 30))).toBe(true);
    expect(schedActive(mondayNight, at(6, 8))).toBe(true);
    expect(schedActive(mondayNight, at(6, 12))).toBe(false);
    // Monday morning belongs to Sunday night, and Tuesday night is not scheduled.
    expect(schedActive(mondayNight, at(5, 8))).toBe(false);
    expect(schedActive(mondayNight, at(6, 21, 30))).toBe(false);
  });

  it('treats an empty day list as every day', () => {
    expect(schedActive({ start: '09:00', end: '10:00', days: [] }, at(4, 9, 30))).toBe(true);
  });

  it('treats equal start and end as the whole day', () => {
    const allDay: Schedule = { start: '00:00', end: '00:00', days: [1] };
    expect(schedActive(allDay, at(5, 15))).toBe(true);
    expect(schedActive(allDay, at(6, 15))).toBe(false);
  });
});

describe('timeLabel', () => {
  it('formats 24-hour times as 12-hour labels', () => {
    expect(timeLabel('21:00')).toBe('9 pm');
    expect(timeLabel('21:30')).toBe('9:30 pm');
    expect(timeLabel('09:05')).toBe('9:05 am');
    expect(timeLabel('00:00')).toBe('12 am');
    expect(timeLabel('12:00')).toBe('12 pm');
  });
});

describe('daysLabel', () => {
  it('names the common sets', () => {
    expect(daysLabel(undefined)).toBe('every day');
    expect(daysLabel([])).toBe('every day');
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('every day');
    expect(daysLabel(WEEKDAYS)).toBe('on weekdays');
    expect(daysLabel([6, 0])).toBe('on weekends');
  });

  it('lists other sets from Monday, ignoring duplicates', () => {
    expect(daysLabel([3, 1, 1])).toBe('on Mon, Wed');
    expect(daysLabel([0, 1])).toBe('on Mon, Sun');
  });
});

describe('scheduleLabel', () => {
  it('joins the time and day labels', () => {
    expect(scheduleLabel(OFFICE)).toBe('9 am to 5 pm, on weekdays');
  });
});

describe('isSettingsLocked', () => {
  const settings = (schedule: Schedule | null | undefined): Settings => ({
    ...DEFAULT_SETTINGS,
    settings_unlock_schedule: schedule
  });

  it('is never locked without an unlock schedule', () => {
    expect(isSettingsLocked(settings(null), at(5, 3))).toBe(false);
    expect(isSettingsLocked(settings(undefined), at(5, 3))).toBe(false);
  });

  it('is locked outside the unlock window only', () => {
    expect(isSettingsLocked(settings(OFFICE), at(5, 10))).toBe(false);
    expect(isSettingsLocked(settings(OFFICE), at(5, 18))).toBe(true);
    expect(isSettingsLocked(settings(OFFICE), at(4, 10))).toBe(true);
  });

  it('is never locked in dev mode', async () => {
    vi.resetModules();
    vi.doMock('./config', () => ({ DEV_MODE: true }));
    const dev = await import('./common');
    expect(dev.isSettingsLocked(settings(OFFICE), at(5, 18))).toBe(false);
    vi.doUnmock('./config');
    vi.resetModules();
  });
});

describe('nextUnlockTime', () => {
  it('says today when the window has not started yet', () => {
    expect(nextUnlockTime(OFFICE, at(5, 8))).toBe('today at 9 am');
  });

  it('says tomorrow when the next scheduled day is the next day', () => {
    expect(nextUnlockTime(OFFICE, at(5, 10))).toBe('tomorrow at 9 am');
    expect(nextUnlockTime(OFFICE, at(4, 10))).toBe('tomorrow at 9 am');
    expect(nextUnlockTime({ ...OFFICE, days: [] }, at(10, 10))).toBe('tomorrow at 9 am');
  });

  it('names the day when it is further away', () => {
    expect(nextUnlockTime(OFFICE, at(9, 10))).toBe('Mon at 9 am');
    expect(nextUnlockTime(OFFICE, at(10, 10))).toBe('Mon at 9 am');
  });

  it('wraps to the same day next week', () => {
    expect(nextUnlockTime({ ...OFFICE, days: [1] }, at(5, 10))).toBe('Mon at 9 am');
  });
});

describe('dayKey', () => {
  it('formats the local date as YYYY-MM-DD', () => {
    expect(dayKey(at(5, 23, 59))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('summarize', () => {
  it('counts attempts today and since Monday', () => {
    const now = at(7, 15);
    const times = [at(7), at(7, 14), at(6, 23, 59), at(5), at(4, 23, 59)].map((d) => d.getTime());
    expect(summarize(times, now)).toEqual({ total: 5, today: 2, week: 4 });
    expect(now).toEqual(at(7, 15));
  });

  it('starts the week on Monday even on a Sunday', () => {
    expect(summarize([at(5, 12).getTime(), at(4, 12).getTime()], at(11, 9))).toEqual({
      total: 2,
      today: 0,
      week: 1
    });
  });

  it('returns zeros with no attempts', () => {
    expect(summarize()).toEqual({ total: 0, today: 0, week: 0 });
  });
});

const state = (over: Partial<ExtensionState> = {}): ExtensionState => ({
  blocks: DEFAULT_BLOCKS,
  settings: DEFAULT_SETTINGS,
  used: 0,
  limit: 3600,
  out: false,
  session: null,
  pendingAttempts: [],
  lastError: null,
  syncedAt: null,
  usingDefaults: true,
  focus: null,
  focusConfig: DEFAULT_FOCUS_CONFIG,
  ...over
});

const block = (over: Partial<Block> & Pick<Block, 'id' | 'target'>): Block => ({
  kind: isSiteTarget(over.target) ? 'site' : 'page',
  person: null,
  schedule: null,
  ...over
});

const JANE = block({ id: 'jane', target: 'instagram.com/jane.doe', person: 'Jane Doe' });

// The default night schedule runs from 9 pm to noon.
const AFTERNOON = at(5, 13);
const NIGHT = at(5, 22);

describe('budgetSiteFor and isBudgetSite', () => {
  it('finds the budget site an address belongs to', () => {
    expect(budgetSiteFor('https://old.reddit.com/r/all', DEFAULT_SETTINGS)).toBe('reddit.com');
    expect(budgetSiteFor('https://twitter.com/home', DEFAULT_SETTINGS)).toBe('x.com');
    expect(isBudgetSite('https://www.tiktok.com/', DEFAULT_SETTINGS)).toBe(true);
  });

  it('returns null for other sites', () => {
    expect(budgetSiteFor('https://example.com/', DEFAULT_SETTINGS)).toBeNull();
    expect(isBudgetSite('https://example.com/', DEFAULT_SETTINGS)).toBe(false);
  });

  it('normalises the configured sites', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, budget_sites: ['www.Twitter.com'] };
    expect(budgetSiteFor('https://x.com/home', settings)).toBe('x.com');
  });
});

describe('watchTerms', () => {
  it('builds terms from the full name, the profile name and extra terms', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, person_terms: { 'Jane Doe': ['jdoe'] } };
    expect(watchTerms({ blocks: [JANE], settings })).toEqual([
      { person: 'Jane Doe', id: 'jane', term: 'janedoe' },
      { person: 'Jane Doe', id: 'jane', term: 'doejane' },
      { person: 'Jane Doe', id: 'jane', term: 'jdoe' }
    ]);
  });

  it('never uses a first name on its own', () => {
    const blocks = [block({ id: 'a', target: 'x.com', person: 'Jane' })];
    expect(watchTerms({ blocks, settings: DEFAULT_SETTINGS })).toEqual([]);
  });

  it('ignores allow rules and blocks with no person', () => {
    const blocks = [
      { ...JANE, kind: 'allow' as const },
      block({ id: 'b', target: 'x.com/janedoe' })
    ];
    expect(watchTerms({ blocks, settings: DEFAULT_SETTINGS })).toEqual([]);
  });
});

describe('isWatchScope', () => {
  const st = {
    blocks: [block({ id: 'g', target: 'github.com/janedoe', person: 'Jane Doe' })],
    settings: DEFAULT_SETTINGS
  };

  it('covers search engines, budget sites and sites with a blocked person', () => {
    expect(isWatchScope('https://www.google.co.uk/search?q=x', st)).toBe(true);
    expect(isWatchScope('https://duckduckgo.com/', st)).toBe(true);
    expect(isWatchScope('https://www.reddit.com/r/all', st)).toBe(true);
    expect(isWatchScope('https://github.com/', st)).toBe(true);
  });

  it('leaves other sites and invalid addresses out', () => {
    expect(isWatchScope('https://example.com/', st)).toBe(false);
    expect(isWatchScope('not a url', st)).toBe(false);
  });
});

describe('watchUrl', () => {
  const st = { blocks: [JANE], settings: DEFAULT_SETTINGS };

  it('spots a search for a blocked person, allowing for a typo', () => {
    expect(watchUrl('https://www.google.com/search?q=jane+doe', st)?.id).toBe('jane');
    expect(watchUrl('https://www.bing.com/search?q=jane+dae', st)?.id).toBe('jane');
  });

  it('spots a lookalike profile on a watched site', () => {
    expect(watchUrl('https://www.instagram.com/jane_doe2/', st)?.id).toBe('jane');
  });

  it('ignores a first name, other sites and invalid addresses', () => {
    expect(watchUrl('https://www.google.com/search?q=jane', st)).toBeNull();
    expect(watchUrl('https://example.com/jane_doe', st)).toBeNull();
    expect(watchUrl('not a url', st)).toBeNull();
  });

  it('returns null when nobody is blocked', () => {
    expect(watchUrl('https://www.google.com/search?q=jane+doe', state())).toBeNull();
  });
});

describe('isYouTube and videoId', () => {
  it('recognises YouTube and its subdomains', () => {
    expect(isYouTube('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isYouTube('https://music.youtube.com/')).toBe(true);
    expect(isYouTube('https://vimeo.com/')).toBe(false);
  });

  it('reads the video id from each link shape', () => {
    expect(videoId('https://www.youtube.com/watch?v=abc&t=158s')).toBe('abc');
    expect(videoId('https://youtu.be/abc')).toBe('abc');
    expect(videoId('https://www.youtube.com/shorts/x-_1')).toBe('x-_1');
    expect(videoId('https://www.youtube.com/live/abc')).toBe('abc');
    expect(videoId('https://www.youtube.com/embed/abc')).toBe('abc');
  });

  it('returns null when there is no video', () => {
    expect(videoId('https://youtu.be/')).toBeNull();
    expect(videoId('https://www.youtube.com/feed')).toBeNull();
    expect(videoId('https://vimeo.com/watch?v=abc')).toBeNull();
    expect(videoId('nope')).toBeNull();
  });
});

describe('lock-in helpers', () => {
  const focus: FocusState = { task: 'write', totalMs: 3_600_000, phase: 'focus', endsAt: 10_000 };

  it('starts a focus day with every counter at zero', () => {
    const day = emptyFocusDay();
    expect(Object.keys(day).sort()).toEqual([...FOCUS_KEYS].sort());
    expect(Object.values(day).every((v) => v === 0)).toBe(true);
  });

  it('counts down to the end of the phase and never below zero', () => {
    expect(focusLeft(focus, 4_000)).toBe(6_000);
    expect(focusLeft(focus, 20_000)).toBe(0);
  });

  it('holds the remaining time while paused', () => {
    expect(focusLeft({ ...focus, phase: 'paused', remainingMs: 1_234 }, 20_000)).toBe(1_234);
    expect(focusLeft({ ...focus, phase: 'paused' }, 4_000)).toBe(0);
  });

  it('merges budget, lock-in and session sites, without YouTube', () => {
    const st = {
      settings: { ...DEFAULT_SETTINGS, budget_sites: ['x.com', 'youtube.com'] },
      focusConfig: { ...DEFAULT_FOCUS_CONFIG, sites: ['www.News.com', 'twitter.com'] },
      focus: { ...focus, sites: ['old.reddit.com'] }
    };
    expect(focusSites(st)).toEqual(['x.com', 'news.com', 'reddit.com']);
    expect(focusSites({ ...st, focus: null })).toEqual(['x.com', 'news.com']);
  });
});

describe('decide', () => {
  it('allows invalid, internal and unrelated addresses', () => {
    expect(decide('not a url', state(), NIGHT)).toBeNull();
    expect(decide('chrome://extensions', state(), NIGHT)).toBeNull();
    expect(decide('https://example.com/', state({ out: true }), NIGHT)).toBeNull();
  });

  it('blocks an always-on page at any time', () => {
    expect(decide('https://x.com/settings/content_you_see', state(), AFTERNOON)).toEqual({
      id: 'default-1'
    });
  });

  it('blocks a scheduled site only inside its window', () => {
    expect(decide('https://www.instagram.com/', state(), NIGHT)).toEqual({ id: 'default-5' });
    expect(decide('https://www.instagram.com/', state(), AFTERNOON)).toBeNull();
  });

  it('lets an allow rule win over a block', () => {
    expect(decide('https://www.linkedin.com/jobs/view/1', state(), NIGHT)).toBeNull();
    expect(decide('https://www.linkedin.com/feed', state(), NIGHT)).toEqual({ id: 'default-4' });
  });

  it('prefers a person block over a plain block on the same address', () => {
    const blocks = [block({ id: 'site', target: 'instagram.com' }), JANE];
    expect(decide('https://www.instagram.com/jane.doe', state({ blocks }), AFTERNOON)).toEqual({
      id: 'jane'
    });
  });

  it('blocks a search or lookalike profile for a blocked person', () => {
    const st = state({ blocks: [JANE] });
    expect(decide('https://www.google.com/search?q=jane+doe', st, AFTERNOON)).toEqual({
      id: 'jane',
      watch: true
    });
    expect(decide('https://www.instagram.com/jane_doe2/', st, AFTERNOON)).toEqual({
      id: 'jane',
      watch: true
    });
  });

  it('blocks budget sites only once the daily limit is used up', () => {
    expect(decide('https://www.tiktok.com/', state({ out: true }), AFTERNOON)).toEqual({
      budget: true
    });
    expect(decide('https://www.tiktok.com/', state(), AFTERNOON)).toBeNull();
  });

  describe('during a lock-in session', () => {
    const focus: FocusState = { task: 'write', totalMs: 3_600_000, phase: 'focus', endsAt: 10_000 };
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      budget_sites: [...DEFAULT_SETTINGS.budget_sites, 'youtube.com']
    };

    it('blocks the session sites even with time left', () => {
      expect(decide('https://www.tiktok.com/', state({ focus }), AFTERNOON)).toEqual({
        focus: true
      });
    });

    it('still honours an allow rule', () => {
      expect(decide('https://www.linkedin.com/jobs', state({ focus }), AFTERNOON)).toBeNull();
    });

    it('closes YouTube feeds and Shorts but not watching or search', () => {
      const st = state({ focus });
      expect(decide('https://www.youtube.com/feed/subscriptions', st, AFTERNOON)).toEqual({
        focus: true
      });
      expect(decide('https://www.youtube.com/shorts/abc', st, AFTERNOON)).toEqual({ focus: true });
      expect(decide('https://www.youtube.com/@name/shorts', st, AFTERNOON)).toEqual({
        focus: true
      });
      expect(decide('https://www.youtube.com/watch?v=abc', st, AFTERNOON)).toBeNull();
      expect(decide('https://www.youtube.com/results?search_query=lofi', st, AFTERNOON)).toBeNull();
    });

    it('lets YouTube ignore the daily limit while the timer runs, but not on a break', () => {
      const url = 'https://www.youtube.com/watch?v=abc';
      expect(decide(url, state({ focus, settings, out: true }), AFTERNOON)).toBeNull();
      expect(
        decide(url, state({ focus: { ...focus, phase: 'break' }, settings, out: true }), AFTERNOON)
      ).toEqual({
        budget: true
      });
    });
  });
});

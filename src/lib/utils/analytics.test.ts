import { describe, expect, it } from 'vitest';
import { buildUsage, weekAverage } from './analytics';
import type { SiteUsageRow, UsageDayRow } from '../types';

// Monday 28 September to Wednesday 7 October 2026: one full week and three days.
const START = new Date(2026, 8, 28);
const TODAY = new Date(2026, 9, 7);
const EXTRA = ['extra:youtube.com', 'extra:whatsapp.com'];

const SITE_ROWS: SiteUsageRow[] = [
  { day: '2026-09-30', site: 'reddit.com', seconds: 600 },
  { day: '2026-09-30', site: 'extra:youtube.com', seconds: 1200 },
  { day: '2026-10-06', site: 'extra:youtube.com', seconds: 900 }
];
const TOTAL_ROWS: UsageDayRow[] = [{ day: '2026-09-30', seconds: 600 }];
const PENDING_SITE = { '2026-09-30': { 'extra:whatsapp.com': 300, 'extra:youtube.com': 60 } };

const build = (extra?: string[]) =>
  buildUsage(START, TODAY, SITE_ROWS, TOTAL_ROWS, PENDING_SITE, {}, 7, extra);

describe('buildUsage', () => {
  it('makes one entry per day from the start to today', () => {
    const { days } = build(EXTRA);
    expect(days).toHaveLength(10);
    expect(days[0].key).toBe('2026-09-28');
    expect(days[9].key).toBe('2026-10-07');
  });

  it('keeps tracked-only sites out of the series and the limit total', () => {
    const data = build(EXTRA);
    const day = data.days[2];
    expect(data.series).toEqual(['reddit.com']);
    expect(data.extra).toEqual(EXTRA);
    expect(day.values).toEqual({ 'reddit.com': 600 });
    expect(day.total).toBe(600);
  });

  it('adds server rows and unsynced time for tracked-only sites', () => {
    const day = build(EXTRA).days[2];
    expect(day.extra).toEqual({ 'extra:youtube.com': 1260, 'extra:whatsapp.com': 300 });
    expect(day.totalAll).toBe(2160);
  });

  it('gives a day with only tracked-only time a zero limit total', () => {
    const day = build(EXTRA).days[8];
    expect(day.total).toBe(0);
    expect(day.values).toEqual({});
    expect(day.totalAll).toBe(900);
  });

  it('starts from the first day with any time, limit or tracked-only', () => {
    expect(build(EXTRA).firstData).toBe(2);
    const onlyExtra = buildUsage(START, TODAY, [SITE_ROWS[2]], [], {}, {}, 7, EXTRA);
    expect(onlyExtra.firstData).toBe(8);
    expect(onlyExtra.firstLimit).toBe(-1);
    expect(buildUsage(START, TODAY, [], [], {}, {}, 7, EXTRA).firstData).toBe(-1);
  });

  it('never counts time twice when a tracked-only site is also a limit site', () => {
    // YouTube was added to the daily-limit sites: its limit time has the plain key and is
    // in the recorded total, while earlier tracked-only time keeps its own key.
    const data = buildUsage(
      START,
      TODAY,
      [
        { day: '2026-09-30', site: 'youtube.com', seconds: 500 },
        { day: '2026-09-30', site: 'extra:youtube.com', seconds: 200 }
      ],
      [{ day: '2026-09-30', seconds: 500 }],
      {},
      {},
      7,
      EXTRA
    );
    const day = data.days[2];
    expect(data.series).toEqual(['youtube.com']);
    expect(day.values).toEqual({ 'youtube.com': 500 });
    expect(day.total).toBe(500);
    expect(day.extra).toEqual({ 'extra:youtube.com': 200 });
    expect(day.totalAll).toBe(700);
  });

  it('counts limited phone time as limit time, once', () => {
    // phone_event adds Instagram phone time to both site_usage and the usage total.
    const data = buildUsage(
      START,
      TODAY,
      [
        { day: '2026-09-30', site: 'reddit.com', seconds: 600 },
        { day: '2026-09-30', site: 'phone:instagram.com', seconds: 400 }
      ],
      [{ day: '2026-09-30', seconds: 1000 }],
      {},
      {},
      7,
      EXTRA
    );
    const day = data.days[2];
    expect(data.series).toContain('phone:instagram.com');
    expect(data.extra).not.toContain('phone:instagram.com');
    expect(day.values).toEqual({ 'reddit.com': 600, 'phone:instagram.com': 400 });
    expect(day.total).toBe(1000);
  });

  it('treats every site as a limit site when no tracked-only sites are given', () => {
    const data = build();
    const day = data.days[2];
    expect(data.series).toEqual(['extra:youtube.com', 'reddit.com', 'extra:whatsapp.com']);
    expect(day.total).toBe(2160);
    expect(day.totalAll).toBe(2160);
    expect(day.extra).toEqual({});
  });
});

describe('weekAverage', () => {
  it('averages both totals over the days since the first recorded day', () => {
    const week = weekAverage(build(EXTRA), 0)!;
    expect(week.n).toBe(5);
    expect(week.total).toBe(120);
    expect(week.values).toEqual({ 'reddit.com': 120 });
    expect(week.extra).toEqual({ 'extra:youtube.com': 252, 'extra:whatsapp.com': 60 });
    expect(week.totalAll).toBe(432);
  });

  it('divides the current week by the days so far', () => {
    const week = weekAverage(build(EXTRA), 1)!;
    expect(week.n).toBe(3);
    expect(week.total).toBe(0);
    expect(week.extra).toEqual({ 'extra:youtube.com': 300, 'extra:whatsapp.com': 0 });
    expect(week.totalAll).toBe(300);
  });

  it('averages tracked-only time from the day it was first recorded', () => {
    // Limit time since Monday, YouTube only since Thursday.
    const data = buildUsage(
      START,
      TODAY,
      [
        { day: '2026-09-28', site: 'reddit.com', seconds: 700 },
        { day: '2026-10-01', site: 'extra:youtube.com', seconds: 400 }
      ],
      [{ day: '2026-09-28', seconds: 700 }],
      {},
      {},
      7,
      EXTRA
    );
    const week = weekAverage(data, 0)!;
    expect(week.n).toBe(7);
    expect(week.total).toBe(100);
    expect(week.extra['extra:youtube.com']).toBe(100);
    expect(week.totalAll).toBe(200);
  });

  it('averages each tracked-only site from its own first day', () => {
    // YouTube since Monday, phone YouTube only since Friday.
    const phone = 'extra:phone:youtube.com';
    const data = buildUsage(
      START,
      TODAY,
      [
        { day: '2026-09-28', site: 'extra:youtube.com', seconds: 700 },
        { day: '2026-10-02', site: phone, seconds: 600 }
      ],
      [],
      {},
      {},
      7,
      [...EXTRA, phone]
    );
    expect(data.series).toEqual([]);
    const week = weekAverage(data, 0)!;
    expect(week.total).toBe(0);
    expect(week.extra['extra:youtube.com']).toBe(100);
    expect(week.extra[phone]).toBe(200);
    expect(week.totalAll).toBe(300);
    // Later weeks still count from that first day, not from their own.
    expect(weekAverage(data, 1)!.extra[phone]).toBe(0);
  });

  it('averages limit time from its own first day when tracked-only time is older', () => {
    const data = buildUsage(
      START,
      TODAY,
      [
        { day: '2026-09-28', site: 'extra:youtube.com', seconds: 700 },
        { day: '2026-10-01', site: 'reddit.com', seconds: 400 }
      ],
      [{ day: '2026-10-01', seconds: 400 }],
      {},
      {},
      7,
      EXTRA
    );
    const week = weekAverage(data, 0)!;
    expect(week.n).toBe(7);
    expect(week.total).toBe(100);
    expect(week.values).toEqual({ 'reddit.com': 100 });
    expect(week.extra['extra:youtube.com']).toBe(100);
    expect(week.totalAll).toBe(200);
  });

  it('shows no limit average when only tracked-only time exists', () => {
    const data = buildUsage(START, TODAY, [SITE_ROWS[2]], [], {}, {}, 7, EXTRA);
    const week = weekAverage(data, 1)!;
    expect(week.n).toBe(2);
    expect(week.total).toBe(0);
    expect(week.extra['extra:youtube.com']).toBe(450);
    expect(week.totalAll).toBe(450);
  });

  it('returns null outside the range or without any data', () => {
    expect(weekAverage(build(EXTRA), 2)).toBeNull();
    expect(weekAverage(build(EXTRA), -1)).toBeNull();
    expect(weekAverage(buildUsage(START, TODAY, [], [], {}, {}, 7, EXTRA), 0)).toBeNull();
  });
});

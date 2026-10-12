import { describe, expect, it } from 'vitest';
import { buildUsage, weekAverage } from './analytics';
import type { SiteUsageRow, UsageDayRow } from '../types';

// Monday 28 September to Wednesday 7 October 2026: one full week and three days.
const START = new Date(2026, 8, 28);
const TODAY = new Date(2026, 9, 7);
const EXTRA = ['youtube.com', 'whatsapp.com'];

const SITE_ROWS: SiteUsageRow[] = [
  { day: '2026-09-30', site: 'reddit.com', seconds: 600 },
  { day: '2026-09-30', site: 'youtube.com', seconds: 1200 },
  { day: '2026-10-06', site: 'youtube.com', seconds: 900 }
];
const TOTAL_ROWS: UsageDayRow[] = [{ day: '2026-09-30', seconds: 600 }];
const PENDING_SITE = { '2026-09-30': { 'whatsapp.com': 300, 'youtube.com': 60 } };

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
    expect(day.extra).toEqual({ 'youtube.com': 1260, 'whatsapp.com': 300 });
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
    expect(buildUsage(START, TODAY, [], [], {}, {}, 7, EXTRA).firstData).toBe(-1);
  });

  it('treats every site as a limit site when no tracked-only sites are given', () => {
    const data = build();
    const day = data.days[2];
    expect(data.series).toEqual(['youtube.com', 'reddit.com', 'whatsapp.com']);
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
    expect(week.extra).toEqual({ 'youtube.com': 252, 'whatsapp.com': 60 });
    expect(week.totalAll).toBe(432);
  });

  it('divides the current week by the days so far', () => {
    const week = weekAverage(build(EXTRA), 1)!;
    expect(week.n).toBe(3);
    expect(week.total).toBe(0);
    expect(week.extra).toEqual({ 'youtube.com': 300, 'whatsapp.com': 0 });
    expect(week.totalAll).toBe(300);
  });

  it('returns null outside the range or without any data', () => {
    expect(weekAverage(build(EXTRA), 2)).toBeNull();
    expect(weekAverage(build(EXTRA), -1)).toBeNull();
    expect(weekAverage(buildUsage(START, TODAY, [], [], {}, {}, 7, EXTRA), 0)).toBeNull();
  });
});

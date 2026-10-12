// Turning usage rows into days and weekly averages for the analytics page.
import { dayKey } from './common';
import type { SiteUsageRow, UsageDayRow, PendingUsage, PendingSiteUsage } from '../types';

export const OTHER = 'Other sites';
export const UNSPLIT = 'Not broken down'; // time recorded without a site, e.g. before per-site tracking existed

export interface UsageDay {
  key: string;
  date: Date;
  values: Record<string, number>; // seconds per series
  total: number; // seconds, from the same count the daily limit uses
  extra: Record<string, number>; // seconds per tracked-only site, not part of total
  totalAll: number; // total plus the tracked-only sites
}

export interface UsageData {
  days: UsageDay[];
  series: string[]; // sites with their own series, most used first, then OTHER and UNSPLIT if present
  extra: string[]; // tracked-only sites, kept apart from series
  firstData: number; // index of the first day with any time recorded, or -1
}

export interface WeekAverage {
  first: Date; // the week's Monday
  n: number; // days averaged over
  values: Record<string, number>; // average seconds per day, per series
  total: number; // average seconds per day
  extra: Record<string, number>; // average seconds per day, per tracked-only site
  totalAll: number; // average seconds per day, tracked-only sites included
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// One entry per day from start to today. Server rows and time not yet synced
// are added together. The `slots` most-used sites keep their own series; the
// rest are folded into OTHER. Sites in `extra` don't count against the daily
// limit, so they stay out of the series and the total.
export function buildUsage(
  start: Date,
  today: Date,
  siteRows: SiteUsageRow[],
  totalRows: UsageDayRow[],
  pendingSite: PendingSiteUsage,
  pendingTotal: PendingUsage,
  slots: number,
  extra: string[] = []
): UsageData {
  const sites: Record<string, Record<string, number>> = {};
  const extras: Record<string, Record<string, number>> = {};
  const addSite = (day: string, site: string, secs: number): void => {
    const m = ((extra.includes(site) ? extras : sites)[day] ||= {});
    m[site] = (m[site] || 0) + secs;
  };
  for (const r of siteRows) addSite(r.day, r.site, r.seconds);
  for (const [day, m] of Object.entries(pendingSite)) {
    for (const [site, secs] of Object.entries(m)) addSite(day, site, secs);
  }

  const totals: Record<string, number> = {};
  for (const r of totalRows) totals[r.day] = (totals[r.day] || 0) + r.seconds;
  for (const [day, secs] of Object.entries(pendingTotal)) totals[day] = (totals[day] || 0) + secs;

  const days: UsageDay[] = [];
  const sums: Record<string, number> = {};
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const key = dayKey(d);
    for (const [site, secs] of Object.entries(sites[key] || {}))
      sums[site] = (sums[site] || 0) + secs;
    days.push({ key, date: d, values: {}, total: 0, extra: extras[key] || {}, totalAll: 0 });
  }
  const named = Object.keys(sums)
    .sort((a, b) => sums[b] - sums[a] || a.localeCompare(b))
    .slice(0, slots);

  for (const day of days) {
    let split = 0;
    for (const [site, secs] of Object.entries(sites[day.key] || {})) {
      const k = named.includes(site) ? site : OTHER;
      day.values[k] = (day.values[k] || 0) + secs;
      split += secs;
    }
    // The day's total is the recorded total, not the sum of the sites: the two
    // are rounded separately when synced and can differ by a few seconds.
    day.total = Math.max(totals[day.key] || 0, split);
    const gap = day.total - split;
    if (gap >= 60) day.values[UNSPLIT] = gap;
    day.totalAll = day.total + Object.values(day.extra).reduce((a, b) => a + b, 0);
  }

  const series = [...named];
  if (days.some((d) => d.values[OTHER])) series.push(OTHER);
  if (days.some((d) => d.values[UNSPLIT])) series.push(UNSPLIT);

  return { days, series, extra, firstData: days.findIndex((d) => d.totalAll > 0) };
}

// Average per day for week w, where week 0 starts at days[0] (a Monday).
// Days before the first recorded day and days after today don't count, so
// the current week divides by the days so far.
export function weekAverage(data: UsageData, w: number): WeekAverage | null {
  const { days, series, extra, firstData } = data;
  if (firstData < 0 || w < 0 || w * 7 >= days.length) return null;
  const slice = days.slice(w * 7, w * 7 + 7).filter((_, i) => w * 7 + i >= firstData);
  const n = slice.length;
  if (!n) return null;
  const values: Record<string, number> = {};
  for (const k of series) values[k] = slice.reduce((a, d) => a + (d.values[k] || 0), 0) / n;
  const extras: Record<string, number> = {};
  for (const k of extra) extras[k] = slice.reduce((a, d) => a + (d.extra[k] || 0), 0) / n;
  return {
    first: days[w * 7].date,
    n,
    values,
    total: slice.reduce((a, d) => a + d.total, 0) / n,
    extra: extras,
    totalAll: slice.reduce((a, d) => a + d.totalAll, 0) / n
  };
}

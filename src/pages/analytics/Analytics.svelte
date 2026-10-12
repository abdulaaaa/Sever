<script lang="ts">
  import { onMount } from 'svelte';
  import { dayKey, FOCUS_KEYS, emptyFocusDay, focusLeft } from '../../lib/utils/common';
  import { EXTRA_SITES, EXTRA_PREFIX } from '../../lib/utils/config';
  import { fetchSiteUsageSince, fetchUsageSince, fetchFocusSince } from '../../lib/services/supa';
  import {
    addDays,
    buildUsage,
    weekAverage,
    OTHER,
    UNSPLIT,
    type UsageData,
    type UsageDay
  } from '../../lib/utils/analytics';
  import type {
    PendingUsage,
    PendingSiteUsage,
    SiteUsageRow,
    UsageDayRow,
    FocusLog,
    FocusDay,
    FocusDayRow,
    FocusState
  } from '../../lib/types';

  const WEEKS = 12; // how far back to load
  const SLOTS = 7; // sites that get their own colour; the rest fold into "Other sites"
  const PLOT_H = 220;

  interface Series {
    key: string;
    color: string;
  }
  interface Row {
    label: string;
    note: string;
    values: Record<string, number>;
    total: number;
    totalAll: number; // with YouTube and WhatsApp
  }

  // Weeks run Monday to Sunday.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- set once, never read reactively
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const start = addDays(monday, -(WEEKS - 1) * 7);

  let loading = $state(true);
  let error = $state('');
  let siteError = $state(false);
  let data: UsageData = $state.raw({
    days: [],
    series: [],
    extra: [],
    firstData: -1,
    firstLimit: -1,
    firstExtra: -1
  });
  let range = $state(4); // weeks shown in the chart
  let withExtra = $state(false); // also show YouTube and WhatsApp, which don't count against the limit
  let hover: number | null = $state(null);
  let focusDays: Array<{ date: Date; d: FocusDay }> = $state([]); // lock-in history, newest first
  let focusRunning = $state(false);
  let focusError = $state(false); // lock-in history couldn't be read from the database

  function fmt(secs: number): string {
    const m = Math.round(secs / 60);
    if (m < 1) return secs >= 1 ? '<1m' : '–';
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  const dateFmt = (d: Date): string => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const dayFmt = (d: Date): string =>
    d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  async function load(): Promise<void> {
    const from = dayKey(start);
    const [siteRows, totalRows, focusRows, local] = await Promise.all([
      fetchSiteUsageSince(from).catch((): SiteUsageRow[] | null => null),
      fetchUsageSince(from).catch((e): UsageDayRow[] => {
        error = String((e as Error).message || e);
        return [];
      }),
      fetchFocusSince(from).catch((): FocusDayRow[] => {
        focusError = true;
        return [];
      }),
      chrome.storage.local.get([
        'pendingUsage',
        'pendingSiteUsage',
        'pendingFocus',
        'focusLog',
        'focus'
      ]) as Promise<{
        pendingUsage?: PendingUsage;
        pendingSiteUsage?: PendingSiteUsage;
        pendingFocus?: FocusLog;
        focusLog?: FocusLog; // history from before it was synced, until the next sync uploads it
        focus?: FocusState;
      }>
    ]);
    siteError = siteRows === null && !error;

    // Lock-in history: synced days plus whatever hasn't been synced yet.
    const log: FocusLog = {};
    for (const [day, d] of [
      ...focusRows.map((r): [string, FocusDay] => [r.day, r]),
      ...Object.entries(local.pendingFocus || {}),
      ...Object.entries(local.focusLog || {})
    ]) {
      const sum = (log[day] ||= emptyFocusDay());
      for (const k of FOCUS_KEYS) sum[k] += d[k] || 0;
    }
    // A session is only written to history when it ends, so add the one in progress.
    if (local.focus && local.focus.phase !== 'break') {
      const sum = (log[dayKey(today)] ||= emptyFocusDay());
      sum.seconds += (local.focus.totalMs - focusLeft(local.focus)) / 1000;
      sum.sessions += 1;
      focusRunning = true;
    }
    const list: typeof focusDays = [];
    for (let d = today; d >= start; d = addDays(d, -1)) {
      if (log[dayKey(d)]) list.push({ date: d, d: log[dayKey(d)] });
    }
    focusDays = list;

    data = buildUsage(
      start,
      today,
      siteRows || [],
      totalRows,
      local.pendingSiteUsage || {},
      local.pendingUsage || {},
      SLOTS,
      EXTRA_SITES.map((site) => EXTRA_PREFIX + site)
    );
    loading = false;
  }

  const days: UsageDay[] = $derived(data.days);
  const firstData = $derived(data.firstData);

  // Colour follows the site: ranked once over everything loaded, not per view.
  const series: Series[] = $derived(
    data.series.map((key, i) => ({
      key,
      color:
        key === OTHER ? 'var(--s-other)' : key === UNSPLIT ? 'var(--s-unsplit)' : `var(--s${i + 1})`
    }))
  );

  // Tracked-only sites keep fixed colours and stack on top of the limit sites.
  const NAMES: Record<string, string> = {
    [EXTRA_PREFIX + 'youtube.com']: 'YouTube',
    [EXTRA_PREFIX + 'whatsapp.com']: 'WhatsApp'
  };
  const label = (key: string): string => NAMES[key] || key;
  const extraLabel = $derived(data.extra.map(label).join(' + '));
  const extraSeries: Series[] = $derived(
    data.extra.map((key, i) => ({ key, color: `var(--x${i + 1})` }))
  );
  const cols = $derived(withExtra ? [...series, ...extraSeries] : series);

  const dayTotal = (d: UsageDay): number => (withExtra ? d.totalAll : d.total);
  const dayVal = (d: UsageDay, k: string): number => d.values[k] || d.extra[k] || 0;

  function weekRow(w: number): Row | null {
    const avg = weekAverage(data, w);
    if (!avg) return null;
    const { n } = avg;
    const note =
      w === WEEKS - 1
        ? `so far, ${n} day${n === 1 ? '' : 's'}`
        : n < 7
          ? `${n} day${n === 1 ? '' : 's'} tracked`
          : '';
    return {
      label: `${dateFmt(avg.first)} – ${dateFmt(addDays(avg.first, 6))}`,
      note,
      values: { ...avg.values, ...avg.extra },
      total: avg.total,
      totalAll: avg.totalAll
    };
  }

  const shown = $derived(days.slice((WEEKS - range) * 7));

  const scale = $derived.by(() => {
    const maxMin = Math.max(1, ...shown.map(dayTotal)) / 60;
    const step = [5, 10, 15, 30, 60, 120, 240].find((s) => maxMin / s <= 4) ?? 480;
    const top = Math.max(step, Math.ceil(maxMin / step) * step);
    const ticks: number[] = [];
    for (let t = 0; t <= top; t += step) ticks.push(t * 60);
    return { top: top * 60, ticks };
  });

  const weekRows = $derived.by(() => {
    const rows: Row[] = [];
    for (let w = WEEKS - 1; w >= 0; w--) {
      const r = weekRow(w);
      if (r) rows.push(r);
    }
    return rows;
  });

  const dayRows = $derived(
    shown
      .filter((_, i) => (WEEKS - range) * 7 + i >= firstData)
      .map((d): Row => ({
        label: dayFmt(d.date),
        note: '',
        values: { ...d.values, ...d.extra },
        total: d.total,
        totalAll: d.totalAll
      }))
      .reverse()
  );

  const thisWeek = $derived(days.length ? weekRow(WEEKS - 1) : null);
  const lastWeek = $derived(days.length ? weekRow(WEEKS - 2) : null);

  function outcomes(d: FocusDay): string {
    const parts = [
      d.done && `${d.done} done`,
      d.partly && `${d.partly} partly`,
      d.pulled && `${d.pulled} pulled away`,
      d.early && `${d.early} ended early`
    ].filter(Boolean);
    return parts.join(' · ') || '–';
  }

  onMount(load);
</script>

{#snippet table(first: string, rows: Row[])}
  <div class="scroll">
    <table class="table">
      <thead>
        <tr>
          <th>{first}</th>
          {#each cols as s (s.key)}
            <th class="num"><span class="sw" style:background={s.color}></span>{label(s.key)}</th>
          {/each}
          <th class="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.label)}
          <tr>
            <td>
              {r.label}
              {#if r.note}<span class="muted small"> · {r.note}</span>{/if}
            </td>
            {#each cols as s (s.key)}
              <td class="num">{fmt(r.values[s.key] || 0)}</td>
            {/each}
            <td class="num total">{fmt(withExtra ? r.totalAll : r.total)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

{#snippet figures(total: number, totalAll: number)}
  {#if data.extra.length}
    <div class="pair">
      <div><b>{fmt(total)}</b><span class="muted small">Limit sites</span></div>
      <div><b>{fmt(totalAll)}</b><span class="muted small">With {extraLabel}</span></div>
    </div>
  {:else}
    <b>{fmt(total)}</b>
  {/if}
{/snippet}

<div class="wrap">
  <h1>Usage analytics</h1>
  <p class="lede">
    Time on your daily-limit sites, per site, for the last {WEEKS} weeks.
    {#if data.extra.length}{extraLabel} time is recorded too and doesn't count against the limit.{/if}
    <a href="../options/index.html">Settings</a>
  </p>

  {#if error}
    <div class="card notice">
      Couldn't reach the database ({error}). Showing only time that hasn't synced yet.
    </div>
  {:else if siteError}
    <div class="card notice">
      Per-site data isn't available yet: the <code>site_usage</code> table is missing. Run the "Per-site
      usage" SQL from the README in Supabase. Until then only daily totals are shown.
    </div>
  {/if}

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if firstData < 0}
    <div class="card">
      No time recorded yet. Per-site tracking starts from the day this page was added.
    </div>
  {:else}
    <div class="tiles">
      <div class="tile">
        <span class="muted small">Today</span>
        {@render figures(days[days.length - 1].total, days[days.length - 1].totalAll)}
      </div>
      {#if thisWeek}
        <div class="tile">
          <span class="muted small">This week, average per day</span>
          {@render figures(thisWeek.total, thisWeek.totalAll)}
        </div>
      {/if}
      {#if lastWeek}
        <div class="tile">
          <span class="muted small">Last week, average per day</span>
          {@render figures(lastWeek.total, lastWeek.totalAll)}
        </div>
      {/if}
    </div>

    <div class="card">
      <div class="head">
        <div>
          <h2>Time per day</h2>
          <p class="muted">Each bar is one day, split by site.</p>
        </div>
        <div class="controls">
          {#if data.extra.length}
            <div class="ranges">
              <button
                class:on={!withExtra}
                aria-pressed={!withExtra}
                onclick={() => (withExtra = false)}>Limit sites only</button
              >
              <button
                class:on={withExtra}
                aria-pressed={withExtra}
                onclick={() => (withExtra = true)}>With {extraLabel}</button
              >
            </div>
          {/if}
          <div class="ranges">
            {#each [2, 4, 12] as w (w)}
              <button
                class:on={range === w}
                aria-pressed={range === w}
                onclick={() => {
                  range = w;
                  hover = null;
                }}>{w} weeks</button
              >
            {/each}
          </div>
        </div>
      </div>

      <div class="legend">
        {#each cols as s (s.key)}
          <span><span class="sw" style:background={s.color}></span>{label(s.key)}</span>
        {/each}
      </div>

      <div class="chart">
        <div class="yaxis" style:height="{PLOT_H}px">
          {#each scale.ticks as t (t)}
            <span style:bottom="{(t / scale.top) * 100}%">{t ? fmt(t) : '0'}</span>
          {/each}
        </div>
        <div class="plotwrap">
          <div
            class="plot"
            style:height="{PLOT_H}px"
            role="group"
            aria-label="Time per day by site"
            onmouseleave={() => (hover = null)}
          >
            {#each scale.ticks as t (t)}
              <i class="grid" style:bottom="{(t / scale.top) * 100}%"></i>
            {/each}
            {#each shown as d, i (d.key)}
              <button
                class="col"
                aria-label="{dayFmt(d.date)}: {fmt(dayTotal(d))}"
                onmouseenter={() => (hover = i)}
                onfocus={() => (hover = i)}
                onblur={() => (hover = null)}
              >
                {#each cols as s (s.key)}
                  {#if dayVal(d, s.key)}
                    <i
                      style:height="{(dayVal(d, s.key) / scale.top) * PLOT_H}px"
                      style:background={s.color}
                    ></i>
                  {/if}
                {/each}
              </button>
            {/each}
            {#if hover !== null && shown[hover]}
              {@const d = shown[hover]}
              {@const pos = (hover + 0.5) / shown.length}
              <div
                class="tip"
                class:left={pos < 0.25}
                class:right={pos > 0.75}
                style:left="{pos * 100}%"
              >
                <div class="top"><span>{dayFmt(d.date)}</span><span>{fmt(dayTotal(d))}</span></div>
                {#each cols as s (s.key)}
                  {#if dayVal(d, s.key)}
                    <div>
                      <span><span class="sw" style:background={s.color}></span>{label(s.key)}</span
                      ><span>{fmt(dayVal(d, s.key))}</span>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
          <div class="xaxis">
            {#each shown as d (d.key)}
              <span>{d.date.getDay() === 1 ? dateFmt(d.date) : ''}</span>
            {/each}
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Weekly average</h2>
      <p class="muted">
        Average time per day in each week (Monday to Sunday), per site.{withExtra
          ? ` Total includes ${extraLabel}.`
          : ''}
      </p>
      {@render table('Week', weekRows)}
    </div>

    <div class="card">
      <details>
        <summary>Daily breakdown, last {range} weeks</summary>
        {@render table('Day', dayRows)}
      </details>
    </div>
  {/if}

  {#if focusDays.length}
    <div class="card">
      <h2>Lock-in sessions</h2>
      <p class="muted">
        Time spent locked in. YouTube watched during a session is listed here and not counted above.{focusRunning
          ? ' Today includes the session in progress.'
          : ''}
      </p>
      {#if focusError && !error}
        <p class="muted">
          Only sessions from this browser are shown: lock-in history isn't syncing. Run the "Lock-in
          mode" SQL from the README in Supabase.
        </p>
      {/if}
      <div class="scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Day</th>
              <th class="num">Locked in</th>
              <th class="num">Sessions</th>
              <th>How they went</th>
              <th class="num">On YouTube</th>
            </tr>
          </thead>
          <tbody>
            {#each focusDays as row (row.date.getTime())}
              <tr>
                <td>{dayFmt(row.date)}</td>
                <td class="num total">{fmt(row.d.seconds)}</td>
                <td class="num">{row.d.sessions}</td>
                <td>{outcomes(row.d)}</td>
                <td class="num">{fmt(row.d.video)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>

<style>
  .wrap {
    --s1: #2a78d6;
    --s2: #eb6834;
    --s3: #1baf7a;
    --s4: #eda100;
    --s5: #e87ba4;
    --s6: #008300;
    --s7: #6250d6;
    --s-other: #8a8a85;
    --s-unsplit: #c9c9c3;
    --x1: #c8281e;
    --x2: #0e9aa7;
  }
  @media (prefers-color-scheme: dark) {
    .wrap {
      --s1: #3987e5;
      --s2: #d95926;
      --s3: #199e70;
      --s4: #c98500;
      --s5: #d55181;
      --s6: #008300;
      --s7: #9085e9;
      --s-other: #7d7d78;
      --s-unsplit: #4a4a47;
      --x1: #e5534b;
      --x2: #2bb8c6;
    }
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: flex-start;
    justify-content: space-between;
  }
  .tiles {
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  }
  .pair {
    display: flex;
    gap: 22px;
  }
  .pair span {
    display: block;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  .ranges {
    display: flex;
    gap: 6px;
  }
  .ranges button.on {
    background: var(--soft);
    border-color: var(--muted);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 13px;
    margin-bottom: 18px;
  }
  .sw {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 3px;
    margin-right: 6px;
  }
  .chart {
    display: flex;
    gap: 8px;
  }
  .yaxis {
    position: relative;
    width: 44px;
    flex: none;
    font-size: 11px;
    color: var(--muted);
  }
  .yaxis span {
    position: absolute;
    right: 0;
    transform: translateY(50%);
    white-space: nowrap;
  }
  .plotwrap {
    flex: 1;
    min-width: 0;
  }
  .plot {
    position: relative;
    display: flex;
  }
  .grid {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--line);
  }
  .col {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column-reverse;
    align-items: center;
    gap: 2px;
    padding: 0 1px;
    border: 0;
    border-radius: 0;
    background: none;
    cursor: default;
  }
  .col:hover,
  .col:focus-visible {
    background: var(--soft);
  }
  .col i {
    display: block;
    flex: none;
    width: 100%;
    max-width: 24px;
  }
  .col i:last-child {
    border-radius: 3px 3px 0 0;
  }
  .xaxis {
    display: flex;
    margin-top: 6px;
    height: 16px;
    font-size: 11px;
    color: var(--muted);
  }
  .xaxis span {
    flex: 1 1 0;
    min-width: 0;
    white-space: nowrap;
  }
  .tip {
    position: absolute;
    bottom: calc(100% + 4px);
    z-index: 2;
    min-width: 170px;
    padding: 8px 10px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    font-size: 12px;
    pointer-events: none;
    transform: translateX(-50%);
  }
  .tip.left {
    transform: none;
  }
  .tip.right {
    transform: translateX(-100%);
  }
  .tip div {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    white-space: nowrap;
  }
  .tip .top {
    font-weight: 600;
    margin-bottom: 4px;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
  }
  details[open] summary {
    margin-bottom: 10px;
  }
</style>

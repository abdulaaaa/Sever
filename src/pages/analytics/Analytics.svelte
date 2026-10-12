<script lang="ts">
  import { onMount } from 'svelte';
  import { dayKey } from '../../lib/utils/common';
  import { fetchSiteUsageSince, fetchUsageSince } from '../../lib/services/supa';
  import { addDays, buildUsage, weekAverage, OTHER, UNSPLIT, type UsageData, type UsageDay } from '../../lib/utils/analytics';
  import type { PendingUsage, PendingSiteUsage, SiteUsageRow, UsageDayRow } from '../../lib/types';

  const WEEKS = 12;             // how far back to load
  const SLOTS = 7;              // sites that get their own colour; the rest fold into "Other sites"
  const PLOT_H = 220;

  interface Series { key: string; color: string; }
  interface Row { label: string; note: string; values: Record<string, number>; total: number; }

  // Weeks run Monday to Sunday.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const start = addDays(monday, -(WEEKS - 1) * 7);

  let loading = $state(true);
  let error = $state('');
  let siteError = $state(false);
  let data: UsageData = $state.raw({ days: [], series: [], firstData: -1 });
  let range = $state(4);      // weeks shown in the chart
  let hover: number | null = $state(null);

  function fmt(secs: number): string {
    const m = Math.round(secs / 60);
    if (m < 1) return secs >= 1 ? '<1m' : '–';
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  const dateFmt = (d: Date): string => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const dayFmt = (d: Date): string => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  async function load(): Promise<void> {
    const from = dayKey(start);
    const [siteRows, totalRows, local] = await Promise.all([
      fetchSiteUsageSince(from).catch((): SiteUsageRow[] | null => null),
      fetchUsageSince(from).catch((e): UsageDayRow[] => {
        error = String((e as Error).message || e);
        return [];
      }),
      chrome.storage.local.get(['pendingUsage', 'pendingSiteUsage']) as Promise<{
        pendingUsage?: PendingUsage;
        pendingSiteUsage?: PendingSiteUsage;
      }>
    ]);
    siteError = siteRows === null && !error;

    data = buildUsage(
      start, today,
      siteRows || [], totalRows,
      local.pendingSiteUsage || {}, local.pendingUsage || {},
      SLOTS
    );
    loading = false;
  }

  const days: UsageDay[] = $derived(data.days);
  const firstData = $derived(data.firstData);

  // Colour follows the site: ranked once over everything loaded, not per view.
  const series: Series[] = $derived(data.series.map((key, i) => ({
    key,
    color: key === OTHER ? 'var(--s-other)' : key === UNSPLIT ? 'var(--s-unsplit)' : `var(--s${i + 1})`
  })));

  function weekRow(w: number): Row | null {
    const avg = weekAverage(data, w);
    if (!avg) return null;
    const { n } = avg;
    const note = w === WEEKS - 1
      ? `so far, ${n} day${n === 1 ? '' : 's'}`
      : n < 7 ? `${n} day${n === 1 ? '' : 's'} tracked` : '';
    return {
      label: `${dateFmt(avg.first)} – ${dateFmt(addDays(avg.first, 6))}`,
      note,
      values: avg.values,
      total: avg.total
    };
  }

  const shown = $derived(days.slice((WEEKS - range) * 7));

  const scale = $derived.by(() => {
    const maxMin = Math.max(1, ...shown.map((d) => d.total)) / 60;
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
      .map((d): Row => ({ label: dayFmt(d.date), note: '', values: d.values, total: d.total }))
      .reverse()
  );

  const thisWeek = $derived(days.length ? weekRow(WEEKS - 1) : null);
  const lastWeek = $derived(days.length ? weekRow(WEEKS - 2) : null);

  onMount(load);
</script>

<style>
  .wrap {
    --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100;
    --s5: #e87ba4; --s6: #008300; --s7: #6250d6;
    --s-other: #8a8a85; --s-unsplit: #c9c9c3;
  }
  @media (prefers-color-scheme: dark) {
    .wrap {
      --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
      --s5: #d55181; --s6: #008300; --s7: #9085e9;
      --s-other: #7d7d78; --s-unsplit: #4a4a47;
    }
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: flex-start;
    justify-content: space-between;
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
  .col:hover, .col:focus-visible {
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

{#snippet table(first: string, rows: Row[])}
  <div class="scroll">
    <table class="table">
      <thead>
        <tr>
          <th>{first}</th>
          {#each series as s}
            <th class="num"><span class="sw" style:background={s.color}></span>{s.key}</th>
          {/each}
          <th class="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r}
          <tr>
            <td>
              {r.label}
              {#if r.note}<span class="muted small"> · {r.note}</span>{/if}
            </td>
            {#each series as s}
              <td class="num">{fmt(r.values[s.key] || 0)}</td>
            {/each}
            <td class="num total">{fmt(r.total)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

<div class="wrap">
  <h1>Usage analytics</h1>
  <p class="lede">Time on your daily-limit sites, per site, for the last {WEEKS} weeks. <a href="../options/index.html">Settings</a></p>

  {#if error}
    <div class="card notice">Couldn't reach the database ({error}). Showing only time that hasn't synced yet.</div>
  {:else if siteError}
    <div class="card notice">Per-site data isn't available yet: the <code>site_usage</code> table is missing. Run the "Per-site usage" SQL from the README in Supabase. Until then only daily totals are shown.</div>
  {/if}

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if firstData < 0}
    <div class="card">No time recorded yet. Per-site tracking starts from the day this page was added.</div>
  {:else}
    <div class="tiles">
      <div class="tile">
        <span class="muted small">Today</span>
        <b>{fmt(days[days.length - 1].total)}</b>
      </div>
      {#if thisWeek}
        <div class="tile">
          <span class="muted small">This week, average per day</span>
          <b>{fmt(thisWeek.total)}</b>
        </div>
      {/if}
      {#if lastWeek}
        <div class="tile">
          <span class="muted small">Last week, average per day</span>
          <b>{fmt(lastWeek.total)}</b>
        </div>
      {/if}
    </div>

    <div class="card">
      <div class="head">
        <div>
          <h2>Time per day</h2>
          <p class="muted">Each bar is one day, split by site.</p>
        </div>
        <div class="ranges">
          {#each [2, 4, 12] as w}
            <button class:on={range === w} aria-pressed={range === w} onclick={() => { range = w; hover = null; }}>{w} weeks</button>
          {/each}
        </div>
      </div>

      <div class="legend">
        {#each series as s}
          <span><span class="sw" style:background={s.color}></span>{s.key}</span>
        {/each}
      </div>

      <div class="chart">
        <div class="yaxis" style:height="{PLOT_H}px">
          {#each scale.ticks as t}
            <span style:bottom="{(t / scale.top) * 100}%">{t ? fmt(t) : '0'}</span>
          {/each}
        </div>
        <div class="plotwrap">
          <div class="plot" style:height="{PLOT_H}px" role="group" aria-label="Time per day by site" onmouseleave={() => (hover = null)}>
            {#each scale.ticks as t}
              <i class="grid" style:bottom="{(t / scale.top) * 100}%"></i>
            {/each}
            {#each shown as d, i}
              <button
                class="col"
                aria-label="{dayFmt(d.date)}: {fmt(d.total)}"
                onmouseenter={() => (hover = i)}
                onfocus={() => (hover = i)}
                onblur={() => (hover = null)}
              >
                {#each series as s}
                  {#if d.values[s.key]}
                    <i style:height="{(d.values[s.key] / scale.top) * PLOT_H}px" style:background={s.color}></i>
                  {/if}
                {/each}
              </button>
            {/each}
            {#if hover !== null && shown[hover]}
              {@const d = shown[hover]}
              {@const pos = (hover + 0.5) / shown.length}
              <div class="tip" class:left={pos < 0.25} class:right={pos > 0.75} style:left="{pos * 100}%">
                <div class="top"><span>{dayFmt(d.date)}</span><span>{fmt(d.total)}</span></div>
                {#each series as s}
                  {#if d.values[s.key]}
                    <div><span><span class="sw" style:background={s.color}></span>{s.key}</span><span>{fmt(d.values[s.key])}</span></div>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
          <div class="xaxis">
            {#each shown as d}
              <span>{d.date.getDay() === 1 ? dateFmt(d.date) : ''}</span>
            {/each}
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Weekly average</h2>
      <p class="muted">Average time per day in each week (Monday to Sunday), per site.</p>
      {@render table('Week', weekRows)}
    </div>

    <div class="card">
      <details>
        <summary>Daily breakdown, last {range} weeks</summary>
        {@render table('Day', dayRows)}
      </details>
    </div>
  {/if}
</div>

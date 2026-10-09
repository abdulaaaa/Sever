<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadState, schedActive, timeLabel } from '../../lib/utils/common';
  import type { ExtensionState } from '../../lib/types';

  let notice = $state('');
  let showNotice = $state(false);
  let timeLeft = $state('-');
  let usedText = $state('');
  let fillPercent = $state(0);
  let barClass = $state('bar');
  let activeBlocks: Array<{ text: string }> = $state([]);

  let tickInterval: ReturnType<typeof setInterval> | null = null;
  let syncInterval: ReturnType<typeof setInterval> | null = null;
  let localRemaining = 0;
  let isTracking = false;

  function formatTimeRemaining(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    if (s === 0) return 'Used up';

    if (s >= 3600) {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')} left`;
    }
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')} left`;
  }

  function updateTimeUI(): void {
    timeLeft = formatTimeRemaining(localRemaining);
    const minutesLeft = Math.ceil(localRemaining / 60);
    barClass = 'bar' + (localRemaining === 0 ? ' out' : minutesLeft <= 10 ? ' warn' : '');
  }

  async function syncTime(): Promise<void> {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getTimeLeft' }) as {
        remaining: number;
        tracking?: boolean;
      };
      if (response && typeof response.remaining === 'number') {
        localRemaining = response.remaining;
        isTracking = response.tracking ?? false;
        updateTimeUI();
      }
    } catch {
      // Extension context invalidated
    }
  }

  function startTicking(): void {
    if (tickInterval) return;

    syncTime();

    tickInterval = setInterval(() => {
      if (isTracking) {
        localRemaining = Math.max(0, localRemaining - 1);
        updateTimeUI();
      }
    }, 1000);

    syncInterval = setInterval(syncTime, 2000);
  }

  function stopTicking(): void {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
  }

  function openSettings(): void {
    chrome.runtime.openOptionsPage();
  }

  async function render(): Promise<void> {
    const st = await loadState();

    if (!st.session) {
      notice = "Not signed in: using your saved blocks. Sign in from Settings to sync both profiles.";
      showNotice = true;
    } else if (st.lastError) {
      notice = "Couldn't reach the database. Your saved blocks still apply.";
      showNotice = true;
    }

    localRemaining = Math.max(0, st.limit - st.used);
    timeLeft = formatTimeRemaining(localRemaining);
    usedText = `${Math.floor(st.used / 60)} of ${st.settings.daily_limit_minutes} min used`;

    const pct = Math.min(100, (st.used / st.limit) * 100);
    fillPercent = pct;

    const minutesLeft = Math.ceil(localRemaining / 60);
    barClass = 'bar' + (localRemaining === 0 ? ' out' : minutesLeft <= 10 ? ' warn' : '');

    startTicking();

    // Active blocks
    const active = st.blocks.filter((b) => b.kind !== 'allow' && b.schedule && schedActive(b.schedule));
    const groups: Record<string, string[]> = {};
    for (const b of active) {
      const end = b.schedule!.end;
      (groups[end] = groups[end] || []).push(b.target);
    }
    activeBlocks = Object.entries(groups).map(([end, targets]) => ({
      text: `${targets.join(', ')} until ${timeLabel(end)}`
    }));
    if (st.out) {
      activeBlocks.push({ text: 'All social media (daily limit used up) until midnight' });
    }
    if (activeBlocks.length === 0) {
      activeBlocks.push({ text: 'Only your always-on blocks.' });
    }
  }

  onMount(() => {
    render();
  });

  onDestroy(() => {
    stopTicking();
  });
</script>

<style>
  :global(body) {
    width: 360px;
    font-size: 13px;
    line-height: 1.4;
    background: var(--card);
  }
  header {
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--line);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  h1 {
    font-size: 15px;
    margin: 0;
  }
  section {
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
  }
  section:last-of-type {
    border-bottom: 0;
  }
  h2 {
    font-size: 11px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0 0 8px;
    font-weight: 600;
  }
  .big {
    font-size: 22px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 6px;
  }
  ul {
    margin: 0;
    padding-left: 16px;
  }
  li {
    margin: 2px 0;
    word-break: break-all;
  }
  .notice {
    background: var(--accent-soft);
    color: var(--accent);
    padding: 8px 16px;
    font-size: 12px;
  }
  .muted {
    color: var(--muted);
  }
</style>

<header>
  <h1>Sever</h1>
  <button class="primary" onclick={openSettings}>Settings</button>
</header>

{#if showNotice}
  <div class="notice">{notice}</div>
{/if}

<section>
  <h2>Social media today</h2>
  <div class="row">
    <span class="big">{timeLeft}</span>
    <span class="muted">{usedText}</span>
  </div>
  <div class={barClass}>
    <i style="width: {fillPercent}%"></i>
  </div>
</section>

<section>
  <h2>Blocked right now</h2>
  <ul>
    {#each activeBlocks as item}
      <li class={item.text.includes('Only your') ? 'muted' : ''}>{item.text}</li>
    {/each}
  </ul>
</section>

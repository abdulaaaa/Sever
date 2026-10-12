<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadState, schedActive, timeLabel, focusLeft } from '../../lib/utils/common';
  import type { ExtensionState, FocusState, FocusUnrated } from '../../lib/types';

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

  // ---------- lock-in mode ----------
  const END_SENTENCE = 'I am choosing to stop before the timer ends';
  const END_WAIT_MS = 30_000;

  let focus: FocusState | null = $state(null);
  let unrated: FocusUnrated | null = $state(null); // last session, until you say how it went
  let focusTask = $state('');
  let focusMinutes = $state(60);
  let now = $state(Date.now());
  let ending = $state(false);
  let endText = $state('');
  let endReadyAt = $state(0); // when the wait is over, once the sentence has been typed
  let clockInterval: ReturnType<typeof setInterval> | null = null;

  const canEnd = $derived(endReadyAt > 0 && now >= endReadyAt);

  const send = (type: string, extra: Record<string, unknown> = {}): Promise<unknown> =>
    chrome.runtime.sendMessage({ type, ...extra });

  function clock(ms: number): string {
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  function onFocusChange(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
    if (area !== 'local') return;
    if (changes.focusUnrated) unrated = (changes.focusUnrated.newValue as FocusUnrated | null | undefined) || null;
    if (!changes.focus) return;
    focus = (changes.focus.newValue as FocusState | null | undefined) || null;
    ending = false;
    endText = '';
    endReadyAt = 0;
    render();
  }

  function startFocus(e: Event): void {
    e.preventDefault();
    if (focusTask.trim()) send('focusStart', { task: focusTask.trim(), minutes: focusMinutes });
  }

  // The wait starts once the sentence is typed, and resets if it's changed.
  function checkEnd(): void {
    const typed = endText.trim().toLowerCase() === END_SENTENCE.toLowerCase();
    if (typed && !endReadyAt) endReadyAt = Date.now() + END_WAIT_MS;
    if (!typed) endReadyAt = 0;
  }

  function openAnalytics(): void {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/analytics/index.html') });
  }

  function openSettings(): void {
    chrome.runtime.openOptionsPage();
  }

  async function render(): Promise<void> {
    const st = await loadState();

    if (st.lastError) {
      notice = "Couldn't reach the database. Your local blocks still apply.";
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

  onMount(async () => {
    render();
    const st = await loadState();
    focus = st.focus;
    focusMinutes = st.focusConfig.minutes;
    const saved = await chrome.storage.local.get('focusUnrated') as { focusUnrated?: FocusUnrated | null };
    unrated = saved.focusUnrated || null;
    chrome.storage.onChanged.addListener(onFocusChange);
    clockInterval = setInterval(() => (now = Date.now()), 1000);
  });

  onDestroy(() => {
    stopTicking();
    chrome.storage.onChanged.removeListener(onFocusChange);
    if (clockInterval) clearInterval(clockInterval);
  });
</script>

<style>
  :global(body) {
    width: 360px;
    font-size: 13px;
    line-height: 1.4;
  }
  header {
    padding: 14px 16px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  h1 {
    font-size: 18px;
    margin: 0;
  }
  main {
    padding: 0 16px 16px;
    display: grid;
    gap: 12px;
  }
  .tile, .card {
    margin: 0;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 8px;
  }
  .lockin {
    display: grid;
    gap: 8px;
    margin-top: 6px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }
  .line input[type='number'] {
    width: 64px;
  }
  .line .primary {
    margin-left: auto;
  }
  .end {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    display: grid;
    gap: 8px;
  }
  .end p {
    margin: 0;
  }
  .end i {
    user-select: none;
  }
  .rate {
    margin-bottom: 10px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
  }
  .card h2 {
    font-size: 14px;
    margin-bottom: 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    padding: 6px 0;
    border-top: 1px solid var(--line);
    word-break: break-all;
  }
  li:first-child {
    border-top: 0;
  }
  .notice {
    background: var(--accent-soft);
    color: var(--accent);
    padding: 8px 16px;
    margin-bottom: 12px;
    font-size: 12px;
  }
</style>

<header>
  <h1>Sever</h1>
  <div>
    <button onclick={openAnalytics}>Analytics</button>
    <button class="primary" onclick={openSettings}>Settings</button>
  </div>
</header>

{#if showNotice}
  <div class="notice">{notice}</div>
{/if}

<main>
  <div class="tile">
    {#if unrated}
      <div class="rate">
        <span class="muted small">How did "{unrated.task}" go?</span>
        <div class="line">
          <button onclick={() => send('focusOutcome', { outcome: 'done' })}>Done</button>
          <button onclick={() => send('focusOutcome', { outcome: 'partly' })}>Partly</button>
          <button onclick={() => send('focusOutcome', { outcome: 'pulled' })}>Got pulled away</button>
        </div>
      </div>
    {/if}
    {#if !focus}
      <span class="muted small">Lock in</span>
      <form class="lockin" onsubmit={startFocus}>
        <input type="text" bind:value={focusTask} placeholder="What are you working on?" maxlength="80" required>
        <div class="line">
          <input type="number" bind:value={focusMinutes} min="1" max="480" required>
          <span class="muted">minutes</span>
          <button class="primary">Lock in</button>
        </div>
      </form>
    {:else}
      <span class="muted small">
        {focus.phase === 'break' ? 'Break' : focus.phase === 'paused' ? 'Paused' : 'Locked in'} · {focus.task}
      </span>
      <b>{clock(focusLeft(focus, now))}</b>
      {#if focus.phase === 'break'}
        <div class="line">
          <button onclick={() => send('focusSkipBreak')}>End break</button>
        </div>
      {:else}
        <div class="line">
          {#if focus.phase === 'paused'}
            <button class="primary" style="margin-left:0" onclick={() => send('focusResume')}>Resume</button>
          {:else}
            <button onclick={() => send('focusPause')}>Pause</button>
          {/if}
          <button class="link" onclick={() => (ending = !ending)}>End early</button>
        </div>
        {#if ending}
          <div class="end">
            <p class="muted small">To end early, type: <i>{END_SENTENCE}</i></p>
            <input type="text" bind:value={endText} oninput={checkEnd} onpaste={(e) => e.preventDefault()} ondrop={(e) => e.preventDefault()} autocomplete="off">
            <button disabled={!canEnd} onclick={() => send('focusEnd')}>
              {endReadyAt && !canEnd ? `Wait ${Math.ceil((endReadyAt - now) / 1000)}s` : 'End session'}
            </button>
          </div>
        {/if}
      {/if}
    {/if}
  </div>

  <div class="tile">
    <span class="muted small">Social media today</span>
    <div class="row">
      <b>{timeLeft}</b>
      <span class="muted">{usedText}</span>
    </div>
    <div class={barClass}>
      <i style="width: {fillPercent}%"></i>
    </div>
  </div>

  <div class="card">
    <h2>Blocked right now</h2>
    <ul>
      {#each activeBlocks as item}
        <li class={item.text.includes('Only your') ? 'muted' : ''}>{item.text}</li>
      {/each}
    </ul>
  </div>
</main>

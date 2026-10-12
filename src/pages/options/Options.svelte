<script lang="ts">
  import { onMount } from 'svelte';
  import { loadState, cleanTarget, scheduleLabel, schedActive, normHost, isSettingsLocked, nextUnlockTime, summarize, videoId } from '../../lib/utils/common';
  import { loadAttempts, updateSettings, insertBlock, deleteBlock, updateBlock, renameAttemptTarget } from '../../lib/services/supa';
  import { watchSquash, searchTarget } from '../../lib/utils/watch';
  import type { ExtensionState, Block, Schedule, AttemptSummary } from '../../lib/types';

  let st: ExtensionState | null = $state(null);
  let toastText = $state('');
  let toastVisible = $state(false);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  // Form inputs
  let limitValue = $state(60);
  let budgetInput = $state('');
  let personName = $state('');
  let personLink = $state('');
  let alwaysLink = $state('');
  let alwaysKind = $state<'page' | 'site'>('page');
  let schedLink = $state('');
  let schedKind = $state<'site' | 'page'>('site');
  let schedStart = $state('21:00');
  let schedEnd = $state('12:00');
  let schedDays = $state<number[]>([0, 1, 2, 3, 4, 5, 6]);
  let schedAllDay = $state(false);
  let allowLink = $state('');

  // Settings lock
  let isLocked = $state(false);
  let lockNextUnlock = $state('');
  let lockEnabled = $state(false);
  let lockStart = $state('09:00');
  let lockEnd = $state('10:00');
  let lockDays = $state<number[]>([0, 1, 2, 3, 4, 5, 6]);

  // Lock-in mode
  let focusOn = $state(false); // a session is running: sites can be added but not removed
  let focusMinutes = $state(60);
  let focusBreak = $state(10);
  let focusVideo = $state('');
  let focusSites: string[] = $state([]);
  let focusSiteInput = $state('');
  let focusDirty = false; // unsaved edits in the lock-in fields: don't overwrite them when a sync lands

  // Data arrays
  let budgetSites: string[] = $state([]);
  let personGroups: Array<{ name: string; blocks: Block[] }> = $state([]);
  let personNames: string[] = $state([]);
  let alwaysBlocks: Block[] = $state([]);
  let scheduledBlocks: Array<{ block: Block; label: string; isActive: boolean }> = $state([]);
  let allowedBlocks: Block[] = $state([]);

  // People report
  let showReport = $state(false);
  let reportLoading = $state(false);
  let reportRows: Array<{
    isPerson: boolean;
    name: string;
    target?: string;
    today: number;
    total: number;
  }> = $state([]);

  // Summary tiles
  function activeCount(s: ExtensionState): number {
    return s.blocks.filter((b) => b.kind !== 'allow' && (!b.schedule || schedActive(b.schedule))).length;
  }

  function fmtMin(secs: number): string {
    const m = Math.max(0, Math.round(secs / 60));
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

  function toast(text: string): void {
    toastText = text;
    toastVisible = true;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastVisible = false;
    }, 2600);
  }

  async function syncNow(): Promise<void> {
    await chrome.runtime.sendMessage({ type: 'sync' });
  }

  async function run(action: () => Promise<unknown>, done?: string): Promise<void> {
    try {
      await action();
      await syncNow();
      await render();
      if (done) toast(done);
    } catch (e) {
      const err = e as Error;
      toast(err.message === 'signed-out' ? 'Sign in first.' : "Couldn't save: " + err.message);
    }
  }

  function addBlock(row: Partial<Block>): Promise<unknown> {
    return insertBlock({ person: null, schedule: null, ...row });
  }

  function removeBlock(b: Block, label?: string): void {
    if (!confirm(`Remove ${label || b.target}?`)) return;
    run(() => deleteBlock(b.id), 'Removed.');
  }

  function editPersonName(oldName: string): void {
    const newName = prompt(`Edit name for "${oldName}":`, oldName);
    if (!newName || newName.trim() === '' || newName.trim() === oldName) return;
    const trimmed = newName.trim();
    const blocksToUpdate = st!.blocks.filter((b) => b.person === oldName);
    const { [oldName]: moved, ...terms } = st!.settings.person_terms || {};
    run(async () => {
      for (const b of blocksToUpdate) {
        await updateBlock(b.id, { person: trimmed });
      }
      if (moved) await saveSettings({ person_terms: { ...terms, [trimmed]: moved } });
      await renameAttemptTarget(searchTarget(oldName), searchTarget(trimmed));
    }, `Renamed to "${trimmed}".`);
  }

  function saveFocus(patch: Record<string, unknown>, done: string): void {
    run(() => saveSettings({ focus_config: { ...st!.focusConfig, ...patch } }), done);
  }

  function handleFocusSave(e: Event): void {
    e.preventDefault();
    const video = focusVideo.trim();
    if (video && !videoId(video)) {
      toast("That doesn't look like a YouTube video link.");
      return;
    }
    const whole = (n: unknown, min: number, max: number): boolean =>
      typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
    if (!whole(focusMinutes, 1, 480)) {
      toast('Sessions can be 1 to 480 minutes.');
      return;
    }
    if (!whole(focusBreak, 0, 60)) {
      toast('Breaks can be 0 to 60 minutes.');
      return;
    }
    focusDirty = false;
    saveFocus({ minutes: focusMinutes, breakMinutes: focusBreak, video }, 'Saved.');
  }

  function handleAddFocusSite(e: Event): void {
    e.preventDefault();
    const site = cleanTarget(focusSiteInput, 'site');
    if (!site) {
      toast('Enter a website, e.g. bbc.co.uk');
      return;
    }
    if (site === 'youtube.com') {
      toast('YouTube is already cut down to search and watching during a session.');
      return;
    }
    focusSiteInput = '';
    saveFocus({ sites: [...new Set([...focusSites, site])] }, 'Added.');
  }

  function handleRemoveFocusSite(site: string): void {
    if (focusOn) {
      toast("Sites can't be removed during a session.");
      return;
    }
    saveFocus({ sites: focusSites.filter((s) => s !== site) }, 'Removed.');
  }

  // Extra names and usernames that count as looking a person up.
  function personTerms(name: string): string[] {
    return st?.settings.person_terms?.[name] || [];
  }

  function addTerm(name: string): void {
    const term = (prompt(`Another name or username for ${name} to block in searches:`) || '').trim();
    if (!term) return;
    if (watchSquash(term).length < 3) {
      toast('Too short to match safely.');
      return;
    }
    const all = st!.settings.person_terms || {};
    run(() => saveSettings({ person_terms: { ...all, [name]: [...new Set([...(all[name] || []), term])] } }), 'Added.');
  }

  function removeTerm(name: string, term: string): void {
    const all = st!.settings.person_terms || {};
    run(() => saveSettings({ person_terms: { ...all, [name]: (all[name] || []).filter((t) => t !== term) } }), 'Removed.');
  }

  function saveSettings(patch: Record<string, unknown>): Promise<unknown> {
    return updateSettings(st!.session!.user.id, patch);
  }

  function exists(kind: string, target: string, extra: (b: Block) => boolean = () => true): boolean {
    return st!.blocks.some((b) => b.kind === kind && b.target === target && extra(b));
  }

  async function render(): Promise<void> {
    st = await loadState();

    // Daily limit
    limitValue = st.settings.daily_limit_minutes;
    budgetSites = [...st.settings.budget_sites];

    // People
    const names = [...new Set(st.blocks.filter((b) => b.person).map((b) => b.person))] as string[];
    personNames = names;
    personGroups = names.map(name => ({
      name,
      blocks: st!.blocks.filter((b) => b.person === name)
    }));

    // Always blocked
    alwaysBlocks = st.blocks.filter((b) => b.kind !== 'allow' && !b.person && !b.schedule);

    // Scheduled
    scheduledBlocks = st.blocks
      .filter((b) => b.kind !== 'allow' && b.schedule)
      .map(b => ({
        block: b,
        label: scheduleLabel(b.schedule!),
        isActive: schedActive(b.schedule!)
      }));

    // Allowed
    allowedBlocks = st.blocks.filter((b) => b.kind === 'allow');

    // Lock-in mode
    focusOn = !!st.focus;
    if (!focusDirty) {
      focusMinutes = st.focusConfig.minutes;
      focusBreak = st.focusConfig.breakMinutes;
      focusVideo = st.focusConfig.video;
    }
    focusSites = [...st.focusConfig.sites];

    // Settings lock
    const lockSched = st.settings.settings_unlock_schedule;
    lockEnabled = !!lockSched;
    if (lockSched) {
      lockStart = lockSched.start;
      lockEnd = lockSched.end;
      lockDays = [...lockSched.days];
      isLocked = isSettingsLocked(st.settings);
      lockNextUnlock = isLocked ? nextUnlockTime(lockSched) : '';
    } else {
      isLocked = false;
      lockNextUnlock = '';
    }

  }

  // Form handlers

  function handleLimitSubmit(e: Event): void {
    e.preventDefault();
    const v = Math.round(Number(limitValue));
    if (!(v >= 1 && v <= 1440)) {
      toast('Enter a number of minutes.');
      return;
    }
    run(() => saveSettings({ daily_limit_minutes: v }), 'Limit saved.');
  }

  function handleRemoveBudgetSite(site: string): void {
    if (focusOn) {
      toast("Sites can't be removed during a session.");
      return;
    }
    if (!confirm(`Stop counting ${site} toward the daily limit?`)) return;
    run(() => saveSettings({ budget_sites: st!.settings.budget_sites.filter((s) => s !== site) }), 'Removed.');
  }

  function handleAddBudget(e: Event): void {
    e.preventDefault();
    const t = cleanTarget(budgetInput, 'site');
    if (!t) {
      toast("That doesn't look like a website.");
      return;
    }
    if (st!.settings.budget_sites.map(normHost).includes(t)) {
      toast('Already counted.');
      return;
    }
    run(() => saveSettings({ budget_sites: [...st!.settings.budget_sites, t] }), `Added ${t}.`).then(() => {
      budgetInput = '';
    });
  }

  function handleAddPerson(e: Event): void {
    e.preventDefault();
    const name = personName.trim();
    const t = cleanTarget(personLink, 'page');
    if (!name) {
      toast('Add a name.');
      return;
    }
    if (!t) {
      toast("That doesn't look like a link.");
      return;
    }
    if (exists('page', t, (b) => !!b.person)) {
      toast('Already blocked.');
      return;
    }
    run(() => addBlock({ kind: t.includes('/') ? 'page' : 'site', target: t, person: name }), `Blocked ${t}.`).then(() => {
      personLink = '';
    });
  }

  function handleAddAlways(e: Event): void {
    e.preventDefault();
    const t = cleanTarget(alwaysLink, alwaysKind);
    if (!t) {
      toast("That doesn't look like a link.");
      return;
    }
    const k = t.includes('/') ? 'page' : 'site';
    if (exists(k, t, (b) => !b.schedule && !b.person)) {
      toast('Already blocked.');
      return;
    }
    run(() => addBlock({ kind: k, target: t }), `Blocked ${t}.`).then(() => {
      alwaysLink = '';
    });
  }

  function handleAddScheduled(e: Event): void {
    e.preventDefault();
    const t = cleanTarget(schedLink, schedKind);
    if (!t) {
      toast("That doesn't look like a link.");
      return;
    }
    if (schedDays.length === 0) {
      toast('Pick at least one day.');
      return;
    }
    const start = schedAllDay ? '00:00' : schedStart;
    const end = schedAllDay ? '00:00' : schedEnd;
    const schedule: Schedule = { start, end, days: [...schedDays].sort() };
    run(() => addBlock({ kind: t.includes('/') ? 'page' : 'site', target: t, schedule }), `Scheduled ${t}.`).then(() => {
      schedLink = '';
    });
  }

  function handleAddAllow(e: Event): void {
    e.preventDefault();
    const t = cleanTarget(allowLink, 'page');
    if (!t) {
      toast("That doesn't look like a link.");
      return;
    }
    if (focusOn) {
      toast("Pages can't be allowed during a session.");
      return;
    }
    if (exists('allow', t)) {
      toast('Already allowed.');
      return;
    }
    run(() => addBlock({ kind: 'allow', target: t }), `Allowed ${t}.`).then(() => {
      allowLink = '';
    });
  }

  function toggleSchedDay(day: number): void {
    if (schedDays.includes(day)) {
      schedDays = schedDays.filter(d => d !== day);
    } else {
      schedDays = [...schedDays, day];
    }
  }

  function toggleLockDay(day: number): void {
    if (lockDays.includes(day)) {
      lockDays = lockDays.filter(d => d !== day);
    } else {
      lockDays = [...lockDays, day];
    }
  }


  async function handleLockToggle(): Promise<void> {
    if (lockEnabled) {
      // Turning off
      run(() => saveSettings({ settings_unlock_schedule: null }), 'Lock disabled.');
    } else {
      // Turning on
      if (lockDays.length === 0) {
        toast('Pick at least one day.');
        return;
      }
      const schedule: Schedule = { start: lockStart, end: lockEnd, days: [...lockDays].sort() };
      run(() => saveSettings({ settings_unlock_schedule: schedule }), 'Lock enabled.');
    }
  }

  async function handleLockScheduleSave(e: Event): Promise<void> {
    e.preventDefault();
    if (lockDays.length === 0) {
      toast('Pick at least one day.');
      return;
    }
    const schedule: Schedule = { start: lockStart, end: lockEnd, days: [...lockDays].sort() };
    run(() => saveSettings({ settings_unlock_schedule: schedule }), 'Schedule saved.');
  }

  async function toggleReport(): Promise<void> {
    if (showReport) {
      showReport = false;
      return;
    }

    reportLoading = true;
    try {
      const attempts = await loadAttempts();
      const people = [...new Set(st!.blocks.filter((b) => b.person).map((b) => b.person))] as string[];
      const rows: typeof reportRows = [];

      for (const name of people) {
        // Each of the person's links, then searches and lookalike profiles.
        const entries = [
          ...st!.blocks.filter((b) => b.person === name).map((b) => ({ label: b.target, target: b.target })),
          { label: 'Searches and lookalike profiles', target: searchTarget(name) }
        ];
        const allCounts = entries.map((e) => summarize(attempts[e.target]));
        const sum = (k: keyof AttemptSummary): number =>
          allCounts.reduce((a, c) => a + c[k], 0);

        rows.push({
          isPerson: true,
          name,
          today: sum('today'),
          total: sum('total')
        });

        for (let i = 0; i < entries.length; i++) {
          rows.push({
            isPerson: false,
            name: '',
            target: entries[i].label,
            today: allCounts[i].today,
            total: allCounts[i].total
          });
        }
      }

      reportRows = rows;
      showReport = true;
    } catch (e) {
      toast('Could not load report.');
    } finally {
      reportLoading = false;
    }
  }

  onMount(() => {
    render();

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.cache || changes.session || changes.syncedAt || changes.lastError || changes.focus) {
        render();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  });
</script>

<style>
  form.add {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  form.add input[type='text'] {
    flex: 1 1 220px;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }
  .seg label {
    padding: 6px 10px;
    cursor: pointer;
    font-size: 13px;
  }
  .seg input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .seg label:has(input:checked) {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .days {
    display: inline-flex;
    gap: 4px;
  }
  .days label {
    font-size: 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 3px 6px;
    cursor: pointer;
  }
  .days input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .days label:has(input:checked) {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: transparent;
  }
  ul.items {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  ul.items li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 0;
    border-top: 1px solid var(--line);
  }
  ul.items li:first-child {
    border-top: 0;
  }
  .t {
    flex: 1;
    word-break: break-all;
  }
  .person-h {
    font-weight: 600;
    margin: 12px 0 2px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .person-h:first-child {
    margin-top: 0;
  }
  .person-h button {
    font-size: 12px;
  }
  .empty {
    color: var(--muted);
    font-size: 13px;
    padding: 4px 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: var(--soft);
    border-radius: 999px;
    padding: 2px 4px 2px 10px;
    font-size: 13px;
  }
  .terms {
    align-items: center;
    margin: 6px 0 4px;
  }
  .limit-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .limit-row input {
    width: 90px;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }
  fieldset:disabled {
    opacity: 0.55;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 20px;
    transform: translateX(-50%);
    background: var(--fg);
    color: var(--bg);
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 13px;
  }
  .lock-banner {
    border-color: var(--danger);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .lock-banner svg {
    flex-shrink: 0;
    color: var(--danger);
  }
  .report {
    margin-top: 12px;
  }
  .report tr.person td {
    font-weight: 600;
  }
  .lock-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .lock-toggle input[type="checkbox"] {
    width: 18px;
    height: 18px;
  }
  .lock-sched {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .report-btn {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  .allday {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    cursor: pointer;
  }
  .allday input {
    width: 16px;
    height: 16px;
  }
</style>

<div class="wrap">
  <h1>Sever</h1>
  <p class="lede">Changes sync to your database and apply across all Chrome profiles within about a minute. <a href="../analytics/index.html">View usage analytics</a></p>

  {#if isLocked}
    <div class="card notice lock-banner">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <div>
        <strong>Settings locked</strong><br>
        <span>Unlocks {lockNextUnlock}</span>
      </div>
    </div>
  {/if}

  {#if st}
    <div class="tiles">
      <div class="tile">
        <span class="muted small">Time left today</span>
        <b>{fmtMin(st.limit - st.used)}</b>
      </div>
      <div class="tile">
        <span class="muted small">Daily limit</span>
        <b>{fmtMin(st.limit)}</b>
      </div>
      <div class="tile">
        <span class="muted small">Blocks active now</span>
        <b>{activeCount(st)}</b>
      </div>
      <div class="tile">
        <span class="muted small">Settings lock</span>
        <b>{!lockEnabled ? 'Off' : isLocked ? 'Locked' : 'Unlocked'}</b>
      </div>
    </div>
  {/if}

  <!-- Settings Lock Card - locked when outside unlock window -->
  <fieldset disabled={isLocked}>
    <div class="card">
      <h2>Settings lock</h2>
      <p class="muted">Lock settings outside of a scheduled time window. Settings can only be changed during unlock hours.</p>
      <div class="lock-toggle">
        <input type="checkbox" id="lock-enabled" checked={lockEnabled} onchange={handleLockToggle}>
        <label for="lock-enabled">{lockEnabled ? 'Lock is enabled' : 'Enable lock'}</label>
      </div>
      {#if lockEnabled}
        <form class="lock-sched" onsubmit={handleLockScheduleSave}>
          <span>Unlock from <input type="time" bind:value={lockStart} required> to <input type="time" bind:value={lockEnd} required></span>
          <span class="days">
            {#each DAYS as [day, label]}
              <label>
                <input type="checkbox" value={day} checked={lockDays.includes(day)} onchange={() => toggleLockDay(day)}>
                {label}
              </label>
            {/each}
          </span>
          <button>Save schedule</button>
        </form>
      {/if}
    </div>
  </fieldset>

  <!-- Daily Limit Card - locked when settings locked -->
  <fieldset disabled={isLocked}>
    <div class="card">
      <h2>Daily social media limit</h2>
      <p class="muted">Time on these sites is added together, across both profiles. When it runs out, they're blocked until midnight.</p>
      <form class="limit-row" onsubmit={handleLimitSubmit}>
        <input type="number" bind:value={limitValue} min="1" max="1440" step="1">
        <span>minutes a day</span>
        <button>Save</button>
      </form>
      <div class="chips">
        {#each budgetSites as site}
          <span class="chip">
            {site}
            <button type="button" class="link" title="Remove {site}" onclick={() => handleRemoveBudgetSite(site)}>&times;</button>
          </span>
        {/each}
      </div>
      <form class="add" onsubmit={handleAddBudget}>
        <input type="text" bind:value={budgetInput} placeholder="Add a site, e.g. tiktok.com">
        <button>Add site</button>
      </form>
    </div>
  </fieldset>

  <!-- Lock-in Card - always editable -->
  <fieldset>
    <div class="card">
      <h2>Lock-in mode</h2>
      <p class="muted">
        Start a session from the popup. Until it ends, your daily-limit sites and the sites below are blocked, and YouTube is cut down to search and watching.
      </p>
      <form class="limit-row" onsubmit={handleFocusSave} oninput={() => (focusDirty = true)}>
        <input type="number" bind:value={focusMinutes} min="1" max="480" step="1" required>
        <span>minute sessions,</span>
        <input type="number" bind:value={focusBreak} min="0" max="60" step="1" required>
        <span>minute breaks</span>
        <input type="text" bind:value={focusVideo} placeholder="YouTube link to play during a session (optional)" style="flex:1 1 260px;width:auto">
        <button>Save</button>
      </form>
      <div class="chips">
        {#each focusSites as site}
          <span class="chip">
            {site}
            <button type="button" class="link" title="Remove {site}" onclick={() => handleRemoveFocusSite(site)} disabled={focusOn}>&times;</button>
          </span>
        {:else}
          <span class="empty">No extra sites yet. Add news, shopping or anything else that pulls you away.</span>
        {/each}
      </div>
      <form class="add" onsubmit={handleAddFocusSite}>
        <input type="text" bind:value={focusSiteInput} placeholder="Block a site during sessions, e.g. bbc.co.uk">
        <button>Add site</button>
      </form>
    </div>
  </fieldset>

  <!-- Block cards - can add blocks even when locked -->
  <fieldset>
    <!-- People Card -->
    <div class="card">
      <h2>People</h2>
      <p class="muted">Always blocked, and counted. Searching for their full name or usernames is blocked too, as are profiles that resemble them. A first name on its own is never matched.</p>
      <div>
        {#each personGroups as group}
          <div class="person-h">
            <span>{group.name}</span>
            <button type="button" class="link" onclick={() => editPersonName(group.name)} disabled={isLocked}>Edit</button>
          </div>
          <ul class="items">
            {#each group.blocks as block}
              <li>
                <span class="t">{block.target}</span>
                <button type="button" class="link" onclick={() => removeBlock(block)} disabled={isLocked}>Remove</button>
              </li>
            {/each}
          </ul>
          <div class="chips terms">
            <span class="muted small">Also blocked in searches:</span>
            {#each personTerms(group.name) as term}
              <span class="chip">
                {term}
                <button type="button" class="link" title="Remove {term}" onclick={() => removeTerm(group.name, term)} disabled={isLocked}>&times;</button>
              </span>
            {/each}
            <button type="button" class="link" onclick={() => addTerm(group.name)}>Add a name or username</button>
          </div>
        {:else}
          <div class="empty">No people yet.</div>
        {/each}
      </div>
      <form class="add" onsubmit={handleAddPerson}>
        <input type="text" bind:value={personName} placeholder="Name" list="names" style="flex:0 1 140px">
        <datalist id="names">
          {#each personNames as name}
            <option value={name}></option>
          {/each}
        </datalist>
        <input type="text" bind:value={personLink} placeholder="Paste a profile link">
        <button>Add</button>
      </form>
      {#if personGroups.length > 0}
        <div class="report-btn">
          <button type="button" onclick={toggleReport} disabled={reportLoading}>
            {reportLoading ? 'Loading...' : showReport ? 'Hide report' : 'View report'}
          </button>
        </div>
        {#if showReport}
          <div class="scroll report">
          <table class="table">
            <thead>
              <tr>
                <th>Page</th>
                <th class="num">Today</th>
                <th class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {#each reportRows as row}
                {#if row.isPerson}
                  <tr class="person">
                    <td>{row.name}</td>
                    <td class="num">{row.today}</td>
                    <td class="num">{row.total}</td>
                  </tr>
                {:else}
                  <tr>
                    <td>{row.target}</td>
                    <td class="num">{row.today || ''}</td>
                    <td class="num">{row.total || ''}</td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Always Blocked Card -->
    <div class="card">
      <h2>Always blocked</h2>
      <p class="muted">Blocked at all times, not counted.</p>
      <ul class="items">
        {#each alwaysBlocks as block}
          <li>
            <span class="t">{block.target}</span>
            <span class="tag">{block.kind === 'site' ? 'whole site' : 'page'}</span>
            <button type="button" class="link" onclick={() => removeBlock(block)} disabled={isLocked}>Remove</button>
          </li>
        {:else}
          <li class="empty">Nothing here yet.</li>
        {/each}
      </ul>
      <form class="add" onsubmit={handleAddAlways}>
        <input type="text" bind:value={alwaysLink} placeholder="Paste a link or website">
        <span class="seg">
          <label><input type="radio" bind:group={alwaysKind} value="page">This page</label>
          <label><input type="radio" bind:group={alwaysKind} value="site">Whole site</label>
        </span>
        <button>Add</button>
      </form>
    </div>

    <!-- Scheduled Blocks Card -->
    <div class="card">
      <h2>Scheduled blocks</h2>
      <p class="muted">Blocked only during set hours. A time like 9 pm to 12 pm runs overnight into the next day.</p>
      <ul class="items">
        {#each scheduledBlocks as item}
          <li>
            <span class="t">{item.block.target}{item.block.kind === 'site' ? '' : ' (page)'}</span>
            <span class="muted">{item.label}</span>
            <span class="tag" class:on={item.isActive}>{item.isActive ? 'active now' : 'off now'}</span>
            <button type="button" class="link" onclick={() => removeBlock(item.block)} disabled={isLocked}>Remove</button>
          </li>
        {:else}
          <li class="empty">Nothing scheduled.</li>
        {/each}
      </ul>
      <form class="add" onsubmit={handleAddScheduled}>
        <input type="text" bind:value={schedLink} placeholder="Paste a link or website">
        <span class="seg">
          <label><input type="radio" bind:group={schedKind} value="site">Whole site</label>
          <label><input type="radio" bind:group={schedKind} value="page">This page</label>
        </span>
        <label class="allday"><input type="checkbox" bind:checked={schedAllDay}> All day</label>
        {#if !schedAllDay}
          <span>from <input type="time" bind:value={schedStart} required> to <input type="time" bind:value={schedEnd} required></span>
        {/if}
        <span class="days">
          {#each DAYS as [day, label]}
            <label>
              <input type="checkbox" value={day} checked={schedDays.includes(day)} onchange={() => toggleSchedDay(day)}>
              {label}
            </label>
          {/each}
        </span>
        <button>Add</button>
      </form>
    </div>
  </fieldset>

  <!-- Always Allowed Card - locked when settings locked -->
  <fieldset disabled={isLocked}>
    <div class="card">
      <h2>Always allowed</h2>
      <p class="muted">These always open, even during scheduled blocks or after the daily limit, and don't use up your time.</p>
      <ul class="items">
        {#each allowedBlocks as block}
          <li>
            <span class="t">{block.target}</span>
            <button type="button" class="link" onclick={() => removeBlock(block)}>Remove</button>
          </li>
        {:else}
          <li class="empty">Nothing here yet.</li>
        {/each}
      </ul>
      <form class="add" onsubmit={handleAddAllow}>
        <input type="text" bind:value={allowLink} placeholder="Paste a link, e.g. linkedin.com/jobs">
        <button>Add</button>
      </form>
    </div>
  </fieldset>
</div>

{#if toastVisible}
  <div class="toast">{toastText}</div>
{/if}

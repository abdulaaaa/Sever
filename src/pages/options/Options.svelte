<script lang="ts">
  import { onMount } from 'svelte';
  import { loadState, cleanTarget, scheduleLabel, schedActive, normHost } from '../../lib/utils/common';
  import { signIn, signOut, api } from '../../lib/services/supa';
  import type { ExtensionState, Block, Schedule } from '../../lib/types';

  let st: ExtensionState | null = $state(null);
  let signedIn = $state(false);
  let email = $state('');
  let password = $state('');
  let accountMsg = $state('');
  let accountMsgError = $state(false);
  let userEmail = $state('');
  let syncStatus = $state('');
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
  let allowLink = $state('');

  // Data arrays
  let budgetSites: string[] = $state([]);
  let personGroups: Array<{ name: string; blocks: Block[] }> = $state([]);
  let personNames: string[] = $state([]);
  let alwaysBlocks: Block[] = $state([]);
  let scheduledBlocks: Array<{ block: Block; label: string; isActive: boolean }> = $state([]);
  let allowedBlocks: Block[] = $state([]);

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
    return api('blocks', { method: 'POST', body: [{ person: null, schedule: null, ...row }], prefer: 'return=minimal' });
  }

  function removeBlock(b: Block, label?: string): void {
    if (!confirm(`Remove ${label || b.target}?`)) return;
    run(() => api(`blocks?id=eq.${b.id}`, { method: 'DELETE' }), 'Removed.');
  }

  function editPersonName(oldName: string): void {
    const newName = prompt(`Edit name for "${oldName}":`, oldName);
    if (!newName || newName.trim() === '' || newName.trim() === oldName) return;
    const trimmed = newName.trim();
    const blocksToUpdate = st!.blocks.filter((b) => b.person === oldName);
    run(async () => {
      for (const b of blocksToUpdate) {
        await api(`blocks?id=eq.${b.id}`, { method: 'PATCH', body: { person: trimmed }, prefer: 'return=minimal' });
      }
    }, `Renamed to "${trimmed}".`);
  }

  function saveSettings(patch: Record<string, unknown>): Promise<unknown> {
    return api(`settings?user_id=eq.${st!.session!.user.id}`, {
      method: 'PATCH', body: { ...patch, updated_at: new Date().toISOString() }, prefer: 'return=minimal'
    });
  }

  function exists(kind: string, target: string, extra: (b: Block) => boolean = () => true): boolean {
    return st!.blocks.some((b) => b.kind === kind && b.target === target && extra(b));
  }

  async function render(): Promise<void> {
    st = await loadState();
    signedIn = !!st.session;

    if (signedIn) {
      userEmail = st.session!.user.email;
      syncStatus = st.lastError
        ? "Couldn't reach the database: " + st.lastError
        : st.syncedAt
          ? 'Last synced ' + new Date(st.syncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
          : 'Not synced yet';
    }

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
  }

  // Form handlers
  async function handleSignIn(e: Event): Promise<void> {
    e.preventDefault();
    accountMsg = 'Signing in...';
    accountMsgError = false;
    try {
      await signIn(email.trim(), password);
      password = '';
      accountMsg = 'Signed in. Syncing...';
      await syncNow();
      accountMsg = '';
      await render();
    } catch (err) {
      accountMsg = "Couldn't sign in: " + (err as Error).message;
      accountMsgError = true;
    }
  }

  async function handleSignOut(): Promise<void> {
    if (!confirm("Sign out? Your saved blocks keep working, but changes won't sync.")) return;
    await signOut();
    await render();
  }

  async function handleSyncNow(): Promise<void> {
    await syncNow();
    await render();
    toast('Synced.');
  }

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
    const schedule: Schedule = { start: schedStart, end: schedEnd, days: [...schedDays].sort() };
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

  onMount(() => {
    render();

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.cache || changes.session || changes.syncedAt || changes.lastError) {
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
  :global(body) {
    font-size: 14px;
    line-height: 1.45;
  }
  .wrap {
    max-width: 780px;
    margin: 0 auto;
    padding: 28px 16px 64px;
  }
  h1 {
    font-size: 22px;
    margin: 0 0 4px;
  }
  .lede {
    color: var(--muted);
    margin: 0 0 22px;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 18px 20px;
    margin-bottom: 16px;
  }
  .card h2 {
    font-size: 16px;
    margin: 0 0 2px;
  }
  .card > p.muted {
    margin: 0 0 14px;
    font-size: 13px;
  }
  form.add {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px dashed var(--line);
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
  .account {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
  }
  .signin {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .signin input {
    flex: 1 1 180px;
  }
  .msg {
    font-size: 13px;
    margin-top: 8px;
  }
  .msg.err {
    color: var(--danger);
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
  .muted {
    color: var(--muted);
  }
  .tag {
    display: inline-block;
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--soft);
    color: var(--muted);
  }
  .tag.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>

<div class="wrap">
  <h1>Page Blocker</h1>
  <p class="lede">Changes save to your database and apply in every Chrome profile where you're signed in, within about a minute.</p>

  <!-- Account Card -->
  <div class="card">
    <h2>Account</h2>
    {#if !signedIn}
      <p class="muted">Sign in with the email and password you created in Supabase. Until you do, the extension keeps using your saved blocks.</p>
      <form class="signin" onsubmit={handleSignIn}>
        <input type="email" bind:value={email} placeholder="Email" required autocomplete="username">
        <input type="password" bind:value={password} placeholder="Password" required autocomplete="current-password">
        <button class="primary">Sign in</button>
      </form>
    {:else}
      <div class="account">
        <div>
          <div>Signed in as <b>{userEmail}</b></div>
          <div class="muted">{syncStatus}</div>
        </div>
        <div>
          <button onclick={handleSyncNow}>Sync now</button>
          <button onclick={handleSignOut}>Sign out</button>
        </div>
      </div>
    {/if}
    {#if accountMsg}
      <div class="msg" class:err={accountMsgError}>{accountMsg}</div>
    {/if}
  </div>

  <fieldset disabled={!signedIn}>
    <!-- Daily Limit Card -->
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

    <!-- People Card -->
    <div class="card">
      <h2>People</h2>
      <p class="muted">Always blocked. Every attempt to open these pages is counted.</p>
      <div>
        {#each personGroups as group}
          <div class="person-h">
            <span>{group.name}</span>
            <button type="button" class="link" onclick={() => editPersonName(group.name)}>Edit</button>
          </div>
          <ul class="items">
            {#each group.blocks as block}
              <li>
                <span class="t">{block.target}</span>
                <button type="button" class="link" onclick={() => removeBlock(block)}>Remove</button>
              </li>
            {/each}
          </ul>
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
            <button type="button" class="link" onclick={() => removeBlock(block)}>Remove</button>
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
            <button type="button" class="link" onclick={() => removeBlock(item.block)}>Remove</button>
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
        <span>from <input type="time" bind:value={schedStart} required> to <input type="time" bind:value={schedEnd} required></span>
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

    <!-- Always Allowed Card -->
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

<script lang="ts">
  import { onMount } from 'svelte';
  import { loadState, scheduleLabel, timeLabel, summarize } from '../../lib/utils/common';
  import { recordAttempt, loadAttempts } from '../../lib/services/supa';
  import { searchTarget } from '../../lib/utils/watch';
  import type { Block, ExtensionState, AttemptSummary } from '../../lib/types';

  const params = new URLSearchParams(location.search);

  let label = $state('Blocked');
  let title = $state('This page is blocked');
  let titleHighlight = $state('');
  let sub = $state('');
  let note = $state('Close this tab and carry on.');
  let showCounts = $state(false);
  let showBar = $state(false);
  let counts: AttemptSummary = $state({ today: 0, week: 0, total: 0 });

  async function show(): Promise<void> {
    const st = await loadState();

    if (params.has('budget')) {
      const mins = st.settings.daily_limit_minutes;
      label = 'Daily limit';
      title = "Today's social media time is used up";
      sub = `You've used ${Math.floor(st.used / 60)} of your ${mins} minutes. The time resets at midnight.`;
      showBar = true;
      note = 'Other websites still work.';
      return;
    }

    const block = st.blocks.find((b) => b.id === params.get('id'));
    if (!block) return;
    titleHighlight = block.target;

    if (block.schedule) {
      label = 'Scheduled block';
      sub = `Blocked ${scheduleLabel(block.schedule)}.`;
      note = `Available again at ${timeLabel(block.schedule.end)}.`;
      return;
    }

    if (!block.person) {
      label = 'Always blocked';
      sub = 'This is blocked at all times.';
      return;
    }

    label = block.person;
    if (params.has('w')) {
      // A search or lookalike profile: don't put their page on screen.
      titleHighlight = '';
      title = 'Looking them up is blocked';
    }
    // Count this attempt once (not again if the page is refreshed, or if the tab was already open).
    const counting = !params.has('n') && !params.has('c');
    if (counting) {
      params.set('c', '1');
      history.replaceState(null, '', '?' + params.toString());
      await recordAttempt(params.has('w') ? searchTarget(block.person) : block.target);
    }
    // A blocked link shows its own count. A search is counted against the
    // person, so show their total: every link plus searches.
    const targets = params.has('w')
      ? [...st.blocks.filter((b) => b.person === block.person).map((b) => b.target), searchTarget(block.person)]
      : [block.target];
    const attempts = await loadAttempts(targets.length === 1 ? targets[0] : undefined);
    const c = summarize(targets.flatMap((t) => attempts[t] || []));
    sub = params.has('n')
      ? "This tab was already open when the block started, so it wasn't counted."
      : `You've tried ${c.total} time${c.total === 1 ? '' : 's'}.`;
    counts = c;
    showCounts = true;
  }

  onMount(() => {
    show();
  });
</script>

<style>
  :global(body) {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  main {
    max-width: 540px;
    width: 100%;
    margin: 0;
    padding: 32px 28px;
    text-align: center;
  }
  .label {
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0 0 0.6rem;
  }
  h1 {
    font-size: 1.5rem;
    margin: 0 0 0.5rem;
    word-break: break-word;
  }
  h1 span {
    color: var(--accent);
  }
  .sub {
    color: var(--muted);
    margin: 0 0 1.4rem;
  }
  .tiles {
    grid-template-columns: repeat(3, 1fr);
    margin: 0;
  }
  .tile {
    background: var(--bg);
  }
  .note {
    margin-top: 1.4rem;
    color: var(--muted);
  }
  .bar-container {
    max-width: 320px;
    margin: 0 auto;
  }
</style>

<main class="card">
  <p class="label">{label}</p>
  <h1>
    {#if titleHighlight}
      <span>{titleHighlight}</span>
    {:else}
      {title}
    {/if}
  </h1>
  <p class="sub">{sub}</p>

  {#if showCounts}
    <div class="tiles">
      <div class="tile"><b>{counts.today}</b><span class="muted small">today</span></div>
      <div class="tile"><b>{counts.week}</b><span class="muted small">this week</span></div>
      <div class="tile"><b>{counts.total}</b><span class="muted small">in total</span></div>
    </div>
  {/if}

  {#if showBar}
    <div class="bar-container">
      <div class="bar out"><i style="width:100%"></i></div>
    </div>
  {/if}

  <p class="note">{note}</p>
</main>

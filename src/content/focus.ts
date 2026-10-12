// Lock-in mode on every page: the session pill, and YouTube cut down to
// search and watching. Reads the session straight from storage.
import type { FocusState } from '../lib/types';

let focus: FocusState | null = null;
let host: HTMLDivElement | null = null;
let pill: HTMLDivElement | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let isAudioTab = false;
let audioPhase: string | null = null; // the phase the audio was last matched to

const onYouTube = /(^|\.)youtube\.com$/.test(location.hostname);
const AUDIO_MARK = '#sever-audio'; // set by the background worker on the audio tab's address
const AUTOPLAY_FLAG = 'sever-autoplay-off'; // set when a session turned YouTube's autoplay off

// Everything on YouTube that leads somewhere you didn't search for.
const YT_CSS = `
  ytd-browse[page-subtype="home"] ytd-rich-grid-renderer,
  ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], grid-shelf-view-model,
  #guide, #guide-button, ytd-mini-guide-renderer, tp-yt-app-drawer,
  #related, ytd-watch-next-secondary-results-renderer,
  #comments, ytd-comments,
  .ytp-endscreen-content, .ytp-ce-element, .html5-endscreen, .ytp-fullscreen-grid,
  .ytp-autonav-endscreen-upnext-container { display: none !important; }
`;

const left = (f: FocusState): number =>
  Math.max(0, f.phase === 'paused' ? f.remainingMs || 0 : f.endsAt - Date.now());

function clock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function drawPill(): void {
  if (!focus) return;
  if (!pill) {
    // A closed shadow root keeps the task text out of reach of the page's own scripts.
    host = document.createElement('div');
    host.id = 'sever-focus';
    host.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483647;pointer-events:none';
    pill = document.createElement('div');
    pill.style.cssText = [
      'max-width:320px',
      'padding:8px 14px',
      'border-radius:999px',
      'font:600 13px/1.3 system-ui,-apple-system,sans-serif',
      'color:#fff',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'box-shadow:0 2px 10px rgba(0,0,0,.25)'
    ].join(';');
    host.attachShadow({ mode: 'closed' }).appendChild(pill);
    document.documentElement.appendChild(host);
  }
  const label =
    focus.phase === 'break' ? 'Break' : focus.phase === 'paused' ? 'Paused' : focus.task;
  pill.textContent = `${label} · ${clock(left(focus))}`;
  pill.style.background =
    focus.phase === 'break' ? '#2f7d4f' : focus.phase === 'paused' ? '#6a6a66' : '#b4441f';
}

const autoplayToggle = (on: boolean): HTMLElement | null =>
  document.querySelector<HTMLElement>(`.ytp-autonav-toggle-button[aria-checked="${on}"]`);

// Turn autoplay back on if a session turned it off. Returns true once there's nothing left to do.
function restoreAutoplay(): boolean {
  try {
    if (!localStorage.getItem(AUTOPLAY_FLAG)) return true;
    if (autoplayToggle(true)) {
      localStorage.removeItem(AUTOPLAY_FLAG);
      return true;
    }
    const off = autoplayToggle(false);
    if (!off) return false; // the player isn't on this page (yet)
    off.click();
    localStorage.removeItem(AUTOPLAY_FLAG);
    return true;
  } catch {
    return true;
  }
}

function youtube(): void {
  if (!onYouTube) return;
  let style = document.getElementById('sever-focus-yt');
  if (focus && !style) {
    style = document.createElement('style');
    style.id = 'sever-focus-yt';
    style.textContent = YT_CSS;
    document.documentElement.appendChild(style);
  } else if (!focus && style) {
    style.remove();
  }
  if (!focus) {
    restoreAutoplay();
    return;
  }

  // Stop YouTube moving on to a video you didn't pick. Remembered, so it can be turned back on afterwards.
  const on = autoplayToggle(true);
  if (on) {
    on.click();
    try {
      localStorage.setItem(AUTOPLAY_FLAG, '1');
    } catch {
      /* storage unavailable */
    }
  }

  // The session's audio tab loops (but not an advert), and follows pause and resume.
  // Play and pause are only sent when the phase changes, so you can still pause it yourself.
  const video = document.querySelector('video');
  if (isAudioTab && video) {
    video.loop = !document.querySelector('.ad-showing');
    if (focus.phase !== audioPhase) {
      audioPhase = focus.phase;
      if (focus.phase === 'focus') video.play().catch(() => {});
      else video.pause();
    }
  }
}

function apply(next: FocusState | null): void {
  focus = next;
  if (!focus) {
    host?.remove();
    host = null;
    pill = null;
    audioPhase = null;
    if (ticker) clearInterval(ticker);
    ticker = null;
    youtube();
    return;
  }
  drawPill();
  youtube();
  ticker ??= setInterval(() => {
    // The extension was reloaded or removed: this copy of the script is orphaned.
    if (!chrome.runtime?.id) {
      apply(null);
      return;
    }
    drawPill();
    youtube();
  }, 1000);
}

// Find out whether this tab is the session's audio tab, then show whatever the session is now.
function start(): void {
  chrome.runtime.sendMessage({ type: 'focusTab' }, (r?: { audio: boolean }) => {
    // The address marker covers the cases where the tab's id isn't known: right
    // after the tab opens, and after a browser restart.
    isAudioTab = (!chrome.runtime.lastError && !!r?.audio) || location.hash === AUDIO_MARK;
    chrome.storage.local.get('focus', (s: { focus?: FocusState | null }) => apply(s.focus || null));
  });
}

chrome.storage.local.get('focus', (s: { focus?: FocusState | null }) => {
  if (s.focus) {
    start();
  } else if (onYouTube) {
    // No session, but an earlier one may have left autoplay off. The player loads late, so retry briefly.
    let tries = 0;
    const retry = setInterval(() => {
      if (restoreAutoplay() || ++tries >= 30) clearInterval(retry);
    }, 1000);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.focus) return;
  const next = (changes.focus.newValue as FocusState | null | undefined) || null;
  if (next && !focus) start();
  else apply(next);
  if (!next) isAudioTab = false;
});

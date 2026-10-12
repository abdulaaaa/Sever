// Countdown pill that shows remaining time on budget sites
(function (): void {
  'use strict';

  let pill: HTMLDivElement | null = null;
  let tickInterval: ReturnType<typeof setInterval> | null = null;
  let syncInterval: ReturnType<typeof setInterval> | null = null;
  let localRemaining: number = 0; // Local countdown in seconds

  // Format seconds to "MM:SS" or "H:MM:SS"
  function formatTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
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

  // Get color class based on remaining time
  function getColorClass(seconds: number): string {
    if (seconds <= 60) return 'critical'; // red
    if (seconds <= 600) return 'warning'; // orange
    return 'normal'; // grey
  }

  // Create and inject pill element
  function createPill(): void {
    if (pill) return;

    pill = document.createElement('div');
    pill.id = 'sever-countdown';
    pill.setAttribute('data-blocker-pill', 'true');
    document.documentElement.appendChild(pill);

    // Inject isolated styles
    const style = document.createElement('style');
    style.textContent = `
      #sever-countdown {
        position: fixed !important;
        bottom: 16px !important;
        left: 16px !important;
        z-index: 2147483647 !important;

        background: rgba(50, 50, 50, 0.9) !important;
        color: #fff !important;
        padding: 8px 12px !important;
        border-radius: 20px !important;

        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        line-height: 1 !important;

        pointer-events: none !important;
        user-select: none !important;

        box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
        transition: background-color 0.3s ease !important;
      }

      #sever-countdown.warning {
        background: rgba(255, 140, 0, 0.9) !important;
      }

      #sever-countdown.critical {
        background: rgba(220, 38, 38, 0.9) !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  // Update pill display
  function updatePill(remaining: number): void {
    if (!pill) return;
    pill.textContent = formatTime(remaining);
    pill.className = getColorClass(remaining);
  }

  interface GetTimeLeftResponse {
    remaining: number;
    tracking: boolean;
  }

  interface ShouldShowCountdownResponse {
    show: boolean;
  }

  // Sync with background to get accurate time
  async function syncWithBackground(): Promise<void> {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'getTimeLeft'
      })) as GetTimeLeftResponse;
      if (response && typeof response.remaining === 'number') {
        localRemaining = response.remaining;
        updatePill(localRemaining);

        // If out of time, trigger immediate check
        if (localRemaining <= 0) {
          chrome.runtime.sendMessage({ type: 'checkNow' });
        }
      }
    } catch (err) {
      console.warn('Sever: Failed to sync countdown', err);
    }
  }

  // Local tick (decrements every second)
  function tick(): void {
    if (!document.hidden && document.hasFocus()) {
      localRemaining = Math.max(0, localRemaining - 1);
      updatePill(localRemaining);

      // Check if hit zero
      if (localRemaining <= 0) {
        chrome.runtime.sendMessage({ type: 'checkNow' });
        stopCountdown();
      }
    }
  }

  // Start countdown
  function startCountdown(): void {
    if (tickInterval) return;

    createPill();
    syncWithBackground(); // Initial sync

    // Tick every second
    tickInterval = setInterval(tick, 1000);

    // Re-sync every 2 seconds to stay accurate with popup/badge
    syncInterval = setInterval(syncWithBackground, 2000);
  }

  // Stop countdown
  function stopCountdown(): void {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
    if (pill && pill.parentNode) {
      pill.parentNode.removeChild(pill);
      pill = null;
    }
  }

  // Check if current page should show countdown
  async function checkShouldShow(): Promise<void> {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'shouldShowCountdown'
      })) as ShouldShowCountdownResponse;
      if (response && response.show) {
        startCountdown();
      } else {
        stopCountdown();
      }
    } catch {
      // Extension context invalidated or error
      stopCountdown();
    }
  }

  // Initialize
  checkShouldShow();

  // Re-check on visibility/focus change
  document.addEventListener('visibilitychange', checkShouldShow);
  window.addEventListener('focus', checkShouldShow);

  // Re-check on URL change (for SPAs)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      checkShouldShow();
    }
  }).observe(document.documentElement, { subtree: true, childList: true });
})();

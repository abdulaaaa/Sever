import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Runs the real content script against a small stand-in for the page and the background worker.

interface FakeEl {
  textContent: string;
  className: string;
  parentNode: { removeChild: () => void } | null;
  setAttribute: () => void;
}

function fakePage(reply: { remaining: number; tracking?: boolean }) {
  let pill: FakeEl | null = null;
  const root = {
    appendChild: (el: FakeEl) => {
      el.parentNode = { removeChild: () => {} };
      if ('id' in el && (el as { id?: string }).id === 'sever-countdown') pill = el;
    }
  };
  const document = {
    hidden: false,
    hasFocus: () => true,
    documentElement: root,
    createElement: (): FakeEl => ({
      textContent: '',
      className: '',
      parentNode: null,
      setAttribute: () => {}
    }),
    addEventListener: () => {}
  };
  const chrome = {
    runtime: {
      sendMessage: vi.fn(async (msg: { type: string }) => {
        if (msg.type === 'shouldShowCountdown') return { show: true };
        if (msg.type === 'getTimeLeft') return { ...reply };
        return { ok: true };
      })
    }
  };
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { addEventListener: () => {} });
  vi.stubGlobal('location', { href: 'https://example.com/' });
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe(): void {}
    }
  );
  vi.stubGlobal('chrome', chrome);
  return { reply, text: () => (pill as FakeEl | null)?.textContent };
}

describe('countdown pill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('holds still while the background is not counting', async () => {
    const page = fakePage({ remaining: 600, tracking: false });
    await import('./countdown');
    await vi.advanceTimersByTimeAsync(1000);
    expect(page.text()).toBe('10:00 left');

    await vi.advanceTimersByTimeAsync(1000); // a local tick, then a re-sync
    expect(page.text()).toBe('10:00 left');
  });

  it('counts down between re-syncs while the background is counting', async () => {
    const page = fakePage({ remaining: 600, tracking: true });
    await import('./countdown');
    await vi.advanceTimersByTimeAsync(1000);
    expect(page.text()).toBe('9:59 left');
  });
});

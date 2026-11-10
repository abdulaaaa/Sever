import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_BLOCKS } from '../lib/utils/defaults';

// Runs the real background worker and the real Supabase SDK against a fake server, so the
// tests can see what a sync actually writes. Row-level security is modelled the way Postgres
// does it: a request without a user's token reads no rows and raises no error.

const ANON = 'test-key'; // VITE_SUPABASE_KEY in vitest.config.ts
const USER_ID = '00000000-0000-4000-8000-000000000001';
const HOUR = 3600;

interface Row {
  id?: string;
  [key: string]: unknown;
}

function jwt(expiresAt: number): string {
  const part = (o: object): string =>
    btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: USER_ID, exp: expiresAt })}.sig`;
}

function fakeServer() {
  const server = {
    blocks: [] as Row[],
    settings: [] as Row[],
    authDown: 0, // how many upcoming calls to the auth server fail
    blockPosts: 0,
    anonReads: 0,
    beforeWrite: null as null | (() => void),
    afterAddUsage: null as null | (() => void),
    usage: 0, // today's seconds in the usage table
    seed(): void {
      server.blocks.push(
        ...DEFAULT_BLOCKS.map((b) => ({ ...b, id: crypto.randomUUID(), user_id: USER_ID }))
      );
      server.settings.push({ user_id: USER_ID, daily_limit_minutes: 80, budget_sites: [] });
    },
    targets(): string[] {
      return server.blocks.map((b) => b.target as string);
    }
  };

  const reply = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    });

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const { pathname } = new URL(req.url);
    const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
    const asUser = token !== '' && token !== ANON;

    if (pathname === '/auth/v1/user') {
      if (server.authDown > 0) {
        server.authDown--;
        return reply(503, { message: 'unavailable' });
      }
      return reply(200, { id: USER_ID, email: 'test@example.com', aud: 'authenticated' });
    }

    const table = pathname.replace('/rest/v1/', '');

    if (table === 'rpc/add_usage' && asUser) {
      const { p_seconds } = (await req.json()) as { p_seconds: number };
      server.usage += p_seconds;
      server.afterAddUsage?.();
      server.afterAddUsage = null;
      return reply(200, server.usage);
    }
    if (table === 'rpc/phone_open_seconds') return reply(200, []);
    if (table === 'usage' && req.method === 'GET') {
      return reply(200, asUser && server.usage ? [{ seconds: server.usage }] : []);
    }
    const rows = table === 'blocks' ? server.blocks : table === 'settings' ? server.settings : [];

    if (req.method === 'GET') {
      if (!asUser && (table === 'blocks' || table === 'settings')) server.anonReads++;
      return reply(200, asUser ? rows : []);
    }

    if (req.method === 'POST') {
      server.beforeWrite?.();
      server.beforeWrite = null;
      if (!asUser) return reply(401, { code: '42501', message: 'row-level security' });
      const body = (await req.json()) as Row[];
      // settings.user_id is the primary key, so a second row for the same user is refused.
      if (table === 'settings' && server.settings.length) {
        return reply(409, { code: '23505', message: 'duplicate key' });
      }
      if (table === 'blocks') server.blockPosts++;
      const added = body.map((r) => ({ ...r, id: crypto.randomUUID(), user_id: USER_ID }));
      rows.push(...added);
      return reply(201, added);
    }

    return reply(200, []);
  };

  return { server, handler };
}

function fakeChrome() {
  const store = (initial: Record<string, unknown>) => {
    const data: Record<string, unknown> = initial;
    return {
      data,
      get: async (keys?: string | string[]) => {
        if (keys === undefined) return { ...data };
        const out: Record<string, unknown> = {};
        for (const k of [keys].flat()) if (k in data) out[k] = data[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(data, structuredClone(items));
      },
      remove: async (key: string) => {
        delete data[key];
      }
    };
  };

  const installed: Array<() => void> = [];
  const startup: Array<() => void> = [];
  const messages: Array<(msg: unknown, sender: unknown, reply: (r: unknown) => void) => unknown> =
    [];
  const noopEvent = { addListener: () => {} };

  const chrome = {
    storage: {
      local: store({
        session: {
          access_token: jwt(Math.floor(Date.now() / 1000) + HOUR),
          refresh_token: 'refresh-1',
          expires_at: Math.floor(Date.now() / 1000) + HOUR,
          user: { id: USER_ID, email: 'test@example.com' }
        }
      }),
      session: store({})
    },
    runtime: {
      getURL: (p: string) => `chrome-extension://sever/${p}`,
      onInstalled: { addListener: (f: () => void) => installed.push(f) },
      onStartup: { addListener: (f: () => void) => startup.push(f) },
      onMessage: { addListener: (f: (typeof messages)[number]) => messages.push(f) }
    },
    alarms: {
      get: async () => ({ name: 'tick' }),
      create: async () => {},
      clear: async () => {},
      onAlarm: noopEvent
    },
    idle: {
      setDetectionInterval: () => {},
      queryState: async () => 'active',
      onStateChanged: noopEvent
    },
    tabs: {
      query: async () => [],
      update: async () => {},
      onActivated: noopEvent,
      onUpdated: noopEvent,
      onRemoved: noopEvent
    },
    windows: { getLastFocused: async () => null, onFocusChanged: noopEvent },
    webNavigation: { onHistoryStateUpdated: noopEvent, onCommitted: noopEvent },
    notifications: { create: () => {}, onClicked: noopEvent, onButtonClicked: noopEvent },
    declarativeNetRequest: {
      RuleActionType: { REDIRECT: 'redirect', ALLOW: 'allow', BLOCK: 'block' },
      getDynamicRules: async () => [],
      updateDynamicRules: async () => {}
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {}
    }
  };

  return { chrome, installed, startup, messages };
}

// A new service worker: everything held in memory is gone, chrome.storage and the database stay.
async function bootWorker(c: ReturnType<typeof fakeChrome>): Promise<void> {
  c.installed.length = 0;
  c.startup.length = 0;
  c.messages.length = 0;
  vi.resetModules();
  await import('./background');
}

// Lets everything the worker has queued so far finish. getTimeLeft goes through the same queue
// as syncs but doesn't start one.
const settled = (c: ReturnType<typeof fakeChrome>): Promise<unknown> =>
  new Promise((resolve) => c.messages[0]({ type: 'getTimeLeft' }, {}, resolve));

// What reloading the extension at chrome://extensions does.
async function reloadExtension(c: ReturnType<typeof fakeChrome>): Promise<void> {
  await bootWorker(c);
  c.installed.forEach((f) => f());
  await settled(c);
}

// What opening Chrome does.
async function startBrowser(c: ReturnType<typeof fakeChrome>): Promise<void> {
  await bootWorker(c);
  c.startup.forEach((f) => f());
  await settled(c);
}

describe('seeding the starting blocks', () => {
  let c: ReturnType<typeof fakeChrome>;
  let f: ReturnType<typeof fakeServer>;

  beforeEach(() => {
    c = fakeChrome();
    f = fakeServer();
    vi.stubGlobal('chrome', c.chrome);
    vi.stubGlobal('fetch', vi.fn(f.handler));
    vi.stubGlobal('WebSocket', class {}); // the SDK wants one to exist; nothing here connects
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('copies them once on the first sign-in, however often the extension reloads', async () => {
    for (let i = 0; i < 3; i++) await reloadExtension(c);

    expect(f.server.targets().sort()).toEqual(DEFAULT_BLOCKS.map((b) => b.target).sort());
    expect(f.server.settings).toHaveLength(1);
    expect(c.chrome.storage.local.data.lastError).toBeNull();
  });

  it('adds nothing when the extension reloads or Chrome starts with blocks already saved', async () => {
    f.server.seed();
    await reloadExtension(c);
    await reloadExtension(c);
    await startBrowser(c);

    expect(f.server.blockPosts).toBe(0);
    expect(f.server.blocks).toHaveLength(DEFAULT_BLOCKS.length);
    expect(f.server.anonReads).toBe(0);
  });

  it('adds nothing when the auth server fails during the reads of a new worker', async () => {
    f.server.seed();
    f.server.authDown = 5; // the five reads in sync(); it is back in time for an insert
    await reloadExtension(c);

    expect(f.server.blockPosts).toBe(0);
    expect(f.server.blocks).toHaveLength(DEFAULT_BLOCKS.length);
    expect(f.server.anonReads).toBe(0);
    expect(c.chrome.storage.local.data.lastError).toContain('Could not use the session');
  });

  it('leaves the cached blocks alone when that happens, and recovers on the next sync', async () => {
    f.server.seed();
    await reloadExtension(c);
    const before = c.chrome.storage.local.data.cache;

    f.server.authDown = 5;
    await reloadExtension(c);
    expect(c.chrome.storage.local.data.cache).toEqual(before);

    await reloadExtension(c);
    expect(c.chrome.storage.local.data.lastError).toBeNull();
    expect(f.server.blocks).toHaveLength(DEFAULT_BLOCKS.length);
  });

  it('adds nothing when another profile seeds between the reads and the writes', async () => {
    f.server.beforeWrite = () => f.server.seed();
    await reloadExtension(c);

    expect(f.server.blockPosts).toBe(0);
    expect(f.server.blocks).toHaveLength(DEFAULT_BLOCKS.length);

    // The next sync picks up what the other profile wrote.
    await reloadExtension(c);
    expect(c.chrome.storage.local.data.lastError).toBeNull();
    expect((c.chrome.storage.local.data.cache as { blocks: Row[] }).blocks).toHaveLength(
      DEFAULT_BLOCKS.length
    );
  });
});

describe('time left across a sync', () => {
  let c: ReturnType<typeof fakeChrome>;
  let f: ReturnType<typeof fakeServer>;

  beforeEach(() => {
    c = fakeChrome();
    f = fakeServer();
    vi.stubGlobal('chrome', c.chrome);
    vi.stubGlobal('fetch', vi.fn(f.handler));
    vi.stubGlobal('WebSocket', class {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const timeLeft = async (): Promise<number> =>
    ((await settled(c)) as { remaining: number }).remaining;

  it('stays the same when a sync uploads the time counted so far', async () => {
    f.server.seed();
    await reloadExtension(c);
    const day = (c.chrome.storage.local.data.cache as { usage: { day: string } }).usage.day;
    c.chrome.storage.local.data.pendingUsage = { [day]: 300 };
    const before = await timeLeft();

    await reloadExtension(c);

    expect(f.server.usage).toBe(300);
    expect(c.chrome.storage.local.data.lastError).toBeNull();
    expect((c.chrome.storage.local.data.cache as { usage: object }).usage).toEqual({
      day,
      seconds: 300,
      phone: {}
    });
    expect(await timeLeft()).toBe(before);
  });

  it('stays the same when the upload lands but a read after it fails', async () => {
    f.server.seed();
    await reloadExtension(c);
    const day = (c.chrome.storage.local.data.cache as { usage: { day: string } }).usage.day;
    c.chrome.storage.local.data.pendingUsage = { [day]: 300 };
    const before = await timeLeft();

    f.server.afterAddUsage = () => (f.server.authDown = 99); // every call after the upload 503s
    await reloadExtension(c);

    expect(f.server.usage).toBe(300);
    expect(c.chrome.storage.local.data.lastError).toBeTruthy();
    expect(await timeLeft()).toBe(before);

    // Once the server is back, the next sync takes its total without counting the 300 twice.
    f.server.authDown = 0;
    await reloadExtension(c);
    expect(c.chrome.storage.local.data.lastError).toBeNull();
    expect(await timeLeft()).toBe(before);
  });
});

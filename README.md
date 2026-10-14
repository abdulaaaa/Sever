# Sever

A personal Chrome extension that blocks distracting websites, limits daily social media time and shows where the time goes. It is built for one person: everything is stored in your own Supabase project and syncs between your Chrome profiles and devices.

## Contents

- [Features](#features)
- [How it works](#how-it-works)
  - [Blocking rules](#blocking-rules)
  - [Daily limit](#daily-limit)
  - [iPhone apps](#iphone-apps)
  - [People](#people)
  - [Lock-in mode](#lock-in-mode)
  - [Analytics](#analytics)
  - [Settings lock](#settings-lock)
  - [Sync and offline use](#sync-and-offline-use)
- [Setup](#setup)
- [iPhone setup (optional)](#iphone-setup-optional)
- [Upgrading an existing install](#upgrading-an-existing-install)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Features

- **Blocking rules**: block whole sites or single pages, always or on a schedule, with allow rules for exceptions.
- **Daily limit**: 80 minutes a day for social media by default, shared between websites and the Instagram and LinkedIn iPhone apps.
- **People**: block someone's profiles and searches for them, and count every attempt.
- **Lock-in mode**: a focus timer that blocks more, trims YouTube down and plays background audio.
- **Analytics**: time per site per day and weekly averages, including iPhone app time and lock-in sessions.
- **Settings lock**: settings can only be changed during a time window you choose.
- **Sync**: one private Supabase database for every Chrome profile and device. Blocking keeps working offline.

## How it works

### Blocking rules

All rules are managed on the Settings page (open the popup, then **Settings**).

| Rule | What it does | Example |
|---|---|---|
| **Always blocked** | Blocks a page or a whole site at all times | `reddit.com/settings/profile` |
| **Scheduled** | Blocks a page or site during a time window on chosen days | `x.com` from 21:00 to 12:00 every day |
| **Always allowed** | Lets a page through, overriding every other rule | `linkedin.com/jobs` |

For each URL you choose **This page** or **Whole site**. Matching ignores `www.`, `m.` and similar subdomains, and treats `twitter.com` as `x.com`.

A new install starts with night-time blocks (21:00 to 12:00) on X, LinkedIn, Instagram, Facebook and Reddit, a couple of settings pages blocked, and LinkedIn Jobs allowed. These are copied into your database the first time you sign in and can be changed from then on.

### Daily limit

Time on the daily-limit sites (X, Reddit, Instagram, Facebook, LinkedIn, TikTok, Threads, Snapchat, Pinterest and Tumblr by default) counts against one daily allowance. You can change both the sites and the minutes in Settings.

- Time counts only while the tab is the active tab in the focused window.
- Pages on a limit site show a countdown, and the toolbar badge shows the website minutes left.
- When the limit is used up, every limit site is blocked until midnight.

The default limit is **80 minutes**, split like this:

| Part | Minutes |
|---|---|
| Websites | 60 |
| Instagram on the iPhone | 15 |
| LinkedIn on the iPhone | 5 |

The 20 phone minutes are always held back from website time, whether you use them or not. Websites are blocked after 60 minutes and the day can never go over 80. Unused phone time is not passed on to websites. If a phone app goes over its allowance (for example ScreenZen is overridden), every extra minute comes off website time.

The popup and the Settings page show the time left out of the full 80 minutes, and say how much of it is kept for the phone. The blocked page says how much was used and how much is kept for the phone.

The phone allowances are `PHONE_LIMITS` in `src/lib/utils/config.ts`. Sever doesn't block the apps on the phone itself; keep these values equal to your ScreenZen limits by hand, and rebuild after changing them. Without the [iPhone setup](#iphone-setup-optional), the 20 minutes are still held back, so either set the limit to 60 or lower `PHONE_LIMITS`.

### iPhone apps

iOS Shortcuts automations report when an app is opened and closed, and the database turns each open and close pair into seconds.

| App | Counts against the limit | Shown on Analytics as |
|---|---|---|
| Instagram | Yes, with a 15-minute allowance | Instagram (phone) |
| LinkedIn | Yes, with a 5-minute allowance | LinkedIn (phone) |
| YouTube | No, tracked only | YouTube (phone) |
| WhatsApp | No, tracked only | WhatsApp (phone) |

- Phone time reaches the laptop within about a minute of the app being closed.
- One session adds at most 2 hours, so a missed close can't add a whole day. If an app is opened again before its close arrived, the earlier open counts as nothing.
- A session counts on the day it started, by the phone's local date, even if it runs past midnight.
- Requests made while the phone is offline are lost, so that session isn't counted.

See [iPhone setup](#iphone-setup-optional) to turn this on.

### People

Add someone under **People** with a name and their profile URLs. Then:

- **Their pages** are blocked, and every attempt is counted and shown in the popup (today, this week and in total).
- **Searches** for their full name or a username from their links are blocked on Google, Bing, DuckDuckGo, YouTube and the search pages of social sites.
- **Lookalikes** still match: different capitalisation, dots, underscores, trailing numbers, letter swaps like `j4ne`, and one or two typos. A profile whose username resembles theirs is blocked too.
- **Typing** a match into a text box on a search engine or social site clears it and blocks the page. Text is compared inside the page and never stored or sent.
- **Extra terms**: add nicknames or other usernames per person. Removing them follows the settings lock.

A first name on its own is never matched. This only covers this browser; allow the extension in incognito from `chrome://extensions/` to cover incognito windows.

### Lock-in mode

Start a focus session from the popup: type what you're working on, set the length (60 minutes by default) and click **Lock in**.

- **Blocked for the session**: your daily-limit sites, plus a separate lock-in list you set in Settings.
- **YouTube**: search and watching stay open. The home feed, Shorts, the side menu, suggestions and comments are removed, autoplay is switched off, and time there doesn't count against the daily limit while the timer runs.
- **Audio**: a YouTube video of your choice plays on a loop in a pinned tab. If Chrome won't start the sound by itself, press play once in that tab.
- **Pause**: stops the timer and the audio; the blocks stay on. After 10 minutes paused you get a reminder.
- **Ending early**: type a sentence and wait 30 seconds.
- **Afterwards**: a break timer (10 minutes by default; sites stay blocked during it), then you rate how the session went.

Lock-in settings and history sync like everything else. A running session belongs to the Chrome profile it was started in.

### Analytics

Click **Analytics** in the popup to see time per daily-limit site per day, and the average per day for each week (Monday to Sunday).

- **Phone columns**: Instagram (phone) and LinkedIn (phone) are limit time and rank like any other limit site.
- **Tracked-only time**: YouTube and WhatsApp Web, and the YouTube and WhatsApp iPhone apps, are recorded but never count against the limit. They keep being recorded after the limit is used up. The tiles show **Limit sites** and **With YouTube + WhatsApp** side by side, and a switch adds them to the chart and tables.
- **YouTube in the browser** keeps counting while a video plays with sound and you aren't touching the mouse or keyboard. It stops when the video is paused or muted, or the screen locks. YouTube during a lock-in session isn't counted here; it shows in the lock-in table as "On YouTube".
- **Lock-in sessions** are listed with their length and how each one went.

If you add YouTube or WhatsApp to your daily-limit sites, it counts against the limit from then on. Time recorded before the change stays where it was, so nothing is counted twice.

### Settings lock

Set an unlock schedule in Settings and everything else can only be changed inside that window, so you can't switch blocks off in a weak moment. With no schedule, settings are always unlocked.

### Sync and offline use

Every Chrome profile or device you sign in on uses the same blocks, settings and daily limit. Changes reach the others within about a minute. Without a connection the last synced rules keep applying, and time used offline is uploaded when the connection returns.

## Setup

You need Chrome (or Brave, Edge or another Chromium browser), a free [Supabase](https://supabase.com) account and Node.js 22 (the version in `.nvmrc`).

### 1. Create the database

1. Create a Supabase project.
2. In **Project Settings → API**, copy the **Project URL** and the **anon public key**.
3. In **SQL Editor**, run this block. It is safe to run again on an existing database: it only adds what is missing and replaces the functions.

```sql
-- Settings, one row per user
CREATE TABLE IF NOT EXISTS settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_limit_minutes INTEGER NOT NULL DEFAULT 80,
  budget_sites TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS settings_unlock_schedule JSONB;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS person_terms JSONB NOT NULL DEFAULT '{}';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS focus_config JSONB NOT NULL DEFAULT '{}';

-- Blocking rules
CREATE TABLE IF NOT EXISTS blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'site', 'allow')),
  target TEXT NOT NULL,
  person TEXT,
  schedule JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seconds counted against the daily limit, one row per day
CREATE TABLE IF NOT EXISTS usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Seconds per site per day, for the Analytics page
CREATE TABLE IF NOT EXISTS site_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  site TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, site)
);

-- Attempts to open a blocked person's pages
CREATE TABLE IF NOT EXISTS attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL
);

-- Lock-in history, one row per day
CREATE TABLE IF NOT EXISTS focus_days (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  video INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  partly INTEGER NOT NULL DEFAULT 0,
  pulled INTEGER NOT NULL DEFAULT 0,
  early INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Adds to today's limit time and returns the new total
CREATE OR REPLACE FUNCTION add_usage(p_day DATE, p_seconds INTEGER)
RETURNS INTEGER AS $$
DECLARE
  new_total INTEGER;
BEGIN
  INSERT INTO usage (user_id, day, seconds)
  VALUES (auth.uid(), p_day, p_seconds)
  ON CONFLICT (user_id, day)
  DO UPDATE SET seconds = usage.seconds + p_seconds;

  SELECT seconds INTO new_total
  FROM usage
  WHERE user_id = auth.uid() AND day = p_day;

  RETURN new_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Adds to one site's time for a day
CREATE OR REPLACE FUNCTION add_site_usage(p_day DATE, p_site TEXT, p_seconds INTEGER)
RETURNS VOID AS $$
BEGIN
  INSERT INTO site_usage (user_id, day, site, seconds)
  VALUES (auth.uid(), p_day, p_site, p_seconds)
  ON CONFLICT (user_id, day, site)
  DO UPDATE SET seconds = site_usage.seconds + p_seconds;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Adds to a day's lock-in history
CREATE OR REPLACE FUNCTION add_focus(
  p_day DATE, p_seconds INTEGER, p_sessions INTEGER, p_video INTEGER,
  p_done INTEGER, p_partly INTEGER, p_pulled INTEGER, p_early INTEGER
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.focus_days AS f (user_id, day, seconds, sessions, video, done, partly, pulled, early)
  VALUES (auth.uid(), p_day, p_seconds, p_sessions, p_video, p_done, p_partly, p_pulled, p_early)
  ON CONFLICT (user_id, day)
  DO UPDATE SET
    seconds = f.seconds + p_seconds,
    sessions = f.sessions + p_sessions,
    video = f.video + p_video,
    done = f.done + p_done,
    partly = f.partly + p_partly,
    pulled = f.pulled + p_pulled,
    early = f.early + p_early;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Row Level Security: each user only sees their own rows
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE focus_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own settings" ON settings;
CREATE POLICY "Users can manage their own settings"
  ON settings FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own blocks" ON blocks;
CREATE POLICY "Users can manage their own blocks"
  ON blocks FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own usage" ON usage;
CREATE POLICY "Users can manage their own usage"
  ON usage FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own site usage" ON site_usage;
CREATE POLICY "Users can manage their own site usage"
  ON site_usage FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own attempts" ON attempts;
CREATE POLICY "Users can manage their own attempts"
  ON attempts FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own focus days" ON focus_days;
CREATE POLICY "Users can manage their own focus days"
  ON focus_days FOR ALL USING (auth.uid() = user_id);
```

4. In **Authentication → Users**, create **one** user with an email and password.

### 2. Build and load the extension

```bash
git clone https://github.com/abdulaaaa/Sever.git
cd Sever
npm install
cp .env.example .env
```

Put your Supabase values in `.env`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_KEY=your_anon_public_key_here
```

Then build:

```bash
npm run build
```

In Chrome, open `chrome://extensions/`, turn on **Developer mode**, click **Load unpacked** and choose the `dist` folder.

### 3. Sign in

There is no login screen. Sign in once per Chrome profile with a console script:

1. Click the Sever icon and open **Settings**.
2. Open the console (F12 → **Console**).
3. Fill in your details and run:

```javascript
const email = 'your@email.com';
const password = 'your_password';
const supabaseUrl = 'https://your-project.supabase.co'; // same as VITE_SUPABASE_URL
const supabaseKey = 'your_anon_key'; // same as VITE_SUPABASE_KEY

fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: supabaseKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
})
  .then((r) => r.json())
  .then((j) => {
    chrome.storage.local.set(
      {
        session: {
          access_token: j.access_token,
          refresh_token: j.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + j.expires_in,
          user: { id: j.user.id, email: j.user.email }
        }
      },
      () => location.reload()
    );
  });
```

The page reloads and Sever is signed in. The session is kept across restarts and refreshes itself.

### 4. Set up your rules

In Settings, add your people, blocks and allow rules, and check the daily limit and its sites. See [How it works](#how-it-works) for what each one does.

## iPhone setup (optional)

This sends Instagram, LinkedIn, YouTube and WhatsApp time from your iPhone. See [iPhone apps](#iphone-apps) for how it is counted.

### 1. Add the phone tables and function

Run this in the Supabase SQL Editor. It is safe to run again.

```sql
-- Secrets the phone may use. Only a hash is stored. RLS is on with no
-- policies, so only the phone_event function can read these tables.
CREATE TABLE IF NOT EXISTS phone_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Apps that are open on the phone right now, waiting for their close event
CREATE TABLE IF NOT EXISTS phone_open (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  day DATE NOT NULL,
  PRIMARY KEY (user_id, app)
);

ALTER TABLE phone_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_open ENABLE ROW LEVEL SECURITY;

-- Called by the iPhone when an app is opened or closed. A close is paired with
-- the open before it and the seconds between them are added to site_usage.
-- Instagram and LinkedIn are stored under "phone:<site>" and also added to the
-- usage table, so they count against the daily limit. YouTube and WhatsApp are
-- stored under "extra:phone:<site>" and never touch usage, so they are tracked
-- only. Returns the seconds added.
CREATE OR REPLACE FUNCTION phone_event(p_secret TEXT, p_app TEXT, p_event TEXT, p_time TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_cap CONSTANT INTEGER := 7200; -- most seconds one session can add, in case a close was missed
  v_user UUID;
  v_app TEXT := lower(p_app);
  v_site TEXT;
  v_at TIMESTAMPTZ := p_time::timestamptz;
  v_open public.phone_open%ROWTYPE;
  v_secs INTEGER;
BEGIN
  SELECT user_id INTO v_user FROM public.phone_tokens
  WHERE token_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unknown secret';
  END IF;

  v_site := CASE v_app
    WHEN 'instagram' THEN 'phone:instagram.com'
    WHEN 'linkedin' THEN 'phone:linkedin.com'
    WHEN 'youtube' THEN 'extra:phone:youtube.com'
    WHEN 'whatsapp' THEN 'extra:phone:whatsapp.com'
  END;
  IF v_site IS NULL THEN
    RAISE EXCEPTION 'unknown app';
  END IF;

  IF p_event = 'open' THEN
    -- p_time is the phone's local time, so its first ten characters are the local day.
    -- An open that never got its close is replaced and counts as nothing.
    INSERT INTO public.phone_open (user_id, app, opened_at, day)
    VALUES (v_user, v_app, v_at, left(p_time, 10)::date)
    ON CONFLICT (user_id, app)
    DO UPDATE SET opened_at = EXCLUDED.opened_at, day = EXCLUDED.day;
    RETURN 0;
  ELSIF p_event = 'close' THEN
    DELETE FROM public.phone_open
    WHERE user_id = v_user AND app = v_app
    RETURNING * INTO v_open;
    IF NOT FOUND THEN
      RETURN 0;
    END IF;
    v_secs := least(floor(extract(epoch FROM v_at - v_open.opened_at)), v_cap)::integer;
    IF v_secs < 1 THEN
      RETURN 0;
    END IF;
    INSERT INTO public.site_usage AS s (user_id, day, site, seconds)
    VALUES (v_user, v_open.day, v_site, v_secs)
    ON CONFLICT (user_id, day, site)
    DO UPDATE SET seconds = s.seconds + v_secs;
    IF v_site LIKE 'phone:%' THEN
      INSERT INTO public.usage AS u (user_id, day, seconds)
      VALUES (v_user, v_open.day, v_secs)
      ON CONFLICT (user_id, day)
      DO UPDATE SET seconds = u.seconds + v_secs;
    END IF;
    RETURN v_secs;
  END IF;
  RAISE EXCEPTION 'unknown event';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION phone_event(TEXT, TEXT, TEXT, TEXT) TO anon;
```

### 2. Register a secret for the phone

Make a long random secret (for example with `openssl rand -hex 32`), keep it for the Shortcuts, and run this with it filled in:

```sql
INSERT INTO phone_tokens (token_hash, user_id)
VALUES (
  encode(sha256(convert_to('YOUR-PHONE-SECRET', 'UTF8')), 'hex'),
  (SELECT id FROM auth.users LIMIT 1)
);
```

### 3. Create the Shortcuts automations

Create eight automations, an opened and a closed one for each app:

| App | `p_app` | Automations |
|---|---|---|
| Instagram | `instagram` | Is Opened → `open`, Is Closed → `close` |
| LinkedIn | `linkedin` | Is Opened → `open`, Is Closed → `close` |
| YouTube | `youtube` | Is Opened → `open`, Is Closed → `close` |
| WhatsApp | `whatsapp` | Is Opened → `open`, Is Closed → `close` |

For each one:

1. In **Shortcuts → Automation**, tap **+** and choose **App**.
2. Pick the app, tick only **Is Opened** or only **Is Closed**, and choose **Run Immediately**.
3. Tap **Next**, then **New Blank Automation**, and add these actions:
   - **Date**: Current Date
   - **Format Date**: Date Format **ISO 8601**, with **Include ISO 8601 Time** on
   - **Get Contents of URL**:
     - URL: `https://YOUR-PROJECT.supabase.co/rest/v1/rpc/phone_event`
     - Method: **POST**
     - Headers: `apikey` = your anon key, `Content-Type` = `application/json`
     - Request Body: **JSON** with four text fields:
       - `p_secret`: your phone secret
       - `p_app`: from the table, in lowercase
       - `p_event`: `open` or `close`
       - `p_time`: the **Formatted Date** from the action above

Once one automation works, you can copy its **Get Contents of URL** action into the others and change only `p_app` and `p_event`.

### 4. Check it

Open one of the apps, wait a minute and close it. Then run this in the SQL Editor:

```sql
SELECT site, seconds FROM site_usage WHERE day = current_date AND site LIKE '%phone:%';
```

The app's row should show about 60 seconds. If nothing arrives, run the automation by hand in Shortcuts to see its error. `unknown app` means `p_app` is misspelled; `unknown secret` means the secret doesn't match.

### Security

The URL and anon key are the same values the extension uses, and alone they can't do anything here. The secret is what lets the phone add time, only for these four apps. Someone holding it could use up website time through Instagram or LinkedIn (at most 2 hours per session), but can't read anything or remove time. To stop a phone from adding time, delete its row from `phone_tokens`.

## Upgrading an existing install

1. Pull the latest code, run `npm install` and `npm run build`.
2. Re-run the SQL block in [Create the database](#1-create-the-database). It adds any missing tables, columns and functions and leaves your data alone.
3. If you use the iPhone apps, re-run the block in [Add the phone tables and function](#1-add-the-phone-tables-and-function). Your secret and tables are kept.
4. Reload the extension on **every** device. A device on an older build doesn't hold back the phone minutes, so it would let websites use them.
5. Check the daily limit in Settings. From 80 minutes, the 20 phone minutes are held back; if it is still at 60, websites only get 40.

## Development

### Commands

```bash
npm run dev          # Build to dist/ and rebuild on change
npm run build        # Production build
npm run check        # Type checking
npm run lint         # ESLint
npm run format       # Format with Prettier (format:check to check only)
npm test             # Unit tests (test:watch to re-run on change)
```

Reload the extension in `chrome://extensions/` after a build. Tests live next to the code as `*.test.ts` and use stub configuration, never your `.env`. GitHub Actions runs check, lint, format:check, test and build on pushes to `main` and on pull requests.

To skip the settings lock while testing, build with `VITE_DEV_MODE=true` set (in `.env` or on the command line). Rebuild without it afterwards.

### Tech stack

TypeScript 5.6, Svelte 5, Vite 5.4 with `@crxjs/vite-plugin`, `@supabase/supabase-js` v2, Vitest, ESLint and Prettier. The extension uses the Chrome `declarativeNetRequest`, `storage` and `alarms` APIs.

### Project structure

```
src/
├── background/      Service worker: blocking rules, time counting, sync every minute
├── content/         Content scripts: countdown, typing checks, lock-in page changes
├── pages/
│   ├── popup/       Time left, attempts, lock-in controls
│   ├── options/     Settings page
│   ├── blocked/     Page shown when something is blocked
│   └── analytics/   Time per site per day, weekly averages, lock-in history
├── lib/
│   ├── services/    Supabase access
│   ├── types/       Shared TypeScript types
│   └── utils/
│       ├── common.ts     URL matching, schedules, limit and state logic
│       ├── analytics.ts  Turns usage rows into days and weekly averages
│       ├── config.ts     Configuration, tracked-only sites, phone allowances
│       └── defaults.ts   Starting blocks and settings
└── assets/          Icons
```

## Troubleshooting

**The extension doesn't load**
- Load the `dist` folder, not the project folder, and check that `npm run build` succeeded.
- Look for errors on the Sever card in `chrome://extensions/`.

**The build fails**
- Check that `.env` exists with `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` set.
- Check Node.js with `node --version` (22 is expected), then run `npm install`.

**Nothing syncs, or "signed-out" errors**
- Run the sign-in script again on that profile.
- Check that the Supabase project is active, the user exists and the SQL block ran without errors.
- Look in the console of the Settings page (F12) for errors.

**Rules or settings don't apply**
- Changes from another device take about a minute. Reload open tabs afterwards.

**The time left looks wrong**
- Reload the extension in `chrome://extensions/` after every build. Pages can pick up the new build before the background worker does, and the two then disagree.
- Make sure every device runs the same build.

**iPhone time doesn't show**
- See [Check it](#4-check-it) in the iPhone setup.

## License

MIT License

Copyright (c) 2024

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

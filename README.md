# Sever Chrome Extension

A personal Chrome extension for managing internet usage and reducing distractions. Features website blocking, customizable schedules, daily time limits, and accountability tracking.

**Note**: This is a single-user personal productivity tool. It syncs across your Chrome profiles via your private Supabase database.

## Features

- **Website Blocking**: Block entire sites or specific pages
- **Scheduled Blocks**: Apply time-based blocking rules (e.g., block social media from 9pm to noon)
- **Daily Time Limits**: Track and limit time spent on social media with a configurable daily minute allowance
- **Person Tracking**: Monitor attempts to visit specific profiles for accountability
- **Allow Rules**: Whitelist specific pages even during blocked periods
- **Multi-Profile Sync**: Sync settings across Chrome profiles via Supabase
- **Offline Support**: Works offline, syncs when connection returns
- **Privacy First**: All data stored in YOUR private Supabase database

## Screenshots

The extension includes:
- Browser popup showing daily social media usage and statistics
- Comprehensive settings page for managing all blocking rules
- Blocked page display with clear information about why content was blocked

## Installation

### Prerequisites

- Google Chrome or Chromium-based browser (Brave, Edge, etc.)
- A Supabase account (free tier works perfectly)
- Node.js 22 (the version in `.nvmrc`, also used by CI)

### Step 1: Set up Supabase

1. Create a free account at [supabase.com](https://supabase.com)
2. Create a new project
3. Go to **Project Settings → API**
4. Copy your **Project URL** and **anon public key**
5. Go to **SQL Editor** and run the following database schema:

```sql
-- Settings table
CREATE TABLE settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_limit_minutes INTEGER NOT NULL DEFAULT 60,
  budget_sites TEXT[] NOT NULL DEFAULT '{}',
  person_terms JSONB NOT NULL DEFAULT '{}',
  focus_config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Blocks table
CREATE TABLE blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'site', 'allow')),
  target TEXT NOT NULL,
  person TEXT,
  schedule JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Usage tracking
CREATE TABLE usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Attempt tracking
CREATE TABLE attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL
);

-- Function to add usage
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

-- Row Level Security
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;

-- Policies (users can only see their own data)
CREATE POLICY "Users can manage their own settings"
  ON settings FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own blocks"
  ON blocks FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own usage"
  ON usage FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own attempts"
  ON attempts FOR ALL USING (auth.uid() = user_id);
```

**Extra watch terms (for blocking searches).** If your database was set up before search blocking existed, run this once:

```sql
ALTER TABLE settings ADD COLUMN IF NOT EXISTS person_terms JSONB NOT NULL DEFAULT '{}';
```

**Lock-in mode.** Run this to sync lock-in settings and session history. It is safe to run again:

```sql
ALTER TABLE settings ADD COLUMN IF NOT EXISTS focus_config JSONB NOT NULL DEFAULT '{}';

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

-- Function to add to a day's lock-in history
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

ALTER TABLE focus_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own focus days" ON focus_days;
CREATE POLICY "Users can manage their own focus days"
  ON focus_days FOR ALL USING (auth.uid() = user_id);
```

**Per-site usage (for the Analytics page).** If your database was set up before the Analytics page existed, run just this block:

```sql
-- Per-site usage tracking
CREATE TABLE site_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  site TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, site)
);

-- Function to add per-site usage
CREATE OR REPLACE FUNCTION add_site_usage(p_day DATE, p_site TEXT, p_seconds INTEGER)
RETURNS VOID AS $$
BEGIN
  INSERT INTO site_usage (user_id, day, site, seconds)
  VALUES (auth.uid(), p_day, p_site, p_seconds)
  ON CONFLICT (user_id, day, site)
  DO UPDATE SET seconds = site_usage.seconds + p_seconds;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE site_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own site usage"
  ON site_usage FOR ALL USING (auth.uid() = user_id);
```

6. Create **ONE** user account in **Authentication → Users** with email and password

### Step 2: Install the Extension

1. **Clone this repository**
   ```bash
   git clone https://github.com/yourusername/sever.git
   cd sever
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_KEY=your_anon_public_key_here
   ```

4. **Build the extension**
   ```bash
   npm run build
   ```

5. **Load into Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in top right)
   - Click **Load unpacked**
   - Select the `dist` folder from this project
   - The Sever icon should appear in your toolbar

### Step 3: Set Up Your Session (One-Time)

Since this is a single-user extension with no login UI, you'll need to set up your session once using a browser console script:

1. Click the extension icon and go to **Settings**
2. Open the browser console (F12 → Console tab)
3. Paste and run this script (replace with your credentials):

```javascript
const email = 'your@email.com';
const password = 'your_password';
const supabaseUrl = 'https://your-project.supabase.co';  // Same as VITE_SUPABASE_URL
const supabaseKey = 'your_anon_key';  // Same as VITE_SUPABASE_KEY

fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'apikey': supabaseKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
})
.then(r => r.json())
.then(j => {
  chrome.storage.local.set({
    session: {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + j.expires_in,
      user: { id: j.user.id, email: j.user.email }
    }
  }, () => location.reload());
});
```

4. The page will reload and you're ready to go! The session persists across restarts and auto-refreshes.

### Step 4: Configure Your Blocks

1. In Settings, configure your blocking rules:
   - **People**: Track specific social media profiles
   - **Always blocked**: Sites or pages to block permanently
   - **Scheduled blocks**: Time-based blocking (e.g., nights/weekends)
   - **Always allowed**: Exceptions to your blocks
   - **Daily limit**: Set your social media time budget

## Usage

### Adding Blocking Rules

**Block a Person's Profile (Tracked)**
1. Go to Settings → People section
2. Enter a name and paste their profile URL
3. Every access attempt is counted and displayed in the popup

**Block a Page or Site Always**
1. Settings → Always blocked section
2. Paste a URL
3. Choose "This page" or "Whole site"

**Block on a Schedule**
1. Settings → Scheduled blocks section
2. Paste a URL, choose page/site
3. Set start/end times and days of week
4. Example: Block Twitter from 9pm to noon every day

**Allow Exceptions**
1. Settings → Always allowed section
2. Paste a URL (e.g., `linkedin.com/jobs`)
3. This bypasses all other blocking rules

### Daily Social Media Limit

- Set your desired minutes per day in Settings
- The extension tracks time on configured "budget sites"
- When the limit is reached, all budget sites are blocked until midnight
- View remaining time in the extension popup

### Syncing Across Devices

Set up the session (using the console script) on each Chrome profile/device. Settings sync automatically within about a minute.

### Analytics

Click **Analytics** in the popup to see how much time you spend on each daily-limit site per day, and the average per day for each week (Monday to Sunday). Per-site numbers start from the day you install this version; earlier days only show a combined total.

**YouTube and WhatsApp Web** are recorded too, but they never count against your daily limit and keep being recorded after the limit is used up:

- Time only counts while the tab is the active tab in the focused window. A YouTube video that is playing sound keeps counting when you aren't touching the mouse or keyboard; it stops when the video is paused or muted, or the screen locks.
- YouTube during a lock-in session isn't counted here. It stays in the lock-in table as "On YouTube".
- The tiles show two figures side by side: **Limit sites**, and **With YouTube + WhatsApp**. The switch above the chart adds both sites to the chart and the tables.
- No database change is needed: the time is stored in the existing `site_usage` table under its own site name (`extra:youtube.com`, `extra:whatsapp.com`). Numbers start from the day you install this version.
- If you add YouTube or WhatsApp to your daily-limit sites, that site counts against the limit from then on like any other. Time recorded before the change stays where it was, so nothing is counted twice.

### Blocking searches for people

For everyone under **People**, looking them up is blocked as well as their pages:

- **Searches**: on Google, Bing, DuckDuckGo, YouTube and the search pages of social sites, a search for their full name or a username from their blocked links goes to the blocked page and is counted.
- **Lookalikes**: different capitalisation, dots, underscores, trailing numbers, letter swaps like `j4ne`, and one or two typos still match. A profile whose username resembles theirs is blocked too.
- **Typing**: on search engines and social sites, typing a match into a text box clears it and blocks the page. Text is compared inside the page and never stored or sent.
- **Extra terms**: add nicknames or other usernames per person in Settings. Removing them follows the settings lock.

A first name on its own is never matched. This only covers this browser; allow the extension in incognito from `chrome://extensions/` to cover incognito windows.

### Lock-in mode

Start a focus session from the popup: type what you're working on, set the length (60 minutes by default) and click **Lock in**.

- **Blocked for the session**: your daily-limit sites, plus a separate lock-in list you set in Settings.
- **YouTube**: search and watching stay open. The home feed, Shorts, the side menu, suggestions and comments are removed, autoplay is switched off for the session, and time there doesn't count against your daily limit while the timer runs.
- **Audio**: a YouTube video of your choice plays on a loop in a pinned tab from the start. If Chrome won't start the sound by itself, press play once in that tab.
- **Pause**: stops the timer and the audio; the blocks stay on. After 10 minutes paused you get a reminder.
- **Ending early**: type a sentence and wait 30 seconds.
- **Afterwards**: a break timer (sites stay blocked during it), and the Analytics page lists your sessions.

Lock-in settings and history sync through Supabase like everything else. A running session itself belongs to the Chrome profile it was started in.

### Settings Lock

Lock your settings outside of a scheduled time window to prevent yourself from disabling blocks when you shouldn't. When locked, you can only change settings during the unlock schedule you define.

## Privacy & Security

- **Your Data, Your Control**: All data stored in YOUR private Supabase database
- **No Third-Party Tracking**: Zero analytics, no data collection by us
- **Local-First**: Works offline, credentials never leave your machine
- **Open Source**: Audit the code yourself

## Development

### Tech Stack

- **TypeScript 5.6** - Type safety
- **Svelte 5** - Reactive UI framework
- **Vite 5.4** - Fast build tool
- **@supabase/supabase-js** - Official Supabase SDK for database operations
- **@crxjs/vite-plugin** - Chrome extension bundler
- **Vitest** - Unit tests
- **ESLint and Prettier** - Linting and formatting
- **GitHub Actions** - Runs all checks on pushes to `main` and on pull requests

### Project Structure

```
sever/
├── src/
│   ├── background/          # Service worker (blocking logic, sync)
│   ├── pages/
│   │   ├── popup/          # Extension popup UI
│   │   ├── options/        # Settings page UI
│   │   ├── analytics/      # Usage analytics page
│   │   └── blocked/        # Blocked page display
│   ├── content/            # Content scripts (countdown timer)
│   ├── lib/
│   │   ├── services/       # Supabase SDK integration
│   │   ├── types/          # TypeScript interfaces
│   │   └── utils/          # Core logic (matching, scheduling)
│   └── assets/             # Icons
├── .github/workflows/      # CI workflow
├── dist/                   # Build output (load in Chrome)
└── .env                    # Your credentials (gitignored)
```

### Making Changes

1. **Development Mode** (with hot reload):
   ```bash
   npm run dev
   ```
   - Builds to `dist/` and watches for changes
   - Reload extension in Chrome to see updates

2. **Production Build**:
   ```bash
   npm run build
   ```

3. **Checks** (CI runs all of these):
   ```bash
   npm run check          # Type checking
   npm run lint           # ESLint
   npm run format:check   # Prettier, without writing (npm run format to fix)
   npm test               # Unit tests (npm run test:watch to re-run on change)
   ```
   Tests live next to the code as `*.test.ts` and use stub configuration, never your `.env`.

4. **Reload extension in Chrome**:
   - Go to `chrome://extensions/`
   - Click the reload icon on the Sever card

### Key Files

- **Blocking logic**: `src/background/background.ts`
- **URL matching**: `src/lib/utils/common.ts`
- **Supabase SDK**: `src/lib/services/supa.ts`
- **Popup UI**: `src/pages/popup/Popup.svelte`
- **Settings UI**: `src/pages/options/Options.svelte`

### Architecture

- **Background Worker**: Runs blocking logic, manages sync with Supabase every 1 minute
- **Content Scripts**: Injects countdown timer on budget sites
- **Svelte Pages**: Reactive UI for popup, options, and blocked pages
- **Supabase SDK**: Type-safe database operations with automatic token refresh
- **Chrome Storage**: Session persists locally, auto-refreshes via SDK

## Troubleshooting

**Extension not loading**
- Verify you ran `npm run build` successfully
- Load the `dist` folder, not the root folder
- Check Chrome's extension error messages in `chrome://extensions/`

**Sync not working**
- Check internet connection
- Verify Supabase credentials in `.env` (must start with `VITE_`)
- Check browser console for errors (F12 → Console)
- Confirm database tables were created correctly
- Verify session is set up (run the console script again if needed)

**Blocks not applying**
- Wait ~1 minute after making changes for sync
- Reload tabs for changes to take effect
- Check browser console for errors

**Build fails**
- Ensure `.env` file exists with valid credentials
- Check that Node.js 22 is installed: `node --version`
- Make sure `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` are set
- Run `npm install` to ensure dependencies are installed

**Session expired / "signed-out" errors**
- The session auto-refreshes, but if it fails, run the console script again
- Check that your Supabase user account still exists
- Verify your Supabase project is still active

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

## Support

For bugs or feature requests, please [open an issue](https://github.com/yourusername/sever/issues) on GitHub.

---

**Note**: This extension requires you to set up your own Supabase project. This ensures your data privacy and gives you full control over your information.

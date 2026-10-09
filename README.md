# Page Blocker Chrome Extension

A Chrome extension that helps you manage internet usage and reduce distractions by blocking websites and pages with customizable schedules, daily time limits, and accountability tracking.

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
- Node.js installed on your machine

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

6. Create a user account in **Authentication → Users** (or sign up via email in the extension later)

### Step 2: Install the Extension

1. **Clone this repository**
   ```bash
   git clone https://github.com/yourusername/page-blocker.git
   cd page-blocker
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your Supabase credentials:
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your_anon_public_key_here
   ```

3. **Build the extension**
   ```bash
   node build.js
   ```

   You should see:
   ```
   ✓ Build complete!
   ```

4. **Load into Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in top right)
   - Click **Load unpacked**
   - Select the `dist` folder from this project
   - The Page Blocker icon should appear in your toolbar

### Step 3: Configure Your Blocks

1. Click the extension icon and go to **Settings**
2. Sign in with your Supabase credentials
3. Configure your blocking rules:
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

Sign in with the same Supabase account on multiple Chrome profiles/devices. Settings sync automatically within about a minute.

## Privacy & Security

- **Your Data, Your Control**: All data stored in YOUR private Supabase database
- **No Third-Party Tracking**: Zero analytics, no data collection by us
- **Local-First**: Works offline, credentials never leave your machine
- **Open Source**: Audit the code yourself

See [PRIVACY.md](PRIVACY.md) for complete details.

## Development

### Project Structure

```
page-blocker/
├── src/
│   ├── background/          # Service worker (blocking logic)
│   ├── pages/              # UI pages (popup, options, blocked)
│   ├── utils/              # Shared utilities
│   ├── services/           # External services (Supabase)
│   └── assets/             # Icons, styles
├── dist/                   # Build output (load in Chrome)
├── manifest.json           # Extension manifest
├── build.js                # Build script
└── .env                    # Your credentials (gitignored)
```

### Making Changes

1. Edit files in `src/`
2. Run build script: `node build.js`
3. Reload extension in Chrome:
   - Go to `chrome://extensions/`
   - Click the reload icon on the Page Blocker card

### Key Files

- **Blocking logic**: `src/background/background.js`
- **URL matching**: `src/utils/common.js`
- **Supabase API**: `src/services/supa.js`
- **Popup UI**: `src/pages/popup/`
- **Settings UI**: `src/pages/options/`

## Troubleshooting

**Extension not loading**
- Verify you ran `node build.js` successfully
- Load the `dist` folder, not the root folder
- Check Chrome's extension error messages

**Sync not working**
- Check internet connection
- Verify Supabase credentials in `.env`
- Check browser console for errors (F12 → Console)
- Confirm database tables were created

**Blocks not applying**
- Wait ~1 minute after making changes for sync
- Reload tabs for changes to take effect
- Check that you're signed in

**Build script fails**
- Ensure `.env` file exists with valid credentials
- Check that Node.js is installed: `node --version`
- Make sure `SUPABASE_URL` and `SUPABASE_KEY` are set

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

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

For bugs or feature requests, please [open an issue](https://github.com/yourusername/page-blocker/issues) on GitHub.

---

**Note**: This extension requires you to set up your own Supabase project. This ensures your data privacy and gives you full control over your information.

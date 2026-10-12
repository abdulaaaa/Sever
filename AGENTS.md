# Sever

A personal Chrome extension for blocking distracting websites with scheduling and
usage tracking. Single-user deployment with cross-device sync via Supabase.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development server with HMR
npm run build        # Build extension for production
npm run check        # Run TypeScript type checking
```

After building, load the `dist` folder in Chrome at `chrome://extensions/`.

## Structure

```
src/
├── background/      Service worker: blocking logic, sync engine, scheduler
├── pages/
│   ├── popup/      Extension popup: stats, quick settings
│   ├── options/    Settings page: manage blocks, schedules, preferences
│   └── blocked/    Page shown when site is blocked
├── content/        Content scripts: countdown timer injection
├── lib/
│   ├── services/   External integrations (Supabase for sync)
│   ├── types/      TypeScript interfaces (Block, Settings, Session, etc.)
│   └── utils/
│       ├── common.ts   Core logic: URL matching, scheduling, state mgmt
│       ├── config.ts   Configuration constants
│       └── defaults.ts Default blocks and settings
└── assets/         Extension icons
```

## Conventions

**Naming**:
- camelCase for variables/functions
- PascalCase for types/interfaces
- snake_case for database fields
- Prefixes for helpers: `norm*`, `sched*`, `day*`

**Error Handling**:
- Try-catch for URL parsing and validation
- Return null for invalid inputs
- Graceful fallbacks with defaults from `defaults.ts`

**Architecture**:
- Pure functions for business logic (matching, scheduling)
- Async/await for Chrome storage and Supabase
- URL normalization strips subdomains and handles aliases (twitter.com → x.com)
- Schedule-based blocking with time windows and day-of-week logic
- State cached in background worker, persisted to Chrome storage
- DEV_MODE bypass for testing

**Tech Stack**:
- TypeScript 5.6 (strict mode), Svelte 5.1, Vite 5.4
- @supabase/supabase-js v2 for type-safe database operations
- Chrome Extension APIs (declarativeNetRequest, storage, alarms)
- No login UI - session managed via chrome.storage.local with SDK auto-refresh

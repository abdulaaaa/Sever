# Privacy Policy - Page Blocker Chrome Extension

**Last Updated**: October 2024

## Overview

Page Blocker is designed with privacy as the highest priority. Unlike most extensions, Page Blocker does NOT collect, transmit, or store your data on our servers. Instead, you maintain complete control by using your own private Supabase database.

## Data Collection

### What Data is Collected

The extension processes the following data LOCALLY and in YOUR private database:

1. **Blocking Rules**
   - Pages and sites you choose to block
   - Scheduled blocking times and days
   - Person names and their profile URLs (if you add them)

2. **Usage Statistics**
   - Time spent on social media sites (for daily limit feature)
   - Daily, weekly, and total usage aggregated by day

3. **Access Attempts**
   - Timestamps when you try to visit blocked pages
   - URLs of attempted access

4. **Settings**
   - Daily time limit preference
   - List of budget sites to track
   - Account credentials (email/password for Supabase auth)

### Where Your Data Goes

**YOUR Private Supabase Database ONLY**
- ALL data is stored exclusively in the Supabase database YOU create and control
- You set up the Supabase project using your own account
- Your Supabase credentials stay on your local machine only (in the `.env` file)
- The credentials are never committed to git or sent anywhere

**Local Chrome Storage**
- Recent data is cached locally for offline functionality
- Syncs to your Supabase database when online
- Cleared if you uninstall the extension

**Extension Developer (us)**
- We have ZERO access to your data
- We do NOT operate any backend servers
- We do NOT receive any telemetry or analytics
- We cannot see what you block or when you use the extension

## What We DON'T Collect

- No analytics or telemetry
- No error reporting to third parties
- No browsing history beyond what you configure to block
- No personal information sent to us
- No tracking pixels or cookies
- No third-party integrations (except Supabase, which YOU control)

## How Your Data is Protected

### Database Security

1. **Row Level Security (RLS)**
   - Supabase RLS policies ensure you only see your own data
   - Even Supabase administrators cannot access your data without your credentials

2. **Authentication Required**
   - Must sign in with your Supabase account to sync
   - JWT-based authentication with token refresh
   - Session tokens stored securely in Chrome's local storage

3. **HTTPS Encryption**
   - All connections to Supabase use encrypted HTTPS
   - Your data is encrypted in transit

### Local Security

1. **Credentials Protection**
   - `.env` file with credentials is in `.gitignore`
   - Never committed to version control
   - Only exists on your local machine

2. **Minimal Permissions**
   - Extension only requests necessary Chrome permissions
   - No access to your passwords, payment info, or other sensitive data
   - Can see visited URLs only to determine what to block

3. **No Web Access to Sensitive Files**
   - Configuration and credentials are NOT exposed as web-accessible resources
   - Only necessary files (blocked page UI) are web-accessible

## Data Retention

### In Your Supabase Database
- Data persists until YOU delete it
- You control retention policies
- You can delete all data from the Supabase dashboard anytime

### In Local Chrome Storage
- Cached data remains until extension is uninstalled
- Or until you clear browser data for the extension

## Your Rights

Since you own and control the Supabase database, you have complete rights:

1. **Right to Access**
   - View all your data anytime in Supabase dashboard
   - Export data in JSON, CSV, or SQL format

2. **Right to Delete**
   - Delete individual records from Supabase dashboard
   - Delete your entire Supabase project
   - Uninstall the extension to remove local data

3. **Right to Export**
   - Export all data from Supabase using their export tools
   - No proprietary formats - standard SQL database

4. **Right to Control**
   - You control who has access (just you, by default)
   - You can modify database schema
   - You can add additional security rules

## Third-Party Services

### Supabase

The extension requires YOU to create a Supabase account:
- Supabase is a legitimate, open-source backend-as-a-service
- Read Supabase's privacy policy: https://supabase.com/privacy
- You control the Supabase project and database
- Free tier available, no credit card required

The extension communicates with YOUR Supabase instance using:
- Your project URL (e.g., `https://xxxxx.supabase.co`)
- Your public API key (safe for client-side use)
- These are configured locally and never sent to us

### No Other Third Parties

- No Google Analytics
- No error tracking services (Sentry, Rollbar, etc.)
- No advertising networks
- No CDNs for loading code
- No external fonts or resources

## Permissions Explained

The extension requests these Chrome permissions:

| Permission | Why It's Needed |
|------------|----------------|
| `declarativeNetRequest` | Block specific URLs by redirecting them |
| `webNavigation` | Detect when you visit pages to apply blocks |
| `storage` | Cache data locally for offline use |
| `alarms` | Schedule periodic syncing with your database |
| `idle` | Detect when you're inactive (for time tracking) |
| `notifications` | Show warnings when approaching time limit |
| `tabs` | Redirect currently open tabs when blocks change |
| `host_permissions: <all_urls>` | Check URLs against your blocking rules |

None of these permissions allow access to passwords, payment info, or other sensitive Chrome data.

## Children's Privacy

This extension is not intended for children under 13. We do not knowingly collect data from children. Since you control the database, you are responsible for compliance with children's privacy laws if allowing use by minors.

## Changes to Privacy Policy

Any changes to this privacy policy will be:
- Documented in this file with a new "Last Updated" date
- Committed to the public GitHub repository
- Highlighted in release notes

## Data Breach Protocol

In the unlikely event of a security vulnerability:
- We will disclose it publicly on GitHub
- We will provide mitigation instructions
- Since you control the data, you can take immediate action

Note: Because your data is in YOUR database, a breach of our code repository does NOT compromise your personal data (as we never have access to it).

## Questions & Transparency

This is an open-source project. You can:
- Review the complete source code on GitHub
- Verify these privacy claims yourself
- Audit network requests in Chrome DevTools
- See exactly what data is stored and where

For questions about privacy:
- Open an issue on GitHub
- Review the code to understand data flow
- Check Supabase's documentation for their privacy practices

## Summary

**In Plain English:**
- You create your own private database (Supabase)
- The extension stores all data there
- We never see or access your data
- No tracking, analytics, or third-party sharing
- You have complete control and ownership

This is privacy by design, not just privacy by policy.

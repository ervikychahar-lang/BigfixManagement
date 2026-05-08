# BigFix Management Tool

A web-based console control dashboard for managing HCL BigFix infrastructure. Monitor endpoints, deploy content, track actions, analyze failures, and auto-fix issues across your BigFix environment.

## Features

- **Dashboard** - Real-time overview of endpoints, content, actions, and failure metrics
- **Endpoints** - View and sync all managed computers from your BigFix console
- **Content Manager** - Browse and deploy fixlets, tasks, baselines, and patches
- **Actions Monitor** - Track deployed actions with per-computer results and progress
- **Failure Reports** - Auto-analyze failed actions and apply resolutions
- **Resolution Library** - Build and manage manual/auto-fix resolutions for common errors
- **Settings** - Configure BigFix console connections (REST API on port 52311)

## Tech Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS
- Lucide React (icons)
- Supabase (database, auth, edge functions)

## Architecture

```
Frontend (React)  -->  Supabase Edge Function  -->  BigFix REST API
       |                        |
       v                        v
  Supabase DB  <----------  Sync Data
```

- The frontend reads/writes data from Supabase PostgreSQL tables
- The `bigfix-proxy` edge function communicates with the BigFix REST API
- "Sync from Console" buttons trigger the edge function to pull live data from BigFix and store it in the database

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env` and configure your Supabase credentials:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```
5. Go to **Settings** and add your BigFix console connection details (host, port, username, password)

## Local / Internal BigFix Proxy

Use this mode when BigFix is on a private IP such as `192.168.x.x` and should not be called from Supabase cloud.

Create `.env.local` using `.env.local.example` as the template, then set:

```bash
VITE_BIGFIX_PROXY_URL=http://127.0.0.1:8787
BIGFIX_PROXY_HOST=127.0.0.1
BIGFIX_PROXY_PORT=8787
BIGFIX_LOCAL_DB=data/local-db.json
BIGFIX_TLS_REJECT_UNAUTHORIZED=false
```

Run the proxy and app in two terminals:

```bash
npm run proxy:local
npm run dev:local
```

For company testing, deploy `server/local-bigfix-proxy.mjs` on an internal server that can reach BigFix, set `BIGFIX_PROXY_HOST=0.0.0.0`, use a trusted TLS certificate, set `BIGFIX_TLS_REJECT_UNAUTHORIZED=true`, and point `VITE_BIGFIX_PROXY_URL` to that internal proxy URL.

## BigFix Console Connection

The tool connects to your BigFix server via the REST API:

- Default port: **52311** (HTTPS)
- Authentication: HTTP Basic Auth using your BigFix Console operator credentials
- Ensure the REST API is enabled on your BigFix server
- The operator must have sufficient permissions for the actions you want to perform

## Database Tables

| Table | Description |
|-------|-------------|
| `bigfix_consoles` | BigFix server connection configurations |
| `bigfix_computers` | Synced endpoint/computer records |
| `bigfix_content` | Fixlets, tasks, baselines, and patches |
| `bigfix_actions` | Deployed actions and their status |
| `bigfix_action_results` | Per-computer action results |
| `bigfix_failure_resolutions` | Manual and auto-fix resolution templates |
| `bigfix_applied_resolutions` | History of applied resolutions |

## Auto-Fix Workflow

1. Deploy an action to target endpoints
2. Monitor results - failed computers are flagged
3. Click **Analyze & Fix** to auto-match failures against the Resolution Library
4. Apply fixes manually or automatically (auto-fix deploys a remediation action via BigFix API)
5. Track resolution history and success rates

## Build

```bash
npm run build
```

## License

Private

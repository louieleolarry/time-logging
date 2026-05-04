# Jira Time Tracker — Native Mac Wizard Design Spec

## Architecture

```
setup.sh
  └── checks for node (falls back to python3 if absent)
  └── installs npm deps (express + vite build, bundled)
  └── starts local server on :7429
  └── opens http://localhost:7429 in default browser
  └── waits for wizard completion signal, then exits

server/
  index.js        ← Express server: serves UI + exposes /api/* endpoints
  routes/
    check.js      ← GET /api/check — probe installed tools, existing config
    install.js    ← POST /api/install — run shell commands (pip3, etc.)
    config.js     ← POST /api/config — write ~/.jira-time-tracker/config.json
    launchd.js    ← POST /api/launchd — write + load launchd plist
    verify.js     ← POST /api/verify — test Jira connection, dry-run log
    done.js       ← POST /api/done — signal setup.sh to exit

client/           ← React + Tailwind (same stack as existing wizard)
  src/
    App.tsx
    pages/
      Welcome.tsx
      ChooseSource.tsx
      JiraCredentials.tsx
      ChargeCodes.tsx
      InstallDeps.tsx
      Configure.tsx
      TestVerify.tsx
      Done.tsx
```

## Wizard Steps

| # | Step | What happens |
|---|---|---|
| 1 | **Welcome** | Intro screen |
| 2 | **Choose Source** | Sticky Notes / Mac Notes / Google Sheets / Google Docs — multi-select cards |
| 3 | **Jira Credentials** | Atlassian URL, email, API token — written to config |
| 4 | **Charge Codes** | Paste RR, Standup, Code Review codes — parsed and stored in config |
| 5 | **Install Dependencies** | Live terminal output: installs requests, macnotesapp, google libs as needed |
| 6 | **Configure** | Writes ~/.jira-time-tracker/config.json; writes launchd plist + schedule picker |
| 7 | **Test & Verify** | Pings Jira API, shows connected account, optional dry-run |
| 8 | **Done** | Summary, copy-paste command for manual runs, link to docs |

All logging is done via a **launchd cron job** that calls `log-time.py` directly.
`log-time.py` posts worklogs to Jira using the REST API — no Claude Code CLI or MCP server required.

## Config Schema (config.json)

```json
{
  "jira": {
    "url": "https://yourteam.atlassian.net",
    "email": "you@company.com",
    "token": "ATATT3..."
  },
  "approach": "cron",
  "sources": ["mac-notes"],
  "charge_codes": {
    "rapid_response": [
      { "label": "AI", "key": "FBAI-875" },
      { "label": "FCEH", "key": "FCEH-109" }
    ],
    "standup": [
      { "label": "AI", "key": "FBAI-1683" },
      { "label": "FCEH", "key": "FCEH-750" }
    ],
    "code_review": [
      { "label": "AI", "key": "FBAI-1667" },
      { "label": "FCEH", "key": "FCEH-751" }
    ]
  },
  "custom_rules": [],
  "schedule": {
    "time": "17:30",
    "days": ["Mon","Tue","Wed","Thu","Fri"]
  }
}
```

## Charge Code Input Format (Step 4)

Users paste freeform text like:
```
RR
fbai-875 / fceh-109
diff review
fbai-1667
fceh-751 / mdcr-13
STANDUP logged under
AI: FBAI-1683
AFG: mafg-4
FC: fceh-750
```

Parser rules:
- Lines after `RR` until next section → rapid_response codes
- Lines after `diff review` / `code review` → code_review codes
- Lines after `STANDUP` → standup codes
- `label: KEY` format → { label, key }
- `KEY / KEY` format → multiple entries, label inferred from key prefix

## Design Language

- **Background:** `#0d1117` (near-black)
- **Card surface:** `#161b22`
- **Border:** `#30363d`
- **Primary accent:** `#2563eb` (blue-600)
- **Success:** `#16a34a` (green-600)
- **Text primary:** `#e6edf3`
- **Text muted:** `#8b949e`
- **Font:** JetBrains Mono for code blocks, system-ui for body
- **Progress:** Left sidebar vertical stepper
- **Cards:** Dark bordered cards with hover glow for selection steps

## Distribution

```
jira-time-tracker-wizard/
  setup.sh              ← entry point: chmod +x && ./setup.sh
  package.json
  server/
    index.js
    routes/
  client/dist/          ← pre-built React bundle (committed)
  README.md
```

User runs: `curl -fsSL https://... | bash` or downloads zip and runs `./setup.sh`

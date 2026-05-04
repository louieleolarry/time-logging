# JiraTimeTracker

A macOS application that automates logging time entries to Jira using Claude Code CLI and a scheduled launchd cron job.

---

## Installation

Open **Terminal** and paste this single command:

```bash
curl -fsSL https://raw.githubusercontent.com/louieleolarry/time-logging/main/install.sh | bash
```

That's it. The installer will:
1. Download `JiraTimeTracker.app` directly via `curl` (no Gatekeeper warning)
2. Install it to `~/Applications/`
3. Extract the setup wizard
4. Launch the wizard automatically in your browser

---

## Running Again Later

To re-open the wizard and modify your settings, simply double-click **`JiraTimeTracker.app`** in `~/Applications`. All your existing settings will be pre-filled — only change what you need.

---

## How It Works

The setup wizard walks you through:

1. **Choose Source** — Mac Notes, Google Sheets, or Google Docs
2. **Jira Credentials** — your Jira URL, email, and API token
3. **Charge Codes** — RR, Standup, Code Review project defaults
4. **Install Dependencies** — mcp-atlassian, Claude Code CLI check
5. **Configure** — review settings and set your daily logging schedule
6. **Test & Verify** — confirm your Jira connection works
7. **Done** — launchd agent installed and running

A launchd agent (`com.jira-time-tracker.daily`) is installed at:
`~/Library/LaunchAgents/com.jira-time-tracker.daily.plist`

Logs are written to: `~/.jira-time-tracker/logs/jira-time-tracker.log`

---

## Manual Trigger

To log time manually at any time:

```bash
/usr/bin/python3 ~/Applications/JiraTimeTracker/wizard/log-time.py
```

Dry run (preview without posting):

```bash
/usr/bin/python3 ~/Applications/JiraTimeTracker/wizard/log-time.py --dry-run
```

---

## Uninstall

```bash
cd ~/Applications/JiraTimeTracker/wizard && bash uninstall.sh
```

This removes the launchd agent, config, and logs.

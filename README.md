# JiraTimeTracker

A macOS application that automatically logs your daily time entries to Jira using a scheduled launchd cron job. Reads from Mac Notes, Stickies, Google Sheets, or Google Docs — posts directly to the Jira REST API.

---

## Installation

Open **Terminal** and paste this single command:

```bash
curl -fsSL https://raw.githubusercontent.com/louieleolarry/time-logging/main/install.sh | bash
```

That's it. The installer will:
1. Download `jira-time-tracker-v1.1.0.zip` from the latest GitHub Release
2. Extract it to `~/Applications/JiraTimeTracker/`
3. Launch the setup wizard automatically in your browser


---

## Running Again Later

To re-open the wizard and modify your settings, Run: `bash ~/Applications/JiraTimeTracker/wizard/setup.sh`

All your existing settings will be pre-filled — only change what you need.

---

## How It Works

The setup wizard walks you through:

1. **Choose Source** — Mac Notes, Stickies, Google Sheets, or Google Docs
2. **Jira Credentials** — your Jira URL, email, and API token
3. **Charge Codes** — RR, Standup, Code Review project defaults
4. **Install Dependencies** — installs `requests` and any source-specific packages
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
bash ~/Applications/JiraTimeTracker/wizard/uninstall.sh
```

This removes the launchd agent, config, and logs.

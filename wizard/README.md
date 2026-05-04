# Jira Time Tracker — Setup Wizard

A local web wizard that configures automated Jira time logging on macOS.  
No code signing. No App Store. No admin rights required.

---

## First-Time Setup

### Step 1 — Move the folder somewhere permanent

Move `jira-time-wizard` to a location you won't accidentally delete. A good default:

```
~/JiraTimeTracker
```

You can do this in Finder (drag it to your home folder) or in Terminal:

```bash
mv ~/Downloads/jira-time-wizard ~/JiraTimeTracker
```

### Step 2 — Open Terminal and navigate into the folder

> **Important:** You must `cd` into the folder before running any commands.

```bash
cd ~/JiraTimeTracker
```

If you put it somewhere else, replace `~/JiraTimeTracker` with the actual path.  
Tip: drag the folder from Finder into the Terminal window to auto-fill the path.

### Step 3 — Make the script executable (first time only)

```bash
chmod +x setup.sh
```

### Step 4 — Run the wizard

```bash
./setup.sh
```

The wizard will:
1. Check that Node.js is installed (installs via Homebrew if missing)
2. Install server dependencies
3. Build the UI
4. Start a local server at `http://localhost:7429`
5. Open the wizard in your default browser automatically

---

## Running Again Later

Any time you want to update your configuration, just run:

```bash
cd ~/JiraTimeTracker   # or wherever you put it
./setup.sh
```

---

## What Gets Configured

| Step | What happens |
|---|---|
| 1. Welcome | Overview |

| 3. Choose Source | Sticky Notes, Mac Notes, Google Sheets, Google Docs — Google sources prompt for a Sheet/Doc URL |
| 4. Jira Credentials | Atlassian URL, email, API token |
| 5. Charge Codes | Paste your RR / Standup / Code Review codes, plus optional custom keyword rules |
| 6. Install Dependencies | Live terminal output as packages install |
| 7. Configure | Saves config + sets up launchd schedule (cron path only) |
| 8. Test & Verify | Pings Jira API, confirms your account |
| 9. Done | Summary, copy-ready run commands, and next steps |

---

## Running the Logger Manually

### Sticky Notes or Mac Notes source

```bash
# Log today's entries
/usr/bin/python3 ~/JiraTimeTracker/log-time.py

# Preview without posting to Jira
/usr/bin/python3 ~/JiraTimeTracker/log-time.py --dry-run

# Log for a specific date
/usr/bin/python3 ~/JiraTimeTracker/log-time.py --date 2026-04-25
```

### Google Sheets source

```bash
# Log today's entries from a Google Sheet
python3 ~/skills/jira-time-tracker/scripts/log_from_gdrive.py \
  --sheet <SHEET_ID_OR_URL>

# Preview without posting to Jira
python3 ~/skills/jira-time-tracker/scripts/log_from_gdrive.py \
  --sheet <SHEET_ID_OR_URL> --dry-run

# Log for a specific date
python3 ~/skills/jira-time-tracker/scripts/log_from_gdrive.py \
  --sheet <SHEET_ID_OR_URL> --date 2026-04-25
```

### Google Docs source

```bash
# Log today's entries from a Google Doc
python3 ~/skills/jira-time-tracker/scripts/log_from_gdrive.py \
  --doc <DOC_ID_OR_URL>

# Preview without posting to Jira
python3 ~/skills/jira-time-tracker/scripts/log_from_gdrive.py \
  --doc <DOC_ID_OR_URL> --dry-run
```

The `SHEET_ID_OR_URL` and `DOC_ID_OR_URL` values are saved to `~/.jira-time-tracker/config.json` as `google_source_url` during setup — the Done page shows you the exact command with your URL pre-filled.

All existing rules apply: time range parsing (`9:15-->10:00`), charge code shorthands (`ai`, `cr fceh`, `standup`), same-day ticket merging, and the one-standup-per-day rule. See `Google_Drive_Integration.md` in the skill folder for full format details.

---

## Custom Rules

In Step 5 (Charge Codes) you can optionally paste your own keyword-to-ticket mappings. These are saved to `config.json` as `custom_rules` and are checked **before** the built-in RR and code review defaults.

Format — one rule per line, lines starting with `#` are comments:

```
# keyword -> JIRA-KEY  optional label
design -> PROJ-42  Design Work
oncall -> FCEH-200
infra work -> MDCR-99
```

You can also edit `~/.jira-time-tracker/config.json` directly to add or remove rules at any time without re-running the wizard.

---

## Configuration File

All settings are stored at:

```
~/.jira-time-tracker/config.json
```

Permissions are set to 600 (owner read/write only). Edit this file at any time to update credentials, charge codes, custom rules, or schedule.

**Key fields:**

| Field | Description |
|---|---|
| `jira` | Atlassian URL, email, and API token |
| `approach` | `manus-native` or `claude-cron` |
| `sources` | Array of selected source types |
| `charge_codes` | Parsed RR / standup / code review codes |
| `custom_rules` | Your personal keyword → Jira key mappings |
| `google_source_url` | URL or ID of your linked Google Sheet or Doc |
| `schedule` | Time and days for the launchd cron job |

---

## Logs (cron approach only)

```
~/.jira-time-tracker/logs/jira-time-tracker.log
~/.jira-time-tracker/logs/jira-time-tracker-error.log
```

---

## Uninstalling

To fully remove the Jira Time Tracker (launchd job, config, and logs):

```bash
cd ~/JiraTimeTracker
./uninstall.sh
```

The uninstaller will:
1. Unload and remove the launchd job (`com.jira-time-tracker.daily`)
2. Delete `~/.jira-time-tracker/` (your config and logs)
3. Optionally delete the wizard directory itself

If you prefer to uninstall manually:
```bash
# Remove the launchd agent
launchctl unload ~/Library/LaunchAgents/com.jira-time-tracker.daily.plist
rm ~/Library/LaunchAgents/com.jira-time-tracker.daily.plist

# Remove config and logs
rm -rf ~/.jira-time-tracker
```

---

## Requirements

- macOS 12 Monterey or later
- Node.js 18+ (auto-installed via Homebrew if missing)
- An Atlassian Cloud account with API token access
- For Google sources: `gws` CLI configured with Google OAuth

---

## Troubleshooting

**`chmod: setup.sh: No such file or directory`**  
You're not in the right directory. Run `cd ~/JiraTimeTracker` first (or wherever you placed the folder), then retry.

**`./setup.sh` opens a text editor instead of running**  
This happens when double-clicking in Finder. Always run it from Terminal using the commands above.

**Port 7429 is already in use**  
The wizard detects this and opens the existing instance. If that fails, run:
```bash
lsof -ti :7429 | xargs kill -9
./setup.sh
```

**Google source returns an auth error**  
Ensure the `gws` CLI is authenticated: run `gws drive files list` to confirm access. If it fails, re-run the OAuth flow with `gws auth login`.

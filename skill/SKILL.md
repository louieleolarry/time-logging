---
name: jira-time-tracker
description: "Log time entries (worklogs) to Jira issues via the mcp-atlassian server. Use when the user asks to log time, add a worklog, track hours, or submit time for a Jira issue. Parses issue key, time spent, and optional comment from user input, then calls jira_add_worklog via the locally running mcp-atlassian SSE server on port 9000."
---

# Jira Time Tracker

## Overview

This skill logs time entries to Jira using the `mcp-atlassian` server running locally at `http://localhost:9000`. The server is pre-configured for `codazen.atlassian.net` and authenticates as **Brad Weldy** (`brad.weldy@codazen.com`).

---

## Charge Codes

Use this reference to resolve shorthand labels in sticky notes.

### Code Review

| Label | Jira Key |
|---|---|
| AI | FBAI-1667 |
| AFG | MAFG-3 |
| FCEH | FCEH-751 |
| MDC | MDCR-13 |

### Rapid Response

| Label | Jira Key |
|---|---|
| AI | FBAI-875 |
| AFG | MAFG-40 |
| FCEH | FCEH-109 |
| Safety Center | FCEH-667 |
| MDC | MDCR-4 |

### Stand-Up

| Label | Jira Key |
|---|---|
| AI | FBAI-1683 |
| AI for Good | MAFG-4 |
| FCEH | FCEH-750 |
| MDC | MDCR-12 |

---

## Parsing Rules

### Time Ranges
Sticky notes use `HH:MM-->HH:MM` format. Calculate the duration from the range.
- `11:45-->12:00` = 15m
- `1:00-->5:30` = 4h 30m

### Multiple time ranges for the same issue — MERGE
If the same Jira issue key appears multiple times in a day (e.g. two time blocks for FBAI-875), **sum all time ranges into a single worklog entry**. Multiple blocks indicate work was paused and resumed — they should still be one entry per ticket per day.

- Example: FBAI-875 at `9:15→10:00` (45m) + `10:30→11:00` (30m) = **one entry of 1h 15m**

### "all the rest of the day" / "all day"
Estimate remaining time after other logged entries to fill the workday (assume 8h total).

### Skip rule — no time or `???` means skip
If an entry has `???` where the time would be, or has no time range at all, **skip it** — no time was spent on it.

> **Important:** An entry with no Jira issue key is NOT automatically skipped. If there is a time range but no ticket, use the best available charge code from context (see "No ticket" rule below).

### No ticket — use best-guess charge code
If a time entry has a duration but no Jira issue key, infer the most appropriate charge code from context:
- **Custom Rules (Checked First):** If the user has defined custom rules in their config (e.g., `design -> PROJ-123`), and the description contains the keyword, use that specific Jira key.
- Work described as a code/diff review → use the appropriate Code Review charge code
- Work described as a standup, meeting, or management task → use the appropriate Stand-Up code
- Work on a named project without a ticket → use the closest matching Rapid Response or project code
- If truly ambiguous, log it to the team's Rapid Response code and note it in the comment

### Standup — one entry per day, hard rule
Always log exactly **one** standup entry of **30 minutes** with comment `"Hyperion Standup"`. Choose the standup code for the team that received the most time that day:
- Most time on FCEH tasks → `FCEH-750`
- Most time on AI/FBAI tasks → `FBAI-1683`
- Most time on AFG tasks → `MAFG-4`
- Most time on MDC tasks → `MDCR-12`

**Never log standup to more than one code in the same day.**

The sticky note header lists hints like:
```
STANDUP logged under
AI: FBAI-1683
AFG: mafg-4
FC: fceh-750
```
Use this as a hint, but the "most time" rule takes precedence.

### `diff review` / `RR` entries
These are shorthand for code review and rapid response respectively. Resolve using the Charge Codes table above based on which team's work is being reviewed.

### Entries with `cdz-` prefix
These are Codazen internal tasks (e.g. `cdz-12`, `cdz-10`). Log them as-is.

---

## Execution Steps

### Step 1: Verify Server is Running

```bash
ss -tlnp | grep 9000
```

If port 9000 is not listening, start the server:

```bash
bash /home/ubuntu/start-mcp-atlassian.sh
sleep 5
```

### Step 2: Log the Time Entry

Use the script at `/home/ubuntu/skills/jira-time-tracker/scripts/add_worklog.py`. Pass arguments as environment variables:

```bash
ISSUE_KEY="FCEH-109" TIME_SPENT="5h" COMMENT="your comment here" \
  python /home/ubuntu/skills/jira-time-tracker/scripts/add_worklog.py
```

For multiple entries, run the script once per entry. Entries for the same issue on the same day must be merged into a single call with the summed duration.

### Step 3: Confirm to User

Report the worklog ID and logged time back to the user. If the server returns an error, surface the full error message.

---

## Notes

- `time_spent` must follow Jira format: `1h`, `30m`, `1h 30m`, `2d` (days = 8h each).
- Date defaults to today (current UTC time). If the user specifies a past date, pass it as `STARTED` env var in ISO format: `2026-04-20T09:00:00.000+0000`.
- Credentials are stored in the running server process; no re-authentication is needed.
- Each **unique issue** is logged as one entry per day — never split the same issue across multiple worklogs.

---

## Setup Reference (first-time only)

If `mcp-atlassian` is not installed, install it with:

```bash
uv tool install mcp-atlassian
```

> **Do NOT use `uvx mcp-atlassian`** — on managed/corporate machines (e.g. Meta), `uvx` may fail to fetch packages from PyPI. Install directly with `uv tool install` instead.

The startup script at `/home/ubuntu/start-mcp-atlassian.sh` uses `--jira-token` (the correct flag for mcp-atlassian v0.21+). The old flag `--jira-api-token` no longer exists and will cause a silent connection failure.

### Claude Code CLI headless mode
When using Claude Code CLI, the correct `--allowedTools` value is the full prefixed name:
```
--allowedTools "mcp__atlassian__jira_add_worklog"
```
The flags `--no-interactive` and `--print` both cause hangs when output is redirected to a file in the Meta build. Use `tee` instead to capture output:
```bash
python3 ~/read_stickies.py | claude -p "..." --allowedTools "mcp__atlassian__jira_add_worklog" 2>&1 | tee -a ~/time-tracker.log
```

# Google Drive Integration for Jira Time Tracker

The Jira Time Tracker now supports reading time entries directly from **Google Sheets** and **Google Docs**. This allows you to maintain your daily logs in a collaborative document and automatically sync them to Jira.

## Features

- **Google Sheets Support**: Read tabular data with columns for Date, Issue/Label, Time, and Comment.
- **Google Docs Support**: Read unstructured text logs (like sticky notes) using `|` or tab separators.
- **Smart Parsing**: Automatically handles time ranges (`9:15-->10:00`) and durations (`1h 30m`).
- **Charge Code Inference**: Resolves shorthand labels (e.g., `ai`, `cr fceh`, `standup`) to the correct Jira charge codes.
- **Merge Rules**: Automatically sums multiple time entries for the same ticket on the same day into a single Jira worklog.
- **Standup Enforcement**: Ensures exactly one 30-minute standup entry is logged per day, assigned to the team you spent the most time on.
- **Data Security**: Integrates with the Meta Connector Policy to ensure restricted files (DSS-4, A/C Priv) are never read.

---

## Usage

The integration is powered by the `log_from_gdrive.py` script located in `/home/ubuntu/skills/jira-time-tracker/scripts/`.

### From a Google Sheet

```bash
python3 ~/skills/jira-time-tracker/scripts/log_from_gdrive.py \
  --sheet <SPREADSHEET_ID_OR_URL> \
  --date 2026-05-01
```

**Expected Format (Columns A-D):**

| Date (optional) | Issue Key or Label | Time Spent or Range | Comment |
| :--- | :--- | :--- | :--- |
| 2026-05-01 | FCEH-109 | 1h 30m | Bug fix |
| | FBAI-875 | 9:15-->10:00 | Code review |
| | standup | 30m | Hyperion Standup |
| | FCEH-109 | ??? | (This row will be skipped) |

*Note: If the Date column is left blank, the script uses the last seen date or the target date.*

### From a Google Doc

```bash
python3 ~/skills/jira-time-tracker/scripts/log_from_gdrive.py \
  --doc <DOCUMENT_ID_OR_URL> \
  --date 2026-05-01
```

**Expected Format:**

```text
2026-05-01

9:15-->10:00 | FBAI-875 | Code review
10:30-->11:00 | FBAI-875 | More review
1h 30m | FCEH-109 | Bug fix
standup | FBAI-1683 | Hyperion Standup
??? | FCEH-109 | skipped
```

*Note: The script looks for a date header (e.g., `2026-05-01` or `May 1, 2026`) to set the context for the lines that follow.*

### Dry Run Mode

To test your document formatting without actually submitting anything to Jira, use the `--dry-run` flag:

```bash
python3 ~/skills/jira-time-tracker/scripts/log_from_gdrive.py --sheet <ID> --dry-run
```

---

## Shorthand Labels

You don't need to remember exact Jira issue keys. The script understands the following shorthands:

- **Projects**: `ai`, `afg`, `fceh`, `fc`, `mdc`, `safety`
- **Code Review**: `cr ai`, `diff review afg`, `cr fceh`, etc.
- **Rapid Response**: `rr ai`, `rr fceh`, `rr safety`, etc.
- **Standup**: `standup`, `su`, `standup ai`, etc.

## Automated Scheduling

Because this is a command-line script, it can easily be scheduled via `cron` to run at the end of every workday. For example, to run at 5:30 PM every weekday:

```bash
30 17 * * 1-5 python3 /home/ubuntu/skills/jira-time-tracker/scripts/log_from_gdrive.py --doc <YOUR_DOC_ID> >> /home/ubuntu/.logs/time_tracker.log 2>&1
```

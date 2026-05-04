#!/usr/bin/env python3
"""
log_from_gdrive.py — Read time entries from a Google Sheet or Google Doc
and log them to Jira via the mcp-atlassian server.

USAGE:
  # From a Google Sheet:
  python log_from_gdrive.py --sheet <SPREADSHEET_ID_OR_URL> [--date 2026-05-01] [--dry-run]

  # From a Google Doc:
  python log_from_gdrive.py --doc <DOCUMENT_ID_OR_URL> [--date 2026-05-01] [--dry-run]

OPTIONS:
  --sheet     Google Spreadsheet ID or full URL
  --doc       Google Document ID or full URL
  --date      Date to log for (YYYY-MM-DD). Defaults to today.
  --dry-run   Parse and print entries without submitting to Jira.
  --range     Sheet range to read (default: A:D). Only used with --sheet.

GOOGLE SHEET FORMAT (columns A-D):
  | Date (optional) | Issue Key or Label | Time Spent or Range | Comment |
  Examples:
    | 2026-05-01 | FCEH-109  | 1h 30m        | Bug fix         |
    |            | FBAI-875  | 9:15-->10:00  | Code review     |
    |            | AI        | 10:30-->11:00 | More review     |
    |            | standup   | 30m           | Hyperion Standup|
    |            | FCEH-109  | ???           |                 |  <- skipped

GOOGLE DOC FORMAT:
  Lines are parsed for patterns like:
    9:15-->10:00 | FBAI-875 | Code review
    1h 30m | FCEH-109 | Bug fix
    standup | FBAI-1683 | Hyperion Standup
    9:00-->17:00 | FCEH-109 | all day

  Lines with ??? or no time info are skipped.
  A date header like "2026-05-01" or "May 1, 2026" sets the date for following entries.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from collections import defaultdict

# ──────────────────────────────────────────────
# Charge code lookup (from SKILL.md)
# ──────────────────────────────────────────────
CHARGE_CODES = {
    # Code Review
    "cr:ai":     "FBAI-1667",
    "cr:afg":    "MAFG-3",
    "cr:fceh":   "FCEH-751",
    "cr:mdc":    "MDCR-13",
    # Rapid Response
    "rr:ai":     "FBAI-875",
    "rr:afg":    "MAFG-40",
    "rr:fceh":   "FCEH-109",
    "rr:safety": "FCEH-667",
    "rr:mdc":    "MDCR-4",
    # Stand-Up
    "su:ai":     "FBAI-1683",
    "su:afg":    "MAFG-4",
    "su:fceh":   "FCEH-750",
    "su:mdc":    "MDCR-12",
}

# Shorthand label aliases → charge code key
LABEL_ALIASES = {
    # Code Review shorthands
    "diff review ai":    "cr:ai",
    "diff review afg":   "cr:afg",
    "diff review fceh":  "cr:fceh",
    "diff review fc":    "cr:fceh",
    "diff review mdc":   "cr:mdc",
    "cr ai":             "cr:ai",
    "cr afg":            "cr:afg",
    "cr fceh":           "cr:fceh",
    "cr fc":             "cr:fceh",
    "cr mdc":            "cr:mdc",
    # Rapid Response shorthands
    "rr ai":             "rr:ai",
    "rr afg":            "rr:afg",
    "rr fceh":           "rr:fceh",
    "rr fc":             "rr:fceh",
    "rr safety":         "rr:safety",
    "rr safety center":  "rr:safety",
    "rr mdc":            "rr:mdc",
    # Stand-Up shorthands
    "standup ai":        "su:ai",
    "standup afg":       "su:afg",
    "standup fceh":      "su:fceh",
    "standup fc":        "su:fceh",
    "standup mdc":       "su:mdc",
    "standup":           "su:ai",   # default; overridden by most-time rule
    "stand-up":          "su:ai",
    "stand up":          "su:ai",
    "su":                "su:ai",
    # Single-word project shorthands
    "ai":                "rr:ai",
    "afg":               "rr:afg",
    "fceh":              "rr:fceh",
    "fc":                "rr:fceh",
    "mdc":               "rr:mdc",
    "safety":            "rr:safety",
    "safety center":     "rr:safety",
}

STANDUP_CODES = {"FBAI-1683", "MAFG-4", "FCEH-750", "MDCR-12"}
STANDUP_COMMENT = "Hyperion Standup"
STANDUP_DURATION_MIN = 30

JIRA_KEY_RE = re.compile(r'\b([A-Z][A-Z0-9]+-\d+)\b')
TIME_RANGE_RE = re.compile(r'(\d{1,2}):(\d{2})\s*[-–—>]+\s*(\d{1,2}):(\d{2})')
DURATION_RE = re.compile(r'(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?', re.IGNORECASE)
DATE_RE = re.compile(
    r'(\d{4}-\d{2}-\d{2})'                              # 2026-05-01
    r'|([A-Za-z]+ \d{1,2},?\s*\d{4})'                  # May 1, 2026
    r'|(\d{1,2}/\d{1,2}/\d{4})'                         # 5/1/2026
)


# ──────────────────────────────────────────────
# Utility helpers
# ──────────────────────────────────────────────

def extract_id(url_or_id: str, resource: str) -> str:
    """Extract file ID from a Google Drive/Docs/Sheets URL, or return as-is."""
    patterns = {
        "sheet": r'/spreadsheets/d/([a-zA-Z0-9_-]+)',
        "doc":   r'/document/d/([a-zA-Z0-9_-]+)',
    }
    m = re.search(patterns.get(resource, r'([a-zA-Z0-9_-]{20,})'), url_or_id)
    return m.group(1) if m else url_or_id


def parse_time_range(text: str):
    """Return total minutes from 'HH:MM-->HH:MM' pattern, or None."""
    m = TIME_RANGE_RE.search(text)
    if not m:
        return None
    h1, m1, h2, m2 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
    start = h1 * 60 + m1
    end   = h2 * 60 + m2
    if end < start:
        end += 24 * 60  # overnight
    return end - start


def parse_duration(text: str):
    """Return total minutes from '1h 30m', '45m', '2h' etc., or None."""
    m = DURATION_RE.match(text.strip())
    if not m or (not m.group(1) and not m.group(2)):
        return None
    hours = int(m.group(1) or 0)
    mins  = int(m.group(2) or 0)
    total = hours * 60 + mins
    return total if total > 0 else None


def minutes_to_jira(minutes: int) -> str:
    """Convert minutes to Jira time format: '1h 30m', '45m', '2h'."""
    h = minutes // 60
    m = minutes % 60
    if h and m:
        return f"{h}h {m}m"
    elif h:
        return f"{h}h"
    else:
        return f"{m}m"


def resolve_label(raw: str):
    """
    Resolve a label/shorthand to a Jira issue key.
    Returns (issue_key, is_standup) or (None, False) if unresolvable.
    """
    # Direct Jira key
    if JIRA_KEY_RE.match(raw.strip()):
        key = raw.strip().upper()
        return key, key in STANDUP_CODES

    normalized = raw.strip().lower()

    # Alias lookup
    if normalized in LABEL_ALIASES:
        code_key = LABEL_ALIASES[normalized]
        issue_key = CHARGE_CODES[code_key]
        return issue_key, issue_key in STANDUP_CODES

    # Partial match
    for alias, code_key in LABEL_ALIASES.items():
        if alias in normalized:
            issue_key = CHARGE_CODES[code_key]
            return issue_key, issue_key in STANDUP_CODES

    return None, False


def parse_date(text: str):
    """Try to parse a date string into a datetime.date object."""
    text = text.strip()
    for fmt in ("%Y-%m-%d", "%B %d, %Y", "%B %d %Y", "%b %d, %Y", "%b %d %Y",
                "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def date_to_started(d) -> str:
    """Convert a date to Jira started ISO string at 09:00 UTC."""
    dt = datetime(d.year, d.month, d.day, 9, 0, 0, tzinfo=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000+0000")


# ──────────────────────────────────────────────
# Google Sheets reader
# ──────────────────────────────────────────────

def read_sheet(spreadsheet_id: str, sheet_range: str = "A:D"):
    """
    Read rows from a Google Sheet using gws CLI.
    Returns list of row lists (strings).
    """
    cmd = [
        "gws", "sheets", "spreadsheets", "values", "get",
        "--params", json.dumps({
            "spreadsheetId": spreadsheet_id,
            "range": sheet_range,
            "valueRenderOption": "FORMATTED_VALUE",
            "dateTimeRenderOption": "FORMATTED_STRING",
        })
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"ERROR reading sheet: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    data = json.loads(result.stdout)
    return data.get("values", [])


def parse_sheet_rows(rows, target_date):
    """
    Parse sheet rows into a list of (issue_key, minutes, comment, date) tuples.
    Expected columns: Date | Issue/Label | Time | Comment
    Rows with ??? or no time are skipped.
    """
    entries = []
    current_date = target_date

    # Skip header row if first cell looks like a header
    start_idx = 0
    if rows and rows[0] and rows[0][0].lower() in ("date", "day", ""):
        if len(rows[0]) > 1 and rows[0][1].lower() in ("issue", "ticket", "key", "label", "task"):
            start_idx = 1

    for row in rows[start_idx:]:
        if not row:
            continue

        # Pad row to 4 columns
        while len(row) < 4:
            row.append("")

        date_cell, issue_cell, time_cell, comment_cell = row[0], row[1], row[2], row[3]

        # Update date if provided
        if date_cell.strip():
            parsed = parse_date(date_cell.strip())
            if parsed:
                current_date = parsed

        # Skip if not our target date
        if current_date != target_date:
            continue

        # Skip ??? entries
        if "???" in time_cell:
            print(f"  [SKIP] {issue_cell!r} — time is ???")
            continue

        # Parse time
        minutes = parse_time_range(time_cell)
        if minutes is None:
            minutes = parse_duration(time_cell)
        if not minutes:
            print(f"  [SKIP] {issue_cell!r} — no valid time found in {time_cell!r}")
            continue

        # Resolve issue key
        issue_key, is_standup = resolve_label(issue_cell)
        if not issue_key:
            print(f"  [WARN] Could not resolve label {issue_cell!r} — skipping")
            continue

        comment = comment_cell.strip() or ""
        if is_standup and not comment:
            comment = STANDUP_COMMENT

        entries.append({
            "issue_key": issue_key,
            "minutes": minutes,
            "comment": comment,
            "date": current_date,
            "is_standup": is_standup,
        })

    return entries


# ──────────────────────────────────────────────
# Google Docs reader
# ──────────────────────────────────────────────

def read_doc(document_id: str) -> str:
    """
    Read plain text content from a Google Doc using gws CLI (export as text/plain).
    """
    cmd = [
        "gws", "drive", "files", "export",
        "--params", json.dumps({
            "fileId": document_id,
            "mimeType": "text/plain",
        }),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # Fallback: try docs get and extract text
        return read_doc_via_api(document_id)
    return result.stdout


def read_doc_via_api(document_id: str) -> str:
    """Fallback: read doc via docs API and extract paragraph text."""
    cmd = [
        "gws", "docs", "documents", "get",
        "--params", json.dumps({"documentId": document_id})
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"ERROR reading doc: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    data = json.loads(result.stdout)
    lines = []
    body = data.get("body", {}).get("content", [])
    for element in body:
        para = element.get("paragraph")
        if not para:
            continue
        text = ""
        for elem in para.get("elements", []):
            tr = elem.get("textRun")
            if tr:
                text += tr.get("content", "")
        lines.append(text.rstrip("\n"))
    return "\n".join(lines)


def parse_doc_text(text: str, target_date):
    """
    Parse Google Doc text into time entries.
    Supports formats:
      - HH:MM-->HH:MM | ISSUE | comment
      - 1h 30m | ISSUE | comment
      - ISSUE | 1h 30m | comment  (alternate column order)
      - Date header lines set the current date context.
    """
    entries = []
    current_date = target_date

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        # Check if line is a date header
        dm = DATE_RE.search(line)
        if dm and len(line) < 30:
            parsed = parse_date(dm.group(0))
            if parsed:
                current_date = parsed
                continue

        # Skip if not target date
        if current_date != target_date:
            continue

        # Skip ??? lines
        if "???" in line:
            continue

        # Split by | or tab
        if "|" in line:
            parts = [p.strip() for p in line.split("|")]
        elif "\t" in line:
            parts = [p.strip() for p in line.split("\t")]
        else:
            parts = [line]

        # Try to identify time, issue, comment from parts
        minutes = None
        issue_raw = None
        comment = ""

        for i, part in enumerate(parts):
            part_lower = part.lower().strip()
            # Check if this part is a known label/issue key FIRST
            if issue_raw is None and part:
                if JIRA_KEY_RE.search(part) or part_lower in LABEL_ALIASES:
                    issue_raw = part
                    # If it's a standup label, treat duration as 30m if no time yet
                    if minutes is None and part_lower in LABEL_ALIASES:
                        _ck = LABEL_ALIASES.get(part_lower)
                        if _ck and CHARGE_CODES.get(_ck) in STANDUP_CODES:
                            minutes = STANDUP_DURATION_MIN
                    continue
            if minutes is None:
                m = parse_time_range(part)
                if m:
                    minutes = m
                    continue
                m = parse_duration(part)
                if m:
                    minutes = m
                    continue
            if part and not comment:
                comment = part

        # If we have time but no issue, try to find issue in the full line
        if minutes and not issue_raw:
            m = JIRA_KEY_RE.search(line)
            if m:
                issue_raw = m.group(1)

        if not minutes:
            continue

        if not issue_raw:
            print(f"  [SKIP] No issue key found in: {line!r}")
            continue

        issue_key, is_standup = resolve_label(issue_raw)
        if not issue_key:
            print(f"  [WARN] Could not resolve {issue_raw!r} — skipping")
            continue

        if is_standup and not comment:
            comment = STANDUP_COMMENT

        entries.append({
            "issue_key": issue_key,
            "minutes": minutes,
            "comment": comment,
            "date": current_date,
            "is_standup": is_standup,
        })

    return entries


# ──────────────────────────────────────────────
# Merge and standup rules
# ──────────────────────────────────────────────

def apply_rules(entries):
    """
    Apply skill rules:
    1. Merge same-day same-issue entries.
    2. Enforce exactly one standup entry per day (30m, most-time team).
    3. Return final list of entries.
    """
    # Group by (date, issue_key)
    merged = defaultdict(lambda: {"minutes": 0, "comments": [], "is_standup": False, "date": None})
    for e in entries:
        key = (e["date"], e["issue_key"])
        merged[key]["minutes"] += e["minutes"]
        if e["comment"]:
            merged[key]["comments"].append(e["comment"])
        merged[key]["is_standup"] = e["is_standup"]
        merged[key]["date"] = e["date"]
        merged[key]["issue_key"] = e["issue_key"]

    # Separate standup entries from regular entries
    standup_entries = {k: v for k, v in merged.items() if v["is_standup"]}
    regular_entries = {k: v for k, v in merged.items() if not v["is_standup"]}

    # Determine standup code per day based on most time
    standup_by_day = {}
    for (date, issue_key), v in regular_entries.items():
        if date not in standup_by_day:
            standup_by_day[date] = defaultdict(int)
        # Categorize by team
        if issue_key.startswith("FCEH"):
            standup_by_day[date]["FCEH-750"] += v["minutes"]
        elif issue_key.startswith("FBAI"):
            standup_by_day[date]["FBAI-1683"] += v["minutes"]
        elif issue_key.startswith("MAFG"):
            standup_by_day[date]["MAFG-4"] += v["minutes"]
        elif issue_key.startswith("MDCR"):
            standup_by_day[date]["MDCR-12"] += v["minutes"]

    # Build final list
    final = []

    # Add regular entries
    for (date, issue_key), v in regular_entries.items():
        comment = "; ".join(dict.fromkeys(v["comments"])) if v["comments"] else ""
        final.append({
            "issue_key": issue_key,
            "time_spent": minutes_to_jira(v["minutes"]),
            "comment": comment,
            "date": date,
        })

    # Add exactly one standup per day
    days_with_standup = set()
    for (date, issue_key), v in standup_entries.items():
        if date not in days_with_standup:
            days_with_standup.add(date)

    # For days that have entries but no explicit standup, add one
    all_days = set(d for (d, _) in regular_entries.keys())
    for date in all_days:
        if date not in days_with_standup:
            # Pick standup code based on most time
            team_times = standup_by_day.get(date, {})
            if team_times:
                best_code = max(team_times, key=team_times.get)
            else:
                best_code = "FBAI-1683"  # default
            final.append({
                "issue_key": best_code,
                "time_spent": minutes_to_jira(STANDUP_DURATION_MIN),
                "comment": STANDUP_COMMENT,
                "date": date,
            })
            days_with_standup.add(date)

    # For days with explicit standup entries, use the correct code
    for date in days_with_standup:
        if date in all_days:
            # Already added above; check if we added a standup for this day
            pass
        # If standup was explicitly listed, override with most-time rule
        for (d, ik), v in standup_entries.items():
            if d == date:
                team_times = standup_by_day.get(date, {})
                if team_times:
                    best_code = max(team_times, key=team_times.get)
                else:
                    best_code = ik  # keep as-is
                # Remove any existing standup for this day from final
                final = [e for e in final if not (e["date"] == date and e["issue_key"] in STANDUP_CODES)]
                final.append({
                    "issue_key": best_code,
                    "time_spent": minutes_to_jira(STANDUP_DURATION_MIN),
                    "comment": STANDUP_COMMENT,
                    "date": date,
                })
                break

    return final


# ──────────────────────────────────────────────
# Jira submission
# ──────────────────────────────────────────────

def submit_to_jira(entries, dry_run=False):
    """Submit entries to Jira using the add_worklog.py script."""
    script = os.path.join(os.path.dirname(__file__), "add_worklog.py")

    for e in entries:
        issue_key = e["issue_key"]
        time_spent = e["time_spent"]
        comment = e.get("comment", "")
        started = date_to_started(e["date"])

        print(f"\n{'[DRY RUN] ' if dry_run else ''}Logging: {issue_key} | {time_spent} | {comment or '(no comment)'} | {e['date']}")

        if dry_run:
            continue

        env = os.environ.copy()
        env["ISSUE_KEY"] = issue_key
        env["TIME_SPENT"] = time_spent
        env["COMMENT"] = comment
        env["STARTED"] = started

        result = subprocess.run(
            [sys.executable, script],
            env=env,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"  ERROR: {result.stdout.strip() or result.stderr.strip()}")
        else:
            print(f"  OK: {result.stdout.strip()}")


# ──────────────────────────────────────────────
# Label check (meta-connector-policy)
# ──────────────────────────────────────────────

def check_label(file_id: str) -> bool:
    """
    Run the meta-connector-policy label check for a Google Drive file.
    Returns True if access is allowed, False if denied.
    """
    check_script = os.path.expanduser(
        "~/skills/meta-connector-policy/scripts/check_labels.py"
    )
    if not os.path.exists(check_script):
        print("[WARN] Label check script not found — skipping classification check.")
        return True

    result = subprocess.run(
        [sys.executable, check_script, file_id],
        capture_output=True, text=True
    )
    output = result.stdout + result.stderr
    if "DENIED" in output.upper():
        print(f"ERROR: File {file_id} is classified as restricted and cannot be read.")
        print(output)
        return False
    return True


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Log time entries from Google Sheets or Docs to Jira."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--sheet", metavar="SHEET_ID_OR_URL",
                       help="Google Spreadsheet ID or URL")
    group.add_argument("--doc", metavar="DOC_ID_OR_URL",
                       help="Google Document ID or URL")
    parser.add_argument("--date", metavar="YYYY-MM-DD",
                        help="Date to log for (default: today)")
    parser.add_argument("--range", metavar="RANGE", default="A:D",
                        help="Sheet range to read (default: A:D)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse and print entries without submitting to Jira")
    args = parser.parse_args()

    # Resolve target date
    if args.date:
        target_date = datetime.strptime(args.date, "%Y-%m-%d").date()
    else:
        target_date = datetime.now(timezone.utc).date()

    print(f"Target date: {target_date}")

    # Verify mcp-atlassian server is running (unless dry-run)
    if not args.dry_run:
        result = subprocess.run(["ss", "-tlnp"], capture_output=True, text=True)
        if ":9000" not in result.stdout:
            print("Starting mcp-atlassian server...")
            startup = os.path.expanduser("~/start-mcp-atlassian.sh")
            if os.path.exists(startup):
                subprocess.run(["bash", startup], check=True)
                time.sleep(5)
            else:
                print("ERROR: mcp-atlassian server not running and start script not found.")
                print("Start it manually: bash ~/start-mcp-atlassian.sh")
                sys.exit(1)

    # Read and parse entries
    if args.sheet:
        file_id = extract_id(args.sheet, "sheet")
        print(f"Reading Google Sheet: {file_id}")
        if not check_label(file_id):
            sys.exit(1)
        rows = read_sheet(file_id, args.range)
        print(f"Read {len(rows)} rows from sheet.")
        raw_entries = parse_sheet_rows(rows, target_date)
    else:
        file_id = extract_id(args.doc, "doc")
        print(f"Reading Google Doc: {file_id}")
        if not check_label(file_id):
            sys.exit(1)
        text = read_doc(file_id)
        print(f"Read {len(text.splitlines())} lines from doc.")
        raw_entries = parse_doc_text(text, target_date)

    print(f"\nParsed {len(raw_entries)} raw entries.")

    if not raw_entries:
        print("No entries found for the target date. Nothing to log.")
        return

    # Apply merge and standup rules
    final_entries = apply_rules(raw_entries)
    print(f"After merging: {len(final_entries)} entries to log.\n")

    for e in final_entries:
        print(f"  {e['issue_key']:15s} {e['time_spent']:10s} {e.get('comment', '')}")

    # Submit to Jira
    submit_to_jira(final_entries, dry_run=args.dry_run)

    if args.dry_run:
        print("\n[DRY RUN] No entries were submitted to Jira.")
    else:
        print("\nDone.")


if __name__ == "__main__":
    main()

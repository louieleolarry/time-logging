#!/usr/bin/env python3
"""
log_from_gdrive.py — Read time entries from a Google Sheet or Google Doc
and log them to Jira via the Jira REST API v3.

USAGE:
  # From a Google Sheet (using config):
  python3 log_from_gdrive.py [--date 2026-05-01] [--dry-run]

  # From a Google Sheet (explicit):
  python3 log_from_gdrive.py --sheet <SPREADSHEET_ID_OR_URL> [--date 2026-05-01] [--dry-run]

  # From a Google Doc (explicit):
  python3 log_from_gdrive.py --doc <DOCUMENT_ID_OR_URL> [--date 2026-05-01] [--dry-run]

OPTIONS:
  --sheet     Google Spreadsheet ID or full URL (overrides config)
  --doc       Google Document ID or full URL
  --date      Date to log for (YYYY-MM-DD). Defaults to today.
  --dry-run   Parse and print entries without submitting to Jira.
  --range     Sheet range to read (default: A:D). Only used with --sheet.
  --config    Path to config file (default: ~/.jira-time-tracker/config.json)

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
from base64 import b64encode
from datetime import datetime, timezone, timedelta, date
from collections import defaultdict
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: 'requests' not installed. Run: pip3 install requests", file=sys.stderr)
    sys.exit(1)

# ──────────────────────────────────────────────
# Config loader
# ──────────────────────────────────────────────

DEFAULT_CONFIG_PATH = Path.home() / ".jira-time-tracker" / "config.json"

def load_config(config_path=None):
    path = Path(config_path) if config_path else DEFAULT_CONFIG_PATH
    if not path.exists():
        return {}
    with open(path) as f:
        return json.load(f)


# ──────────────────────────────────────────────
# Charge code lookup (from SKILL.md + config)
# ──────────────────────────────────────────────

# Default charge codes (overridden by config if present)
DEFAULT_CHARGE_CODES = {
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


def build_charge_codes(config):
    """Build charge code lookup from config, falling back to defaults."""
    codes = dict(DEFAULT_CHARGE_CODES)
    cfg_codes = config.get("charge_codes", {})

    # Map config charge codes into our lookup dict
    for entry in cfg_codes.get("code_review", []):
        label = entry.get("label", "").lower()
        key = entry.get("key", "")
        if label and key:
            codes[f"cr:{label}"] = key
            LABEL_ALIASES[f"cr {label}"] = f"cr:{label}"
            LABEL_ALIASES[f"diff review {label}"] = f"cr:{label}"

    for entry in cfg_codes.get("rapid_response", []):
        label = entry.get("label", "").lower()
        key = entry.get("key", "")
        if label and key:
            codes[f"rr:{label}"] = key
            LABEL_ALIASES[f"rr {label}"] = f"rr:{label}"
            LABEL_ALIASES[label] = f"rr:{label}"

    for entry in cfg_codes.get("standup", []):
        label = entry.get("label", "").lower()
        key = entry.get("key", "")
        if label and key:
            codes[f"su:{label}"] = key
            LABEL_ALIASES[f"standup {label}"] = f"su:{label}"

    return codes


def get_standup_codes(config):
    """Return the set of standup Jira keys from config."""
    standup = config.get("charge_codes", {}).get("standup", [])
    if standup:
        return {e["key"] for e in standup}
    return {"FBAI-1683", "MAFG-4", "FCEH-750", "MDCR-12"}


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


def resolve_label(raw: str, charge_codes: dict, standup_codes: set):
    """
    Resolve a label/shorthand to a Jira issue key.
    Returns (issue_key, is_standup) or (None, False) if unresolvable.
    """
    raw = raw.strip()
    # Direct Jira key (e.g. FCEH-109)
    if JIRA_KEY_RE.match(raw):
        key = raw.upper()
        return key, key in standup_codes

    normalized = raw.lower()

    # Alias lookup (exact)
    if normalized in LABEL_ALIASES:
        code_key = LABEL_ALIASES[normalized]
        issue_key = charge_codes.get(code_key)
        if issue_key:
            return issue_key, issue_key in standup_codes

    # Partial match (alias is substring of normalized)
    for alias, code_key in LABEL_ALIASES.items():
        if alias in normalized:
            issue_key = charge_codes.get(code_key)
            if issue_key:
                return issue_key, issue_key in standup_codes

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
# Google Drive label check
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


def parse_sheet_rows(rows, target_date, charge_codes, standup_codes):
    """
    Parse sheet rows into a list of entry dicts.
    Expected columns: Date | Issue/Label | Time | Comment
    Rows with ??? or no time are skipped.
    """
    entries = []
    current_date = target_date

    # Skip header row if first cell looks like a header
    start_idx = 0
    if rows and rows[0] and rows[0][0].lower() in ("date", "day", ""):
        if len(rows[0]) > 1 and rows[0][1].lower() in ("issue", "ticket", "key", "label", "task", "issue / label"):
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
            print(f"  [SKIP] {issue_cell!r} — no valid time in {time_cell!r}")
            continue

        # Resolve issue key
        issue_key, is_standup = resolve_label(issue_cell, charge_codes, standup_codes)
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
    """Read plain text content from a Google Doc using gws CLI."""
    cmd = [
        "gws", "drive", "files", "export",
        "--params", json.dumps({
            "fileId": document_id,
            "mimeType": "text/plain",
        }),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
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


def parse_doc_text(text: str, target_date, charge_codes, standup_codes):
    """Parse Google Doc text into time entries."""
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

        minutes = None
        issue_raw = None
        comment = ""

        for part in parts:
            part_lower = part.lower().strip()
            if issue_raw is None and part:
                if JIRA_KEY_RE.search(part) or part_lower in LABEL_ALIASES:
                    issue_raw = part
                    if minutes is None and part_lower in LABEL_ALIASES:
                        ck = LABEL_ALIASES.get(part_lower)
                        if ck and charge_codes.get(ck) in standup_codes:
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

        if minutes and not issue_raw:
            m = JIRA_KEY_RE.search(line)
            if m:
                issue_raw = m.group(1)

        if not minutes:
            continue
        if not issue_raw:
            print(f"  [SKIP] No issue key found in: {line!r}")
            continue

        issue_key, is_standup = resolve_label(issue_raw, charge_codes, standup_codes)
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

def apply_rules(entries, standup_codes):
    """
    Apply skill rules:
    1. Merge same-day same-issue entries.
    2. Enforce exactly one standup entry per day (30m, most-time team).
    3. Return final list of entries.
    """
    merged = defaultdict(lambda: {"minutes": 0, "comments": [], "is_standup": False, "date": None})
    for e in entries:
        key = (e["date"], e["issue_key"])
        merged[key]["minutes"] += e["minutes"]
        if e["comment"]:
            merged[key]["comments"].append(e["comment"])
        merged[key]["is_standup"] = e["is_standup"]
        merged[key]["date"] = e["date"]
        merged[key]["issue_key"] = e["issue_key"]

    standup_entries = {k: v for k, v in merged.items() if v["is_standup"]}
    regular_entries = {k: v for k, v in merged.items() if not v["is_standup"]}

    # Sum time by team prefix per day for standup selection
    standup_by_day = {}
    standup_key_map = {
        "FCEH": "FCEH-750",
        "FBAI": "FBAI-1683",
        "MAFG": "MAFG-4",
        "MDCR": "MDCR-12",
    }
    for (d, issue_key), v in regular_entries.items():
        if d not in standup_by_day:
            standup_by_day[d] = defaultdict(int)
        prefix = issue_key.split("-")[0]
        if prefix in standup_key_map:
            standup_by_day[d][standup_key_map[prefix]] += v["minutes"]

    final = []

    # Add regular entries
    for (d, issue_key), v in regular_entries.items():
        comment = "; ".join(dict.fromkeys(v["comments"])) if v["comments"] else ""
        final.append({
            "issue_key": issue_key,
            "time_spent": minutes_to_jira(v["minutes"]),
            "comment": comment,
            "date": d,
        })

    # Determine which days already have an explicit standup
    days_with_standup = set()
    for (d, _) in standup_entries.keys():
        days_with_standup.add(d)

    # Add one standup per day
    all_days = set(d for (d, _) in regular_entries.keys())
    for d in all_days:
        team_times = standup_by_day.get(d, {})
        best_code = max(team_times, key=team_times.get) if team_times else "FBAI-1683"
        # Remove any existing standup for this day (from explicit entries)
        final = [e for e in final if not (e["date"] == d and e["issue_key"] in standup_codes)]
        final.append({
            "issue_key": best_code,
            "time_spent": minutes_to_jira(STANDUP_DURATION_MIN),
            "comment": STANDUP_COMMENT,
            "date": d,
        })

    return final


# ──────────────────────────────────────────────
# Jira REST API submission
# ──────────────────────────────────────────────

def post_worklog(jira_url, email, token, issue_key, time_spent_jira, comment, started_date):
    """Post a worklog to Jira REST API v3. Returns (ok, response_data)."""
    # Convert Jira time format to seconds
    minutes = 0
    h_match = re.search(r'(\d+)h', time_spent_jira)
    m_match = re.search(r'(\d+)m', time_spent_jira)
    if h_match:
        minutes += int(h_match.group(1)) * 60
    if m_match:
        minutes += int(m_match.group(1))
    time_spent_seconds = minutes * 60

    url = jira_url.rstrip("/") + f"/rest/api/3/issue/{issue_key}/worklog"
    auth = b64encode(f"{email}:{token}".encode()).decode()
    headers = {
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    started = date_to_started(started_date)
    payload = {
        "timeSpentSeconds": time_spent_seconds,
        "comment": {
            "type": "doc",
            "version": 1,
            "content": [{
                "type": "paragraph",
                "content": [{"type": "text", "text": comment or issue_key}]
            }]
        },
        "started": started,
    }
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=15)
        return resp.status_code in (200, 201), resp
    except requests.RequestException as e:
        return False, str(e)


def submit_to_jira(entries, jira_url, email, token, dry_run=False):
    """Submit entries to Jira REST API."""
    success_count = 0
    for e in entries:
        issue_key = e["issue_key"]
        time_spent = e["time_spent"]
        comment = e.get("comment", "")
        d = e["date"]

        print(f"\n{'[DRY RUN] ' if dry_run else ''}  {issue_key:<15} {time_spent:<10} {comment or '(no comment)'} | {d}")

        if dry_run:
            success_count += 1
            continue

        ok, resp = post_worklog(jira_url, email, token, issue_key, time_spent, comment, d)
        if ok:
            worklog_id = resp.json().get("id", "?")
            print(f"    ✓ Logged (worklog {worklog_id})")
            success_count += 1
        else:
            status = resp.status_code if hasattr(resp, 'status_code') else "?"
            body = resp.text[:300] if hasattr(resp, 'text') else str(resp)
            print(f"    ✗ FAILED: {status} {body}")

    return success_count


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Log time entries from Google Sheets or Docs to Jira."
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--sheet", metavar="SHEET_ID_OR_URL",
                       help="Google Spreadsheet ID or URL (overrides config)")
    group.add_argument("--doc", metavar="DOC_ID_OR_URL",
                       help="Google Document ID or URL")
    parser.add_argument("--date", metavar="YYYY-MM-DD",
                        help="Date to log for (default: today)")
    parser.add_argument("--range", metavar="RANGE", default="A:D",
                        help="Sheet range to read (default: A:D)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse and print entries without submitting to Jira")
    parser.add_argument("--config", metavar="PATH",
                        help=f"Config file path (default: {DEFAULT_CONFIG_PATH})")
    args = parser.parse_args()

    # Load config
    config = load_config(args.config)
    jira_cfg = config.get("jira", {})
    jira_url = jira_cfg.get("url", "https://codazen.atlassian.net").rstrip("/")
    email = jira_cfg.get("email", "")
    token = jira_cfg.get("token", "")

    if not email or not token:
        print("ERROR: Jira credentials not found in config.", file=sys.stderr)
        print(f"       Expected at: {args.config or DEFAULT_CONFIG_PATH}", file=sys.stderr)
        sys.exit(1)

    # Build charge code lookup from config
    charge_codes = build_charge_codes(config)
    standup_codes = get_standup_codes(config)

    # Resolve source: CLI flag > config google_source_url > error
    sheet_id = None
    doc_id = None

    if args.sheet:
        sheet_id = extract_id(args.sheet, "sheet")
    elif args.doc:
        doc_id = extract_id(args.doc, "doc")
    else:
        # Fall back to config
        google_url = config.get("google_source_url", "")
        sources = config.get("sources", [])
        if google_url:
            if "google-sheets" in sources or not sources:
                sheet_id = extract_id(google_url, "sheet")
            elif "google-docs" in sources:
                doc_id = extract_id(google_url, "doc")
            else:
                # Try to detect from URL
                if "spreadsheets" in google_url:
                    sheet_id = extract_id(google_url, "sheet")
                elif "document" in google_url:
                    doc_id = extract_id(google_url, "doc")
                else:
                    sheet_id = google_url  # treat as raw ID, assume sheet
        else:
            print("ERROR: No source specified. Use --sheet, --doc, or set google_source_url in config.", file=sys.stderr)
            sys.exit(1)

    # Resolve target date
    if args.date:
        target_date = datetime.strptime(args.date, "%Y-%m-%d").date()
    else:
        target_date = datetime.now(timezone.utc).date()

    print(f"📅 Target date   : {target_date}")
    print(f"🔑 Jira account  : {email}")
    print(f"🌐 Jira URL      : {jira_url}")

    # Read and parse entries
    if sheet_id:
        print(f"\n📊 Reading Google Sheet: {sheet_id}")
        if not check_label(sheet_id):
            sys.exit(1)
        rows = read_sheet(sheet_id, args.range)
        print(f"   Read {len(rows)} rows from sheet.")
        raw_entries = parse_sheet_rows(rows, target_date, charge_codes, standup_codes)
    else:
        print(f"\n📄 Reading Google Doc: {doc_id}")
        if not check_label(doc_id):
            sys.exit(1)
        text = read_doc(doc_id)
        print(f"   Read {len(text.splitlines())} lines from doc.")
        raw_entries = parse_doc_text(text, target_date, charge_codes, standup_codes)

    print(f"\n📋 Parsed {len(raw_entries)} raw entries for {target_date}.")

    if not raw_entries:
        print("   No entries found for the target date. Nothing to log.")
        return

    # Apply merge and standup rules
    final_entries = apply_rules(raw_entries, standup_codes)
    print(f"   After merging: {len(final_entries)} entries to submit.\n")

    # Print summary table
    print(f"  {'Issue Key':<15} {'Time':<10} {'Comment'}")
    print("  " + "-" * 58)
    total_minutes = 0
    for e in final_entries:
        mins = 0
        h_m = re.search(r'(\d+)h', e['time_spent'])
        m_m = re.search(r'(\d+)m', e['time_spent'])
        if h_m: mins += int(h_m.group(1)) * 60
        if m_m: mins += int(m_m.group(1))
        total_minutes += mins
        print(f"  {e['issue_key']:<15} {e['time_spent']:<10} {e.get('comment', '')}")
    print("  " + "-" * 58)
    print(f"  {'TOTAL':<15} {minutes_to_jira(total_minutes)}")

    if args.dry_run:
        print(f"\n🔍 Dry run — no entries posted to Jira.")
        return

    # Submit to Jira
    print(f"\n⏫ Posting to Jira...")
    success_count = submit_to_jira(final_entries, jira_url, email, token, dry_run=False)
    print(f"\n✅ Done — {success_count}/{len(final_entries)} entries logged.")


if __name__ == "__main__":
    main()

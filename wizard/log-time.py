#!/usr/bin/env python3
"""
log-time.py — Jira Time Logger
Reads time entries from the configured source, parses them natively,
and posts worklogs to Jira via the REST API.

Usage:
  python3 log-time.py              # use configured source
  python3 log-time.py --dry-run    # parse and print without posting
  python3 log-time.py --date 2026-04-25  # log for a specific date
"""

import argparse
import json
import os
import re
import subprocess
import sys
from base64 import b64encode
from datetime import datetime, date
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: 'requests' is not installed. Run: /usr/bin/pip3 install requests", file=sys.stderr)
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────

CONFIG_PATH = Path.home() / ".jira-time-tracker" / "config.json"

def load_config():
    if not CONFIG_PATH.exists():
        print(f"ERROR: Config not found at {CONFIG_PATH}", file=sys.stderr)
        print("Run the setup wizard first: ./setup.sh", file=sys.stderr)
        sys.exit(1)
    with open(CONFIG_PATH) as f:
        return json.load(f)

# ── Source readers ─────────────────────────────────────────────────────────────

def read_mac_notes(script_dir):
    """Run the Mac Notes reader script and return the note body as text."""
    reader = Path(script_dir) / "read_mac_notes.py"
    if not reader.exists():
        print(f"ERROR: Mac Notes reader not found at {reader}", file=sys.stderr)
        sys.exit(1)
    result = subprocess.run(
        ["/usr/bin/python3", str(reader)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"ERROR reading Mac Notes: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    data = json.loads(result.stdout)
    return data.get("body", "")

def read_stickies(script_dir):
    """Read Stickies notes from the macOS Stickies container directory.
    On macOS Catalina+, each note is stored as an .rtfd package containing TXT.rtf.
    Selects only the most recently modified note that contains BOTH a date AND
    at least one time range (HH:MM-->HH:MM). This prevents concatenating all notes
    and logging entries from old/reference notes.
    """
    import re as _re
    stickies_dir = Path.home() / "Library/Containers/com.apple.stickies/Data/Library/Stickies"
    if not stickies_dir.exists():
        stickies_dir = Path.home() / "Library/Containers/Stickies/Data/Library/Stickies"
    if not stickies_dir.exists():
        print(f"ERROR: Stickies directory not found at {stickies_dir}", file=sys.stderr)
        print("Make sure Stickies.app has been opened at least once.", file=sys.stderr)
        sys.exit(1)

    rtfd_packages = list(stickies_dir.glob("*.rtfd"))
    if not rtfd_packages:
        print("No Stickies notes found — make sure you have at least one note created.", file=sys.stderr)
        sys.exit(0)

    # Sort by modification time, most recent first
    rtfd_packages.sort(key=lambda p: p.stat().st_mtime, reverse=True)

    # Patterns for qualifying a note: must have a date AND a time range
    _date_re = _re.compile(
        r'\b(\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}(?:/\d{2,4})?'
        r'|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}'
        r'|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2})\b',
        _re.IGNORECASE
    )
    _time_range_re = _re.compile(r'\d{1,2}:\d{2}\s*(?:-->|->|–>|—>|-)\s*\d{1,2}:\d{2}')

    def strip_rtf(rtf_bytes):
        """Extract plain text from RTF content."""
        try:
            text = rtf_bytes.decode("utf-8", errors="replace")
        except Exception:
            text = rtf_bytes.decode("latin-1", errors="replace")
        text = _re.sub(r'\\\\[a-z]+\d*\s?', '', text)
        text = _re.sub(r'\{[^{}]*\}', '', text)
        text = _re.sub(r'\\[{}]', '', text)
        text = _re.sub(r'\\[a-z]+\d*\s?', ' ', text)
        text = _re.sub(r'\{|\}', '', text)
        text = _re.sub(r'[ \t]+', ' ', text)
        text = '\n'.join(line.strip() for line in text.splitlines() if line.strip())
        return text.strip()

    # Walk notes from most-recently-modified to oldest
    # Return the first note that has both a date and at least one time range
    fallback_text = None
    for pkg in rtfd_packages:
        rtf_file = pkg / "TXT.rtf"
        if not rtf_file.exists():
            continue
        try:
            plain = strip_rtf(rtf_file.read_bytes())
        except Exception as e:
            print(f"Warning: could not read {rtf_file}: {e}", file=sys.stderr)
            continue
        if not plain:
            continue
        has_date = bool(_date_re.search(plain))
        has_time_range = bool(_time_range_re.search(plain))
        if has_date and has_time_range:
            print(f"📌 Using Stickies note: {pkg.name} (most recent with date + time range)", file=sys.stderr)
            return plain
        # Keep the most-recent note as fallback in case none qualify
        if fallback_text is None:
            fallback_text = plain

    # No note had both a date and time range — use the most recently modified note
    if fallback_text:
        print("⚠️  No Stickies note found with both a date and time range — using most recently modified note.", file=sys.stderr)
        return fallback_text

    print("No readable text found in Stickies notes.", file=sys.stderr)
    sys.exit(0)

# ── Date extraction ──────────────────────────────────────────────────────────────

MONTH_NAMES = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'may': 5, 'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12,
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
    'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}

def extract_date_from_text(text):
    """
    Try to extract a date from the note body. Checks the first 5 non-empty lines
    for common date formats. Returns ISO date string (YYYY-MM-DD) or None.
    """
    lines = [l.strip() for l in text.split('\n') if l.strip()][:5]
    current_year = date.today().year

    for line in lines:
        # ISO: 2026-04-25
        m = re.search(r'\b(\d{4})-(\d{2})-(\d{2})\b', line)
        if m:
            return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

        # US numeric: 4/25/2026 or 4/25/26 or 4/25
        m = re.search(r'\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b', line)
        if m:
            month, day = int(m.group(1)), int(m.group(2))
            year = int(m.group(3)) if m.group(3) else current_year
            if year < 100:
                year += 2000
            if 1 <= month <= 12 and 1 <= day <= 31:
                return f"{year}-{month:02d}-{day:02d}"

        # Month name: April 25, 2026 or April 25 2026 or April 25
        m = re.search(
            r'\b(january|february|march|april|may|june|july|august|september|october|november|december'
            r'|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)'
            r'[.,]?\s+(\d{1,2})(?:[,.]?\s+(\d{4}))?\b',
            line, re.IGNORECASE
        )
        if m:
            month = MONTH_NAMES[m.group(1).lower()]
            day = int(m.group(2))
            year = int(m.group(3)) if m.group(3) else current_year
            if 1 <= day <= 31:
                return f"{year}-{month:02d}-{day:02d}"

        # Day-first: 25 April 2026 or 25 April
        m = re.search(
            r'\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december'
            r'|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)'
            r'(?:[,.]?\s+(\d{4}))?\b',
            line, re.IGNORECASE
        )
        if m:
            day = int(m.group(1))
            month = MONTH_NAMES[m.group(2).lower()]
            year = int(m.group(3)) if m.group(3) else current_year
            if 1 <= day <= 31:
                return f"{year}-{month:02d}-{day:02d}"

    return None

# ── Time entry parser ──────────────────────────────────────────────────────────

# Matches: 9:00-->10:30, 9:00->10:30, 9:00-10:30, 9:00–10:30
TIME_RANGE_RE = re.compile(
    r'(\d{1,2}):(\d{2})\s*(?:-->|->|–>|—>|-)\s*(\d{1,2}):(\d{2})'
)

# Matches: 1h 30m, 1h, 45m, 45min, 1hr
DURATION_RE = re.compile(
    r'(?:(\d+)\s*h(?:r|rs|our|ours)?)?\s*(?:(\d+)\s*m(?:in|ins|inutes?)?)?',
    re.IGNORECASE
)

# Jira key: 1+ letters, dash, digits (case-insensitive)
JIRA_KEY_RE = re.compile(r'\b([A-Za-z][A-Za-z0-9]+-\d+)\b')

def parse_time_range(line):
    """Return duration in minutes from a HH:MM-->HH:MM range, or None."""
    m = TIME_RANGE_RE.search(line)
    if not m:
        return None
    h1, m1, h2, m2 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
    start = h1 * 60 + m1
    end = h2 * 60 + m2
    if end <= start:
        end += 24 * 60  # overnight
    return end - start

def parse_duration(text):
    """Return duration in minutes from '1h 30m' style text, or None."""
    m = DURATION_RE.search(text)
    if not m or (not m.group(1) and not m.group(2)):
        return None
    hours = int(m.group(1) or 0)
    mins = int(m.group(2) or 0)
    total = hours * 60 + mins
    return total if total > 0 else None

def minutes_to_jira(minutes):
    """Convert minutes to Jira time format: '1h 30m', '45m', '2h'."""
    h = minutes // 60
    m = minutes % 60
    if h and m:
        return f"{h}h {m}m"
    elif h:
        return f"{h}h"
    else:
        return f"{m}m"

def is_standup_line(line):
    lower = line.lower()
    return bool(re.search(r'\bstandup\b|\bstand-up\b|\bstand up\b', lower))

def is_skip_line(line):
    return '???' in line

def extract_jira_keys(line):
    return [k.upper() for k in JIRA_KEY_RE.findall(line)]

def resolve_charge_code(line, charge_codes, context_keys):
    """
    Given a line with no Jira key, try to infer the best charge code.
    Returns (key, label) or (None, None).
    """
    lower = line.lower()
    # Code/diff review
    if re.search(r'\b(diff|code)\s*review\b', lower):
        cr = charge_codes.get("code_review", [])
        if cr:
            return cr[0]["key"], "code review"
    # RR / rapid response
    if re.search(r'\brr\b|\brapid.?response\b', lower):
        rr = charge_codes.get("rapid_response", [])
        if rr:
            return rr[0]["key"], "rapid response"
    return None, None

def determine_standup_key(charge_codes, time_by_key):
    """
    Pick the standup code for the team that received the most time today.
    Falls back to the first standup code in config.
    """
    standup_codes = charge_codes.get("standup", [])
    if not standup_codes:
        return "FCEH-750", "Standup"

    # Build a map of prefix -> standup key
    prefix_map = {}
    for entry in standup_codes:
        key = entry["key"].upper()
        prefix = key.split("-")[0]
        prefix_map[prefix] = key

    # Sum time by prefix
    prefix_time = {}
    for issue_key, mins in time_by_key.items():
        prefix = issue_key.split("-")[0]
        prefix_time[prefix] = prefix_time.get(prefix, 0) + mins

    # Find the standup prefix with the most time
    best_prefix = None
    best_time = 0
    for prefix, t in prefix_time.items():
        if prefix in prefix_map and t > best_time:
            best_time = t
            best_prefix = prefix

    if best_prefix:
        return prefix_map[best_prefix], f"Standup ({best_prefix})"

    # Default to first standup code
    return standup_codes[0]["key"], standup_codes[0].get("label", "Standup")

def split_into_blocks(text):
    """
    Split note text into blocks. A new block starts when a Jira key appears
    at the beginning of a line (possibly after whitespace). The header section
    (everything before the first '---' separator) is discarded.
    Returns a list of block strings.
    """
    # Strip header: everything up to and including the first '---' separator line
    # A separator is a line of 3+ dashes/hyphens/em-dashes
    sep_re = re.compile(r'^[-–—]{3,}\s*$')
    lines_all = text.split('\n')
    start_idx = 0
    for i, line in enumerate(lines_all):
        if sep_re.match(line.strip()):
            start_idx = i + 1
            break
    lines = lines_all[start_idx:]

    blocks = []
    current_block = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            # Blank line = block separator if current block is non-empty
            if current_block:
                blocks.append('\n'.join(current_block))
                current_block = []
            continue
        # A line that starts with a Jira key signals a new block
        if JIRA_KEY_RE.match(stripped) and current_block:
            blocks.append('\n'.join(current_block))
            current_block = []
        current_block.append(stripped)
    if current_block:
        blocks.append('\n'.join(current_block))
    return blocks


def parse_entries(text, charge_codes):
    """
    Parse time entries from note text using a block-based approach.
    Each block starts with a Jira key line, followed by description lines
    and one or more time range lines (e.g. 10:00-->11:30).
    Returns list of dicts: {key, minutes, comment, is_standup}
    """
    merged = {}   # key -> {minutes, comments, is_standup}

    blocks = split_into_blocks(text)

    for block in blocks:
        block_lines = [l.strip() for l in block.split('\n') if l.strip()]
        if not block_lines:
            continue

        # Skip blocks marked with ???
        if any(is_skip_line(l) for l in block_lines):
            continue

        # Collect all Jira keys from the block (first line takes priority)
        keys = []
        for line in block_lines:
            found = extract_jira_keys(line)
            if found:
                keys.extend(found)
        keys = list(dict.fromkeys(keys))  # deduplicate, preserve order

        # Detect standup block
        is_standup = any(is_standup_line(l) for l in block_lines)

        # Sum all time ranges in the block
        total_minutes = 0
        for line in block_lines:
            dur = parse_time_range(line)
            if dur and dur > 0:
                total_minutes += dur

        # If no time range found, try duration strings
        if total_minutes == 0:
            for line in block_lines:
                dur = parse_duration(line)
                if dur and dur > 0:
                    total_minutes += dur
                    break  # only use first explicit duration if no time range

        # Standup: always 30m regardless of time range
        if is_standup:
            merged["__standup__"] = {
                "minutes": 30,
                "comments": ["Hyperion Standup"],
                "is_standup": True
            }
            continue

        # Skip blocks with no time
        if total_minutes <= 0:
            continue

        # If no explicit keys, try to resolve from block content
        if not keys:
            for line in block_lines:
                resolved_key, resolved_label = resolve_charge_code(line, charge_codes, [])
                if resolved_key:
                    keys = [resolved_key]
                    break
        if not keys:
            continue  # can't identify issue — skip

        # Build comment from description lines (non-key, non-time-range lines)
        comment_lines = []
        for line in block_lines:
            if TIME_RANGE_RE.search(line):
                continue  # skip time range lines
            if is_skip_line(line):
                continue
            # Strip leading Jira keys from the line for cleaner comments
            cleaned = JIRA_KEY_RE.sub('', line).strip(' /-–—:')
            if cleaned and len(cleaned) > 2:
                comment_lines.append(cleaned)
        comment = '; '.join(comment_lines[:3]) if comment_lines else keys[0]

        for key in keys:
            key = key.upper()
            if key not in merged:
                merged[key] = {"minutes": 0, "comments": [], "is_standup": False}
            merged[key]["minutes"] += total_minutes
            if comment and comment not in merged[key]["comments"]:
                merged[key]["comments"].append(comment)

    # Resolve standup placeholder
    if "__standup__" in merged:
        standup_key, standup_label = determine_standup_key(charge_codes, {
            k: v["minutes"] for k, v in merged.items() if k != "__standup__"
        })
        merged[standup_key] = merged.pop("__standup__")
        merged[standup_key]["comments"] = ["Hyperion Standup"]

    entries = []
    for key, data in merged.items():
        entries.append({
            "key": key,
            "minutes": data["minutes"],
            "comment": "; ".join(data["comments"]) if data["comments"] else key,
            "is_standup": data.get("is_standup", False),
        })

    return entries

# ── Jira API ──────────────────────────────────────────────────────────────────

def get_existing_worklogs(jira_url, email, token, issue_key, log_date):
    """Return set of (timeSpentSeconds, started_date) tuples already logged for this issue on this date."""
    url = jira_url.rstrip("/") + f"/rest/api/3/issue/{issue_key}/worklog"
    auth = b64encode(f"{email}:{token}".encode()).decode()
    headers = {"Authorization": f"Basic {auth}", "Accept": "application/json"}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return set()
        data = resp.json()
        worklogs = data.get("worklogs", [])
        existing = set()
        for wl in worklogs:
            started = wl.get("started", "")
            if started.startswith(log_date):
                existing.add(wl.get("timeSpentSeconds", 0))
        return existing
    except Exception:
        return set()


def post_worklog(jira_url, email, token, issue_key, minutes, comment, started_date):
    """Post a worklog to Jira REST API v3."""
    url = jira_url.rstrip("/") + f"/rest/api/3/issue/{issue_key}/worklog"
    auth = b64encode(f"{email}:{token}".encode()).decode()
    headers = {
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    # Jira expects started in format: 2026-04-25T09:00:00.000+0000
    started = f"{started_date}T09:00:00.000+0000"
    payload = {
        "timeSpentSeconds": minutes * 60,
        "comment": {
            "type": "doc",
            "version": 1,
            "content": [{
                "type": "paragraph",
                "content": [{"type": "text", "text": comment}]
            }]
        },
        "started": started,
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=15)
    return resp

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Log time entries to Jira")
    parser.add_argument("--dry-run", action="store_true", help="Parse and print without posting to Jira")
    parser.add_argument("--date", default=None, help="Date to log for (YYYY-MM-DD). Defaults to today.")
    parser.add_argument("--source", default=None, help="Override source: mac-notes, stickies, google-sheets, google-docs")
    parser.add_argument("--preview-file", default=None, help="Parse a text file and output JSON (used by wizard preview)")
    args = parser.parse_args()

    # --preview-file mode: parse text from a file and output JSON, then exit
    if args.preview_file:
        try:
            text = Path(args.preview_file).read_text()
        except Exception as e:
            print(json.dumps({"entries": [], "date": None, "error": str(e)}))
            sys.exit(0)
        config = load_config()
        charge_codes = config.get("charge_codes", {})
        detected_date = extract_date_from_text(text)
        entries = parse_entries(text, charge_codes)
        output = {
            "date": detected_date,
            "entries": [
                {
                    "key": e["key"],
                    "time": minutes_to_jira(e["minutes"]),
                    "comment": e["comment"],
                }
                for e in entries
            ]
        }
        print(json.dumps(output))
        sys.exit(0)

    config = load_config()
    jira = config.get("jira", {})
    jira_url = jira.get("url", "").rstrip("/")
    email = jira.get("email", "")
    token = jira.get("token", "")
    charge_codes = config.get("charge_codes", {})
    sources = [args.source] if args.source else config.get("sources", ["mac-notes"])
    # Determine log date: CLI flag > parsed from note > today
    log_date = args.date  # may be None at this point

    if not jira_url or not email or not token:
        print("ERROR: Jira credentials missing from config.", file=sys.stderr)
        sys.exit(1)

    # Determine script directory (same dir as this script)
    script_dir = Path(__file__).parent

    # Read from the first configured source
    source = sources[0] if sources else "mac-notes"
    print(f"📖 Reading from source: {source}")

    if source == "mac-notes":
        text = read_mac_notes(script_dir)
    elif source == "stickies":
        text = read_stickies(script_dir)
    else:
        print(f"ERROR: Source '{source}' not yet supported for automated logging.", file=sys.stderr)
        sys.exit(1)

    if not text.strip():
        print("No time entries found in source.")
        sys.exit(0)

    # Resolve date: CLI flag > extracted from note > today
    if not log_date:
        log_date = extract_date_from_text(text)
        if log_date:
            print(f"📅 Date detected from note: {log_date}")
        else:
            log_date = date.today().isoformat()
            print(f"📅 No date found in note — defaulting to today: {log_date}")
    else:
        print(f"📅 Logging for date: {log_date} (from --date flag)")
    print()

    # Parse entries
    entries = parse_entries(text, charge_codes)

    if not entries:
        print("No parseable time entries found.")
        sys.exit(0)

    # Print summary
    print(f"{'Issue Key':<15} {'Time':<10} {'Comment'}")
    print("-" * 60)
    total_minutes = 0
    for e in entries:
        print(f"{e['key']:<15} {minutes_to_jira(e['minutes']):<10} {e['comment']}")
        total_minutes += e["minutes"]
    print("-" * 60)
    print(f"{'TOTAL':<15} {minutes_to_jira(total_minutes)}")
    print()

    if args.dry_run:
        print("🔍 Dry run — no entries posted to Jira.")
        return

    # Post to Jira (with deduplication check against existing Jira worklogs)
    print("⏫ Posting to Jira...")
    success_count = 0
    skip_count = 0
    for e in entries:
        # Check Jira for existing worklogs on this date for this issue
        existing_seconds = get_existing_worklogs(jira_url, email, token, e["key"], log_date)
        entry_seconds = e["minutes"] * 60
        if entry_seconds in existing_seconds:
            print(f"  ⏭  {e['key']} — {minutes_to_jira(e['minutes'])} already logged on {log_date}, skipping")
            skip_count += 1
            continue
        resp = post_worklog(jira_url, email, token, e["key"], e["minutes"], e["comment"], log_date)
        if resp.status_code in (200, 201):
            worklog_id = resp.json().get("id", "?")
            print(f"  ✓ {e['key']} — {minutes_to_jira(e['minutes'])} logged (worklog {worklog_id})")
            success_count += 1
        else:
            print(f"  ✗ {e['key']} — FAILED: {resp.status_code} {resp.text[:200]}")

    print()
    print(f"✅ Done — {success_count}/{len(entries)} entries logged, {skip_count} skipped (already logged).")

if __name__ == "__main__":
    main()

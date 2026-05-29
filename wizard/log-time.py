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
from datetime import datetime, date, timedelta
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

    def strip_rtf(rtf_file_path):
        """Extract plain text from an RTF/RTFD file using macOS textutil."""
        try:
            result = subprocess.run(
                ['/usr/bin/textutil', '-convert', 'txt', '-stdout', str(rtf_file_path)],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except Exception:
            pass
        # Fallback: naive regex strip if textutil fails
        try:
            raw = Path(rtf_file_path).read_bytes()
            text = raw.decode('utf-8', errors='replace')
        except Exception:
            return ''
        text = _re.sub(r'\\[a-z]+\d*\s?', ' ', text)
        text = _re.sub(r'[{}\\]', '', text)
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
            plain = strip_rtf(rtf_file)
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

# ── Day-section extractor ────────────────────────────────────────────────────

def extract_day_section(text, target_date):
    """
    Given a multi-day note (e.g. a Stickies note with multiple day sections),
    return only the portion that belongs to `target_date` (YYYY-MM-DD).

    A day section is delimited by:
      - A date header line (any format recognised by extract_date_from_text)
      - Optionally followed by a '---' separator

    Algorithm:
      1. Walk lines top-to-bottom.
      2. When a line is recognised as a date header, record which date it is.
      3. Collect lines until the next date header (or end of text).
      4. Return the collected lines for the section whose date == target_date.

    If no date headers are found at all (single-day note), the full text is
    returned unchanged so existing behaviour is preserved.
    """
    # Regex that matches a line that IS a date header (same patterns as
    # extract_date_from_text but tested against the whole line, not just
    # the first 5 lines).
    _date_header_re = re.compile(
        r'^(?:'
        # ISO: 2026-04-25
        r'\d{4}-\d{2}-\d{2}'
        r'|'
        # US numeric: 4/25/2026 or 4/25/26 or 4/25
        r'\d{1,2}/\d{1,2}(?:/\d{2,4})?'
        r'|'
        # "Monday, May 5, 2026" or "May 5, 2026" or "May 5 2026" etc.
        r'(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*[.,]?\s+)?'
        r'(?:january|february|march|april|may|june|july|august|september|october|november|december'
        r'|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]*[.,]?\s+\d{1,2}(?:[,.]?\s+\d{4})?'
        r'|'
        # Day-first: 25 April 2026
        r'\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december'
        r'|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:[,.]?\s+\d{4})?'
        r')\s*$',
        re.IGNORECASE
    )

    lines = text.split('\n')

    # Collect sections: list of (date_str_or_None, [lines])
    sections = []
    current_date = None
    current_lines = []

    for line in lines:
        stripped = line.strip()
        if _date_header_re.match(stripped):
            # Save previous section
            if current_lines or current_date is not None:
                sections.append((current_date, current_lines))
            # Start new section
            current_date = extract_date_from_text(stripped)
            current_lines = [line]  # include the header line itself
        else:
            current_lines.append(line)

    # Save last section
    if current_lines or current_date is not None:
        sections.append((current_date, current_lines))

    # If no date headers were found at all, return original text
    if all(s[0] is None for s in sections):
        return text

    # Find the section matching target_date
    for sec_date, sec_lines in sections:
        if sec_date == target_date:
            return '\n'.join(sec_lines)

    # target_date not found in any section — return empty string
    # (caller will handle "no entries" gracefully)
    return ''


def extract_all_day_sections(text):
    """Extract all date-sectioned blocks from a multi-day note.
    Returns list of (date_str, section_text) in document order.
    Falls back to [(detected_date, full_text)] for single-day notes.
    """
    _date_header_re = re.compile(
        r'^(?:'
        r'\d{4}-\d{2}-\d{2}'
        r'|'
        r'\d{1,2}/\d{1,2}(?:/\d{2,4})?'
        r'|'
        r'(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*[.,]?\s+)?'
        r'(?:january|february|march|april|may|june|july|august|september|october|november|december'
        r'|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]*[.,]?\s+\d{1,2}(?:[,.]?\s+\d{4})?'
        r'|'
        r'\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december'
        r'|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:[,.]?\s+\d{4})?'
        r')\s*$',
        re.IGNORECASE
    )

    lines = text.split('\n')
    sections = []
    current_date = None
    current_lines = []

    for line in lines:
        stripped = line.strip()
        if _date_header_re.match(stripped):
            if current_lines or current_date is not None:
                sections.append((current_date, current_lines))
            current_date = extract_date_from_text(stripped)
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines or current_date is not None:
        sections.append((current_date, current_lines))

    dated = [(d, '\n'.join(ls)) for d, ls in sections if d is not None]
    if not dated:
        detected = extract_date_from_text(text) or date.today().isoformat()
        return [(detected, text)]
    return dated


# ── Time entry parser ──────────────────────────────────────────────────────────

# Matches: 9:00-->10:30, 9:00->10:30, 9:00-10:30, 9:00–10:30
TIME_RANGE_RE = re.compile(
    r'(\d{1,2}):(\d{2})\s*(?:-->|->|–>|—>|-)\s*(\d{1,2}):(\d{2})'
)

# Matches open-ended ranges: 4:30--> or 4:30-> or 4:30– (no end time)
OPEN_ENDED_RE = re.compile(
    r'(\d{1,2}):(\d{2})\s*(?:-->|->|–>|—>|-+>?)\s*$'
)

# Matches: 1h 30m, 1h, 45m, 45min, 1hr
DURATION_RE = re.compile(
    r'(?:(\d+)\s*h(?:r|rs|our|ours)?)?\s*(?:(\d+)\s*m(?:in|ins|inutes?)?)?',
    re.IGNORECASE
)

# Jira key: 1+ letters, dash, digits (case-insensitive)
# Must NOT be preceded by '(' to avoid matching parenthetical notes like (parent-742)
JIRA_KEY_RE = re.compile(r'(?<!\()\b([A-Za-z][A-Za-z0-9]+-\d+)\b')

# Partial Jira key: project prefix + dash but no issue number (e.g., "mafg-")
PARTIAL_KEY_RE = re.compile(r'\b([A-Za-z][A-Za-z0-9]+)-(?!\d)', re.IGNORECASE)

def parse_time_range(line):
    """Return duration in minutes from a HH:MM-->HH:MM range, or None.
    
    Overnight wrap is only applied when the end hour is genuinely before the
    start hour AND the start hour is >= 20 (8pm+), which is the only realistic
    overnight work scenario. A range like 12:30-->1:00 is treated as 30 minutes
    (i.e. the end time is interpreted as 1:00pm context, not 1:00am).
    In practice: if end < start and start < 20, treat end as end+12 (pm) first;
    if still < start, then it's truly overnight.
    """
    m = TIME_RANGE_RE.search(line)
    if not m:
        return None
    h1, m1, h2, m2 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
    start = h1 * 60 + m1
    end = h2 * 60 + m2
    if end < start:
        # Try interpreting end as PM (add 12h) if it looks like a same-day range
        # e.g. 12:30-->1:00 should be 30 min (1:00pm), not 12.5h
        if h2 < 12 and h2 + 12 > h1:
            end += 12 * 60  # interpret as PM
        elif start >= 20 * 60:  # genuine overnight (start is 8pm+)
            end += 24 * 60
        else:
            # Ambiguous — treat as same-day, add 12h to end
            end += 12 * 60
    if end <= start:
        return None  # still invalid after adjustment
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
    Split note text into blocks separated by blank lines.
    The header section (everything before the first '---' separator) is discarded.
    
    Blocks are ONLY separated by blank lines — a block can contain any text
    including lines that start with Jira keys. This ensures that a 'lunch' block
    or any other non-Jira block that immediately follows a Jira block (with a
    blank line between them) is treated as a separate block.
    
    Returns a list of block strings.
    """
    # Strip header: everything up to and including the first '---' separator line
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
            # Blank line = block separator
            if current_block:
                blocks.append('\n'.join(current_block))
                current_block = []
            continue
        current_block.append(stripped)
    if current_block:
        blocks.append('\n'.join(current_block))
    return blocks


def parse_entries(text, charge_codes, parsing_rules=None):
    """
    Parse time entries from note text using a block-based approach.
    Each block produces ONE worklog entry — blocks with the same Jira key
    but different descriptions are kept as separate entries.

    parsing_rules (dict, optional) — from config["parsing_rules"]:
      skip_patterns: list of strings — skip any block whose text contains one of these (case-insensitive)
      keyword_mappings: list of {keyword, key, label} — map keyword to a Jira key
      open_ended_time_behavior: "fill_day" | "fixed_15m" (default: "fill_day")
      target_hours_per_day: float (default: 8.25)

    Returns list of dicts: {key, minutes, comment, is_standup}
    """
    if parsing_rules is None:
        parsing_rules = {}

    skip_patterns = [p.lower() for p in parsing_rules.get("skip_patterns", [])]
    keyword_mappings = parsing_rules.get("keyword_mappings", [])  # [{keyword, key, label}]
    open_ended_behavior = parsing_rules.get("open_ended_time_behavior", "fill_day")
    target_minutes = int(parsing_rules.get("target_hours_per_day", 8.25) * 60)  # default 495

    entries = []        # final list — one entry per block
    open_ended_entries = []  # blocks with open-ended time ranges (resolved after totalling)
    standup_entry = None
    time_by_key = {}    # used only to pick the right standup code at the end

    blocks = split_into_blocks(text)

    for block in blocks:
        block_lines = [l.strip() for l in block.split('\n') if l.strip()]
        if not block_lines:
            continue

        # Skip blocks marked with ???
        if any(is_skip_line(l) for l in block_lines):
            continue

        # Skip blocks matching user-configured skip patterns
        block_text_lower = '\n'.join(block_lines).lower()
        if any(pat in block_text_lower for pat in skip_patterns):
            continue

        # Collect Jira keys — ONLY from the first line of the block
        first_line_keys = extract_jira_keys(block_lines[0])
        keys = list(dict.fromkeys(first_line_keys))  # deduplicate, preserve order

        # Detect standup block
        is_standup = any(is_standup_line(l) for l in block_lines)

        # Check for open-ended time range (e.g. 4:30-->)
        has_open_ended = False
        open_ended_start_min = None
        for line in block_lines:
            oe = OPEN_ENDED_RE.search(line)
            # Only treat as open-ended if there is NO complete time range on the same line
            if oe and not TIME_RANGE_RE.search(line):
                has_open_ended = True
                open_ended_start_min = int(oe.group(1)) * 60 + int(oe.group(2))
                break

        # Sum all COMPLETE time ranges in the block
        total_minutes = 0
        for line in block_lines:
            dur = parse_time_range(line)
            if dur and dur > 0:
                total_minutes += dur

        # If no time range found, try duration strings
        if total_minutes == 0 and not has_open_ended:
            for line in block_lines:
                dur = parse_duration(line)
                if dur and dur > 0:
                    total_minutes += dur
                    break

        # Standup: deduplicated to one entry, always uses heuristic
        if is_standup:
            if standup_entry is None:
                standup_entry = {
                    "key": "__standup__",  # always resolved by heuristic at end
                    "minutes": total_minutes if total_minutes > 0 else 30,
                    "comment": "Hyperion Standup",
                    "is_standup": True,
                }
            continue

        # Skip blocks with no time (unless open-ended — those are deferred)
        if total_minutes <= 0 and not has_open_ended:
            continue

        # If no explicit keys on first line, try keyword_mappings then charge code inference
        if not keys:
            # User-configured keyword mappings (checked first)
            for km in keyword_mappings:
                if km.get("keyword", "").lower() in block_text_lower:
                    keys = [km["key"].upper()]
                    break
        if not keys:
            for line in block_lines:
                resolved_key, resolved_label = resolve_charge_code(line, charge_codes, [])
                if resolved_key:
                    keys = [resolved_key]
                    break
        if not keys:
            partial_m = PARTIAL_KEY_RE.search(block_lines[0])
            if partial_m:
                keys = [f"{partial_m.group(1).upper()}-?"]
            else:
                continue

        # Build comment from description lines (non-key, non-time-range lines)
        comment_lines = []
        for line in block_lines:
            if TIME_RANGE_RE.search(line):
                continue
            if OPEN_ENDED_RE.search(line) and not TIME_RANGE_RE.search(line):
                continue  # skip open-ended lines from comment
            if is_skip_line(line):
                continue
            cleaned = JIRA_KEY_RE.sub('', line).strip(' /-–—:')
            if cleaned and len(cleaned) > 2:
                comment_lines.append(cleaned)
        comment = '; '.join(comment_lines[:3]) if comment_lines else keys[0]

        primary_key = keys[0].upper()
        entry = {
            "key": primary_key,
            "minutes": total_minutes,
            "comment": comment,
            "is_standup": False,
            "_open_ended": has_open_ended,
            "_open_ended_start": open_ended_start_min,
        }

        if has_open_ended:
            open_ended_entries.append(entry)
        else:
            entries.append(entry)
            time_by_key[primary_key] = time_by_key.get(primary_key, 0) + total_minutes

    # ── Resolve open-ended entries ────────────────────────────────────────────
    # Calculate total known minutes (excluding open-ended blocks)
    known_total = sum(e["minutes"] for e in entries)
    if standup_entry:
        known_total += standup_entry["minutes"]

    for oe_entry in open_ended_entries:
        if open_ended_behavior == "fill_day" and known_total < target_minutes:
            remaining = target_minutes - known_total
            oe_entry["minutes"] = remaining
            oe_entry["comment"] += " [open-ended: filled to daily target]"
        else:
            oe_entry["minutes"] = 15  # fixed_15m fallback
            oe_entry["comment"] += " [open-ended: 15m]"
        known_total += oe_entry["minutes"]
        primary_key = oe_entry["key"]
        entries.append(oe_entry)
        time_by_key[primary_key] = time_by_key.get(primary_key, 0) + oe_entry["minutes"]

    # Clean up internal fields
    for e in entries:
        e.pop("_open_ended", None)
        e.pop("_open_ended_start", None)

    # ── Resolve standup key via heuristic (always) ────────────────────────────
    if standup_entry is not None:
        standup_key, standup_label = determine_standup_key(charge_codes, time_by_key)
        standup_entry["key"] = standup_key
        entries.insert(0, standup_entry)

    return entries

# ── Tempo Timesheet API ──────────────────────────────────────────────────────

def get_jira_account_id(jira_url, email, token):
    """Resolve the current user's Jira accountId via /rest/api/3/myself."""
    url = jira_url.rstrip("/") + "/rest/api/3/myself"
    auth = b64encode(f"{email}:{token}".encode()).decode()
    headers = {"Authorization": f"Basic {auth}", "Accept": "application/json"}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            return resp.json().get("accountId")
    except Exception:
        pass
    return None


def get_open_timesheet_dates(tempo_token, account_id, candidate_dates):
    """Query Tempo Timesheets API to find which dates are in OPEN timesheets.

    Returns the subset of candidate_dates (YYYY-MM-DD strings) whose
    containing timesheet period has status OPEN (i.e. not WAITING_FOR_APPROVAL
    or APPROVED).  If the Tempo API is unreachable or unconfigured, returns
    all candidate_dates so processing is not blocked.
    """
    if not tempo_token or not account_id or not candidate_dates:
        return list(candidate_dates)

    sorted_dates = sorted(candidate_dates)
    from_date = sorted_dates[0]
    to_date = sorted_dates[-1]

    url = f"https://api.tempo.io/4/timesheet-approvals/user/{account_id}"
    headers = {
        "Authorization": f"Bearer {tempo_token}",
        "Accept": "application/json",
    }
    params = {"from": from_date, "to": to_date}

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        if resp.status_code != 200:
            print(f"  ⚠️  Tempo API returned {resp.status_code} — skipping timesheet filter", file=sys.stderr)
            return list(candidate_dates)
    except Exception as e:
        print(f"  ⚠️  Tempo API unreachable ({e}) — skipping timesheet filter", file=sys.stderr)
        return list(candidate_dates)

    data = resp.json()
    periods = data.get("results", [])
    if not periods:
        # Single-period response (no results wrapper)
        periods = [data] if "status" in data else []

    # Build a set of dates that fall within OPEN periods
    open_dates = set()
    closed_periods = []
    for period in periods:
        status = period.get("status", {})
        status_key = status.get("key", "") if isinstance(status, dict) else str(status)
        period_from = period.get("from", "")
        period_to = period.get("to", "")
        if not period_from or not period_to:
            continue

        if status_key.upper() == "OPEN":
            for d in candidate_dates:
                if period_from <= d <= period_to:
                    open_dates.add(d)
        else:
            closed_periods.append((period_from, period_to, status_key))

    if closed_periods:
        for pf, pt, st in closed_periods:
            print(f"  🔒 Timesheet {pf} → {pt} is {st} — skipping those dates")

    # Dates not covered by any period are treated as open
    for d in candidate_dates:
        covered = any(pf <= d <= pt for pf, pt, _ in closed_periods)
        if not covered and d not in open_dates:
            open_dates.add(d)

    return sorted(open_dates)


# ── Jira API ──────────────────────────────────────────────────────────────────

def _extract_comment_text(comment_field):
    """Extract plain text from a Jira ADF comment field (or plain string)."""
    if isinstance(comment_field, str):
        return comment_field.strip()
    if isinstance(comment_field, dict):
        # Atlassian Document Format
        parts = []
        for block in comment_field.get("content", []):
            for inline in block.get("content", []):
                if inline.get("type") == "text":
                    parts.append(inline.get("text", ""))
        return "".join(parts).strip()
    return ""


def get_existing_worklogs(jira_url, email, token, issue_key, log_date):
    """Return set of (timeSpentSeconds, comment_text) tuples already logged for this issue on this date."""
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
                seconds = wl.get("timeSpentSeconds", 0)
                comment_text = _extract_comment_text(wl.get("comment", ""))
                existing.add((seconds, comment_text))
        return existing
    except Exception:
        return set()


def get_day_total_logged_minutes(jira_url, email, token, issue_keys, log_date):
    """Sum existing worklog minutes across all issue_keys for a given date."""
    total_seconds = 0
    seen = set()
    for key in issue_keys:
        if key in seen:
            continue
        seen.add(key)
        for seconds, _ in get_existing_worklogs(jira_url, email, token, key, log_date):
            total_seconds += seconds
    return total_seconds // 60


def resolve_partial_keys(entries, jira_url, email, token):
    """Resolve entries with partial keys (e.g., MAFG-?) by searching Jira."""
    auth = b64encode(f"{email}:{token}".encode()).decode()
    headers = {"Authorization": f"Basic {auth}", "Accept": "application/json"}
    search_url = jira_url.rstrip("/") + "/rest/api/3/search/jql"

    for entry in entries:
        if not entry["key"].endswith("-?"):
            continue
        project = entry["key"][:-2]
        search_text = entry.get("comment", "")
        words = [re.sub(r'[^a-zA-Z0-9]', '', w) for w in search_text.split()]
        words = [w for w in words if len(w) > 2]
        query_text = ' '.join(words[:8])

        matched = False
        if query_text:
            jql = f'project = "{project}" AND text ~ "{query_text}" ORDER BY updated DESC'
            try:
                resp = requests.get(search_url, headers=headers,
                                    params={"jql": jql, "maxResults": 1, "fields": "key,summary"},
                                    timeout=10)
                if resp.status_code == 200:
                    issues = resp.json().get("issues", [])
                    if issues:
                        entry["key"] = issues[0]["key"]
                        summary = issues[0]["fields"]["summary"]
                        print(f"  🔍 Resolved {project}-? → {entry['key']} ({summary})")
                        matched = True
            except Exception:
                pass

        if not matched:
            jql = f'project = "{project}" ORDER BY updated DESC'
            try:
                resp = requests.get(search_url, headers=headers,
                                    params={"jql": jql, "maxResults": 1, "fields": "key,summary"},
                                    timeout=10)
                if resp.status_code == 200:
                    issues = resp.json().get("issues", [])
                    if issues:
                        entry["key"] = issues[0]["key"]
                        summary = issues[0]["fields"]["summary"]
                        print(f"  🔍 Resolved {project}-? → {entry['key']} (fallback: {summary})")
                        matched = True
            except Exception:
                pass

        if not matched:
            print(f"  ⚠️  Could not resolve {project}-? — no matching issue found")

    return [e for e in entries if not e["key"].endswith("-?")]


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
    parser.add_argument("--since", type=int, default=None, help="Only process days within the last N days (default: all)")
    parser.add_argument("--preview-file", default=None, help="Parse a text file and output JSON (used by wizard preview)")
    args = parser.parse_args()

    # --preview-file mode: parse text from a file and output JSON, then exit
    if args.preview_file:
        try:
            text = Path(args.preview_file).read_text()
        except Exception as e:
            print(json.dumps({"entries": [], "date": None, "error": str(e)}))
            sys.exit(0)
        # Load config if available, but don't require it for preview
        try:
            config = load_config()
            charge_codes = config.get("charge_codes", {})
            parsing_rules = config.get("parsing_rules", {})
        except SystemExit:
            charge_codes = {}
            parsing_rules = {}
        detected_date = extract_date_from_text(text)
        # Scope to just the detected day's section (handles multi-day notes in preview)
        if detected_date:
            day_text = extract_day_section(text, detected_date)
            if day_text.strip():
                text = day_text
        entries = parse_entries(text, charge_codes, parsing_rules)
        output = {
            "date": detected_date,
            "entries": [
                {
                    "key": e["key"],
                    "time": minutes_to_jira(e["minutes"]),
                    "comment": e["comment"],
                    "minutes": e["minutes"],
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
    parsing_rules = config.get("parsing_rules", {})
    sources = [args.source] if args.source else config.get("sources", ["mac-notes"])
    if not jira_url or not email or not token:
        print("ERROR: Jira credentials missing from config.", file=sys.stderr)
        sys.exit(1)

    script_dir = Path(__file__).parent
    target_minutes = int(parsing_rules.get("target_hours_per_day", 8.25) * 60)

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

    # Determine which dates to process
    if args.date:
        day_sections = [(args.date, extract_day_section(text, args.date))]
        print(f"📅 Logging for date: {args.date} (from --date flag)")
    else:
        day_sections = extract_all_day_sections(text)
        if args.since is not None:
            cutoff = (date.today() - timedelta(days=args.since)).isoformat()
            day_sections = [(d, t) for d, t in day_sections if d >= cutoff]
        dates_found = [d for d, _ in day_sections]
        print(f"📅 Found {len(dates_found)} day(s) to process: {', '.join(dates_found)}")

    # ── Tempo timesheet filter ────────────────────────────────────────────────
    tempo_token = config.get("tempo", {}).get("token")
    if tempo_token and not args.dry_run:
        account_id = get_jira_account_id(jira_url, email, token)
        if account_id:
            candidate_dates = [d for d, _ in day_sections]
            open_dates = get_open_timesheet_dates(tempo_token, account_id, candidate_dates)
            skipped = set(candidate_dates) - set(open_dates)
            if skipped:
                print(f"⏭  Skipping {len(skipped)} day(s) with closed timesheets: {', '.join(sorted(skipped))}")
                day_sections = [(d, t) for d, t in day_sections if d in open_dates]
                if not day_sections:
                    print("No open timesheet days to process.")
                    sys.exit(0)
        else:
            print("  ⚠️  Could not resolve Jira account ID — skipping Tempo filter", file=sys.stderr)

    grand_success = 0
    grand_skip = 0
    grand_entries = 0
    days_processed = 0

    for log_date, day_text in day_sections:
        if not day_text.strip():
            continue

        print(f"\n{'='*60}")
        print(f"📅 {log_date}")
        print(f"{'='*60}")

        entries = parse_entries(day_text, charge_codes, parsing_rules)
        entries = resolve_partial_keys(entries, jira_url, email, token)
        if not entries:
            print("  No parseable entries, skipping.")
            continue

        # Skip days already filled to target hours
        if not args.dry_run:
            unique_keys = list(set(e["key"] for e in entries))
            existing_minutes = get_day_total_logged_minutes(
                jira_url, email, token, unique_keys, log_date
            )
            if existing_minutes >= target_minutes:
                print(f"  ⏭  Already has {minutes_to_jira(existing_minutes)} logged "
                      f"(>= {minutes_to_jira(target_minutes)} target), skipping day.")
                continue

        print(f"\n  {'Issue Key':<15} {'Time':<10} {'Comment'}")
        print(f"  {'-'*58}")
        total_minutes = 0
        for e in entries:
            print(f"  {e['key']:<15} {minutes_to_jira(e['minutes']):<10} {e['comment']}")
            total_minutes += e["minutes"]
        print(f"  {'-'*58}")
        print(f"  {'TOTAL':<15} {minutes_to_jira(total_minutes)}")

        if args.dry_run:
            print(f"  🔍 Dry run — not posted.")
            grand_entries += len(entries)
            days_processed += 1
            continue

        print(f"\n  ⏫ Posting to Jira...")
        success_count = 0
        skip_count = 0
        for e in entries:
            existing_worklogs = get_existing_worklogs(jira_url, email, token, e["key"], log_date)
            entry_seconds = e["minutes"] * 60
            entry_comment = e["comment"].strip()
            if (entry_seconds, entry_comment) in existing_worklogs:
                print(f"    ⏭  {e['key']} — {minutes_to_jira(e['minutes'])} already logged, skipping")
                skip_count += 1
                continue
            resp = post_worklog(jira_url, email, token, e["key"], e["minutes"], e["comment"], log_date)
            if resp.status_code in (200, 201):
                worklog_id = resp.json().get("id", "?")
                print(f"    ✓ {e['key']} — {minutes_to_jira(e['minutes'])} logged (worklog {worklog_id})")
                success_count += 1
            else:
                print(f"    ✗ {e['key']} — FAILED: {resp.status_code} {resp.text[:200]}")
        grand_success += success_count
        grand_skip += skip_count
        grand_entries += len(entries)
        days_processed += 1

    print(f"\n{'='*60}")
    if args.dry_run:
        print(f"🔍 Dry run complete — {grand_entries} entries across {days_processed} day(s).")
    else:
        print(f"✅ Done — {grand_success}/{grand_entries} entries logged, "
              f"{grand_skip} skipped, {days_processed} day(s) processed.")

if __name__ == "__main__":
    main()

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

def _is_day_rule(line):
    """A long horizontal rule (10+ dash/en-dash/em-dash chars) used to separate
    day sections. The short '---' / '--' / '–––' separators inside a single day's
    template are intentionally NOT treated as day boundaries."""
    return bool(re.match(r'^\s*[-–—]{10,}\s*$', line))


# Matches a line that IS a date header (the whole line is just a date). Kept
# conservative on purpose so a content line that merely mentions a date is not
# mistaken for a day boundary.
_DATE_HEADER_RE = re.compile(
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


def _split_into_day_sections(text):
    """Split note text into day sections: list of (date_or_None, [lines]).

    A new day section starts at EITHER a long horizontal rule OR a date-header
    line. Using BOTH delimiters means a day is still isolated correctly even if
    one delimiter is missing or malformed in the note — this is the safeguard
    that prevents one day's entries from bleeding into another day's run.
    """
    lines = text.split('\n')
    sections = []
    current_date = None
    current_lines = []

    def flush():
        nonlocal current_date, current_lines
        if current_lines or current_date is not None:
            sections.append((current_date, current_lines))
        current_date = None
        current_lines = []

    for line in lines:
        stripped = line.strip()

        # Long horizontal rule = unambiguous day boundary. Drop the rule itself.
        if _is_day_rule(line):
            flush()
            continue

        # Date-header line. Start a new section only when the current section is
        # already dated (i.e. we're inside a day); a header that simply follows a
        # rule line lands in the fresh section and just labels it with its date.
        if _DATE_HEADER_RE.match(stripped):
            if current_date is not None:
                flush()
            current_date = extract_date_from_text(stripped) or current_date
            current_lines.append(line)
            continue

        current_lines.append(line)

    flush()
    return sections


def extract_day_section(text, target_date):
    """
    Given a multi-day note (e.g. a Stickies note with multiple day sections),
    return only the portion that belongs to `target_date` (YYYY-MM-DD).

    Day sections are delimited by long horizontal rules and/or date-header lines
    (see _split_into_day_sections). Only the matching day's lines are returned,
    so entries from adjacent days can never leak into the wrong day's run.

    If no dated sections are found at all (single-day note), the full text is
    returned unchanged so existing behaviour is preserved.
    """
    sections = _split_into_day_sections(text)

    # No dated sections at all → single-day note; preserve original behaviour.
    if all(sec_date is None for sec_date, _ in sections):
        return text

    matching = [sec_lines for sec_date, sec_lines in sections if sec_date == target_date]
    if not matching:
        # target_date not found — caller handles "no entries" gracefully.
        return ''
    if len(matching) > 1:
        print(
            f"⚠️  Found {len(matching)} sections for {target_date} in the note — "
            f"using the first and ignoring the rest.",
            file=sys.stderr,
        )
    return '\n'.join(matching[0])


# ── Time entry parser ──────────────────────────────────────────────────────────

# Matches: 9:00-->10:30, 9:00->10:30, 9:00-10:30, 9:00–10:30
TIME_RANGE_RE = re.compile(
    r'(\d{1,2}):(\d{2})\s*(?:-->|->|–>|—>|-)\s*(\d{1,2}):(\d{2})'
)

# Matches open-ended ranges with no end time: 4:30-->, 4:30->, and tolerant of
# trailing placeholders like "4:30-->??" or "4:30--> ?" (trailing ?'s meaning
# "still going"). A complete range on the same line is excluded by the caller
# via TIME_RANGE_RE, so loosening the tail here is safe.
OPEN_ENDED_RE = re.compile(
    r'(\d{1,2}):(\d{2})\s*(?:-->|->|–>|—>|-+>?)\s*\?*\s*$'
)


# Phrases that mean "log the remainder of the day's target hours against this
# block" (e.g. "all the rest"). Configurable via parsing_rules.fill_phrases.
DEFAULT_FILL_PHRASES = [
    "all the rest", "the rest", "rest of the day", "rest of day",
    "remainder", "remaining time", "fill the rest", "fill day",
]

def _normalize_phrase(s):
    s = re.sub(r'[^a-z ]', ' ', (s or "").lower())
    return re.sub(r'\s+', ' ', s).strip()

def is_fill_phrase(line, phrases):
    """True if the whole line (ignoring bullets/punctuation) is a fill phrase."""
    return _normalize_phrase(line) in phrases

# Matches: 1h 30m, 1h, 45m, 45min, 1hr
DURATION_RE = re.compile(
    r'(?:(\d+)\s*h(?:r|rs|our|ours)?)?\s*(?:(\d+)\s*m(?:in|ins|inutes?)?)?',
    re.IGNORECASE
)

# Jira key: 1+ letters, dash, digits (case-insensitive)
# Must NOT be preceded by '(' to avoid matching parenthetical notes like (parent-742)
JIRA_KEY_RE = re.compile(r'(?<!\()\b([A-Za-z][A-Za-z0-9]+-\d+)\b')

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

def _normalize_comment(comment):
    """Normalize a comment for in-run duplicate detection: lowercase, replace
    punctuation/symbols with spaces, and collapse whitespace."""
    s = (comment or "").lower()
    s = re.sub(r'[^\w\s]', ' ', s)
    s = re.sub(r'\s+', ' ', s)
    return s.strip()

def dedup_entries_in_run(entries):
    """Collapse duplicate blocks within a single run, keyed by
    (issue key, normalized comment). The first occurrence is kept; later
    duplicates are dropped (not summed — they represent the same work captured
    twice). Returns (kept_entries, dropped_entries)."""
    kept, dropped, seen = [], [], set()
    for e in entries:
        sig = (e["key"], _normalize_comment(e["comment"]))
        if sig in seen:
            dropped.append(e)
            continue
        seen.add(sig)
        kept.append(e)
    return kept, dropped

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
    fill_phrases = {_normalize_phrase(p) for p in parsing_rules.get("fill_phrases", DEFAULT_FILL_PHRASES)}

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

        # A fill phrase ("all the rest", …) is also an open-ended marker: keep the
        # block's explicit ranges and top the day up to target onto this block.
        if any(is_fill_phrase(l, fill_phrases) for l in block_lines):
            has_open_ended = True

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
            continue  # can't identify issue — skip

        # Build comment from description lines (non-key, non-time-range lines)
        comment_lines = []
        for line in block_lines:
            if TIME_RANGE_RE.search(line):
                continue
            if OPEN_ENDED_RE.search(line) and not TIME_RANGE_RE.search(line):
                continue  # skip open-ended lines from comment
            if is_fill_phrase(line, fill_phrases):
                continue  # skip fill-phrase lines ("all the rest") from comment
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
            "_explicit_minutes": total_minutes,
        }

        if has_open_ended:
            open_ended_entries.append(entry)
        else:
            entries.append(entry)
            time_by_key[primary_key] = time_by_key.get(primary_key, 0) + total_minutes

    # ── Resolve open-ended / fill entries ─────────────────────────────────────
    # Known minutes = all explicit time logged that day, INCLUDING the complete
    # ranges that appear inside open-ended/fill blocks. Those blocks keep their
    # real ranges and only receive the day's *remainder* on top (so a block with
    # "7:30-->9:00 / 9:00-->10:00 / all the rest" logs 2.5h + remainder = target).
    known_total = sum(e["minutes"] for e in entries)
    if standup_entry:
        known_total += standup_entry["minutes"]
    known_total += sum(e["_explicit_minutes"] for e in open_ended_entries)

    for oe_entry in open_ended_entries:
        explicit = oe_entry["_explicit_minutes"]
        if open_ended_behavior == "fill_day" and known_total < target_minutes:
            remaining = target_minutes - known_total
            oe_entry["minutes"] = explicit + remaining
            tag = "filled to daily target" if explicit else "open-ended: filled to daily target"
            oe_entry["comment"] += f" [{tag}]"
            known_total += remaining  # explicit minutes were already counted above
        elif explicit > 0:
            oe_entry["minutes"] = explicit  # real ranges stand; nothing left to fill
        else:
            oe_entry["minutes"] = 15  # fixed_15m fallback for a pure marker
            oe_entry["comment"] += " [open-ended: 15m]"
            known_total += 15
        primary_key = oe_entry["key"]
        entries.append(oe_entry)
        time_by_key[primary_key] = time_by_key.get(primary_key, 0) + oe_entry["minutes"]

    # Clean up internal fields
    for e in entries:
        e.pop("_open_ended", None)
        e.pop("_open_ended_start", None)
        e.pop("_explicit_minutes", None)

    # ── Resolve standup key via heuristic (always) ────────────────────────────
    if standup_entry is not None:
        standup_key, standup_label = determine_standup_key(charge_codes, time_by_key)
        standup_entry["key"] = standup_key
        entries.insert(0, standup_entry)

    return entries

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
        entries, _dropped = dedup_entries_in_run(entries)
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

    # Extract only the section for the target date (handles multi-day notes)
    day_text = extract_day_section(text, log_date)
    if not day_text.strip():
        print(f"No entries found for {log_date} in the note (no matching day section).")
        sys.exit(0)
    if day_text is not text:
        print(f"📋 Multi-day note detected — using only the section for {log_date}")
    print()

    # Parse entries
    entries = parse_entries(day_text, charge_codes, parsing_rules)

    if not entries:
        print("No parseable time entries found.")
        sys.exit(0)

    # De-dup duplicate blocks within this run (same issue key + normalized comment)
    entries, dropped = dedup_entries_in_run(entries)
    for d in dropped:
        print(f"⚠️  Duplicate block skipped: {d['key']} {minutes_to_jira(d['minutes'])} — "
              f"\"{d['comment'][:60]}\" (same issue + comment already in this run)")
    if dropped:
        print()

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

    # Post to Jira (with deduplication checks against existing Jira worklogs).
    print("⏫ Posting to Jira...")

    # Snapshot existing worklogs per issue for this date BEFORE posting (once).
    # Drives two checks below: the exact-match skip and the issue+date warning.
    existing_by_key = {}
    for k in dict.fromkeys(e["key"] for e in entries):
        existing_by_key[k] = get_existing_worklogs(jira_url, email, token, k, log_date)

    success_count = 0
    skip_count = 0
    for e in entries:
        existing_worklogs = existing_by_key.get(e["key"], set())
        entry_seconds = e["minutes"] * 60
        entry_comment = e["comment"].strip()
        # Skip ONLY if BOTH duration AND comment text are an exact match.
        if (entry_seconds, entry_comment) in existing_worklogs:
            print(f"  ⏭  {e['key']} — {minutes_to_jira(e['minutes'])} already logged on {log_date} (exact match), skipping")
            skip_count += 1
            continue
        # Issue+date guard: the issue already has other worklog(s) that day with a
        # different time/comment. Warn (but still post) so genuine entries aren't
        # dropped while possible duplicates (e.g. cross-day bleed) are surfaced.
        if existing_worklogs:
            print(f"  ⚠️  {e['key']} — already has {len(existing_worklogs)} worklog(s) on {log_date} "
                  f"with a different time/comment; posting anyway — review for duplicates")
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

#!/usr/bin/env python3
"""
Unit tests for log_from_gdrive.py parsing logic.
Tests time parsing, label resolution, sheet row parsing, doc text parsing, and merge rules.
"""
import sys
import os
from datetime import date

# Add script directory to path
sys.path.insert(0, os.path.dirname(__file__))

from log_from_gdrive import (
    parse_time_range, parse_duration, minutes_to_jira,
    resolve_label, parse_date, parse_sheet_rows, parse_doc_text, apply_rules,
    STANDUP_CODES, STANDUP_COMMENT
)

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
errors = []

def check(name, got, expected):
    if got == expected:
        print(f"  {PASS}  {name}")
    else:
        print(f"  {FAIL}  {name}")
        print(f"         got:      {got!r}")
        print(f"         expected: {expected!r}")
        errors.append(name)


# ──────────────────────────────────────────────
print("\n=== Time Range Parsing ===")
check("9:15-->10:00",      parse_time_range("9:15-->10:00"),   45)
check("1:00-->5:30",       parse_time_range("1:00-->5:30"),    270)
check("11:45-->12:00",     parse_time_range("11:45-->12:00"),  15)
check("10:30-->11:00",     parse_time_range("10:30-->11:00"),  30)
check("9:00-->17:00",      parse_time_range("9:00-->17:00"),   480)
check("No range",          parse_time_range("1h 30m"),         None)
check("Arrow variant –>",  parse_time_range("9:15–>10:00"),    45)

# ──────────────────────────────────────────────
print("\n=== Duration Parsing ===")
check("1h 30m",   parse_duration("1h 30m"),  90)
check("45m",      parse_duration("45m"),     45)
check("2h",       parse_duration("2h"),      120)
check("30m",      parse_duration("30m"),     30)
check("empty",    parse_duration(""),        None)
check("???",      parse_duration("???"),     None)

# ──────────────────────────────────────────────
print("\n=== Minutes to Jira Format ===")
check("90 min",  minutes_to_jira(90),  "1h 30m")
check("45 min",  minutes_to_jira(45),  "45m")
check("120 min", minutes_to_jira(120), "2h")
check("30 min",  minutes_to_jira(30),  "30m")
check("480 min", minutes_to_jira(480), "8h")

# ──────────────────────────────────────────────
print("\n=== Label Resolution ===")
check("Direct Jira key FCEH-109",  resolve_label("FCEH-109"),       ("FCEH-109",  False))
check("Direct Jira key FBAI-875",  resolve_label("FBAI-875"),       ("FBAI-875",  False))
check("Standup FBAI-1683",         resolve_label("FBAI-1683"),      ("FBAI-1683", True))
check("Standup FCEH-750",          resolve_label("FCEH-750"),       ("FCEH-750",  True))
check("Label 'standup'",           resolve_label("standup"),        ("FBAI-1683", True))
check("Label 'ai'",                resolve_label("ai"),             ("FBAI-875",  False))
check("Label 'fceh'",              resolve_label("fceh"),           ("FCEH-109",  False))
check("Label 'rr fceh'",           resolve_label("rr fceh"),        ("FCEH-109",  False))
check("Label 'cr ai'",             resolve_label("cr ai"),          ("FBAI-1667", False))
check("Label 'diff review afg'",   resolve_label("diff review afg"),("MAFG-3",    False))
check("Unknown label",             resolve_label("unknown-thing"),  (None,        False))

# ──────────────────────────────────────────────
print("\n=== Date Parsing ===")
check("ISO date",      parse_date("2026-05-01"), date(2026, 5, 1))
check("Long date",     parse_date("May 1, 2026"), date(2026, 5, 1))
check("Short month",   parse_date("Apr 20, 2026"), date(2026, 4, 20))
check("Slash date",    parse_date("5/1/2026"),    date(2026, 5, 1))
check("Invalid",       parse_date("not a date"),  None)

# ──────────────────────────────────────────────
print("\n=== Sheet Row Parsing ===")
target = date(2026, 5, 1)

rows_basic = [
    ["Date", "Issue", "Time", "Comment"],  # header
    ["2026-05-01", "FCEH-109",  "1h 30m",       "Bug fix"],
    ["2026-05-01", "FBAI-875",  "9:15-->10:00",  "Code review"],
    ["2026-05-01", "FBAI-875",  "10:30-->11:00", "More review"],
    ["2026-05-01", "standup",   "30m",           ""],
    ["2026-05-01", "FCEH-109",  "???",           "skipped"],
    ["2026-04-30", "FCEH-109",  "1h",            "different day"],
]
entries = parse_sheet_rows(rows_basic, target)
check("Sheet: 4 entries (excl header, ???, wrong date)", len(entries), 4)
check("Sheet: FCEH-109 present",  any(e["issue_key"] == "FCEH-109" for e in entries), True)
check("Sheet: FBAI-875 x2",       sum(1 for e in entries if e["issue_key"] == "FBAI-875"), 2)
check("Sheet: standup present",   any(e["is_standup"] for e in entries), True)
check("Sheet: wrong date excluded", all(e["date"] == target for e in entries), True)

# ──────────────────────────────────────────────
print("\n=== Doc Text Parsing ===")
doc_text = """
2026-05-01

9:15-->10:00 | FBAI-875 | Code review
10:30-->11:00 | FBAI-875 | More review
1h 30m | FCEH-109 | Bug fix
standup | FBAI-1683 | Hyperion Standup
??? | FCEH-109 | skipped

2026-04-30
1h | FCEH-109 | different day
"""
doc_entries = parse_doc_text(doc_text, target)
check("Doc: 4 entries (excl ???, wrong date)", len(doc_entries), 4)
check("Doc: FBAI-875 x2",  sum(1 for e in doc_entries if e["issue_key"] == "FBAI-875"), 2)
check("Doc: FCEH-109 x1",  sum(1 for e in doc_entries if e["issue_key"] == "FCEH-109"), 1)
check("Doc: standup x1",   sum(1 for e in doc_entries if e["is_standup"]), 1)

# ──────────────────────────────────────────────
print("\n=== Merge Rules ===")
raw = [
    {"issue_key": "FBAI-875",  "minutes": 45,  "comment": "Code review",  "date": target, "is_standup": False},
    {"issue_key": "FBAI-875",  "minutes": 30,  "comment": "More review",  "date": target, "is_standup": False},
    {"issue_key": "FCEH-109",  "minutes": 90,  "comment": "Bug fix",      "date": target, "is_standup": False},
    {"issue_key": "FBAI-1683", "minutes": 30,  "comment": "Standup",      "date": target, "is_standup": True},
]
merged = apply_rules(raw)

# FBAI-875 should be merged to 1h 15m
fbai875 = [e for e in merged if e["issue_key"] == "FBAI-875"]
check("Merge: FBAI-875 merged to 1 entry",    len(fbai875), 1)
check("Merge: FBAI-875 = 1h 15m",             fbai875[0]["time_spent"], "1h 15m")

# FCEH-109 unchanged
fceh109 = [e for e in merged if e["issue_key"] == "FCEH-109"]
check("Merge: FCEH-109 = 1h 30m",             fceh109[0]["time_spent"], "1h 30m")

# Standup: exactly one, 30m, correct comment
standups = [e for e in merged if e["issue_key"] in STANDUP_CODES]
check("Merge: exactly 1 standup",             len(standups), 1)
check("Merge: standup = 30m",                 standups[0]["time_spent"], "30m")
check("Merge: standup comment",               standups[0]["comment"], STANDUP_COMMENT)

# Most-time rule: FBAI has 75m, FCEH has 90m → standup should be FCEH-750
check("Merge: standup code = FCEH-750 (most time)", standups[0]["issue_key"], "FCEH-750")

# ──────────────────────────────────────────────
print("\n=== Auto-Standup Injection ===")
# Entries with no explicit standup — should auto-inject
raw_no_standup = [
    {"issue_key": "FCEH-109", "minutes": 90, "comment": "Work", "date": target, "is_standup": False},
    {"issue_key": "FCEH-751", "minutes": 60, "comment": "CR",   "date": target, "is_standup": False},
]
merged2 = apply_rules(raw_no_standup)
standups2 = [e for e in merged2 if e["issue_key"] in STANDUP_CODES]
check("Auto-standup: 1 standup injected",    len(standups2), 1)
check("Auto-standup: code = FCEH-750",       standups2[0]["issue_key"], "FCEH-750")
check("Auto-standup: 30m",                   standups2[0]["time_spent"], "30m")

# ──────────────────────────────────────────────
print()
if errors:
    print(f"\033[91m{len(errors)} test(s) FAILED:\033[0m")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
else:
    print(f"\033[92mAll tests passed!\033[0m")

"""
add_worklog.py - Log a time entry to a Jira issue via the mcp-atlassian SSE server.

Usage (via environment variables):
  ISSUE_KEY="FCEH-109" TIME_SPENT="5h" COMMENT="optional comment" python add_worklog.py
  ISSUE_KEY="FCEH-109" TIME_SPENT="5h" COMMENT="..." STARTED="2026-04-20T09:00:00.000+0000" python add_worklog.py

Environment Variables:
  ISSUE_KEY   (required) Jira issue key, e.g. FCEH-109
  TIME_SPENT  (required) Jira time format: 1h, 30m, 1h 30m, 2d
  COMMENT     (optional) Worklog comment text
  STARTED     (optional) ISO 8601 datetime string; defaults to now (UTC)
  MCP_URL     (optional) Base URL of the mcp-atlassian SSE server; defaults to http://localhost:9000
"""
import os
import json
import time
import threading
import sys
from datetime import datetime, timezone

import requests

BASE_URL = os.environ.get("MCP_URL", "http://localhost:9000")
ISSUE_KEY = os.environ.get("ISSUE_KEY", "")
TIME_SPENT = os.environ.get("TIME_SPENT", "")
COMMENT = os.environ.get("COMMENT", "")
STARTED = os.environ.get("STARTED", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000+0000"))

if not ISSUE_KEY or not TIME_SPENT:
    print("ERROR: ISSUE_KEY and TIME_SPENT environment variables are required.")
    sys.exit(1)

responses = []
session_id = None
sse_ready = threading.Event()


def listen_sse():
    global session_id
    try:
        r = requests.get(f"{BASE_URL}/sse", stream=True, timeout=120)
        for chunk in r.iter_content(chunk_size=None):
            text = chunk.decode("utf-8", errors="replace")
            for line in text.strip().split("\n"):
                if line.startswith("data:"):
                    data = line[5:].strip()
                    if "session_id=" in data:
                        session_id = data.split("session_id=")[1].strip()
                        sse_ready.set()
                    else:
                        try:
                            parsed = json.loads(data)
                            responses.append(parsed)
                        except Exception:
                            pass
    except Exception as e:
        print(f"SSE listener error: {e}")
        sse_ready.set()


t = threading.Thread(target=listen_sse, daemon=True)
t.start()
sse_ready.wait(timeout=10)

if not session_id:
    print("ERROR: Could not connect to mcp-atlassian server at", BASE_URL)
    print("Make sure the server is running: bash /home/ubuntu/start-mcp-atlassian.sh")
    sys.exit(1)


def rpc(method, params=None, msg_id=1):
    payload = {"jsonrpc": "2.0", "id": msg_id, "method": method}
    if params:
        payload["params"] = params
    return requests.post(
        f"{BASE_URL}/messages/?session_id={session_id}",
        json=payload,
        timeout=10
    )


# Initialize MCP session
rpc("initialize", {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "jira-time-tracker-skill", "version": "1.0"}
}, msg_id=1)
time.sleep(0.5)

# Build arguments
args = {
    "issue_key": ISSUE_KEY,
    "time_spent": TIME_SPENT,
    "started": STARTED,
}
if COMMENT:
    args["comment"] = COMMENT

# Call jira_add_worklog
rpc("tools/call", {
    "name": "jira_add_worklog",
    "arguments": args
}, msg_id=2)

# Wait for response
time.sleep(8)

for r in responses:
    if r.get("id") == 2:
        error = r.get("error")
        if error:
            print(f"ERROR: {json.dumps(error, indent=2)}")
            sys.exit(1)
        content = r.get("result", {}).get("content", [])
        for c in content:
            print(c.get("text", ""))
        sys.exit(0)

print("ERROR: No response received from server.")
sys.exit(1)

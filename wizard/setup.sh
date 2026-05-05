#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Jira Time Tracker — Setup Wizard
# Starts a local Node.js server and opens the setup wizard in your browser.
# No admin rights required. No code signing. Works on any macOS 12+.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

WIZARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=7429
URL="http://localhost:${PORT}"

# ── Colors ───────────────────────────────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

info()    { echo -e "${CYAN}▶${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "${RED}✗${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}$*${RESET}"; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  ┌─────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}  │   Jira Time Tracker — Setup Wizard      │${RESET}"
echo -e "${BOLD}  └─────────────────────────────────────────┘${RESET}"
echo ""
echo -e "  ${CYAN}Sources supported:${RESET}  macOS Stickies · Mac Notes · Google Sheets · Google Docs"
echo -e "  ${CYAN}Charge codes:${RESET}       RR · Standup · Code Review (project defaults)"
echo -e "  ${CYAN}Custom rules:${RESET}       Paste your own keyword → Jira key mappings (optional)"
echo ""

# ── Check macOS ───────────────────────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
  error "This wizard is for macOS only."
  exit 1
fi

# ── Confirm working directory ─────────────────────────────────────────────────
if [[ ! -f "${WIZARD_DIR}/server/index.js" ]]; then
  error "Could not find wizard files in: ${WIZARD_DIR}"
  error "Make sure you are running setup.sh from inside the jira-time-wizard folder."
  error "Example: cd ~/JiraTimeTracker && ./setup.sh"
  exit 1
fi

info "Running from: ${WIZARD_DIR}"

# ── Check for Node.js ─────────────────────────────────────────────────────────
header "Checking prerequisites..."

NODE_CMD=""
if command -v node &>/dev/null; then
  NODE_CMD="node"
  NODE_VER=$(node --version)
  success "Node.js found: ${NODE_VER}"
else
  # Try common locations
  for candidate in /usr/local/bin/node /opt/homebrew/bin/node ~/.nvm/versions/node/*/bin/node; do
    if [[ -x "$candidate" ]]; then
      NODE_CMD="$candidate"
      NODE_VER=$("$NODE_CMD" --version)
      success "Node.js found at ${candidate}: ${NODE_VER}"
      break
    fi
  done
fi

if [[ -z "$NODE_CMD" ]]; then
  warn "Node.js not found. Attempting to install via Homebrew..."
  if command -v brew &>/dev/null; then
    brew install node
    NODE_CMD="node"
    success "Node.js installed via Homebrew"
  else
    error "Node.js is required but could not be installed automatically."
    error "Please install Node.js from https://nodejs.org and re-run this script."
    exit 1
  fi
fi

# ── Install server dependencies if needed ─────────────────────────────────────
if [[ ! -d "${WIZARD_DIR}/node_modules" ]]; then
  info "Installing server dependencies..."
  cd "${WIZARD_DIR}"
  # Locate npm alongside the node binary, or fall back to PATH
  NPM_CMD=""
  NODE_BIN_DIR="$(dirname "$(command -v "$NODE_CMD" 2>/dev/null || echo "$NODE_CMD")")"
  if [[ -x "${NODE_BIN_DIR}/npm" ]]; then
    NPM_CMD="${NODE_BIN_DIR}/npm"
  elif command -v npm &>/dev/null; then
    NPM_CMD="npm"
  elif command -v pnpm &>/dev/null; then
    NPM_CMD="pnpm"
  else
    error "npm not found. Please install Node.js from https://nodejs.org and re-run."
    exit 1
  fi
  "$NPM_CMD" install --silent 2>&1 || { error "npm install failed. Check your Node.js installation."; exit 1; }
  success "Dependencies installed"
fi

# ── Build client if dist is missing ───────────────────────────────────────────
if [[ ! -d "${WIZARD_DIR}/client/dist" ]]; then
  info "Building wizard UI..."
  cd "${WIZARD_DIR}/client"
  if command -v pnpm &>/dev/null; then
    pnpm install --silent && pnpm build 2>&1
  else
    npm install --silent && npm run build 2>&1
  fi
  success "UI built"
  cd "${WIZARD_DIR}"
fi

# ── Check if port is already in use ───────────────────────────────────────────
if lsof -i ":${PORT}" &>/dev/null 2>&1; then
  warn "Port ${PORT} is already in use. Opening existing wizard..."
  open "${URL}"
  exit 0
fi

# ── Start the server ──────────────────────────────────────────────────────────
header "Starting wizard server..."
cd "${WIZARD_DIR}"

# Start server in background, capture PID
"$NODE_CMD" server/index.js &
SERVER_PID=$!

# Trap to clean up on exit
cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM

# Wait for server to be ready (up to 10s)
info "Waiting for server to start..."
for i in $(seq 1 20); do
  if curl -s "${URL}" &>/dev/null; then
    break
  fi
  sleep 0.5
done

# ── Open browser ──────────────────────────────────────────────────────────────
success "Wizard is running at ${URL}"
echo ""
info "Opening in your default browser..."
open "${URL}"

echo ""
echo -e "${BOLD}  The wizard is running in this terminal.${RESET}"
echo -e "  ${CYAN}Press Ctrl+C to stop the server when you're done.${RESET}"
echo ""

# Keep running until server exits or user presses Ctrl+C
wait "$SERVER_PID"

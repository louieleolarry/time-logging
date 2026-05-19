#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# JiraTimeTracker — One-line Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/louieleolarry/time-logging/main/install.sh | bash
#
# What it does:
#   1. Downloads JiraTimeTracker.zip from the latest GitHub Release via curl
#      (curl does NOT apply the macOS quarantine flag — no Gatekeeper warning)
#   2. Removes any previous .app bundle AND extracted wizard folder
#   3. Extracts JiraTimeTracker.app to ~/Applications/
#   4. Strips any residual quarantine flags
#   5. Opens the app — which extracts the wizard fresh and launches the setup
#      wizard in your browser automatically
#
# To re-open the wizard later: double-click JiraTimeTracker.app in ~/Applications
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="louieleolarry/time-logging"
APP_NAME="JiraTimeTracker"
INSTALL_DIR="${HOME}/Applications"
APP_PATH="${INSTALL_DIR}/${APP_NAME}.app"
WIZARD_DIR="${INSTALL_DIR}/${APP_NAME}"   # extracted wizard lives here

# ── Colors ───────────────────────────────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
RESET='\033[0m'

info()    { echo -e "${CYAN}▶${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
error()   { echo -e "${RED}✗${RESET} $*" >&2; exit 1; }

echo ""
echo -e "${BOLD}  ┌─────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}  │   JiraTimeTracker — Installer  v1.1.0   │${RESET}"
echo -e "${BOLD}  └─────────────────────────────────────────┘${RESET}"
echo ""

# ── macOS check ───────────────────────────────────────────────────────────────
[[ "$(uname)" == "Darwin" ]] || error "This installer is for macOS only."

# ── Ensure ~/Applications exists ─────────────────────────────────────────────
mkdir -p "${INSTALL_DIR}"

# ── Download URL (direct — no API call needed, avoids rate limits) ─────────────
info "Fetching latest release info..."
RELEASE_URL="https://github.com/${REPO}/releases/download/v1.1.0/JiraTimeTracker.zip"

info "Downloading ${APP_NAME}..."
TMP_ZIP="$(mktemp /tmp/JiraTimeTracker-XXXXXX.zip)"
# curl does NOT set com.apple.quarantine — this bypasses Gatekeeper
curl -fsSL "$RELEASE_URL" -o "$TMP_ZIP"
success "Downloaded"

# ── Remove any existing installation (app bundle AND extracted wizard) ────────
if [[ -d "${APP_PATH}" ]]; then
  info "Removing previous app bundle..."
  rm -rf "${APP_PATH}"
fi
if [[ -d "${WIZARD_DIR}" ]]; then
  info "Removing previous wizard files..."
  rm -rf "${WIZARD_DIR}"
fi

# ── Extract the .app bundle ───────────────────────────────────────────────────
info "Installing to ${INSTALL_DIR}..."
TMP_EXTRACT="$(mktemp -d /tmp/JiraTimeTracker-extract-XXXXXX)"
unzip -q "$TMP_ZIP" -d "$TMP_EXTRACT"

if [[ -d "${TMP_EXTRACT}/JiraTimeTracker.app" ]]; then
  cp -R "${TMP_EXTRACT}/JiraTimeTracker.app" "${APP_PATH}"
else
  error "JiraTimeTracker.app not found in the zip. Please re-download."
fi

# ── Strip quarantine flags ────────────────────────────────────────────────────
info "Clearing quarantine flags..."
xattr -dr com.apple.quarantine "${APP_PATH}" 2>/dev/null || true

# ── Make the launcher executable ─────────────────────────────────────────────
chmod +x "${APP_PATH}/Contents/MacOS/JiraTimeTracker"

# ── Clean up ─────────────────────────────────────────────────────────────────
rm -f "$TMP_ZIP"
rm -rf "$TMP_EXTRACT"

success "JiraTimeTracker installed to ${APP_PATH}"
echo ""
info "Launching setup wizard..."
open "${APP_PATH}"
echo ""
echo -e "${BOLD}  Done! The setup wizard will open in your browser shortly.${RESET}"
echo -e "  To re-open later:       double-click ${CYAN}JiraTimeTracker.app${RESET} in ~/Applications"
echo -e "  To log time manually:   ${CYAN}/usr/bin/python3 ~/Applications/JiraTimeTracker/wizard/log-time.py${RESET}"
echo -e "  To uninstall:           ${CYAN}bash ~/Applications/JiraTimeTracker/wizard/uninstall.sh${RESET}"
echo ""

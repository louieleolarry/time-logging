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
#   2. Extracts the app to ~/Applications/
#   3. Extracts the wizard to ~/Applications/JiraTimeTracker/wizard/
#   4. Strips any residual quarantine flags just in case
#   5. Opens the app to launch the setup wizard
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="louieleolarry/time-logging"
APP_NAME="JiraTimeTracker"
INSTALL_DIR="${HOME}/Applications"
APP_PATH="${INSTALL_DIR}/${APP_NAME}.app"
WIZARD_DIR="${INSTALL_DIR}/${APP_NAME}/wizard"

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
echo -e "${BOLD}  │   JiraTimeTracker — Installer           │${RESET}"
echo -e "${BOLD}  └─────────────────────────────────────────┘${RESET}"
echo ""

# ── macOS check ───────────────────────────────────────────────────────────────
[[ "$(uname)" == "Darwin" ]] || error "This installer is for macOS only."

# ── Ensure ~/Applications exists ─────────────────────────────────────────────
mkdir -p "${INSTALL_DIR}"

# ── Get latest release download URL ──────────────────────────────────────────
info "Fetching latest release info..."
RELEASE_URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep '"browser_download_url"' \
  | grep 'JiraTimeTracker.zip' \
  | sed 's/.*"browser_download_url": "\(.*\)"/\1/' \
  | head -1)

[[ -n "$RELEASE_URL" ]] || error "Could not find JiraTimeTracker.zip in the latest release. Check https://github.com/${REPO}/releases"

info "Downloading ${APP_NAME}..."
TMP_ZIP="$(mktemp /tmp/JiraTimeTracker-XXXXXX.zip)"
# curl does NOT set com.apple.quarantine — this is the key to bypassing Gatekeeper
curl -fsSL "$RELEASE_URL" -o "$TMP_ZIP"
success "Downloaded"

# ── Remove any existing installation ─────────────────────────────────────────
if [[ -d "${APP_PATH}" ]]; then
  info "Removing previous installation..."
  rm -rf "${APP_PATH}"
fi
if [[ -d "${INSTALL_DIR}/${APP_NAME}" ]]; then
  rm -rf "${INSTALL_DIR}/${APP_NAME}"
fi

# ── Extract the .app bundle ───────────────────────────────────────────────────
info "Installing to ${INSTALL_DIR}..."
TMP_EXTRACT="$(mktemp -d /tmp/JiraTimeTracker-extract-XXXXXX)"
unzip -q "$TMP_ZIP" -d "$TMP_EXTRACT"

# Move the .app into ~/Applications
if [[ -d "${TMP_EXTRACT}/JiraTimeTracker.app" ]]; then
  cp -R "${TMP_EXTRACT}/JiraTimeTracker.app" "${APP_PATH}"
else
  error "JiraTimeTracker.app not found in the zip. Please re-download."
fi

# ── Extract the bundled wizard zip ───────────────────────────────────────────
WIZARD_ZIP="${APP_PATH}/Contents/Resources/jira-time-tracker-v0.3-wizard.zip"
if [[ -f "$WIZARD_ZIP" ]]; then
  info "Extracting wizard..."
  mkdir -p "${INSTALL_DIR}/${APP_NAME}"
  TMP_WIZARD="$(mktemp -d /tmp/JiraTimeTracker-wizard-XXXXXX)"
  unzip -q "$WIZARD_ZIP" -d "$TMP_WIZARD"
  WIZARD_SRC="$(find "$TMP_WIZARD" -maxdepth 2 -type d -name 'wizard' | head -1)"
  if [[ -n "$WIZARD_SRC" ]]; then
    mkdir -p "$WIZARD_DIR"
    cp -R "${WIZARD_SRC}/." "$WIZARD_DIR/"
  fi
  rm -rf "$TMP_WIZARD"
fi

# ── Strip quarantine flags ────────────────────────────────────────────────────
info "Clearing quarantine flags..."
xattr -dr com.apple.quarantine "${APP_PATH}" 2>/dev/null || true
xattr -dr com.apple.quarantine "${INSTALL_DIR}/${APP_NAME}" 2>/dev/null || true

# ── Make setup.sh executable ─────────────────────────────────────────────────
[[ -f "${WIZARD_DIR}/setup.sh" ]] && chmod +x "${WIZARD_DIR}/setup.sh"

# ── Clean up ─────────────────────────────────────────────────────────────────
rm -f "$TMP_ZIP"
rm -rf "$TMP_EXTRACT"

success "JiraTimeTracker installed to ${APP_PATH}"
echo ""
info "Launching setup wizard..."
open "${APP_PATH}"
echo ""
echo -e "${BOLD}  Done! The setup wizard will open in your browser.${RESET}"
echo -e "  To re-open later: double-click ${CYAN}JiraTimeTracker.app${RESET} in ~/Applications"
echo ""

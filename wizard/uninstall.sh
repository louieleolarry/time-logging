#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# uninstall.sh — Jira Time Tracker Uninstaller
# Removes:
#   • launchd job (com.jira-time-tracker.daily)
#   • ~/.jira-time-tracker/ (config + logs)
#   • Optionally: this wizard directory
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

LABEL="com.jira-time-tracker.daily"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
CONFIG_DIR="$HOME/.jira-time-tracker"
WIZARD_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │   Jira Time Tracker — Uninstaller        │"
echo "  └─────────────────────────────────────────┘"
echo ""

# ── Confirm ───────────────────────────────────────────────────────────────────
echo "This will remove:"
echo "  • launchd job:    $PLIST"
echo "  • config + logs:  $CONFIG_DIR"
echo ""
read -r -p "Continue? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi
echo ""

# ── 1. Unload and remove launchd plist ───────────────────────────────────────
if [ -f "$PLIST" ]; then
  echo "▶ Unloading launchd job..."
  launchctl unload "$PLIST" 2>/dev/null && echo "  ✓ Job unloaded" || echo "  ⚠ Job was not loaded (already stopped)"
  rm -f "$PLIST"
  echo "  ✓ Plist removed: $PLIST"
else
  echo "  ℹ No launchd plist found — skipping"
fi

# ── 2. Remove config and logs ─────────────────────────────────────────────────
if [ -d "$CONFIG_DIR" ]; then
  echo "▶ Removing config and logs..."
  rm -rf "$CONFIG_DIR"
  echo "  ✓ Removed: $CONFIG_DIR"
else
  echo "  ℹ No config directory found — skipping"
fi

# ── 3. Optionally remove wizard directory ─────────────────────────────────────
echo ""
read -r -p "Also remove the wizard directory ($WIZARD_DIR)? [y/N] " remove_dir
if [[ "$remove_dir" =~ ^[Yy]$ ]]; then
  # Can't delete ourselves while running — schedule deletion after exit
  SELF="$0"
  (sleep 1 && rm -rf "$WIZARD_DIR") &
  echo "  ✓ Wizard directory will be removed"
else
  echo "  ℹ Wizard directory kept at: $WIZARD_DIR"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ✓ Jira Time Tracker has been uninstalled."
echo ""

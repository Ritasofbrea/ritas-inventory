#!/bin/bash
# Patch 54: installs the two launchd LaunchAgents (weekly backup, daily
# dead-man's-switch check) from the templates in this folder.
#
# launchd has no shell PATH, so this detects the real, absolute path to
# the node binary currently in use (nvm, Homebrew, or the system install
# all resolve differently) and bakes that in, along with this repo's
# absolute path, in place of the __NODE__ / __REPO__ / __HOME__
# placeholders in the plist templates. No secrets are ever written into
# the plists -- the backup script reads .env.local itself at runtime.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Could not find 'node' on PATH. Activate the Node version you use for this project (e.g. 'nvm use') and re-run this script." >&2
  exit 1
fi
# Resolve through any symlink (nvm shims one) so launchd gets a real path.
NODE_BIN="$(cd "$(dirname "$NODE_BIN")" && pwd)/$(basename "$NODE_BIN")"

echo "Repo:        $REPO_DIR"
echo "Node binary: $NODE_BIN"
echo "Installing into: $LAUNCH_AGENTS_DIR"
echo

mkdir -p "$LAUNCH_AGENTS_DIR"

install_one() {
  local template="$1"
  local label="$2"
  local dest="$LAUNCH_AGENTS_DIR/$label.plist"

  sed \
    -e "s#__NODE__#$NODE_BIN#g" \
    -e "s#__REPO__#$REPO_DIR#g" \
    -e "s#__HOME__#$HOME#g" \
    "$SCRIPT_DIR/$template" > "$dest"

  # Unload first in case it's already installed (bootstrap fails if a job
  # with the same label is already loaded) -- harmless if it wasn't.
  launchctl bootout "gui/$(id -u)" "$dest" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$dest"
  echo "Installed and loaded: $label"
}

install_one "com.ritasinventory.backup.weekly.plist" "com.ritasinventory.backup.weekly"
install_one "com.ritasinventory.backup.check.plist" "com.ritasinventory.backup.check"

echo
echo "Done. Useful commands:"
echo "  Check loaded:   launchctl print gui/$(id -u)/com.ritasinventory.backup.weekly"
echo "                  launchctl print gui/$(id -u)/com.ritasinventory.backup.check"
echo "  Run right now:  launchctl kickstart -k gui/$(id -u)/com.ritasinventory.backup.weekly"
echo "                  launchctl kickstart -k gui/$(id -u)/com.ritasinventory.backup.check"
echo "  Remove:         launchctl bootout gui/$(id -u)/com.ritasinventory.backup.weekly"
echo "                  launchctl bootout gui/$(id -u)/com.ritasinventory.backup.check"
echo "                  rm '$LAUNCH_AGENTS_DIR/com.ritasinventory.backup.weekly.plist'"
echo "                  rm '$LAUNCH_AGENTS_DIR/com.ritasinventory.backup.check.plist'"

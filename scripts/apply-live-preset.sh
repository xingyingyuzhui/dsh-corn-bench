#!/bin/sh
# Apply the already-migrated Corn preset into $DSH_HOME.
# This agent cannot write ~/.dsh (sandbox EPERM); run this in a normal terminal.
set -e
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SRC="$ROOT/backups"
HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
DEST="$HOME_DIR/.agent-presets/corn-bench"
if [ ! -f "$SRC/corn-bench-migrated-agent.cordis.yml" ]; then
  echo "missing migrated files under $SRC" >&2
  exit 1
fi
mkdir -p "$DEST"
cp "$SRC/corn-bench-migrated-agent.cordis.yml" "$DEST/agent.cordis.yml"
cp "$SRC/corn-bench-migrated-preset.yml" "$DEST/preset.yml"
cp "$SRC/corn-bench-migrated-marker.json" "$DEST/.dsh-corn-bench"
echo "wrote $DEST (schema 3, prefix, dsh-corn-bench/agent)"
echo "new Session required; existing sessions keep the old generation"

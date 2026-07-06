#!/usr/bin/env bash
# Installs the ingest + display systemd services on THIS (server) machine.
#
# Run as your normal user (it calls sudo itself), from anywhere:
#   INGEST_SECRET=<the-shared-secret> bash deploy/install-server.sh
#
# The secret MUST match the pusher on your PC. Override any default below by
# exporting it first, e.g.  TZ=America/Chicago CLAUDE_PLAN="Claude Max" ...
set -euo pipefail

# Repo root = parent of this script's dir, so it works from any cwd.
CODE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The user the services run as (the real user even when run via sudo).
RUN_USER="${SUDO_USER:-$(id -un)}"
RUN_GROUP="$(id -gn "$RUN_USER")"
HOME_DIR="$(getent passwd "$RUN_USER" | cut -d: -f6)"
: "${HOME_DIR:=$HOME}"

command -v systemctl >/dev/null || { echo "ERROR: systemd (systemctl) not found." >&2; exit 1; }
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "ERROR: Node.js 18+ not found in PATH." >&2; exit 1; }

SECRET="${INGEST_SECRET:-${1:-}}"
if [ -z "$SECRET" ]; then
  echo "ERROR: the shared secret is required." >&2
  echo "  INGEST_SECRET=<secret> bash deploy/install-server.sh" >&2
  exit 1
fi

# Settings (override via environment before running).
RECV_DIR="${INGEST_DIR:-$HOME_DIR/.claude-usage/received}"
INGEST_PORT="${INGEST_PORT:-2524}"
DISPLAY_PORT="${PORT:-2523}"
TZ_VAL="${TZ:-America/New_York}"
PLAN="${CLAUDE_PLAN:-Claude Pro}"
WEEK_RESET_VAL="${WEEK_RESET:-Tue 9am}"
SESSION_LIMIT_VAL="${SESSION_LIMIT:-102m}"
WEEK_LIMIT_VAL="${WEEK_LIMIT:-660m}"

echo "Code dir     : $CODE_DIR"
echo "Run as       : $RUN_USER:$RUN_GROUP"
echo "Node         : $NODE"
echo "Received logs: $RECV_DIR"
echo "Ports        : ingest $INGEST_PORT / display $DISPLAY_PORT"
echo

# Received-logs dir, owned by the service user (works whether or not run via sudo).
sudo install -d -o "$RUN_USER" -g "$RUN_GROUP" -m 755 "$RECV_DIR"

# Shared env file (root-owned, 600 — holds the secret). EnvironmentFile keeps
# space-containing values (e.g. "Claude Pro") intact, unlike inline Environment=.
sudo install -d -m 755 /etc/trmnl-claude
sudo tee /etc/trmnl-claude/env >/dev/null <<ENV
INGEST_PORT=$INGEST_PORT
INGEST_SECRET=$SECRET
INGEST_DIR=$RECV_DIR
PORT=$DISPLAY_PORT
TZ=$TZ_VAL
CLAUDE_PLAN=$PLAN
WEEK_RESET=$WEEK_RESET_VAL
SESSION_LIMIT=$SESSION_LIMIT_VAL
WEEK_LIMIT=$WEEK_LIMIT_VAL
CLAUDE_PROJECTS_DIR=$RECV_DIR
ENV
sudo chmod 600 /etc/trmnl-claude/env

write_unit() {
  local name="$1" entry="$2"
  sudo tee "/etc/systemd/system/trmnl-claude-$name.service" >/dev/null <<UNIT
[Unit]
Description=TRMNL Claude Code Usage - $name
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$CODE_DIR
EnvironmentFile=/etc/trmnl-claude/env
ExecStart=$NODE $entry
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
}
write_unit ingest src/ingest.js
write_unit usage  src/server.js

sudo systemctl daemon-reload
sudo systemctl enable --now trmnl-claude-ingest.service trmnl-claude-usage.service
sleep 1

echo
echo "ingest  health: $(curl -fsS "http://localhost:$INGEST_PORT/health" 2>/dev/null || echo 'FAILED — check: journalctl -u trmnl-claude-ingest -e')"
echo "display status: HTTP $(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$DISPLAY_PORT/" 2>/dev/null || echo 'FAILED — check: journalctl -u trmnl-claude-usage -e')"
echo
echo "Done. On your PC, set INGEST_URL to  http://<this-server>:$INGEST_PORT"
echo "and point TRMNL at  http://<this-server>:$DISPLAY_PORT/data.json"

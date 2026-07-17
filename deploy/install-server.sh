#!/usr/bin/env bash
# Installs the TRMNL Claude Code Usage display service on THIS machine (systemd).
#
# Run as your normal user (it calls sudo itself), from anywhere:
#   USAGE_API_URL=http://your-dashboard:8080 bash deploy/install-server.sh
#
# Override PORT / TZ / CLAUDE_PLAN by exporting them first. If your dashboard is
# behind an auth boundary, also export USAGE_API_HEADER, e.g.:
#   USAGE_API_HEADER="Authorization: Bearer TOKEN" \
#   USAGE_API_URL=http://your-dashboard:8080 bash deploy/install-server.sh
set -euo pipefail

CODE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(id -un)}"

command -v systemctl >/dev/null || { echo "ERROR: systemd (systemctl) not found." >&2; exit 1; }
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "ERROR: Node.js 18+ not found in PATH." >&2; exit 1; }

API_URL="${USAGE_API_URL:-${1:-}}"
if [ -z "$API_URL" ]; then
  echo "ERROR: USAGE_API_URL is required (the dashboard API base URL)." >&2
  echo "  USAGE_API_URL=http://your-dashboard:8080 bash deploy/install-server.sh" >&2
  exit 1
fi

PORT_VAL="${PORT:-2523}"
TZ_VAL="${TZ:-America/New_York}"
PLAN="${CLAUDE_PLAN:-Claude Pro}"

echo "Code dir : $CODE_DIR"
echo "Run as   : $RUN_USER"
echo "Node     : $NODE"
echo "API URL  : $API_URL"
echo "Port     : $PORT_VAL"
echo "Header   : $([ -n "${USAGE_API_HEADER:-}" ] && echo 'set' || echo 'none')"
echo

# Env file (EnvironmentFile keeps space-containing values like "Claude Pro" and
# "Authorization: Bearer …" intact). Optional vars are written only when set.
# It may hold an auth token (USAGE_API_HEADER), so create it root-only *before*
# writing any content — tee preserves the existing mode, so the secret is never
# even briefly world-readable. systemd reads EnvironmentFile as root before
# dropping to User=, so the service still receives the vars.
sudo install -d -m 755 /etc/trmnl-claude
sudo install -m 600 /dev/null /etc/trmnl-claude/env
{
  echo "USAGE_API_URL=$API_URL"
  echo "PORT=$PORT_VAL"
  echo "TZ=$TZ_VAL"
  echo "CLAUDE_PLAN=$PLAN"
  if [ -n "${USAGE_API_HEADER:-}" ]; then echo "USAGE_API_HEADER=$USAGE_API_HEADER"; fi
  if [ -n "${USAGE_API_TIMEOUT:-}" ]; then echo "USAGE_API_TIMEOUT=$USAGE_API_TIMEOUT"; fi
} | sudo tee /etc/trmnl-claude/env >/dev/null

sudo tee /etc/systemd/system/trmnl-claude-usage.service >/dev/null <<UNIT
[Unit]
Description=TRMNL Claude Code Usage plugin
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$CODE_DIR
EnvironmentFile=/etc/trmnl-claude/env
ExecStart=$NODE src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now trmnl-claude-usage.service
sleep 1

echo "display status: HTTP $(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT_VAL/" 2>/dev/null || echo 'FAILED — check: journalctl -u trmnl-claude-usage -e')"
echo
echo "Done. Point TRMNL at  http://<this-host>:$PORT_VAL/data.json"

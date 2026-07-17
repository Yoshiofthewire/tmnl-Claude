# TRMNL — Claude Code Usage

A grayscale ePaper plugin for [TRMNL](https://usetrmnl.com) that shows your
Claude usage at a glance. A small Node server **pulls** the numbers from the
[Claude Usage Dashboard API](#the-usage-api) and renders an 800×480 e-ink screen.
Every fetch is fresh, so the screen is current each time TRMNL polls (~15 min).

![screen preview](docs/preview.png)

## What it shows

- **Session** and **Week (all models)** usage gauges — the real percentages and
  reset times straight from Claude's usage panel.
- **Per-model** weekly usage bars.
- **Session** cost, API time, and wall time.
- A **usage insight** ("what's contributing to your limits usage").
- Plan badge (top-right) and a footer with the Claude mark, "Claude Code Usage",
  the last-updated time, and a `stale` marker when data is old.

If the dashboard isn't logged in, the screen shows a "not connected" notice with
the dashboard URL instead.

## The usage API

The plugin is a thin renderer over a separate service — the **Claude Usage
Dashboard** — which scrapes Claude Code's `/usage` panel and exposes it at
`GET {USAGE_API_URL}/api/usage`. That service handles login/auth; this plugin
only reads `/api/usage` and degrades gracefully on `503 not authenticated`.

```
TRMNL ──poll──▶ this plugin (:2523) ──GET /api/usage──▶ Claude Usage Dashboard API
                    │
                    └─ renders 800×480 e-ink screen + /data.json
```

You must have that dashboard running and logged in, reachable at `USAGE_API_URL`.

## Requirements

- Node.js 18+ (zero npm dependencies).
- A running, authenticated Claude Usage Dashboard reachable at `USAGE_API_URL`.

## Run it

Set `USAGE_API_URL` (in `.env` or the environment), then:

```bash
node src/server.js      # or: npm start
```

Open <http://localhost:2523/>. Endpoints:

| Path         | Purpose                                                        |
|--------------|---------------------------------------------------------------|
| `/`          | The rendered 800×480 screen (HTML).                           |
| `/data.json` | The normalized usage plus a `display` block of pre-formatted strings for the TRMNL Liquid template. |
| `/health`    | `ok` — for uptime checks.                                     |

Preview without the server (writes `preview.html`; uses live data if
`USAGE_API_URL` is set, else a bundled sample):

```bash
npm run preview && open preview.html
```

## Configuration

The server auto-loads `.env`. See `.env.example`.

| Variable            | Default               | Meaning                                        |
|---------------------|-----------------------|------------------------------------------------|
| `USAGE_API_URL`     | *(required)*          | Base URL of the usage dashboard API.           |
| `PORT`              | `2523`                | Listen port (what TRMNL fetches).              |
| `HOST`              | `0.0.0.0`             | Listen interface.                              |
| `CLAUDE_PLAN`       | `Claude Pro`          | Fallback plan badge; used only when the API reports no `plan` (normally the badge shows "Claude <tier>" from the API). |
| `TZ`                | *(system zone)*       | Timezone for the header/updated timestamps.    |
| `USAGE_API_TIMEOUT` | `8000`                | Milliseconds to wait for the API before falling back. |
| `USAGE_API_HEADER`  | *(none)*              | One `Name: Value` header sent when polling the usage API — for getting through an auth boundary / reverse proxy (e.g. `Authorization: Bearer …`). |

## Behavior when the API is down or not logged in

- **`503` (not authenticated):** the screen shows a "log in at `USAGE_API_URL`"
  notice.
- **Unreachable / timeout, nothing cached yet:** a "can't reach the dashboard"
  notice with the error.
- **Unreachable after a good fetch:** the last good screen is shown with a
  `stale` marker in the footer (kept in memory), rather than going blank.

## Connect it to TRMNL

The plugin server must be reachable from TRMNL's fetchers (LAN, tunnel, or your
own BYOS server).

- **Native (recommended):** Private Plugin → **Polling** → URL
  `http://<host>:2523/data.json`, and paste
  [`trmnl/markup.liquid`](trmnl/markup.liquid) into the markup editor. All
  formatting is precomputed in the JSON's `display` object.
- **Direct:** if your setup screenshots a URL, point it at `http://<host>:2523/`.

## Deploy as a service (systemd)

From the repo, run the installer with your API URL. Run it **with `bash`** and as
your normal user (it calls `sudo` itself):

```bash
USAGE_API_URL=http://your-dashboard:8080 bash deploy/install-server.sh
```

It writes `/etc/trmnl-claude/env` + the `trmnl-claude-usage` unit (`:2523`),
enables and starts it, and health-checks it. Manage with
`sudo systemctl status trmnl-claude-usage` / `journalctl -u trmnl-claude-usage -e`.

## Migrating from the old push model

Earlier versions parsed local Claude logs and pushed them to the display box via
an ingest server + pusher. That's all gone. To clean up:

- **On your PC:** `systemctl --user disable --now trmnl-claude-pusher`; delete
  `~/.config/systemd/user/trmnl-claude-pusher.service` and
  `~/.config/trmnl-claude/pusher.env`.
- **On the old server:** `sudo systemctl disable --now trmnl-claude-ingest`;
  remove its unit and the received-logs dir. Re-run `install-server.sh` (above)
  to point the display service at `USAGE_API_URL`. If you opened the firewall for
  the ingest port (2524), close it.

## Project layout

```
src/usageApi.js   fetch + normalize GET /api/usage; bar classification
src/format.js     usd / date / percent formatting
src/view.js       pre-formatted "display" model (HTML + Liquid share it)
src/render.js     the 800×480 HTML screen (+ not-connected / stale states)
src/server.js     HTTP server (/, /data.json, /health); loads .env; last-good cache
trmnl/markup.liquid   TRMNL Polling template
scripts/preview.js    render to a file for local viewing
test/check.js         dependency-free self-check (npm test)
deploy/               systemd unit + install-server.sh
```

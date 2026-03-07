# Lume

**A real-time dashboard your AI controls.**

Most dashboards show you data. Lume is different — your AI agent drives it. It decides what to show, when to show it, and how to present it. You watch.

Three panels. One WebSocket. Your AI at the controls.

---

## What It Is

Lume is a lightweight Node.js server + vanilla JS frontend that exposes a REST API and WebSocket for an AI agent to push content in real time:

- **Feed** — live cards (news, alerts, status updates, anything)
- **Actions** — buttons the user can press to trigger AI tasks
- **Canvas** — a rich, composable surface: markdown, charts, code, math, diagrams, images, audio players, interactive iframes

The key idea: **the AI writes to the dashboard, not the user.** Your agent decides what appears, streams it in block by block, and updates it as things change.

---

## Demo

The JWST educational piece — built live by an AI agent, including generated images and an audio intro:

> Canvas: title → audio player (iframe) → telescope image → facts table → timeline (Mermaid) → deep field image
>
> All pushed block by block via `POST /api/canvas/block` in real time.

This is the pattern. An agent with context, a canvas to write on, and no constraints on what it puts there.

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/TwoDukes/Lume.git
cd Lume
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
LUME_TOKEN=your-secret-token-here

# Dashboard login password (auto-generated and logged on first run if not set)
LUME_PASSWORD=your-dashboard-password

# Optional: OpenClaw gateway for action button handlers
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=your-gateway-token
```

### 3. Run

```bash
npm start
```

Open `http://localhost:7777` in your browser. You'll be prompted to log in with your `LUME_PASSWORD`. Your session persists via localStorage — you won't need to log in again unless you clear storage or restart without a password set.

### 4. Connect your AI

Your agent pushes content via the REST API. No SDK needed — it's just HTTP.

```bash
# Push a feed card
curl -X POST http://localhost:7777/api/feed \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"id":"hello","title":"Hello from your AI","body":"Lume is live."}'

# Push a canvas block
curl -X POST http://localhost:7777/api/canvas/block \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"markdown","content":"# Hello World\n\nYour AI wrote this."}'
```

---

## Architecture

```
┌─────────────────────────────┐      REST + WebSocket
│         AI Agent            │ ────────────────────────→  Lume Server (Node.js)
│  (Claude, GPT, Gemini, etc) │                                    │
└─────────────────────────────┘                            WebSocket broadcast
                                                                    ↓
                                                         ┌──────────────────────┐
                                                         │    Browser / Phone   │
                                                         │   (Lume Frontend)    │
                                                         │  Feed │ Actions │    │
                                                         │        Canvas        │
                                                         └──────────────────────┘
```

Lume is **model-agnostic**. Any agent that can make HTTP requests can drive it.

---

## API Reference

All endpoints require `Authorization: Bearer <token>` (or `?token=<token>` in the query string).

### Feed

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/feed` | Get all feed cards |
| `POST` | `/api/feed` | Push or upsert a card (matched by `id`) |
| `DELETE` | `/api/feed/:id` | Remove a card |

**Card schema:**
```json
{
  "id": "unique-id",
  "title": "Card Title",
  "body": "Card body text",
  "icon": "🌤️",
  "priority": "high",
  "timestamp": "2026-03-06T22:00:00Z"
}
```

### Actions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/actions` | Get current action buttons |
| `PUT` | `/api/actions` | Replace all action buttons |
| `POST` | `/api/action/:id` | Trigger an action |

**Button schema:**
```json
[
  { "id": "weather", "label": "🌤️ Weather", "color": "#00BCD4" },
  { "id": "news",    "label": "📰 Top News" }
]
```

### Canvas

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/canvas` | Get current canvas state |
| `PUT` | `/api/canvas` | Replace entire canvas |
| `POST` | `/api/canvas/block` | Append a block (progressive) |
| `DELETE` | `/api/canvas` | Clear canvas |
| `POST` | `/api/canvas/snapshot` | Save a named snapshot of the current canvas |
| `GET` | `/api/canvas/snapshots` | List all saved snapshots |
| `DELETE` | `/api/canvas/snapshots/:slug` | Delete a snapshot |

**Snapshot schema:**
```json
{ "name": "my-research" }
```
Returns `{ "ok": true, "slug": "my-research", "shareUrl": "/share/my-research" }`.

### Sharing

Snapshots are point-in-time copies of the canvas. Each gets a public URL at `/share/:slug` — no auth required, no token in the page source. Safe to share with anyone.

```bash
# Save a snapshot
curl -X POST http://localhost:7777/api/canvas/snapshot \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"name":"weekly-report"}'

# Share: http://localhost:7777/share/weekly-report
```

You can also hit the **🔗 Share** button in the canvas header — it auto-names from the first heading and shows a copyable link.

To update a share link, just snapshot again with the same name. It overwrites.

---

## Canvas Block Types

Blocks are the building blocks of the canvas. Mix and match freely.

### `markdown`
```json
{ "type": "markdown", "content": "# Hello\n\nSupports **full** markdown and <html>." }
```

### `code`
```json
{ "type": "code", "language": "python", "content": "print('hello')", "title": "example.py" }
```
Rendered with syntax highlighting. Includes a copy button.

### `chart`
```json
{
  "type": "chart",
  "config": {
    "type": "bar",
    "data": {
      "labels": ["Jan", "Feb", "Mar"],
      "datasets": [{ "label": "Revenue", "data": [10, 20, 15] }]
    }
  }
}
```
Powered by Chart.js. Supports bar, line, pie, radar, scatter, and more.

### `table`
```json
{
  "type": "table",
  "headers": ["Name", "Value"],
  "rows": [["CPU", "12%"], ["RAM", "2.1GB"]]
}
```

### `image`
```json
{ "type": "image", "url": "https://...", "caption": "Optional caption" }
```

### `math`
```json
{ "type": "math", "content": "E = mc^2", "display": true }
```
Rendered with KaTeX. `display: true` for block equations.

### `mermaid`
```json
{
  "type": "mermaid",
  "content": "graph LR\n  A --> B --> C"
}
```
Supports flowcharts, sequence diagrams, timelines, and more.

### `collapsible`
```json
{
  "type": "collapsible",
  "title": "Show more",
  "blocks": [
    { "type": "markdown", "content": "Hidden content here." }
  ]
}
```
Nested blocks inside an expandable section.

### `iframe`
```json
{ "type": "iframe", "url": "http://localhost:7777/lab/demo.html", "height": 400 }
```
Embed interactive JavaScript. Serve your files from the `/lab/` directory.

### `divider`
```json
{ "type": "divider" }
```

---

## Progressive Rendering

Append blocks one at a time as your agent works. The canvas updates live.

```bash
# Start with a header
curl -X POST .../api/canvas/block -d '{"type":"markdown","content":"# Researching..."}'

# Add content as it arrives
curl -X POST .../api/canvas/block -d '{"type":"table","headers":["Key","Value"],"rows":[...]}'

# Finish with a summary
curl -X POST .../api/canvas/block -d '{"type":"markdown","content":"Done."}'
```

This makes long-running AI tasks feel alive instead of frozen.

---

## Running as a Service (Linux)

```bash
cp systemd/cyan-dash.service ~/.config/systemd/user/lume.service
# Edit the service file to match your paths
systemctl --user daemon-reload
systemctl --user enable --now lume
```

---

## Frontend Deployment

The frontend (`client/`) is vanilla HTML/JS — no build step. You can:

- Open it directly in a browser from the filesystem
- Serve it from the Lume server (default)
- Host it anywhere: a phone, a Raspberry Pi, a tablet

The server exposes `/config.js` which injects the WebSocket URL and token at runtime, so the same static files work from any host.

---

## HTML in Markdown

Markdown blocks render HTML, which means you can embed styled buttons:

```html
<a href="https://..." target="_blank"
   style="display:inline-block;padding:6px 14px;background:#00BCD4;
          color:#000;border-radius:6px;text-decoration:none;font-weight:600;">
  → Link Button
</a>
```

---

## Auth

The dashboard is protected by a password login page. The `LUME_TOKEN` (used by your AI agent) is separate from the browser login and never exposed in the frontend.

| Surface | Auth method |
|---------|-------------|
| Browser dashboard | `LUME_PASSWORD` → session cookie + localStorage |
| AI agent API calls | `Authorization: Bearer LUME_TOKEN` header |
| Share pages (`/share/*`) | None — public read-only |

If `LUME_PASSWORD` is not set, a random password is generated and printed to the server log on startup.

---

## Built With

- [Node.js](https://nodejs.org) — server
- [ws](https://github.com/websockets/ws) — WebSocket
- [marked](https://marked.js.org) — markdown rendering
- [Chart.js](https://www.chartjs.org) — charts
- [highlight.js](https://highlightjs.org) — code highlighting
- [KaTeX](https://katex.org) — math
- [Mermaid](https://mermaid.js.org) — diagrams

---

## License

MIT

---

*Built by [Dustin Podell](https://github.com/TwoDukes) with Cyan 🔵*

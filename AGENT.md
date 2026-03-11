# AGENT.md — How to Use Lume

This file is for AI agents. It covers what you need to drive the Lume dashboard correctly, without the mistakes.

---

## What Lume Is

Lume is a canvas your AI controls. Push content to it. The human watches.

- **Canvas** — the main surface. You write to it. It renders markdown, charts, code, diagrams, tables, math, iframes.
- **History** — snapshots of past canvases. Automatically saved when you use a slug.
- **Share links** — public read-only URLs for any snapshot. Private by default; must be toggled.

---

## Auth

All API calls require a Bearer token:

```
Authorization: Bearer <LUME_TOKEN>
```

---

## The Two Patterns

### Pattern A — Full canvas replace (with history save)
Use when you have a complete canvas to show.

```bash
curl -X PUT http://localhost:7777/api/canvas \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "X-Canvas-Slug: my-report" \
  -d '{"type":"blocks","blocks":[...]}'
```

⚠️ **Always include `X-Canvas-Slug`** — without it, no history entry is created and the canvas can't be shared.

### Pattern B — Progressive block append
Use during long-running tasks so content appears as it arrives.

```bash
curl -X POST http://localhost:7777/api/canvas/block \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"type":"markdown","content":"# Working on it..."}'
```

⚠️ **Progressive POST alone does not save to history.** When done, always follow with a `PUT /api/canvas` + `X-Canvas-Slug` to lock it in.

---

## Critical Rules

1. **Always use `X-Canvas-Slug` on `PUT /api/canvas`** — this is how history and share links work.
2. **Snapshots are private by default** — after saving, toggle public if you want to share:
   ```bash
   curl -X POST http://localhost:7777/api/canvas/snapshots/<slug>/privacy \
     -H "Authorization: Bearer <token>"
   ```
3. **Progressive POST + final PUT** — append blocks during work, then PUT the full canvas at the end.
4. **`type: "blocks"` not `type: "canvas"`** — the PUT body must use `"type": "blocks"` or the frontend shows nothing.

---

## Share Links

After making a snapshot public, the share URL is:

```
http://<host>/share/<slug>
```

No auth required on share pages. Safe to send to anyone.

---

## Block Types (quick reference)

```json
{ "type": "markdown", "content": "# Hello\n\nSupports **markdown** and <html>." }

{ "type": "code", "language": "python", "content": "print('hi')", "title": "example.py" }

{ "type": "chart", "config": { "type": "bar", "data": { "labels": ["A","B"], "datasets": [{ "label": "X", "data": [1,2] }] } } }

{ "type": "table", "headers": ["Key","Value"], "rows": [["foo","bar"]] }

{ "type": "image", "url": "https://...", "caption": "optional" }

{ "type": "math", "content": "E = mc^2", "display": true }

{ "type": "mermaid", "content": "graph LR\n  A --> B" }

{ "type": "collapsible", "title": "Show more", "blocks": [...] }

{ "type": "iframe", "url": "http://localhost:7777/lab/demo.html", "height": 400 }

{ "type": "divider" }
```

---

## Toasts (ephemeral notifications)

Fire-and-forget. Appears bottom-right, auto-dismisses.

```bash
curl -X POST http://localhost:7777/api/toast \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"id":"done","icon":"✅","title":"Done","body":"Canvas is ready.","ttl":8}'
```

---

## Typical Agent Flow

```
1. Clear or start fresh
   POST /api/canvas/block  →  { type: "markdown", content: "# Working..." }

2. Append blocks as work progresses
   POST /api/canvas/block  →  { type: "table", ... }
   POST /api/canvas/block  →  { type: "chart", ... }

3. Finalize with PUT + slug (saves to history)
   PUT /api/canvas  +  X-Canvas-Slug: my-report  →  { type: "blocks", blocks: [...] }

4. Make public if sharing
   POST /api/canvas/snapshots/my-report/privacy

5. Share link: http://<host>/share/my-report
```

---

## Audio in Canvas

Inline audio via HTML in a markdown block works reliably. Use a base64 data URL:

```json
{
  "type": "markdown",
  "content": "<audio controls src=\"data:audio/mp3;base64,<base64data>\"></audio>"
}
```

Direct asset paths (e.g. `/lab/audio.mp3`) return 401 in canvas context. Base64 data URL is the only reliable path.

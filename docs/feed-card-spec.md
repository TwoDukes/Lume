# Feed Card System — Design Spec
*For implementation by Claude Code*

---

## Current Card Schema
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

---

## Proposed Enhancements

### 1. Card Types (colored left border)
Add a `type` field that sets the card's visual style:

| Type | Border Color | Use For |
|------|-------------|---------|
| `info` | cyan (`#00BCD4`) | default, informational |
| `success` | green (`#4CAF50`) | completed tasks, good news |
| `warning` | amber (`#FFC107`) | attention needed |
| `alert` | red (`#F44336`) | errors, urgent items |

```json
{ "type": "success", "title": "Task complete", "body": "..." }
```

Default (no type): existing style, no left border change.

### 2. Link Field
Make cards tappable/clickable via a `link` field:

```json
{ "title": "JWST finds new galaxy", "link": "https://nasa.gov/..." }
```

- If `link` is present, the entire card should be clickable (opens in new tab)
- Show a subtle external link icon (↗) in the top-right corner
- Cursor: pointer

### 3. Image Thumbnail
Optional small image in the card (right side or below body):

```json
{ "title": "SF This Weekend", "image": "https://...", "body": "..." }
```

- Display as a small thumbnail (80×60px right-aligned, or full-width below body)
- Only show if URL is present and loads
- Lazy load

### 4. Card TTL / Auto-Expiry
Optional `ttl` field (seconds until auto-remove):

```json
{ "id": "weather", "title": "Weather", "body": "Sunny 68°F", "ttl": 3600 }
```

- Client-side timer removes the card from the feed after `ttl` seconds from `timestamp`
- Server doesn't need to know about it — purely client-side UX
- When removed client-side, optionally fade out

### 5. Action Button on Card (already exists, just formalize)
The existing `action` field should be documented and kept:

```json
{
  "title": "Deploy ready",
  "body": "Build passed. Click to deploy.",
  "action": {
    "label": "Deploy now",
    "endpoint": "/api/action/deploy"
  }
}
```

---

## Updated Full Card Schema

```json
{
  "id": "string (required for upsert)",
  "title": "string",
  "body": "string",
  "icon": "emoji or string",
  "type": "info | success | warning | alert",
  "priority": "high | normal",
  "timestamp": "ISO 8601",
  "ttl": 3600,
  "link": "https://...",
  "image": "https://...",
  "action": {
    "label": "Button label",
    "endpoint": "/api/action/id"
  }
}
```

All fields optional except as needed for display.

---

## Visual Design Notes
- Left border: 3px solid, color based on `type`
- `priority: "high"` cards get a subtle glow/highlight (keep existing behavior)
- Link cards: whole card clickable, `↗` icon top-right, hover lift effect
- Image: right-aligned thumbnail if body is short; full-width below body if body is long
- Keep OLED dark theme (#000 background), cyan (#00BCD4) accent

---

## Testing Against Live Server
- Server: `http://5.78.135.57:7777`
- Auth: `Bearer cyan-c7b3494f6f272450`
- Push test cards to `/api/feed` and validate in browser

---

## Delivery
When done: zip updated `client/` folder and send to Cyan via Telegram.
Cyan will cherry-pick into the Lume release branch and push to GitHub.

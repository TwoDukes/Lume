# Cyan Dashboard — Roadmap
*Built in one night. Ready to share with the world.*

---

## 🧹 Pre-Release Cleanup

### Code Quality
- [ ] Remove debug button ("What Do You Know?") from default actions
- [ ] Clean up server.js — consolidate any leftover dead code from action handler experiments
- [ ] Move auth token to proper env file (.env) with dotenv, not hardcoded
- [ ] Add input validation on feed/canvas API endpoints
- [ ] Error handling on WS disconnect/reconnect (already works, just tighten)

### Security
- [ ] CORS: restrict to specific origins instead of `*`
- [ ] Rate limiting on API endpoints
- [ ] Review what's exposed publicly vs loopback-only

### Frontend Polish (CC)
- [ ] Remove Lab tab (iframe inline in canvas is better)
- [ ] Mobile/trifold optimization — test layout on various screen sizes
- [ ] Loading states on action buttons (spinner while Sonnet works)
- [ ] Error state handling (what if API is down)
- [ ] Smooth block fade-in animation already in — verify it's consistent

---

## 📦 Packaging for Release

### What We're Shipping
The core concept: **an AI assistant dashboard that the AI controls in real-time**
- Feed panel — AI pushes cards (weather, status, news, custom)
- Actions panel — buttons that dispatch tasks to the AI
- Canvas panel — rich content: markdown, math, charts, code, diagrams, interactive iframes

### Config / Setup
- [ ] Single `.env.example` with all required vars
- [ ] Setup script or clear README with install steps
- [ ] Systemd service file included
- [ ] Make dashboard token configurable (not hardcoded)
- [ ] Document the OpenClaw gateway integration

### README
- [ ] What it is (30 second pitch)
- [ ] Architecture diagram (could push to canvas with Mermaid lol)
- [ ] Setup instructions (dependencies: Node.js, OpenClaw)
- [ ] Canvas block type reference
- [ ] Action handler customization guide
- [ ] Screenshot / demo GIF

---

## ✨ Nice-to-Haves Before Launch

- [ ] Default action set is genuinely useful out of the box
- [ ] Canvas has a welcome/onboarding state when empty
- [ ] Feed cards have a max age / auto-expire option
- [ ] A "clear everything" / reset button

---

## 🚀 Launch Targets

- **OpenClaw Community (clawhub.com)** — post as a skill or integration
- **GitHub** — open source the server + frontend
- **Write-up** — "Building a real-time AI dashboard controlled by Claude" — the progressive canvas research mode is genuinely novel
- **X/Twitter** — demo video of research mode (MeanFlow explainer was 🔥)

---

## 💡 Future Ideas (post-launch)

- Persistent canvas URLs (shareable research outputs)
- Multi-user support (different dashboards per user)
- Mobile app wrapper (PWA)
- Plugin system for custom action handlers
- WebRTC for real-time voice interaction with Cyan

---

*Started: 2026-03-05 (one late night in SF)*
*Stack: Node.js + Express + WebSocket + Vanilla JS frontend*
*Powered by: OpenClaw + Claude Opus 4.6 / Sonnet 4.6 / Haiku 4.5*

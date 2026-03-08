import 'dotenv/config';
import { createServer, request as httpRequest } from "http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from "fs";
import { join, extname, dirname } from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import cookie from "cookie";
import crypto from "crypto";

// ─── Config (from environment) ────────────────────────────────────────────────
const PORT        = parseInt(process.env.PORT || "7777");
const TOKEN       = process.env.LUME_TOKEN;
const GW_URL      = process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789";
const GW_TOKEN    = process.env.OPENCLAW_GATEWAY_TOKEN;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

if (!TOKEN) {
  console.error("ERROR: LUME_TOKEN is required");
  process.exit(1);
}

const GENERATED_LUME_PASSWORD = crypto.randomBytes(24).toString("base64url");
const LUME_PASSWORD = process.env.LUME_PASSWORD || GENERATED_LUME_PASSWORD;
if (!process.env.LUME_PASSWORD) {
  console.log("⚠️  LUME_PASSWORD not set. Generated temporary password:");
  console.log(`   ${LUME_PASSWORD}`);
}

const SESSION_SECRET = crypto.createHash("sha256").update(`${TOKEN}:${LUME_PASSWORD}`).digest("hex");
const SESSION_COOKIE = "lume_session";
const sessionTokens = new Set();

function signToken(token) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(token).digest("hex");
}

function encodeSession(token) {
  return `${token}.${signToken(token)}`;
}

function decodeSession(value) {
  if (!value || typeof value !== "string") return null;
  const i = value.lastIndexOf(".");
  if (i <= 0) return null;
  const token = value.slice(0, i);
  const sig = value.slice(i + 1);
  const expectedSig = signToken(token);
  try {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expectedSig, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return token;
}

function getBearerToken(req) {
  const auth = req.headers["authorization"] || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function getSessionTokenFromCookie(req) {
  const raw = req.headers.cookie || "";
  const cookies = cookie.parse(raw);
  const packed = cookies[SESSION_COOKIE];
  return decodeSession(packed);
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
const rateLimits = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const window = 60_000;
  const max = 60;
  let entry = rateLimits.get(ip);
  if (!entry || now - entry.start > window) {
    entry = { start: now, count: 0 };
    rateLimits.set(ip, entry);
  }
  entry.count++;
  return entry.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    if (now - entry.start > 60_000) rateLimits.delete(ip);
  }
}, 300_000);

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR  = join(__dir, "../client");
const STATE_DIR   = join(__dir, "state");
const SNAPSHOT_DIR = join(STATE_DIR, "snapshots");
const LAB_DIR     = join(__dir, "../lab");

mkdirSync(STATE_DIR, { recursive: true });
mkdirSync(SNAPSHOT_DIR, { recursive: true });

// ─── State ────────────────────────────────────────────────────────────────────
function stateFile(name) { return join(STATE_DIR, name + ".json"); }
function loadState(name, def) {
  try { return JSON.parse(readFileSync(stateFile(name), "utf8")); } catch { return def; }
}
function saveState(name, data) {
  writeFileSync(stateFile(name), JSON.stringify(data, null, 2));
}

let feed    = loadState("feed", []);
const DEFAULT_ACTIONS = [
  { id: "weather",       label: "🌤️ Weather",       color: "#00BCD4" },
  { id: "hn-top5",       label: "📰 HN Top 5",       color: "#FF6D00" },
  { id: "server-status", label: "🖥️ Server Status",  color: "#4CAF50" },
  { id: "surprise",      label: "✨ Surprise",        color: "#9C27B0" },
];
let actions = loadState("actions", DEFAULT_ACTIONS);
let canvas  = loadState("canvas", null);

// ─── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of clients) {
    if (c.readyState === 1) c.send(data);
  }
}

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "init", data: { feed, actions, canvas } }));
  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

// ─── MIME types ───────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
};

// ─── Auth middleware ──────────────────────────────────────────────────────────
function isAuthed(req) {
  const bearer = getBearerToken(req);
  if (bearer === TOKEN) return true;
  if (bearer && sessionTokens.has(bearer)) return true;

  const sessionToken = getSessionTokenFromCookie(req);
  if (sessionToken && sessionTokens.has(sessionToken)) return true;

  return false;
}

function isPublicRoute(req, path) {
  if (req.method === "GET" && path === "/auth/login") return true;
  if (req.method === "POST" && path === "/auth/login") return true;
  if (req.method === "GET" && path.startsWith("/share/")) return true;
  // Static assets needed by share page (no sensitive content)
  if (req.method === "GET" && /\.(css|js|ico|png|woff2?|ttf|svg)$/.test(path)) return true;
  return false;
}

function isBrowserPageRequest(req) {
  const accept = req.headers.accept || "";
  return req.method === "GET" && accept.includes("text/html");
}

function slugifyName(name) {
  const normalized = String(name || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized;
}

function isValidSlug(slug) {
  return /^[a-z0-9-]+$/.test(slug);
}

function unslug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function getSnapshotPath(slug) {
  return join(SNAPSHOT_DIR, `${slug}.json`);
}

// ─── Request body helper ──────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function json(res, status, data, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    ...headers,
  });
  res.end(JSON.stringify(data));
}

// ─── Action handlers ─────────────────────────────────────────────────────────
const ACTION_PROMPTS = {
  weather:        "Check the current weather in San Francisco and push a weather card to the dashboard feed, then push a canvas block with details.",
  "hn-top5":      "Fetch the top 5 Hacker News stories right now and display them as a canvas table with titles and links.",
  "server-status": "Check this VPS server status — uptime, memory, disk, load — and display it on the canvas.",
  surprise:       "Surprise Dustin with something interesting, creative, or fun on the canvas. Your choice.",
  memory:         "Summarize what you know about Dustin and your recent work together, and display it on the canvas.",
  goodnight:      "Dustin is heading to bed. Give him a thoughtful goodnight on the canvas — recap the day if you can.",
};

async function handleAction(id, res) {
  const prompt = ACTION_PROMPTS[id];
  if (!prompt) return json(res, 404, { error: "Unknown action" });
  if (!GW_TOKEN) return json(res, 503, { error: "Gateway not configured" });

  json(res, 200, { ok: true, result: "Working on it..." });

  // Notify via gateway
  const DASH_API = `Dashboard API: POST http://localhost:${PORT}/api/feed, /api/canvas/block, /api/canvas (PUT), DELETE /api/canvas. Auth: Bearer ${TOKEN}. Canvas block types: markdown, code{language,content,title}, chart{config}, table{headers,rows}, image{url,caption}, math{content,display}, mermaid{content}, collapsible{title,blocks}, iframe{url,height}, divider.`;

  const gwUrl = new URL("/v1/chat/completions", GW_URL);
  const body = JSON.stringify({
    model: "anthropic/claude-sonnet-4-6",
    messages: [
      { role: "system", content: `You are Cyan, an AI assistant. ${DASH_API}` },
      { role: "user", content: prompt },
    ],
  });

  const opts = {
    hostname: gwUrl.hostname,
    port: gwUrl.port || 80,
    path: gwUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GW_TOKEN}`,
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const req = httpRequest(opts, () => {});
  req.on("error", (e) => console.error("Gateway error:", e.message));
  req.write(body);
  req.end();
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const path = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": CORS_ORIGIN, "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE", "Access-Control-Allow-Headers": "Content-Type,Authorization" });
    return res.end();
  }

  // Public auth route: login page
  if (req.method === "GET" && path === "/auth/login") {
    if (isAuthed(req)) {
      res.writeHead(302, { Location: "/" });
      return res.end();
    }
    const loginPath = join(CLIENT_DIR, "login.html");
    if (existsSync(loginPath)) {
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
      return res.end(readFileSync(loginPath));
    }
    res.writeHead(500);
    return res.end("Missing login page");
  }

  // Public auth route: login API
  if (req.method === "POST" && path === "/auth/login") {
    const body = await readBody(req);
    const bodyJson = body.length ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : {};

    if (!bodyJson.password || bodyJson.password !== LUME_PASSWORD) {
      return json(res, 401, { ok: false, error: "Incorrect password" });
    }

    const sessionToken = crypto.randomBytes(32).toString("base64url");
    sessionTokens.add(sessionToken);
    const packed = encodeSession(sessionToken);

    const cookieHeader = cookie.serialize(SESSION_COOKIE, packed, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return json(res, 200, { ok: true, token: sessionToken }, { "Set-Cookie": cookieHeader });
  }

  // Public auth route: logout API (doesn't require auth)
  if (req.method === "POST" && path === "/auth/logout") {
    const sessionToken = getSessionTokenFromCookie(req);
    const bearer = getBearerToken(req);
    if (sessionToken) sessionTokens.delete(sessionToken);
    if (bearer && bearer !== TOKEN) sessionTokens.delete(bearer);

    const clearCookie = cookie.serialize(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 0,
    });

    return json(res, 200, { ok: true }, { "Set-Cookie": clearCookie });
  }

  // Global auth guard (protect existing routes; keep /share/* public)
  if (!isPublicRoute(req, path) && !isAuthed(req)) {
    if (path === "/" || isBrowserPageRequest(req)) {
      res.writeHead(302, { Location: "/auth/login" });
      return res.end();
    }
    return json(res, 401, { error: "Unauthorized" });
  }

  // ── /api/* requires auth ──
  if (path.startsWith("/api/")) {
    const clientIp = req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) return json(res, 429, { error: 'Rate limit exceeded' });

    const body = await readBody(req);
    const bodyJson = body.length ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : {};

    // Feed
    if (path === "/api/feed" && req.method === "GET") return json(res, 200, feed);
    if (path === "/api/feed" && req.method === "POST") {
      if (!bodyJson.title || typeof bodyJson.title !== 'string') return json(res, 400, { error: 'title is required' });
      const card = { ...bodyJson, timestamp: bodyJson.timestamp || new Date().toISOString() };
      const idx = card.id ? feed.findIndex(c => c.id === card.id) : -1;
      if (idx >= 0) feed[idx] = card; else feed.unshift(card);
      saveState("feed", feed);
      broadcast({ type: "feed_update", data: card });
      return json(res, 200, { ok: true });
    }
    if (path.startsWith("/api/feed/") && req.method === "DELETE") {
      const id = decodeURIComponent(path.slice(10));
      feed = feed.filter(c => c.id !== id);
      saveState("feed", feed);
      broadcast({ type: "feed_remove", data: { id } });
      return json(res, 200, { ok: true });
    }

    // Actions
    if (path === "/api/actions" && req.method === "GET") return json(res, 200, actions);
    if (path === "/api/actions" && req.method === "PUT") {
      actions = Array.isArray(bodyJson) ? bodyJson : [];
      saveState("actions", actions);
      broadcast({ type: "actions", data: actions });
      return json(res, 200, { ok: true });
    }

    // Action trigger
    if (path.startsWith("/api/action/") && req.method === "POST") {
      const id = decodeURIComponent(path.slice(12));
      return handleAction(id, res);
    }

    // Canvas
    if (path === "/api/canvas" && req.method === "GET") return json(res, 200, canvas || {});
    if (path === "/api/canvas" && req.method === "PUT") {
      canvas = bodyJson;
      saveState("canvas", canvas);
      broadcast({ type: "canvas", data: canvas });
      return json(res, 200, { ok: true });
    }
    if (path === "/api/canvas" && req.method === "DELETE") {
      canvas = null;
      saveState("canvas", null);
      broadcast({ type: "canvas_clear" });
      return json(res, 200, { ok: true });
    }
    if (path === "/api/canvas/block" && req.method === "POST") {
      if (!bodyJson.type || typeof bodyJson.type !== 'string') return json(res, 400, { error: 'type is required' });
      if (!canvas || canvas.type !== "blocks") canvas = { type: "blocks", blocks: [] };
      if (bodyJson.type === "blocks" && Array.isArray(bodyJson.blocks)) {
        canvas.blocks.push(...bodyJson.blocks);
      } else {
        canvas.blocks.push(bodyJson);
      }
      saveState("canvas", canvas);
      broadcast({ type: "canvas_append", data: bodyJson });
      return json(res, 200, { ok: true });
    }

    if (path === "/api/canvas/snapshot" && req.method === "POST") {
      const rawName = typeof bodyJson.name === "string" ? bodyJson.name.trim() : "";
      const slug = slugifyName(rawName);
      if (!slug || !isValidSlug(slug)) return json(res, 400, { error: "Valid name is required" });

      const snapshot = {
        name: rawName || unslug(slug),
        slug,
        savedAt: new Date().toISOString(),
        canvas: canvas || loadState("canvas", null),
      };

      writeFileSync(getSnapshotPath(slug), JSON.stringify(snapshot, null, 2));
      return json(res, 200, { ok: true, slug, shareUrl: `/share/${slug}` });
    }

    if (path === "/api/canvas/snapshots" && req.method === "GET") {
      const list = readdirSync(SNAPSHOT_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const slug = f.slice(0, -5);
          if (!isValidSlug(slug)) return null;
          const filePath = getSnapshotPath(slug);
          let parsed = null;
          try { parsed = JSON.parse(readFileSync(filePath, "utf8")); } catch {}
          const stat = statSync(filePath);
          const savedAt = parsed?.savedAt || stat.mtime.toISOString();
          const name = parsed?.name || unslug(slug);
          return { name, slug, shareUrl: `/share/${slug}`, savedAt };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

      return json(res, 200, list);
    }

    if (path.startsWith("/api/canvas/snapshots/") && req.method === "DELETE") {
      const slug = decodeURIComponent(path.slice("/api/canvas/snapshots/".length));
      if (!isValidSlug(slug)) return json(res, 400, { error: "Invalid slug" });

      const filePath = getSnapshotPath(slug);
      if (!existsSync(filePath)) return json(res, 404, { error: "Snapshot not found" });
      unlinkSync(filePath);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: "Not found" });
  }

  // ── /ws WebSocket upgrade ──
  if (path === "/ws") return;

  // ── Public snapshot share page ──
  if (req.method === "GET" && path.startsWith("/share/")) {
    const slug = decodeURIComponent(path.slice("/share/".length));
    if (!isValidSlug(slug)) {
      res.writeHead(404, { "Content-Type": "text/html" });
      return res.end('<!doctype html><html><body style="background:#000;color:#e0e0e0;font-family:system-ui;padding:24px"><h1 style="color:#00BCD4">Snapshot not found</h1><p>Invalid or missing share link.</p></body></html>');
    }

    const snapshotPath = getSnapshotPath(slug);
    if (!existsSync(snapshotPath)) {
      res.writeHead(404, { "Content-Type": "text/html" });
      return res.end('<!doctype html><html><body style="background:#000;color:#e0e0e0;font-family:system-ui;padding:24px"><h1 style="color:#00BCD4">Snapshot not found</h1><p>This shared canvas does not exist.</p></body></html>');
    }

    let snapshot;
    try {
      snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    } catch {
      res.writeHead(500, { "Content-Type": "text/html" });
      return res.end('<!doctype html><html><body style="background:#000;color:#e0e0e0;font-family:system-ui;padding:24px"><h1 style="color:#00BCD4">Snapshot unavailable</h1><p>This snapshot could not be loaded.</p></body></html>');
    }

    const payload = {
      name: snapshot?.name || unslug(slug),
      slug,
      savedAt: snapshot?.savedAt || null,
      canvas: Object.prototype.hasOwnProperty.call(snapshot || {}, "canvas") ? snapshot.canvas : snapshot,
    };

    const sharePath = join(CLIENT_DIR, "share.html");
    if (!existsSync(sharePath)) {
      res.writeHead(500);
      return res.end("Missing share page");
    }

    const html = readFileSync(sharePath, "utf8").replace(
      "__LUME_SHARE_DATA__",
      JSON.stringify(payload).replace(/</g, "\\u003c")
    );

    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
    return res.end(html);
  }

  // ── /config.js — exposes public config to client ──
  if (path === "/config.js") {
    const isHttps = req.headers["x-forwarded-proto"] === "https";
    const wsProto = isHttps ? "wss" : "ws";
    const wsHost  = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
    res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-cache" });
    return res.end(`window.CYAN_CONFIG = { wsUrl: "${wsProto}://${wsHost}/ws", token: "" };`);
  }

  // ── Static files (/lab/* and client files) ──
  let filePath;
  if (path.startsWith("/lab/")) {
    filePath = join(LAB_DIR, path.slice(5));
  } else {
    filePath = join(CLIENT_DIR, path === "/" ? "index.html" : path.split("?")[0]);
  }

  const ext = extname(filePath);
  if (existsSync(filePath) && MIME[ext]) {
    res.writeHead(200, { "Content-Type": MIME[ext], "Cache-Control": "no-cache" });
    return res.end(readFileSync(filePath));
  }

  res.writeHead(404);
  res.end("Not found");
});

// ── WebSocket upgrade ──
server.on("upgrade", (req, socket, head) => {
  const bearer = getBearerToken(req);
  const cookieToken = getSessionTokenFromCookie(req);
  const valid = bearer === TOKEN || (bearer && sessionTokens.has(bearer)) || (cookieToken && sessionTokens.has(cookieToken));
  if (!valid) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("\n  🔵 Lume");
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Gateway: ${GW_URL}`);
  console.log();
});


const $ = id => document.getElementById(id);
let ws = null;
let reconnectTimer = null;
let activeToast = null;
let activeToastTimer = null;

// --- State ---
let canvasData = null;
let currentSlug = null;
let mermaidCounter = 0;
let snapshotPollTimer = null;

// --- Init libs ---
if (typeof mermaid !== 'undefined') {
  mermaid.initialize({ startOnLoad: false, theme: 'dark', themeVariables: {
    primaryColor: '#00BCD4', primaryTextColor: '#e0e0e0', primaryBorderColor: '#1e1e1e',
    lineColor: '#444', secondaryColor: '#111', tertiaryColor: '#111',
    background: '#000', mainBkg: '#111', nodeBorder: '#1e1e1e'
  }});
}

// --- Clock ---
function updateClock() {
  $('clock').textContent = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'America/Los_Angeles'
  }) + ' PT';
}
updateClock();
setInterval(updateClock, 1000);

// --- WebSocket ---
function connectWS() {
  if (ws && ws.readyState <= 1) return;
  setStatus('connecting');
  try {
    const cfg = window.CYAN_CONFIG || {};
    const wsUrl = cfg.wsUrl || `ws://${location.host}/ws`;
    ws = new WebSocket(wsUrl);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    setStatus('connected');
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onmessage = (e) => {
    try {
      handleMessage(JSON.parse(e.data));
    } catch (err) {
      console.error('WS parse error:', err);
    }
  };

  ws.onclose = () => {
    setStatus('disconnected');
    scheduleReconnect();
  };

  ws.onerror = () => { ws.close(); };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWS();
  }, 3000);
}

function setStatus(state) {
  const badge = $('status');
  badge.textContent = state === 'connected' ? 'LIVE' :
                      state === 'connecting' ? 'CONNECTING' : 'OFFLINE';
  badge.className = 'badge ' + state;
}

// --- Message handler ---
function handleMessage(msg) {
  const data = msg.data;

  switch (msg.type) {
    // --- Toasts ---
    case 'toast_update':
      if (data) showToastCard(data);
      break;

    case 'toast_remove':
      if (data && data.id) removeToastCard(data.id);
      break;

    case 'toast_clear':
      clearToastCards();
      break;

    // --- Canvas ---
    case 'canvas':
      canvasData = data;
      renderCanvas();
      loadSnapshots();
      break;

    case 'canvas_append':
      appendCanvas(data);
      break;

    case 'canvas_clear':
      canvasData = null;
      renderCanvas();
      break;

    // --- Canvas slug ---
    case 'canvas_slug':
      currentSlug = data.slug;
      updateSlugUI(currentSlug);
      loadSnapshots();
      break;

    // --- Init ---
    case 'welcome':
    case 'init':
      const init = data || msg;
      if (init.toasts && Array.isArray(init.toasts)) {
        init.toasts.forEach(t => showToastCard(t));
      }
      if (init.canvas) { canvasData = init.canvas; renderCanvas(); }
      if (init.slug) { currentSlug = init.slug; updateSlugUI(currentSlug); }
      loadSnapshots();
      break;

    default:
      console.log('Unknown WS message:', msg.type);
  }
}

// --- Snapshot Browser ---
async function loadSnapshots() {
  try {
    const data = await apiFetch('/api/canvas/snapshots');
    if (Array.isArray(data)) renderSnapshots(data);
  } catch (e) {
    console.error('Failed to load snapshots:', e);
  }
}

function updateSlugUI(slug) {
  const el = document.getElementById('canvas-slug-label');
  if (!el) return;
  el.textContent = slug ? slug.replace(/-/g, ' ') : '';
}

function renderSnapshots(snapshots) {
  const container = $('history-list');
  const count = $('history-count');
  if (!snapshots || !snapshots.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div>No snapshots yet</div></div>';
    count.textContent = '0';
    return;
  }
  count.textContent = snapshots.length;
  container.innerHTML = snapshots.map(s => snapshotCardHTML(s)).join('');
}

function snapshotCardHTML(s) {
  const date = s.savedAt ? new Date(s.savedAt).toLocaleDateString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
  const expiry = expiryBadge(s.expiresAt, s.private);
  const isActive = s.slug === currentSlug;
  return `<div class="snapshot-card${isActive ? ' snapshot-card-active' : ''}">
    <div class="snapshot-card-top">
      <div class="snapshot-name snapshot-clickable" onclick="loadSnapshot('${escAttr(s.slug)}')">${esc(s.name)}</div>
      <div class="snapshot-kebab-wrap">
        <button class="snapshot-kebab" onclick="toggleSnapshotMenu(this)">⋮</button>
        <div class="snapshot-menu">
          <button onclick="shareSnapshot('${escAttr(s.slug)}', ${!!s.private});closeSnapshotMenus()">Share</button>
          ${!s.private ? `<button onclick="togglePrivacy('${escAttr(s.slug)}');closeSnapshotMenus()">Make Private</button>` : ''}
          <button onclick="pinSnapshot('${escAttr(s.slug)}');closeSnapshotMenus()">Pin</button>
          <button class="danger" onclick="deleteSnapshot('${escAttr(s.slug)}');closeSnapshotMenus()">Delete</button>
        </div>
      </div>
    </div>
    <div class="snapshot-meta">${date}${expiry}</div>
  </div>`;
}

function toggleSnapshotMenu(btn) {
  const menu = btn.nextElementSibling;
  const isOpen = menu.classList.contains('open');
  closeSnapshotMenus();
  if (!isOpen) menu.classList.add('open');
}

function closeSnapshotMenus() {
  document.querySelectorAll('.snapshot-menu.open').forEach(m => m.classList.remove('open'));
}

function expiryBadge(expiresAt, isPrivate) {
  const parts = [];
  if (!isPrivate) parts.push('<span class="expiry-badge shared">shared</span>');
  if (expiresAt === null) {
    parts.push('<span class="expiry-badge pinned">📌 pinned</span>');
  } else if (expiresAt) {
    const ms = new Date(expiresAt) - Date.now();
    if (ms < 0) parts.push('<span class="expiry-badge expired">Expired</span>');
    else {
      const days = Math.ceil(ms / 86400000);
      parts.push(`<span class="${days <= 3 ? 'expiry-badge soon' : 'expiry-badge'}">Expires in ${days}d</span>`);
    }
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

async function togglePrivacy(slug) {
  await apiFetch(`/api/canvas/snapshots/${slug}/privacy`, { method: 'POST' });
  loadSnapshots();
}
window.togglePrivacy = togglePrivacy;

async function loadSnapshot(slug) {
  try {
    const snap = await apiFetch(`/api/canvas/snapshots/${encodeURIComponent(slug)}`);
    if (!snap || !snap.canvas) return;
    await apiFetch('/api/canvas', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json', 'X-Canvas-Slug': slug},
      body: JSON.stringify(snap.canvas),
    });
    canvasData = snap.canvas;
    renderCanvas();
    currentSlug = slug;
    updateSlugUI(slug);
  } catch (e) {
    console.error('Failed to load snapshot:', e);
  }
}

async function deleteSnapshot(slug) {
  if (!confirm(`Delete snapshot "${slug}"?`)) return;
  try {
    await apiFetch(`/api/canvas/snapshots/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    loadSnapshots();
  } catch (e) {
    console.error('Failed to delete snapshot:', e);
  }
}

async function pinSnapshot(slug) {
  try {
    await apiFetch(`/api/canvas/snapshots/${encodeURIComponent(slug)}/pin`, { method: 'POST' });
    loadSnapshots();
  } catch (e) {
    console.error('Failed to pin snapshot:', e);
  }
}

function copyShareLink(slug) {
  const fullUrl = window.location.origin + `/share/${slug}`;
  const body = document.createElement('div');
  body.className = 'lume-toast-body';
  const msg = document.createElement('div');
  msg.className = 'lume-toast-message';
  msg.textContent = fullUrl;
  const copyBtn = document.createElement('button');
  copyBtn.className = 'lume-toast-copy';
  copyBtn.textContent = 'Copy';
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(fullUrl);
      } else {
        const tmp = document.createElement('input');
        tmp.value = fullUrl; document.body.appendChild(tmp);
        tmp.select(); document.execCommand('copy');
        document.body.removeChild(tmp);
      }
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1400);
    } catch { copyBtn.textContent = 'Copy failed'; }
  });
  body.appendChild(msg);
  body.appendChild(copyBtn);
  showToast(body, 'success', 6000);
}

async function shareSnapshot(slug, isPrivate) {
  if (isPrivate) {
    await apiFetch(`/api/canvas/snapshots/${slug}/privacy`, { method: 'POST' });
    await loadSnapshots();
  }
  copyShareLink(slug);
}

window.loadSnapshot = loadSnapshot;
window.deleteSnapshot = deleteSnapshot;
window.copyShareLink = copyShareLink;
window.shareSnapshot = shareSnapshot;
window.pinSnapshot = pinSnapshot;
window.toggleSnapshotMenu = toggleSnapshotMenu;
window.closeSnapshotMenus = closeSnapshotMenus;

// --- Toast Cards (WS-driven, bottom-right stack) ---
function showToastCard(toast) {
  const container = $('toast-container');
  if (!container) return;

  // Remove existing card with same id
  if (toast.id) {
    const existing = container.querySelector(`.lume-toast-card[data-id="${escAttr(toast.id)}"]`);
    if (existing) existing.remove();
  }

  const typeCls = toast.type ? ` card-${toast.type}` : '';
  const id = toast.id || ('t-' + Math.random().toString(36).slice(2, 8));
  const icon = toast.icon || '';

  const el = document.createElement('div');
  el.className = `lume-toast-card${typeCls}`;
  el.dataset.id = id;
  const ttlMs = (toast.ttl ? toast.ttl * 1000 : null) || 8000;

  el.innerHTML = `<div class="toast-top">
    <span class="toast-icon">${icon}</span>
    <span class="toast-title">${esc(toast.title || '')}</span>
    <button class="toast-dismiss" onclick="dismissToastCard('${escAttr(id)}')">×</button>
  </div>
  <div class="toast-body">${esc(toast.body || '')}</div>
  <div class="lume-toast-card-progress"></div>`;

  container.appendChild(el);

  // Start progress bar animation after element is in DOM
  requestAnimationFrame(() => {
    const bar = el.querySelector('.lume-toast-card-progress');
    if (bar) {
      bar.style.animationDuration = `${ttlMs}ms`;
      bar.classList.add('animating');
    }
  });

  setTimeout(() => removeToastCard(id), ttlMs);
}

function dismissToastCard(id) {
  removeToastCard(id);
}

function removeToastCard(id) {
  const container = $('toast-container');
  if (!container) return;
  const el = container.querySelector(`[data-id="${escAttr(id)}"]`);
  if (el) el.remove();
}

function clearToastCards() {
  const container = $('toast-container');
  if (container) container.innerHTML = '';
}

window.dismissToastCard = dismissToastCard;

function showActionResult(data) {
  // Legacy support stub — actions panel removed
  if (!data || !data.id) return;
  if (data.result && data.result.length > 50) {
    canvasData = { text: data.result };
    renderCanvas();
  }
}

// --- Canvas ---
let activeCharts = [];

function destroyCharts() {
  activeCharts.forEach(c => c.destroy());
  activeCharts = [];
}

function renderCanvas() {
  const container = $('canvas-content');
  destroyCharts();

  if (!canvasData) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔵</div><div>Canvas is empty</div><div class="empty-state-sub">Your AI will write here</div></div>';
    return;
  }

  // Multi-block mode
  if (canvasData.type === 'blocks' && Array.isArray(canvasData.blocks)) {
    container.innerHTML = canvasData.blocks.map(blockHTML).join('');
    initCanvasBlocks(container);
    return;
  }

  // Single content (backward compatible)
  const rendered = renderSingleBlock(canvasData);
  if (rendered) {
    container.innerHTML = rendered;
    initCanvasBlocks(container);
  } else {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9634;</div>Nothing here yet</div>';
  }
}

function appendCanvas(data) {
  if (!data) return;
  const container = $('canvas-content');
  const empty = container.querySelector('.empty-state');
  if (empty) container.innerHTML = '';

  // Append to canvasData state
  if (canvasData && canvasData.type === 'blocks') {
    if (data.type === 'blocks' && Array.isArray(data.blocks)) {
      canvasData.blocks.push(...data.blocks);
    } else {
      canvasData.blocks.push(data);
    }
  } else {
    canvasData = { type: 'blocks', blocks: [data] };
  }

  // Render the new block(s)
  const blocks = (data.type === 'blocks' && Array.isArray(data.blocks)) ? data.blocks : [data];
  const html = blocks.map(blockHTML).join('');
  container.insertAdjacentHTML('beforeend', html);
  initCanvasBlocks(container);
  container.scrollTop = container.scrollHeight;
}

function renderSingleBlock(block) {
  const content = block.content || '';
  const html = block.html || (block.type === 'html' ? content : '');
  const md = block.markdown || (block.type === 'markdown' ? content : '');
  const text = block.text || (block.type === 'text' ? content : '');

  if (html) return html;
  if (md) return renderMarkdown(md);
  if (text) return `<p>${esc(text)}</p>`;
  return '';
}

function blockHTML(block) {
  switch (block.type) {
    case 'markdown':
      return `<div class="canvas-block">${renderMarkdown(block.content || '')}</div>`;

    case 'code':
      const lang = block.language || '';
      const langLabel = lang ? `<span class="code-lang">${esc(lang)}</span>` : '';
      const codeId = 'code-' + Math.random().toString(36).slice(2, 8);
      const title = block.title ? `<div class="code-title">${esc(block.title)}</div>` : '';
      return `<div class="canvas-block canvas-code-block">
        ${title}
        <div class="code-header">${langLabel}<button class="code-copy" onclick="copyCode('${codeId}')">Copy</button></div>
        <pre><code id="${codeId}" class="language-${esc(lang)}">${esc(block.content || '')}</code></pre>
      </div>`;

    case 'chart':
      const chartId = 'chart-' + Math.random().toString(36).slice(2, 8);
      return `<div class="canvas-block canvas-chart-block">
        <div class="chart-wrapper">
          <button class="chart-expand-btn" onclick="expandChart('${chartId}')" title="Fullscreen">⛶</button>
          <canvas id="${chartId}" data-chart='${JSON.stringify(block.config || {})}'></canvas>
        </div>
      </div>`;

    case 'image':
      const caption = block.caption ? `<div class="image-caption">${esc(block.caption)}</div>` : '';
      return `<div class="canvas-block canvas-image-block">
        <img src="${escAttr(block.url || '')}" alt="${escAttr(block.caption || '')}" loading="lazy">
        ${caption}
      </div>`;

    case 'divider':
      return '<hr class="canvas-divider">';

    case 'table':
      if (!block.headers && !block.rows) return '';
      const ths = (block.headers || []).map(h => `<th>${esc(h)}</th>`).join('');
      const trs = (block.rows || []).map(row =>
        '<tr>' + row.map(cell => `<td>${esc(cell)}</td>`).join('') + '</tr>'
      ).join('');
      return `<div class="canvas-block canvas-table-block">
        <table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>
      </div>`;

    case 'math':
      const mathId = 'math-' + Math.random().toString(36).slice(2, 8);
      const mathCls = block.display !== false ? ' display' : '';
      return `<div class="canvas-block canvas-math-block${mathCls}" id="${mathId}" data-math="${escAttr(block.content || '')}" data-display="${block.display !== false}"></div>`;

    case 'mermaid':
      const mermaidId = 'mermaid-' + (mermaidCounter++);
      return `<div class="canvas-block canvas-mermaid-wrapper">
        <div class="canvas-mermaid-block" id="${mermaidId}" data-mermaid="${escAttr(block.content || '')}"></div>
        <button class="chart-expand-btn" onclick="expandMermaid('${mermaidId}')" title="Fullscreen">⛶</button>
      </div>`;

    case 'collapsible':
      const innerBlocks = (block.blocks || []).map(blockHTML).join('');
      return `<div class="canvas-block"><details class="canvas-collapsible">
        <summary>${esc(block.title || 'Details')}</summary>
        <div class="collapsible-body">${innerBlocks}</div>
      </details></div>`;

    case 'iframe':
      const h = block.height || 400;
      return `<div class="canvas-block canvas-iframe-block">
        <iframe src="${escAttr(block.url || '')}" style="height:${h}px" sandbox="allow-scripts allow-same-origin allow-popups" allowfullscreen loading="lazy"></iframe>
      </div>`;

    case 'html':
      return `<div class="canvas-block">${block.content || ''}</div>`;

    case 'text':
      return `<div class="canvas-block"><p>${esc(block.content || '')}</p></div>`;

    default:
      // Try as single content fallback
      const fallback = renderSingleBlock(block);
      return fallback ? `<div class="canvas-block">${fallback}</div>` : '';
  }
}

function initCanvasBlocks(container) {
  // Init Chart.js charts
  if (typeof Chart !== 'undefined') {
    container.querySelectorAll('canvas[data-chart]').forEach(el => {
      if (el._chartInit) return;
      el._chartInit = true;
      try {
        const config = JSON.parse(el.dataset.chart);
        config.options = config.options || {};
        config.options.responsive = true;
        config.options.maintainAspectRatio = false;
        // Apply dark theme defaults
        if (config.options) {
          config.options.plugins = config.options.plugins || {};
          config.options.plugins.legend = config.options.plugins.legend || {};
          config.options.plugins.legend.labels = { color: '#888' };
          config.options.scales = config.options.scales || {};
          for (const axis of ['x', 'y']) {
            config.options.scales[axis] = config.options.scales[axis] || {};
            config.options.scales[axis].ticks = { color: '#555' };
            config.options.scales[axis].grid = { color: '#1e1e1e' };
          }
        }
        const chart = new Chart(el, config);
        activeCharts.push(chart);
      } catch (e) {
        console.error('Chart init failed:', e);
      }
    });
  }

  // Init highlight.js
  if (typeof hljs !== 'undefined') {
    container.querySelectorAll('pre code[class*="language-"]').forEach(el => {
      if (el._hljsInit) return;
      el._hljsInit = true;
      hljs.highlightElement(el);
    });
  }

  // Init KaTeX
  if (typeof katex !== 'undefined') {
    container.querySelectorAll('[data-math]').forEach(el => {
      if (el._katexInit) return;
      el._katexInit = true;
      try {
        katex.render(el.dataset.math, el, {
          displayMode: el.dataset.display === 'true',
          throwOnError: false,
        });
      } catch (e) {
        el.textContent = el.dataset.math;
        console.error('KaTeX error:', e);
      }
    });
  }

  // Init Mermaid
  if (typeof mermaid !== 'undefined') {
    container.querySelectorAll('[data-mermaid]').forEach(el => {
      if (el._mermaidInit) return;
      el._mermaidInit = true;
      const id = el.id || 'mmd-' + Math.random().toString(36).slice(2, 8);
      mermaid.render(id + '-svg', el.dataset.mermaid).then(({ svg }) => {
        el.innerHTML = svg;
      }).catch(e => {
        el.innerHTML = `<pre style="color:var(--red);font-size:0.8em">${esc(e.message || 'Mermaid error')}</pre>`;
      });
    });
  }

  // Init collapsible nested blocks
  container.querySelectorAll('.collapsible-body').forEach(body => {
    if (body._nestedInit) return;
    body._nestedInit = true;
    initCanvasBlocks(body);
  });
}

function copyCode(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    const btn = el.closest('.canvas-code-block')?.querySelector('.code-copy');
    if (btn) {
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    }
  });
}

function expandChart(chartId) {
  const orig = document.getElementById(chartId);
  if (!orig) return;
  const config = JSON.parse(orig.dataset.chart || '{}');

  const overlay = document.createElement('div');
  overlay.className = 'chart-overlay';
  overlay.innerHTML = `<div class="chart-overlay-inner">
    <button class="chart-overlay-close" onclick="this.closest('.chart-overlay').remove()">✕</button>
    <canvas id="${chartId}-full"></canvas>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  if (typeof Chart !== 'undefined') {
    const fullCanvas = overlay.querySelector('canvas');
    // Apply same dark theme defaults as initCanvasBlocks
    if (config.options) {
      config.options.plugins = config.options.plugins || {};
      config.options.plugins.legend = config.options.plugins.legend || {};
      config.options.plugins.legend.labels = { color: '#888' };
      config.options.scales = config.options.scales || {};
      for (const axis of ['x', 'y']) {
        config.options.scales[axis] = config.options.scales[axis] || {};
        config.options.scales[axis].ticks = { color: '#555' };
        config.options.scales[axis].grid = { color: '#1e1e1e' };
      }
    }
    new Chart(fullCanvas, config);
  }
}

window.copyCode = copyCode;
window.expandChart = expandChart;

function expandMermaid(id) {
  const orig = document.getElementById(id);
  if (!orig) return;
  const svg = orig.querySelector('svg');
  if (!svg) return;

  const cloned = svg.cloneNode(true);
  cloned.removeAttribute('width');
  cloned.removeAttribute('height');
  cloned.style.display = 'block';
  cloned.style.width = '100%';
  cloned.style.height = 'auto';
  cloned.style.transformOrigin = '0 0';

  const overlay = document.createElement('div');
  overlay.className = 'chart-overlay mermaid-overlay';

  const modalBox = document.createElement('div');
  modalBox.className = 'mermaid-modal-box';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'chart-overlay-close';
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => overlay.remove();

  // Header row above zoomArea — no overlap with touch surface
  const header = document.createElement('div');
  header.className = 'mermaid-modal-header';
  header.appendChild(closeBtn);

  const zoomArea = document.createElement('div');
  zoomArea.className = 'mermaid-zoom-area';
  zoomArea.appendChild(cloned);

  const hint = document.createElement('div');
  hint.className = 'mermaid-modal-hint';
  hint.textContent = '1 finger pan · 2 finger zoom · 2× tap reset';

  modalBox.appendChild(header);
  modalBox.appendChild(zoomArea);
  modalBox.appendChild(hint);
  overlay.appendChild(modalBox);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });
  modalBox.addEventListener('click', e => e.stopPropagation());

  const state = {
    scale: 1,
    tx: 0,
    ty: 0,
    lastTouches: null,
    lastDist: null,
    lastMid: null,
    lastTap: 0,
  };

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  const getDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  const getMid = (t1, t2) => ({
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  });

  function applyTransform() {
    cloned.style.transform = `translate(${state.tx}px,${state.ty}px) scale(${state.scale})`;
  }

  function resetView() {
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    state.lastTouches = null;
    state.lastDist = null;
    state.lastMid = null;
    applyTransform();
  }

  applyTransform();

  zoomArea.addEventListener('touchstart', e => {
    e.preventDefault();

    const now = Date.now();
    if (e.touches.length === 1) {
      if (now - state.lastTap < 300) {
        resetView();
        state.lastTap = 0;
        return;
      }
      state.lastTap = now;
    }

    state.lastTouches = Array.from(e.touches).map(t => ({ clientX: t.clientX, clientY: t.clientY }));

    if (e.touches.length === 2) {
      state.lastDist = getDist(e.touches[0], e.touches[1]);
      state.lastMid = getMid(e.touches[0], e.touches[1]);
    }
  }, { passive: false });

  zoomArea.addEventListener('touchmove', e => {
    e.preventDefault();

    if (e.touches.length === 1) {
      const t = e.touches[0];
      const prev = state.lastTouches && state.lastTouches[0];
      if (prev) {
        state.tx += t.clientX - prev.clientX;
        state.ty += t.clientY - prev.clientY;
        applyTransform();
      }
      state.lastTouches = [{ clientX: t.clientX, clientY: t.clientY }];
      state.lastDist = null;
      state.lastMid = null;
      return;
    }

    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = getDist(t1, t2);
      const mid = getMid(t1, t2);

      if (state.lastDist && state.lastDist > 0) {
        const rawFactor = dist / state.lastDist;
        const nextScale = clamp(state.scale * rawFactor, 0.5, 8);
        const factor = nextScale / state.scale;

        state.tx = mid.x - (mid.x - state.tx) * factor;
        state.ty = mid.y - (mid.y - state.ty) * factor;
        state.scale = nextScale;
        applyTransform();
      }

      state.lastDist = dist;
      state.lastMid = mid;
      state.lastTouches = [
        { clientX: t1.clientX, clientY: t1.clientY },
        { clientX: t2.clientX, clientY: t2.clientY },
      ];
    }
  }, { passive: false });

  zoomArea.addEventListener('touchend', e => {
    e.preventDefault();

    state.lastTouches = Array.from(e.touches).map(t => ({ clientX: t.clientX, clientY: t.clientY }));
    if (e.touches.length < 2) {
      state.lastDist = null;
      state.lastMid = null;
    }
  }, { passive: false });
}
window.expandMermaid = expandMermaid;

// --- Markdown ---
if (typeof marked !== 'undefined') {
  marked.setOptions({ breaks: true, gfm: true });
}

function renderMarkdown(md) {
  if (typeof marked !== 'undefined') return marked.parse(md);
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '<br><br>');
}

// --- API helper ---
async function apiFetch(path, opts = {}) {
  const cfg = window.CYAN_CONFIG || {};
  const storedToken = localStorage.getItem('lume_token');
  const authToken = cfg.token || storedToken;

  opts.headers = opts.headers || {};
  if (authToken) opts.headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(path, opts);
  if (res.status === 401) {
    localStorage.removeItem('lume_token');
    window.location.replace('/auth/login');
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`API ${res.status}`);
  const ct = res.headers.get('content-type');
  if (ct && ct.includes('json')) return res.json();
  return res.text();
}

// --- Initial data load ---
async function loadInitial() {
  try {
    const canvas = await apiFetch('/api/canvas').catch(() => null);
    if (canvas && (canvas.type || canvas.blocks)) { canvasData = canvas; renderCanvas(); }
  } catch (e) {
    console.error('Initial load failed:', e);
  }
  loadSnapshots();
  // Poll snapshots every 30s
  if (snapshotPollTimer) clearInterval(snapshotPollTimer);
  snapshotPollTimer = setInterval(loadSnapshots, 30000);
}

// --- Utils ---
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// --- Live timestamp refresh ---
setInterval(() => {
  document.querySelectorAll('.feed-card-time[data-ts]').forEach(el => {
    el.textContent = timeAgo(new Date(el.dataset.ts));
  });
}, 30000);

function dismissToast() {
  if (!activeToast) return;
  const toast = activeToast;
  activeToast = null;
  if (activeToastTimer) {
    clearTimeout(activeToastTimer);
    activeToastTimer = null;
  }
  toast.classList.remove('show');
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 220);
}

function showToast(message, type = 'success', durationMs = 6000) {
  dismissToast();

  const toast = document.createElement('div');
  toast.className = `lume-toast ${type === 'error' ? 'error' : 'success'}`;

  if (typeof message === 'string') {
    const body = document.createElement('div');
    body.className = 'lume-toast-body';

    const msg = document.createElement('div');
    msg.className = 'lume-toast-message';
    msg.textContent = message;

    body.appendChild(msg);
    toast.appendChild(body);
  } else if (message instanceof HTMLElement) {
    toast.appendChild(message);
  }

  // Progress bar
  let progressEl = null;
  if (durationMs > 0) {
    progressEl = document.createElement('div');
    progressEl.className = 'lume-toast-progress';
    toast.appendChild(progressEl);
  }

  document.body.appendChild(toast);
  activeToast = toast;

  requestAnimationFrame(() => {
    if (activeToast === toast) toast.classList.add('show');
    if (progressEl) {
      progressEl.style.animationDuration = `${durationMs}ms`;
      progressEl.classList.add('animating');
    }
  });

  if (durationMs > 0) {
    activeToastTimer = setTimeout(() => {
      if (activeToast === toast) dismissToast();
    }, durationMs);
  }

  return toast;
}

async function shareCanvas() {
  if (!currentSlug) {
    showToast('No canvas identity — load a canvas from Snapshots first', 'error', 3000);
    return;
  }

  const fullUrl = `https://lume.cyanlab.ai/share/${currentSlug}`;
  const shareBtn = $('share-btn');

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(fullUrl);
    } else {
      const tmp = document.createElement('input');
      tmp.value = fullUrl; document.body.appendChild(tmp);
      tmp.select(); document.execCommand('copy');
      document.body.removeChild(tmp);
    }

    if (shareBtn) {
      const origHTML = shareBtn.innerHTML;
      shareBtn.textContent = 'Link copied!';
      setTimeout(() => { shareBtn.innerHTML = origHTML; }, 2000);
    }
  } catch (e) {
    console.error('Copy failed:', e);
    showToast('Copy failed', 'error', 2200);
  }
}
window.shareCanvas = shareCanvas;

// --- Panel collapse ---
function togglePanel(name) {
  const toggle = $(name + '-toggle');
  if (!toggle) return;

  if (name === 'feed') {
    const panel = document.querySelector('.panel-feed');
    const collapsed = !panel.classList.contains('panel-collapsed');
    panel.classList.toggle('panel-collapsed', collapsed);
    toggle.classList.toggle('collapsed', collapsed);
  }
}
window.togglePanel = togglePanel;

async function resetDashboard() {
  const btn = $('reset-btn');
  if (btn) btn.disabled = true;
  try {
    await apiFetch('/api/canvas', { method: 'DELETE' }).catch(() => null);
    canvasData = null;
    renderCanvas();
    clearToastCards();
  } catch (e) {
    console.error('Reset failed:', e);
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.resetDashboard = resetDashboard;


// Close snapshot menus on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.snapshot-kebab-wrap')) closeSnapshotMenus();
});

// --- Boot ---
loadInitial();
connectWS();

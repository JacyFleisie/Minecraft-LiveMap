/* ============================================================
   Minecraft LiveMap — Coordinate Reader Module
   ============================================================

   Reads coordinates from multiple sources for display on the map:

   1. Local file polling (file:// protocol)
   2. Manual coordinate input
   3. WebSocket live updates
   4. Trail recording with localStorage
   ============================================================ */

(function () {
    'use strict';

    // ── Configuration ─────────────────────────────────────────
    const CONFIG = {
        filePath: 'file:///C:/Users/USER-PC/livemap_coords.txt',
        pollInterval: 500,
        wsUrl: 'ws://localhost:9090',
        wsReconnectDelay: 3000,
        trailStorageKey: 'livemap_trail',
        maxTrailPoints: 500,
        dimensions: {
            overworld: { color: '#00e676', label: 'Overworld', keywords: ['overworld', 'minecraft:overworld', '0', 0] },
            nether:    { color: '#ff1744', label: 'Nether',    keywords: ['nether', 'minecraft:the_nether', 'the_nether', '-1', -1] },
            end:       { color: '#d500f9', label: 'End',       keywords: ['end', 'minecraft:the_end', 'the_end', '1', 1] },
        },
    };

    // ── Module State ──────────────────────────────────────────
    const state = {
        pollTimer: null,
        fileLastModified: 0,
        fileLastContent: '',
        ws: null,
        wsConnected: false,
        wsReconnectTimer: null,
        trailPoints: [],
        trailPolyline: null,
        trailLayer: null,
        manualMode: false,
        lastParsedPos: null,
    };

    // ── DOM References ────────────────────────────────────────
    let dom = {};

    function findOrCreateDom() {
        // Try to use existing elements from app.js first
        dom = {
            coordX: document.getElementById('coord-x'),
            coordY: document.getElementById('coord-y'),
            coordZ: document.getElementById('coord-z'),
            coordDim: document.getElementById('coord-dim'),
            coordYaw: document.getElementById('coord-yaw'),
            coordSpeed: document.getElementById('coord-speed'),
            wsStatus: document.getElementById('ws-status'),
            wsStatusLabel: document.querySelector('#ws-status .label'),
        };
    }

    // ── Dimension Detection ───────────────────────────────────
    function detectDimension(value) {
        if (value === undefined || value === null || value === '') return 'overworld';
        const str = String(value).toLowerCase().trim();
        for (const [key, dim] of Object.entries(CONFIG.dimensions)) {
            if (dim.keywords.some(k => String(k) === str)) return key;
        }
        return 'overworld';
    }

    function getDimensionColor(dimensionKey) {
        return CONFIG.dimensions[dimensionKey]?.color || '#888888';
    }

    function getDimensionLabel(dimensionKey) {
        return CONFIG.dimensions[dimensionKey]?.label || 'Unknown';
    }

    // ── Trail Recording ───────────────────────────────────────
    function loadTrailFromStorage() {
        try {
            const stored = localStorage.getItem(CONFIG.trailStorageKey);
            if (stored) {
                state.trailPoints = JSON.parse(stored);
                if (!Array.isArray(state.trailPoints)) state.trailPoints = [];
            }
        } catch (e) {
            console.warn('[coordReader] Failed to load trail from localStorage:', e);
            state.trailPoints = [];
        }
    }

    function saveTrailToStorage() {
        try {
            localStorage.setItem(CONFIG.trailStorageKey, JSON.stringify(state.trailPoints));
        } catch (e) {
            console.warn('[coordReader] Failed to save trail to localStorage:', e);
        }
    }

    function recordTrailPoint(x, z) {
        // Only record if position changed significantly
        const last = state.trailPoints[state.trailPoints.length - 1];
        if (last && Math.abs(last[0] - x) < 0.5 && Math.abs(last[1] - z) < 0.5) return;

        state.trailPoints.push([x, z]);
        if (state.trailPoints.length > CONFIG.maxTrailPoints) {
            state.trailPoints.shift();
        }
        saveTrailToStorage();
        renderTrail();
    }

    function clearTrail() {
        state.trailPoints = [];
        saveTrailToStorage();
        renderTrail();
        toast('Trail cleared', 'info');
    }

    function renderTrail() {
        if (!state.trailLayer || !window.map) return;

        state.trailLayer.clearLayers();
        if (state.trailPoints.length < 2) return;

        const poly = L.polyline(state.trailPoints, {
            color: '#f0a500',
            opacity: 0.6,
            weight: 2.5,
            lineCap: 'round',
            lineJoin: 'round',
        });
        poly.addTo(state.trailLayer);
        state.trailPolyline = poly;
    }

    // ── Coordinate Display ────────────────────────────────────
    function updateCoordDisplay(x, y, z, dimension) {
        const dimKey = detectDimension(dimension);
        const color = getDimensionColor(dimKey);
        const label = getDimensionLabel(dimKey);

        if (dom.coordX) dom.coordX.textContent = x.toFixed(2);
        if (dom.coordY) dom.coordY.textContent = y !== undefined ? y.toFixed(1) : '---';
        if (dom.coordZ) dom.coordZ.textContent = z.toFixed(2);
        if (dom.coordDim) {
            dom.coordDim.textContent = label;
            dom.coordDim.style.color = color;
            dom.coordDim.style.fontWeight = 'bold';
        }

        // Color-code X and Z based on dimension
        if (dom.coordX) dom.coordX.style.color = color;
        if (dom.coordZ) dom.coordZ.style.color = color;
        if (dom.coordY) dom.coordY.style.color = y < 0 || y > 256 ? '#ff1744' : color;
    }

    function copyCoordinatesToClipboard() {
        if (!state.lastParsedPos) {
            toast('No coordinates to copy', 'info');
            return;
        }
        const { x, y, z, dimension } = state.lastParsedPos;
        const dimKey = detectDimension(dimension);
        const label = getDimensionLabel(dimKey);
        const text = `${x.toFixed(2)}, ${y.toFixed(1)}, ${z.toFixed(2)} [${label}]`;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                toast('Copied: ' + text, 'success');
            }).catch(() => {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            toast('Copied: ' + text, 'success');
        } catch (e) {
            toast('Copy failed', 'error');
        }
        document.body.removeChild(ta);
    }

    // ── File Polling ──────────────────────────────────────────
    function pollLocalFile() {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', CONFIG.filePath, true);
        xhr.setRequestHeader('Cache-Control', 'no-cache');
        xhr.setRequestHeader('Pragma', 'no-cache');

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200 || xhr.status === 0) {
                    const content = xhr.responseText.trim();
                    if (content !== state.fileLastContent) {
                        state.fileLastContent = content;
                        const parsed = parseCoordinateString(content);
                        if (parsed) {
                            parsed.source = 'file';
                            applyPosition(parsed);
                        }
                    }
                }
            }
        };

        xhr.onerror = function () {
            // file:// protocol often blocked in WebView2; log silently
            console.debug('[coordReader] File poll error (CORS/file access blocked)');
        };

        try {
            xhr.send();
        } catch (e) {
            console.debug('[coordReader] File poll send failed:', e);
        }
    }

    function parseCoordinateString(str) {
        // Support formats:
        //   x,y,z
        //   x, y, z
        //   x,y,z,dimension
        //   {"x":85,"y":123,"z":-115}

        if (!str) return null;

        // Try JSON first
        if (str.startsWith('{')) {
            try {
                const obj = JSON.parse(str);
                return {
                    x: parseFloat(obj.x),
                    y: parseFloat(obj.y ?? 64),
                    z: parseFloat(obj.z),
                    dimension: obj.dimension,
                    yaw: parseFloat(obj.yaw ?? 0),
                    pitch: parseFloat(obj.pitch ?? 0),
                    speed: parseFloat(obj.speed ?? 0),
                };
            } catch (e) {
                // Fall through to CSV parsing
            }
        }

        // CSV parsing
        const parts = str.split(',').map(s => s.trim());
        if (parts.length >= 3) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            const z = parseFloat(parts[2]);
            if (isNaN(x) || isNaN(y) || isNaN(z)) return null;

            return {
                x: x,
                y: y,
                z: z,
                dimension: parts.length >= 4 ? parts[3] : undefined,
                yaw: parts.length >= 5 ? parseFloat(parts[4]) : 0,
                pitch: parts.length >= 6 ? parseFloat(parts[5]) : 0,
                speed: parts.length >= 7 ? parseFloat(parts[6]) : 0,
            };
        }
        return null;
    }

    function startFilePolling() {
        if (state.pollTimer) return;
        pollLocalFile(); // Initial read
        state.pollTimer = setInterval(pollLocalFile, CONFIG.pollInterval);
        console.log('[coordReader] Started file polling:', CONFIG.filePath);
    }

    function stopFilePolling() {
        if (state.pollTimer) {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
            console.log('[coordReader] Stopped file polling');
        }
    }

    // ── WebSocket ─────────────────────────────────────────────
    function connectWebSocket() {
        if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        try {
            state.ws = new WebSocket(CONFIG.wsUrl);

            state.ws.onopen = function () {
                state.wsConnected = true;
                updateConnectionStatus('Connected');
                console.log('[coordReader] WebSocket connected to', CONFIG.wsUrl);
                // Cancel any pending reconnect
                if (state.wsReconnectTimer) {
                    clearTimeout(state.wsReconnectTimer);
                    state.wsReconnectTimer = null;
                }
            };

            state.ws.onmessage = function (event) {
                try {
                    const data = JSON.parse(event.data);
                    const parsed = {
                        x: parseFloat(data.x),
                        y: parseFloat(data.y ?? 64),
                        z: parseFloat(data.z),
                        dimension: data.dimension,
                        yaw: parseFloat(data.yaw ?? 0),
                        pitch: parseFloat(data.pitch ?? 0),
                        speed: parseFloat(data.speed ?? 0),
                    };
                    if (isNaN(parsed.x) || isNaN(parsed.z)) return;
                    parsed.source = 'websocket';
                    applyPosition(parsed);
                } catch (e) {
                    console.warn('[coordReader] WebSocket message parse error:', e);
                }
            };

            state.ws.onclose = function () {
                state.wsConnected = false;
                updateConnectionStatus('Disconnected');
                scheduleReconnect();
            };

            state.ws.onerror = function (e) {
                console.debug('[coordReader] WebSocket error:', e);
                state.wsConnected = false;
                updateConnectionStatus('Error');
            };

        } catch (e) {
            console.error('[coordReader] WebSocket connect failed:', e);
            scheduleReconnect();
        }
    }

    function scheduleReconnect() {
        if (state.wsReconnectTimer) return;
        state.wsReconnectTimer = setTimeout(() => {
            state.wsReconnectTimer = null;
            if (!state.wsConnected) {
                connectWebSocket();
            }
        }, CONFIG.wsReconnectDelay);
    }

    function disconnectWebSocket() {
        if (state.wsReconnectTimer) {
            clearTimeout(state.wsReconnectTimer);
            state.wsReconnectTimer = null;
        }
        if (state.ws) {
            state.ws.onclose = null; // Prevent reconnect loop
            state.ws.close();
            state.ws = null;
        }
        state.wsConnected = false;
        updateConnectionStatus('Disconnected');
    }

    function updateConnectionStatus(status) {
        if (dom.wsStatus) {
            dom.wsStatus.classList.remove('connected', 'disconnected');
            dom.wsStatus.classList.add(status.toLowerCase());
        }
        if (dom.wsStatusLabel) {
            dom.wsStatusLabel.textContent = status;
        }
    }

    // ── Position Application ──────────────────────────────────
    function applyPosition(pos) {
        state.lastParsedPos = pos;

        // Update coordinate display
        updateCoordDisplay(pos.x, pos.y, pos.z, pos.dimension);

        // Update map marker if available
        if (typeof window.movePlayerMarker === 'function') {
            window.movePlayerMarker(pos.x, pos.z, pos.yaw || 0);
        } else if (window.playerMarker && window.map) {
            window.playerMarker.setLatLng([pos.x, pos.z]);
        }

        // Record trail point
        recordTrailPoint(pos.x, pos.z);

        // Update coordinate panel if function exists (from app.js)
        if (typeof window.updateCoordPanel === 'function') {
            window.updateCoordPanel(pos);
        }

        // Center map if follow mode
        if (typeof window.centerOnPlayer === 'function') {
            window.centerOnPlayer(pos.x, pos.z);
        }
    }

    // ── Manual Input ──────────────────────────────────────────
    function setupManualInput() {
        // Create the manual input UI panel
        const panel = document.createElement('div');
        panel.id = 'manual-input-panel';
        panel.innerHTML = `
            <div class="manual-header">
                <span class="manual-title">Coord Input</span>
                <button class="manual-copy-btn" id="btn-copy-coords" title="Copy coordinates">📋</button>
            </div>
            <div class="manual-input-row">
                <div class="manual-field">
                    <label for="input-x">X</label>
                    <input type="number" id="input-x" step="0.01" placeholder="0.00">
                </div>
                <div class="manual-field">
                    <label for="input-y">Y</label>
                    <input type="number" id="input-y" step="0.1" min="0" max="256" placeholder="64.0">
                </div>
                <div class="manual-field">
                    <label for="input-z">Z</label>
                    <input type="number" id="input-z" step="0.01" placeholder="0.00">
                </div>
                <div class="manual-field manual-field-dim">
                    <label for="input-dim">Dim</label>
                    <select id="input-dim">
                        <option value="overworld">Overworld</option>
                        <option value="nether">Nether</option>
                        <option value="end">End</option>
                    </select>
                </div>
            </div>
            <div class="manual-actions">
                <button class="manual-btn teleport-btn" id="btn-teleport">Teleport</button>
                <button class="manual-btn clear-btn" id="btn-clear-trail">Clear Trail</button>
            </div>
            <div class="manual-validation" id="manual-validation"></div>
        `;

        // Insert after coord panel or as a floating panel
        const coordPanel = document.getElementById('coord-panel');
        if (coordPanel && coordPanel.parentNode) {
            coordPanel.parentNode.insertBefore(panel, coordPanel.nextSibling);
        } else {
            document.body.appendChild(panel);
        }

        // Add styles
        addManualInputStyles();

        // Bind events
        const btnTeleport = document.getElementById('btn-teleport');
        const btnClearTrail = document.getElementById('btn-clear-trail');
        const btnCopy = document.getElementById('btn-copy-coords');
        const inputY = document.getElementById('input-y');

        btnTeleport.addEventListener('click', handleTeleport);
        btnClearTrail.addEventListener('click', clearTrail);
        btnCopy.addEventListener('click', copyCoordinatesToClipboard);

        // Allow Enter key to teleport
        ['input-x', 'input-y', 'input-z'].forEach(id => {
            document.getElementById(id).addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleTeleport();
            });
        });

        // Y validation feedback
        inputY.addEventListener('input', () => {
            const val = parseFloat(inputY.value);
            const validation = document.getElementById('manual-validation');
            if (!isNaN(val) && (val < 0 || val > 256)) {
                validation.textContent = '⚠ Y must be 0-256';
                validation.className = 'manual-validation show error';
                inputY.style.borderColor = '#ff1744';
            } else {
                validation.className = 'manual-validation';
                inputY.style.borderColor = '';
            }
        });
    }

    function handleTeleport() {
        const xVal = document.getElementById('input-x').value;
        const yVal = document.getElementById('input-y').value;
        const zVal = document.getElementById('input-z').value;
        const dimVal = document.getElementById('input-dim').value;

        const x = parseFloat(xVal);
        const y = parseFloat(yVal);
        const z = parseFloat(zVal);

        // Validation
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            showValidation('X, Y, and Z are required', 'error');
            return;
        }
        if (y < 0 || y > 256) {
            showValidation('Y must be between 0 and 256', 'error');
            return;
        }

        const pos = {
            x: x,
            y: y,
            z: z,
            dimension: dimVal,
            yaw: 0,
            source: 'manual',
        };

        applyPosition(pos);
        showValidation(`Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`, 'success');
        toast(`Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`, 'success');
    }

    function showValidation(message, type) {
        const el = document.getElementById('manual-validation');
        if (!el) return;
        el.textContent = message;
        el.className = 'manual-validation show ' + type;
        setTimeout(() => {
            el.className = 'manual-validation';
        }, 3000);
    }

    function addManualInputStyles() {
        if (document.getElementById('coordReader-styles')) return;

        const style = document.createElement('style');
        style.id = 'coordReader-styles';
        style.textContent = `
            #manual-input-panel {
                position: fixed;
                top: 320px;
                right: 16px;
                background: rgba(20, 20, 30, 0.92);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 10px;
                padding: 14px 16px;
                min-width: 280px;
                z-index: 1000;
                font-family: 'Segoe UI', system-ui, sans-serif;
                backdrop-filter: blur(8px);
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            }

            .manual-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }

            .manual-title {
                font-size: 12px;
                font-weight: 600;
                color: #aaa;
                text-transform: uppercase;
                letter-spacing: 0.8px;
            }

            .manual-copy-btn {
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                padding: 4px 8px;
                cursor: pointer;
                font-size: 14px;
                transition: background 0.15s;
            }

            .manual-copy-btn:hover {
                background: rgba(255, 255, 255, 0.12);
            }

            .manual-input-row {
                display: flex;
                gap: 8px;
                margin-bottom: 10px;
            }

            .manual-field {
                flex: 1;
                min-width: 0;
            }

            .manual-field label {
                display: block;
                font-size: 10px;
                color: #888;
                margin-bottom: 3px;
                font-weight: 600;
            }

            .manual-field input,
            .manual-field select {
                width: 100%;
                padding: 6px 8px;
                background: rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: #e0e0e0;
                font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
                font-size: 13px;
                outline: none;
                transition: border-color 0.15s;
                box-sizing: border-box;
            }

            .manual-field input:focus,
            .manual-field select:focus {
                border-color: #4a9eff;
            }

            .manual-field input::placeholder {
                color: #555;
            }

            .manual-field-dim {
                flex: 0.7;
            }

            .manual-actions {
                display: flex;
                gap: 8px;
            }

            .manual-btn {
                flex: 1;
                padding: 7px 12px;
                border: none;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .teleport-btn {
                background: linear-gradient(135deg, #4a9eff, #0066cc);
                color: white;
            }

            .teleport-btn:hover {
                background: linear-gradient(135deg, #5aa8ff, #0077ee);
                transform: translateY(-1px);
            }

            .clear-btn {
                background: rgba(255, 255, 255, 0.06);
                color: #ccc;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }

            .clear-btn:hover {
                background: rgba(255, 23, 68, 0.15);
                border-color: #ff1744;
                color: #ff1744;
            }

            .manual-validation {
                font-size: 11px;
                margin-top: 8px;
                min-height: 16px;
                opacity: 0;
                transition: opacity 0.2s;
            }

            .manual-validation.show {
                opacity: 1;
            }

            .manual-validation.error {
                color: #ff1744;
            }

            .manual-validation.success {
                color: #00e676;
            }

            /* Large coordinate display overrides */
            .coord-value {
                font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace !important;
                font-size: 14px !important;
                font-weight: 600 !important;
            }

            .coord-value.live {
                font-size: 16px !important;
            }

            /* Status indicators for sources */
            .source-indicator {
                font-size: 9px;
                padding: 2px 6px;
                border-radius: 3px;
                font-weight: 600;
                margin-left: 6px;
            }

            .source-file { background: rgba(74, 158, 255, 0.2); color: #4a9eff; }
            .source-ws { background: rgba(0, 230, 118, 0.2); color: #00e676; }
            .source-manual { background: rgba(213, 0, 249, 0.2); color: #d500f9; }
        `;
        document.head.appendChild(style);
    }

    // ── Toast Helper ──────────────────────────────────────────
    function toast(message, type = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:6px;align-items:center;';
            document.body.appendChild(container);
        }

        const el = document.createElement('div');
        el.className = 'toast ' + type;
        el.textContent = message;
        el.style.cssText = `padding:8px 16px;border-radius:6px;font-size:13px;font-family:system-ui;animation:fadeInUp 0.2s ease;${type === 'success' ? 'background:rgba(0,230,118,0.2);color:#00e676;border:1px solid rgba(0,230,118,0.3);' : type === 'error' ? 'background:rgba(255,23,68,0.2);color:#ff1744;border:1px solid rgba(255,23,68,0.3);' : 'background:rgba(74,158,255,0.2);color:#4a9eff;border:1px solid rgba(74,158,255,0.3);'}`;

        container.appendChild(el);
        setTimeout(() => {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 3000);
    }

    // ── Public API ────────────────────────────────────────────
    window.CoordReader = {
        start: function () {
            startFilePolling();
            connectWebSocket();
        },
        stop: function () {
            stopFilePolling();
            disconnectWebSocket();
        },
        pollOnce: pollLocalFile,
        teleport: function (x, y, z, dimension) {
            applyPosition({ x, y, z, dimension, yaw: 0, source: 'manual' });
        },
        clearTrail: clearTrail,
        copyCoords: copyCoordinatesToClipboard,
        getStatus: function () {
            return {
                polling: !!state.pollTimer,
                wsConnected: state.wsConnected,
                trailPoints: state.trailPoints.length,
                lastPos: state.lastParsedPos,
            };
        },
        parseCoordinateString: parseCoordinateString,
        loadTrailFromStorage: loadTrailFromStorage,
    };

    // ── Initialization ────────────────────────────────────────
    function init() {
        findOrCreateDom();

        // Initialize trail layer from app.js or create our own
        if (typeof L !== 'undefined') {
            if (typeof trailLayer !== 'undefined') {
                state.trailLayer = trailLayer;
            } else {
                state.trailLayer = L.layerGroup();
                if (typeof map !== 'undefined') {
                    state.trailLayer.addTo(map);
                }
            }
        }

        // Load trail from storage
        loadTrailFromStorage();

        // Setup UI
        setupManualInput();

        // Start sources
        startFilePolling();
        connectWebSocket();

        // Render existing trail
        setTimeout(renderTrail, 500);

        console.log('[coordReader] Initialized');
    }

    // Wait for DOM and Leaflet
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // If app.js already initialized, init immediately
        if (typeof map !== 'undefined' && map) {
            init();
        } else {
            document.addEventListener('DOMContentLoaded', init);
        }
    }
})();

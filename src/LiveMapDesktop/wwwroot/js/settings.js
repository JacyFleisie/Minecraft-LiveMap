/* ============================================================
   Minecraft LiveMap — Settings & Customization Panel
   ============================================================
   Provides theme, map, player marker, performance,
   and export controls with localStorage persistence.

   Exports: window.SettingsPanel
   Listens for: (none - fully standalone)
   Dispatches: 'settingChanged' custom events for app.js
   ============================================================ */

(function () {
    'use strict';

    // ── Default Settings ─────────────────────────────────────
    const DEFAULTS = {
        // Theme
        theme: 'dark',
        customPrimary: '#1a1a2e',
        customSecondary: '#232342',
        customAccent: '#f0a500',
        glassIntensity: 16,

        // Map
        tileLayer: 'carto-dark',
        customTileUrl: '',
        gridLines: true,
        gridInterval: 1000,
        coordLabels: true,
        biomeLabels: true,
        terrain3D: false,

        // Player Marker
        markerIcon: 'arrow',
        markerColor: '#f0a500',
        markerSize: 36,
        directionArrow: true,
        trailLength: 100,
        trailColor: '#f0a500',
        trailOpacity: 0.7,

        // Performance
        renderDistance: 10000,
        animations: true,
        fpsLimit: 60,
    };

    // ── State ────────────────────────────────────────────────
    let settings = {};
    let panelEl = null;

    // ── Tile Layer Presets ───────────────────────────────────
    const TILE_LAYERS = {
        'carto-dark': {
            name: 'CartoDB Dark',
            url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            subdomains: 'abcd',
            attribution: '&copy; OSM &copy; CARTO',
        },
        'carto-light': {
            name: 'CartoDB Light',
            url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
            subdomains: 'abcd',
            attribution: '&copy; OSM &copy; CARTO',
        },
        'osm': {
            name: 'OpenStreetMap',
            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            subdomains: '',
            attribution: '&copy; OSM',
        },
        'custom': {
            name: 'Custom',
            url: '',
            subdomains: 'abcd',
            attribution: '',
        },
    };

    // ── Theme Presets ────────────────────────────────────────
    const THEMES = {
        dark: {
            '--bg-charcoal': '#1a1a2e',
            '--bg-charcoal-light': '#232342',
            '--bg-panel': 'rgba(26, 26, 46, 0.75)',
            '--gold': '#f0a500',
            '--gold-dark': '#c48500',
            '--gold-light': '#ffc540',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#a0a0b8',
            '--text-dim': '#6a6a80',
            '--border-glass': 'rgba(240, 165, 0, 0.2)',
            '--glow-gold': '0 0 15px rgba(240, 165, 0, 0.4)',
            '--glow-gold-strong': '0 0 25px rgba(240, 165, 0, 0.6)',
        },
        light: {
            '--bg-charcoal': '#f0f0f5',
            '--bg-charcoal-light': '#ffffff',
            '--bg-panel': 'rgba(255, 255, 255, 0.85)',
            '--gold': '#d48800',
            '--gold-dark': '#a36900',
            '--gold-light': '#e6a800',
            '--text-primary': '#1a1a2e',
            '--text-secondary': '#4a4a60',
            '--text-dim': '#888899',
            '--border-glass': 'rgba(180, 130, 0, 0.25)',
            '--glow-gold': '0 0 15px rgba(212, 136, 0, 0.2)',
            '--glow-gold-strong': '0 0 25px rgba(212, 136, 0, 0.3)',
        },
        amoled: {
            '--bg-charcoal': '#000000',
            '--bg-charcoal-light': '#0a0a0a',
            '--bg-panel': 'rgba(0, 0, 0, 0.9)',
            '--gold': '#f0a500',
            '--gold-dark': '#c48500',
            '--gold-light': '#ffc540',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#a0a0a0',
            '--text-dim': '#555555',
            '--border-glass': 'rgba(240, 165, 0, 0.15)',
            '--glow-gold': '0 0 15px rgba(240, 165, 0, 0.3)',
            '--glow-gold-strong': '0 0 25px rgba(240, 165, 0, 0.4)',
        },
    };

    // ── Persistence ──────────────────────────────────────────
    const STORAGE_KEY = 'livemap_settings';

    function loadSettings() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                settings = { ...DEFAULTS, ...JSON.parse(stored) };
                return;
            }
        } catch (e) { /* ignore */ }
        settings = { ...DEFAULTS };
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (e) { /* ignore */ }
    }

    function resetSettings() {
        settings = { ...DEFAULTS };
        saveSettings();
        applyAllSettings();
        if (panelEl) renderPanel();
    }

    // ── Event Dispatching ────────────────────────────────────
    function emitSetting(key, value) {
        try {
            window.dispatchEvent(new CustomEvent('settingChanged', {
                detail: { key, value, settings: { ...settings } },
            }));
        } catch (e) { /* ignore */ }
    }

    // ── Theme Application ────────────────────────────────────
    function applyTheme() {
        const root = document.documentElement;

        if (settings.theme === 'custom') {
            root.style.setProperty('--bg-charcoal', settings.customPrimary);
            root.style.setProperty('--bg-charcoal-light', settings.customSecondary);
            root.style.setProperty('--gold', settings.customAccent);
            root.style.setProperty('--gold-dark', settings.customAccent);
            root.style.setProperty('--gold-light', settings.customAccent);
        } else if (THEMES[settings.theme]) {
            const t = THEMES[settings.theme];
            for (const [k, v] of Object.entries(t)) {
                root.style.setProperty(k, v);
            }
        }

        // Glassmorphism intensity
        document.querySelectorAll('.glass-panel').forEach(el => {
            el.style.backdropFilter = `blur(${settings.glassIntensity}px) saturate(180%)`;
            el.style.webkitBackdropFilter = `blur(${settings.glassIntensity}px) saturate(180%)`;
        });

        // AMOLED special handling
        if (settings.theme === 'amoled') {
            document.body.style.backgroundColor = '#000000';
            const mapEl = document.getElementById('map');
            if (mapEl) mapEl.style.background = '#000000';
            document.querySelectorAll('.leaflet-container').forEach(el => {
                el.style.background = '#000000';
            });
        }
    }

    // ── Grid Lines ────────────────────────────────────────────
    let gridLayer = null;

    function applyGridLines() {
        if (typeof L === 'undefined' || typeof map === 'undefined') return;

        if (gridLayer) {
            map.removeLayer(gridLayer);
            gridLayer = null;
        }

        if (!settings.gridLines) return;

        gridLayer = L.layerGroup();
        const interval = settings.gridInterval;
        const halfSize = settings.renderDistance / 2;

        for (let x = -halfSize; x <= halfSize; x += interval) {
            const isMajor = x % (interval * 5) === 0;
            L.polyline(
                [[-halfSize, x], [halfSize, x]],
                {
                    color: '#ffffff',
                    weight: isMajor ? 1 : 0.5,
                    opacity: isMajor ? 0.3 : 0.15,
                    interactive: false,
                }
            ).addTo(gridLayer);
        }

        for (let z = -halfSize; z <= halfSize; z += interval) {
            const isMajor = z % (interval * 5) === 0;
            L.polyline(
                [[z, -halfSize], [z, halfSize]],
                {
                    color: '#ffffff',
                    weight: isMajor ? 1 : 0.5,
                    opacity: isMajor ? 0.3 : 0.15,
                    interactive: false,
                }
            ).addTo(gridLayer);
        }

        if (settings.coordLabels) {
            for (let x = -halfSize; x <= halfSize; x += interval * 5) {
                for (let z = -halfSize; z <= halfSize; z += interval * 5) {
                    if (x === 0 && z === 0) continue;
                    L.marker([z, x], {
                        icon: L.divIcon({
                            className: 'coord-label',
                            html: `<span style="font-size:8px;color:rgba(255,255,255,0.4);font-family:monospace;">${x},${z}</span>`,
                            iconSize: [50, 10],
                            iconAnchor: [25, 5],
                        }),
                        interactive: false,
                    }).addTo(gridLayer);
                }
            }
        }

        gridLayer.addTo(map);
    }

    // ── Player Marker ─────────────────────────────────────────
    function updatePlayerMarkerAppearance() {
        // Update existing marker in the DOM
        const markerContainer = document.querySelector('.player-marker-container');
        if (!markerContainer) return;

        const { markerIcon, markerColor, markerSize, directionArrow } = settings;

        // Update container size
        markerContainer.style.width = markerSize + 'px';
        markerContainer.style.height = markerSize + 'px';

        // Update pulse
        const pulse = markerContainer.querySelector('.player-pulse');
        if (pulse) {
            pulse.style.width = (markerSize * 0.8) + 'px';
            pulse.style.height = (markerSize * 0.8) + 'px';
        }

        // Update dot
        const dot = markerContainer.querySelector('.player-dot');
        if (dot) {
            dot.style.width = (markerSize * 0.4) + 'px';
            dot.style.height = (markerSize * 0.4) + 'px';
            dot.style.background = markerColor;
            dot.style.borderColor = markerColor;
            dot.style.boxShadow = `0 0 ${markerSize * 0.3}px ${markerColor}cc`;
        }

        // Update arrow
        const arrow = markerContainer.querySelector('.player-arrow');
        if (arrow) {
            if (directionArrow) {
                arrow.style.display = '';
                arrow.style.borderLeftWidth = (markerSize * 0.15) + 'px';
                arrow.style.borderRightWidth = (markerSize * 0.15) + 'px';
                arrow.style.borderBottomWidth = (markerSize * 0.3) + 'px';
                arrow.style.borderBottomColor = markerColor;
                arrow.style.filter = `drop-shadow(0 0 3px ${markerColor}88)`;
            } else {
                arrow.style.display = 'none';
            }
        }
    }

    // ── Trail ─────────────────────────────────────────────────
    function applyTrailStyle() {
        document.documentElement.style.setProperty('--trail-color', settings.trailColor);
        document.documentElement.style.setProperty('--trail-opacity', settings.trailOpacity);

        // Update any visible trail polylines via CSS
        document.querySelectorAll('.trail-segment').forEach(el => {
            if (el.setStyle) {
                el.setStyle({
                    color: settings.trailColor,
                    opacity: settings.trailOpacity,
                });
            }
        });
    }

    // ── Master Apply ──────────────────────────────────────────
    function applyAllSettings() {
        loadSettings();
        applyTheme();
        applyGridLines();
        updatePlayerMarkerAppearance();
        applyTrailStyle();
    }

    // ── Screenshot ────────────────────────────────────────────
    function screenshotMap() {
        const mapEl = document.getElementById('map');
        if (!mapEl) {
            toast('Map not found', 'error');
            return;
        }

        try {
            const tiles = mapEl.querySelectorAll('.leaflet-tile');
            const canvas = document.createElement('canvas');
            const size = mapEl.getBoundingClientRect();
            canvas.width = size.width;
            canvas.height = size.height;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#1a1a2e';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            tiles.forEach(tile => {
                const rect = tile.getBoundingClientRect();
                const mapRect = mapEl.getBoundingClientRect();
                const x = rect.left - mapRect.left;
                const y = rect.top - mapRect.top;
                if (tile instanceof HTMLImageElement && tile.src && tile.complete && tile.naturalWidth > 0) {
                    try {
                        ctx.drawImage(tile, x, y, rect.width, rect.height);
                    } catch (e) { /* CORS */ }
                }
            });

            canvas.toBlob(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `livemap_screenshot_${Date.now()}.png`;
                a.click();
                URL.revokeObjectURL(url);
                toast('Screenshot saved!', 'success');
            }, 'image/png');

        } catch (e) {
            console.error('Screenshot failed:', e);
            toast('Screenshot failed: ' + e.message, 'error');
        }
    }

    // ── Export Waypoints ──────────────────────────────────────
    function exportWaypoints() {
        let waypoints = [];

        // Collect from app.js markers if available
        if (typeof markers !== 'undefined' && Array.isArray(markers)) {
            markers.forEach(m => {
                if (m.getLatLng) {
                    const ll = m.getLatLng();
                    waypoints.push({ x: Math.round(ll.lng), z: Math.round(ll.lat), type: 'marker' });
                }
            });
        }

        if (waypoints.length === 0) {
            toast('No waypoints to export. Click the map to add markers first.', 'info');
            return;
        }

        const blob = new Blob([JSON.stringify(waypoints, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `livemap_waypoints_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast(`Exported ${waypoints.length} waypoints`, 'success');
    }

    // ── Export Seed Data ──────────────────────────────────────
    function exportSeedData() {
        let seed = 'unknown';
        const seedEl = document.getElementById('current-seed');
        if (seedEl && seedEl.textContent) {
            seed = seedEl.textContent.trim();
        }

        const data = {
            seed: seed,
            exportedAt: new Date().toISOString(),
            settings: { ...settings },
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `livemap_seed_${seed}_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Seed data exported!', 'success');
    }

    // ── Toast Helper ──────────────────────────────────────────
    function toast(message, type) {
        type = type || 'info';
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:6px;align-items:center;';
            document.body.appendChild(container);
        }

        const el = document.createElement('div');
        el.textContent = message;
        const colors = {
            success: 'background:rgba(0,230,118,0.2);color:#00e676;border:1px solid rgba(0,230,118,0.3);',
            error: 'background:rgba(255,23,68,0.2);color:#ff1744;border:1px solid rgba(255,23,68,0.3);',
            info: 'background:rgba(74,158,255,0.2);color:#4a9eff;border:1px solid rgba(74,158,255,0.3);',
        };
        el.style.cssText = `padding:8px 16px;border-radius:6px;font-size:13px;font-family:system-ui;animation:fadeInUp 0.2s ease;${colors[type] || colors.info}`;
        container.appendChild(el);
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3000);
    }

    // ── Settings Panel UI ─────────────────────────────────────
    function renderPanel() {
        if (!panelEl) return;

        panelEl.innerHTML = `
            <div class="settings-header">
                <span class="settings-title">⚙ Settings</span>
                <div class="settings-header-actions">
                    <button class="settings-btn-icon" id="btn-save-settings" title="Save to localStorage">💾</button>
                    <button class="settings-btn-icon" id="btn-reset-settings" title="Reset to defaults">↺</button>
                    <button class="settings-btn-icon" id="btn-close-settings" title="Close">✕</button>
                </div>
            </div>

            <div class="settings-scroll">
                <!-- THEME -->
                <details class="settings-section" open>
                    <summary>🎨 Theme</summary>
                    <div class="settings-body">
                        <div class="setting-row">
                            <label>Mode</label>
                            <select id="set-theme">
                                <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Dark (Default)</option>
                                <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Light</option>
                                <option value="amoled" ${settings.theme === 'amoled' ? 'selected' : ''}>AMOLED Black</option>
                                <option value="custom" ${settings.theme === 'custom' ? 'selected' : ''}>Custom Colors</option>
                            </select>
                        </div>
                        <div class="setting-row custom-colors" style="${settings.theme === 'custom' ? '' : 'display:none;'}">
                            <label>Primary</label>
                            <input type="color" id="set-primary" value="${settings.customPrimary}">
                        </div>
                        <div class="setting-row custom-colors" style="${settings.theme === 'custom' ? '' : 'display:none;'}">
                            <label>Secondary</label>
                            <input type="color" id="set-secondary" value="${settings.customSecondary}">
                        </div>
                        <div class="setting-row custom-colors" style="${settings.theme === 'custom' ? '' : 'display:none;'}">
                            <label>Accent</label>
                            <input type="color" id="set-accent" value="${settings.customAccent}">
                        </div>
                        <div class="setting-row">
                            <label>Glass Blur: <span id="val-glass">${settings.glassIntensity}px</span></label>
                            <input type="range" id="set-glass" min="0" max="32" value="${settings.glassIntensity}">
                        </div>
                    </div>
                </details>

                <!-- MAP -->
                <details class="settings-section">
                    <summary>🗺 Map</summary>
                    <div class="settings-body">
                        <div class="setting-row">
                            <label>Tile Layer</label>
                            <select id="set-tilelayer">
                                <option value="carto-dark" ${settings.tileLayer === 'carto-dark' ? 'selected' : ''}>CartoDB Dark</option>
                                <option value="carto-light" ${settings.tileLayer === 'carto-light' ? 'selected' : ''}>CartoDB Light</option>
                                <option value="osm" ${settings.tileLayer === 'osm' ? 'selected' : ''}>OpenStreetMap</option>
                                <option value="custom" ${settings.tileLayer === 'custom' ? 'selected' : ''}>Custom URL</option>
                            </select>
                        </div>
                        <div class="setting-row custom-tile" style="${settings.tileLayer === 'custom' ? '' : 'display:none;'}">
                            <label>Tile URL</label>
                            <input type="text" id="set-tileurl" value="${settings.customTileUrl}" placeholder="https://...">
                        </div>
                        <div class="setting-row">
                            <label>Grid Lines</label>
                            <label class="toggle-label">
                                <input type="checkbox" id="set-grid" ${settings.gridLines ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="setting-row">
                            <label>Grid Interval</label>
                            <select id="set-grid-interval">
                                <option value="100" ${settings.gridInterval === 100 ? 'selected' : ''}>100 blocks</option>
                                <option value="500" ${settings.gridInterval === 500 ? 'selected' : ''}>500 blocks</option>
                                <option value="1000" ${settings.gridInterval === 1000 ? 'selected' : ''}>1000 blocks</option>
                                <option value="5000" ${settings.gridInterval === 5000 ? 'selected' : ''}>5000 blocks</option>
                            </select>
                        </div>
                        <div class="setting-row">
                            <label>Coordinate Labels</label>
                            <label class="toggle-label">
                                <input type="checkbox" id="set-coordlabels" ${settings.coordLabels ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="setting-row">
                            <label>Biome Labels</label>
                            <label class="toggle-label">
                                <input type="checkbox" id="set-biomelabels" ${settings.biomeLabels ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="setting-row">
                            <label>3D Terrain View</label>
                            <label class="toggle-label">
                                <input type="checkbox" id="set-terrain3d" ${settings.terrain3D ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </details>

                <!-- PLAYER MARKER -->
                <details class="settings-section">
                    <summary>📍 Player Marker</summary>
                    <div class="settings-body">
                        <div class="setting-row">
                            <label>Icon Style</label>
                            <select id="set-markericon">
                                <option value="arrow" ${settings.markerIcon === 'arrow' ? 'selected' : ''}>Arrow</option>
                                <option value="circle" ${settings.markerIcon === 'circle' ? 'selected' : ''}>Circle</option>
                                <option value="head" ${settings.markerIcon === 'head' ? 'selected' : ''}>Player Head</option>
                            </select>
                        </div>
                        <div class="setting-row">
                            <label>Color</label>
                            <input type="color" id="set-markercolor" value="${settings.markerColor}">
                        </div>
                        <div class="setting-row">
                            <label>Size: <span id="val-markersize">${settings.markerSize}px</span></label>
                            <input type="range" id="set-markersize" min="20" max="60" value="${settings.markerSize}">
                        </div>
                        <div class="setting-row">
                            <label>Direction Arrow</label>
                            <label class="toggle-label">
                                <input type="checkbox" id="set-directionarrow" ${settings.directionArrow ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="setting-row">
                            <label>Trail Length: <span id="val-traillength">${settings.trailLength}</span></label>
                            <input type="range" id="set-traillength" min="10" max="500" step="10" value="${settings.trailLength}">
                        </div>
                        <div class="setting-row">
                            <label>Trail Color</label>
                            <input type="color" id="set-trailcolor" value="${settings.trailColor}">
                        </div>
                        <div class="setting-row">
                            <label>Trail Opacity: <span id="val-trailopacity">${Math.round(settings.trailOpacity * 100)}%</span></label>
                            <input type="range" id="set-trailopacity" min="10" max="100" value="${Math.round(settings.trailOpacity * 100)}">
                        </div>
                    </div>
                </details>

                <!-- PERFORMANCE -->
                <details class="settings-section">
                    <summary>⚡ Performance</summary>
                    <div class="settings-body">
                        <div class="setting-row">
                            <label>Render Distance: <span id="val-render">${settings.renderDistance}</span></label>
                            <input type="range" id="set-renderdistance" min="2000" max="30000" step="1000" value="${settings.renderDistance}">
                        </div>
                        <div class="setting-row">
                            <label>Animations</label>
                            <label class="toggle-label">
                                <input type="checkbox" id="set-animations" ${settings.animations ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="setting-row">
                            <label>FPS Limit</label>
                            <select id="set-fpslimit">
                                <option value="30" ${settings.fpsLimit === 30 ? 'selected' : ''}>30 FPS</option>
                                <option value="60" ${settings.fpsLimit === 60 ? 'selected' : ''}>60 FPS</option>
                                <option value="120" ${settings.fpsLimit === 120 ? 'selected' : ''}>120 FPS</option>
                                <option value="0" ${settings.fpsLimit === 0 ? 'selected' : ''}>Unlimited</option>
                            </select>
                        </div>
                    </div>
                </details>

                <!-- EXPORT -->
                <details class="settings-section">
                    <summary>📤 Export / Save</summary>
                    <div class="settings-body">
                        <div class="export-buttons">
                            <button class="settings-action-btn" id="btn-screenshot">📸 Screenshot (PNG)</button>
                            <button class="settings-action-btn" id="btn-export-waypoints">📍 Export Waypoints</button>
                            <button class="settings-action-btn" id="btn-export-seed">🌱 Export Seed Data</button>
                            <button class="settings-action-btn" id="btn-save-local">💾 Save Settings</button>
                            <button class="settings-action-btn btn-danger" id="btn-reset-all">↺ Reset All Settings</button>
                        </div>
                    </div>
                </details>
            </div>
        `;

        bindPanelEvents();
    }

    function bindPanelEvents() {
        if (!panelEl) return;

        // Close
        const closeBtn = panelEl.querySelector('#btn-close-settings');
        if (closeBtn) closeBtn.addEventListener('click', () => panelEl.classList.remove('open'));

        // Save
        const saveBtn = panelEl.querySelector('#btn-save-settings');
        if (saveBtn) saveBtn.addEventListener('click', () => { saveSettings(); toast('Settings saved!', 'success'); });

        // Reset
        const resetBtn = panelEl.querySelector('#btn-reset-settings');
        if (resetBtn) resetBtn.addEventListener('click', () => { resetSettings(); toast('Settings reset to defaults', 'info'); });

        // Theme
        const themeSelect = panelEl.querySelector('#set-theme');
        if (themeSelect) {
            themeSelect.addEventListener('change', (e) => {
                settings.theme = e.target.value;
                panelEl.querySelectorAll('.custom-colors').forEach(el => {
                    el.style.display = e.target.value === 'custom' ? '' : 'none';
                });
                applyTheme();
                saveSettings();
                emitSetting('theme', settings.theme);
            });
        }

        const primaryInput = panelEl.querySelector('#set-primary');
        if (primaryInput) {
            primaryInput.addEventListener('input', (e) => {
                settings.customPrimary = e.target.value;
                if (settings.theme === 'custom') applyTheme();
                saveSettings();
            });
        }

        const secondaryInput = panelEl.querySelector('#set-secondary');
        if (secondaryInput) {
            secondaryInput.addEventListener('input', (e) => {
                settings.customSecondary = e.target.value;
                if (settings.theme === 'custom') applyTheme();
                saveSettings();
            });
        }

        const accentInput = panelEl.querySelector('#set-accent');
        if (accentInput) {
            accentInput.addEventListener('input', (e) => {
                settings.customAccent = e.target.value;
                if (settings.theme === 'custom') applyTheme();
                saveSettings();
            });
        }

        // Glass blur
        const glassInput = panelEl.querySelector('#set-glass');
        if (glassInput) {
            glassInput.addEventListener('input', (e) => {
                settings.glassIntensity = parseInt(e.target.value);
                const valEl = panelEl.querySelector('#val-glass');
                if (valEl) valEl.textContent = settings.glassIntensity + 'px';
                applyTheme();
                saveSettings();
            });
        }

        // Tile layer
        const tileLayerSelect = panelEl.querySelector('#set-tilelayer');
        if (tileLayerSelect) {
            tileLayerSelect.addEventListener('change', (e) => {
                settings.tileLayer = e.target.value;
                const customTileRow = panelEl.querySelector('.custom-tile');
                if (customTileRow) customTileRow.style.display = e.target.value === 'custom' ? '' : 'none';
                emitSetting('tileLayer', settings.tileLayer);
                saveSettings();
            });
        }

        const tileUrlInput = panelEl.querySelector('#set-tileurl');
        if (tileUrlInput) {
            tileUrlInput.addEventListener('change', (e) => {
                settings.customTileUrl = e.target.value;
                emitSetting('customTileUrl', settings.customTileUrl);
                saveSettings();
            });
        }

        // Grid
        const gridCheckbox = panelEl.querySelector('#set-grid');
        if (gridCheckbox) {
            gridCheckbox.addEventListener('change', (e) => {
                settings.gridLines = e.target.checked;
                applyGridLines();
                saveSettings();
                emitSetting('gridLines', settings.gridLines);
            });
        }

        const gridIntervalSelect = panelEl.querySelector('#set-grid-interval');
        if (gridIntervalSelect) {
            gridIntervalSelect.addEventListener('change', (e) => {
                settings.gridInterval = parseInt(e.target.value);
                applyGridLines();
                saveSettings();
                emitSetting('gridInterval', settings.gridInterval);
            });
        }

        const coordLabelsCheckbox = panelEl.querySelector('#set-coordlabels');
        if (coordLabelsCheckbox) {
            coordLabelsCheckbox.addEventListener('change', (e) => {
                settings.coordLabels = e.target.checked;
                applyGridLines();
                saveSettings();
                emitSetting('coordLabels', settings.coordLabels);
            });
        }

        const biomeLabelsCheckbox = panelEl.querySelector('#set-biomelabels');
        if (biomeLabelsCheckbox) {
            biomeLabelsCheckbox.addEventListener('change', (e) => {
                settings.biomeLabels = e.target.checked;
                saveSettings();
                emitSetting('biomeLabels', settings.biomeLabels);
            });
        }

        const terrain3dCheckbox = panelEl.querySelector('#set-terrain3d');
        if (terrain3dCheckbox) {
            terrain3dCheckbox.addEventListener('change', (e) => {
                settings.terrain3D = e.target.checked;
                if (settings.terrain3D) {
                    toast('3D Terrain: Enable height-based shading', 'info');
                }
                saveSettings();
                emitSetting('terrain3D', settings.terrain3D);
            });
        }

        // Player marker
        const markerIconSelect = panelEl.querySelector('#set-markericon');
        if (markerIconSelect) {
            markerIconSelect.addEventListener('change', (e) => {
                settings.markerIcon = e.target.value;
                updatePlayerMarkerAppearance();
                saveSettings();
                emitSetting('markerIcon', settings.markerIcon);
            });
        }

        const markerColorInput = panelEl.querySelector('#set-markercolor');
        if (markerColorInput) {
            markerColorInput.addEventListener('input', (e) => {
                settings.markerColor = e.target.value;
                updatePlayerMarkerAppearance();
                saveSettings();
                emitSetting('markerColor', settings.markerColor);
            });
        }

        const markerSizeInput = panelEl.querySelector('#set-markersize');
        if (markerSizeInput) {
            markerSizeInput.addEventListener('input', (e) => {
                settings.markerSize = parseInt(e.target.value);
                const valEl = panelEl.querySelector('#val-markersize');
                if (valEl) valEl.textContent = settings.markerSize + 'px';
                updatePlayerMarkerAppearance();
                saveSettings();
                emitSetting('markerSize', settings.markerSize);
            });
        }

        const directionArrowCheckbox = panelEl.querySelector('#set-directionarrow');
        if (directionArrowCheckbox) {
            directionArrowCheckbox.addEventListener('change', (e) => {
                settings.directionArrow = e.target.checked;
                updatePlayerMarkerAppearance();
                saveSettings();
                emitSetting('directionArrow', settings.directionArrow);
            });
        }

        // Trail
        const trailLengthInput = panelEl.querySelector('#set-traillength');
        if (trailLengthInput) {
            trailLengthInput.addEventListener('input', (e) => {
                settings.trailLength = parseInt(e.target.value);
                const valEl = panelEl.querySelector('#val-traillength');
                if (valEl) valEl.textContent = settings.trailLength;
                emitSetting('trailLength', settings.trailLength);
                saveSettings();
            });
        }

        const trailColorInput = panelEl.querySelector('#set-trailcolor');
        if (trailColorInput) {
            trailColorInput.addEventListener('input', (e) => {
                settings.trailColor = e.target.value;
                applyTrailStyle();
                saveSettings();
                emitSetting('trailColor', settings.trailColor);
            });
        }

        const trailOpacityInput = panelEl.querySelector('#set-trailopacity');
        if (trailOpacityInput) {
            trailOpacityInput.addEventListener('input', (e) => {
                settings.trailOpacity = parseInt(e.target.value) / 100;
                const valEl = panelEl.querySelector('#val-trailopacity');
                if (valEl) valEl.textContent = e.target.value + '%';
                applyTrailStyle();
                saveSettings();
                emitSetting('trailOpacity', settings.trailOpacity);
            });
        }

        // Performance
        const renderDistanceInput = panelEl.querySelector('#set-renderdistance');
        if (renderDistanceInput) {
            renderDistanceInput.addEventListener('input', (e) => {
                settings.renderDistance = parseInt(e.target.value);
                const valEl = panelEl.querySelector('#val-render');
                if (valEl) valEl.textContent = settings.renderDistance;
                emitSetting('renderDistance', settings.renderDistance);
                saveSettings();
            });
        }

        const animationsCheckbox = panelEl.querySelector('#set-animations');
        if (animationsCheckbox) {
            animationsCheckbox.addEventListener('change', (e) => {
                settings.animations = e.target.checked;
                saveSettings();
                emitSetting('animations', settings.animations);
            });
        }

        const fpsLimitSelect = panelEl.querySelector('#set-fpslimit');
        if (fpsLimitSelect) {
            fpsLimitSelect.addEventListener('change', (e) => {
                settings.fpsLimit = parseInt(e.target.value);
                emitSetting('fpsLimit', settings.fpsLimit);
                saveSettings();
            });
        }

        // Export buttons
        const screenshotBtn = panelEl.querySelector('#btn-screenshot');
        if (screenshotBtn) screenshotBtn.addEventListener('click', screenshotMap);

        const exportWaypointsBtn = panelEl.querySelector('#btn-export-waypoints');
        if (exportWaypointsBtn) exportWaypointsBtn.addEventListener('click', exportWaypoints);

        const exportSeedBtn = panelEl.querySelector('#btn-export-seed');
        if (exportSeedBtn) exportSeedBtn.addEventListener('click', exportSeedData);

        const saveLocalBtn = panelEl.querySelector('#btn-save-local');
        if (saveLocalBtn) saveLocalBtn.addEventListener('click', () => { saveSettings(); toast('Settings saved!', 'success'); });

        const resetAllBtn = panelEl.querySelector('#btn-reset-all');
        if (resetAllBtn) resetAllBtn.addEventListener('click', () => { resetSettings(); toast('All settings reset', 'info'); });
    }

    // ── Create Settings Button ────────────────────────────────
    function createSettingsButton() {
        const btn = document.createElement('button');
        btn.id = 'settings-toggle-btn';
        btn.className = 'settings-toggle-btn';
        btn.innerHTML = '⚙';
        btn.title = 'Settings (S)';
        document.body.appendChild(btn);

        btn.addEventListener('click', () => {
            if (panelEl) panelEl.classList.toggle('open');
        });
    }

    // ── Create Settings Panel ─────────────────────────────────
    function createSettingsPanel() {
        panelEl = document.createElement('div');
        panelEl.id = 'settings-panel';
        panelEl.className = 'settings-panel glass-panel';
        document.body.appendChild(panelEl);
        renderPanel();
    }

    // ── Inject Styles ─────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('settings-panel-styles')) return;

        const style = document.createElement('style');
        style.id = 'settings-panel-styles';
        style.textContent = `
            /* Settings Toggle Button */
            .settings-toggle-btn {
                position: fixed;
                top: 16px;
                right: 16px;
                z-index: 1001;
                width: 40px;
                height: 40px;
                border-radius: 10px;
                border: 1px solid var(--border-glass);
                background: var(--bg-panel);
                backdrop-filter: blur(16px) saturate(180%);
                -webkit-backdrop-filter: blur(16px) saturate(180%);
                color: var(--gold);
                font-size: 18px;
                cursor: pointer;
                transition: all var(--transition-smooth);
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            }
            .settings-toggle-btn:hover {
                background: rgba(240, 165, 0, 0.15);
                box-shadow: 0 0 15px rgba(240, 165, 0, 0.3);
                transform: rotate(30deg);
            }

            /* Settings Panel */
            .settings-panel {
                position: fixed;
                top: 12px;
                right: 12px;
                width: 340px;
                max-height: calc(100vh - 24px);
                overflow: hidden;
                z-index: 1002;
                background: var(--bg-panel);
                border: 1px solid var(--border-glass);
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(16px) saturate(180%);
                -webkit-backdrop-filter: blur(16px) saturate(180%);
                transform: translateX(360px);
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                display: flex;
                flex-direction: column;
            }
            .settings-panel.open {
                transform: translateX(0);
            }

            .settings-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                flex-shrink: 0;
            }
            .settings-title {
                font-size: 13px;
                font-weight: 700;
                color: var(--gold);
                text-transform: uppercase;
                letter-spacing: 1.2px;
            }
            .settings-header-actions {
                display: flex;
                gap: 4px;
            }
            .settings-btn-icon {
                width: 28px;
                height: 28px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                background: rgba(255, 255, 255, 0.04);
                color: var(--text-secondary);
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.15s;
            }
            .settings-btn-icon:hover {
                background: rgba(240, 165, 0, 0.15);
                border-color: var(--gold);
                color: var(--gold);
            }

            .settings-scroll {
                overflow-y: auto;
                flex: 1;
                padding: 4px 0;
            }

            /* Accordion sections */
            .settings-section {
                border-bottom: 1px solid rgba(255, 255, 255, 0.04);
            }
            .settings-section summary {
                padding: 10px 16px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
                color: var(--text-secondary);
                text-transform: uppercase;
                letter-spacing: 0.8px;
                user-select: none;
                list-style: none;
                transition: color 0.15s;
            }
            .settings-section summary:hover {
                color: var(--gold);
            }
            .settings-section summary::-webkit-details-marker {
                display: none;
            }
            .settings-section summary::before {
                content: '▶';
                display: inline-block;
                margin-right: 8px;
                font-size: 8px;
                transition: transform 0.2s;
            }
            .settings-section[open] summary::before {
                transform: rotate(90deg);
            }

            .settings-body {
                padding: 0 16px 12px;
            }

            /* Setting rows */
            .setting-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 8px;
            }
            .setting-row label {
                font-size: 11px;
                color: var(--text-secondary);
                flex-shrink: 0;
                min-width: 90px;
            }
            .setting-row input[type="range"] {
                flex: 1;
                height: 4px;
                -webkit-appearance: none;
                appearance: none;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 2px;
                outline: none;
            }
            .setting-row input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 14px;
                height: 14px;
                background: var(--gold);
                border-radius: 50%;
                cursor: pointer;
                box-shadow: 0 0 8px rgba(240, 165, 0, 0.4);
            }
            .setting-row select,
            .setting-row input[type="text"] {
                flex: 1;
                padding: 6px 10px;
                background: rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: var(--text-primary);
                font-size: 12px;
                outline: none;
                font-family: inherit;
            }
            .setting-row select:focus,
            .setting-row input[type="text"]:focus {
                border-color: var(--gold);
            }
            .setting-row input[type="color"] {
                width: 36px;
                height: 28px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                cursor: pointer;
                background: none;
                padding: 2px;
            }
            .setting-row span {
                color: var(--gold-light);
                font-weight: 600;
                font-size: 11px;
                min-width: 40px;
                text-align: right;
            }

            /* Export buttons */
            .export-buttons {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .settings-action-btn {
                padding: 8px 14px;
                background: rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                color: var(--text-primary);
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                text-align: left;
                transition: all 0.15s;
            }
            .settings-action-btn:hover {
                background: rgba(240, 165, 0, 0.1);
                border-color: var(--gold);
                color: var(--gold);
            }
            .settings-action-btn.btn-danger:hover {
                background: rgba(255, 23, 68, 0.1);
                border-color: #ff1744;
                color: #ff1744;
            }

            /* Toggle override for settings panel */
            .setting-row .toggle-label {
                margin: 0;
                min-width: auto;
            }

            /* Responsive */
            @media (max-width: 768px) {
                .settings-panel {
                    width: 300px;
                    right: 8px;
                    top: 8px;
                }
            }
            @media (max-width: 480px) {
                .settings-panel {
                    width: calc(100vw - 16px);
                    transform: translateX(110%);
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ── Keyboard Shortcut ─────────────────────────────────────
    function initKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                if (panelEl) panelEl.classList.toggle('open');
            }
        });
    }

    // ── Public API ────────────────────────────────────────────
    window.SettingsPanel = {
        open: function () {
            if (panelEl) panelEl.classList.add('open');
        },
        close: function () {
            if (panelEl) panelEl.classList.remove('open');
        },
        toggle: function () {
            if (panelEl) panelEl.classList.toggle('open');
        },
        getSettings: function () {
            return { ...settings };
        },
        getSetting: function (key) {
            return settings[key];
        },
        setSetting: function (key, value) {
            if (key in DEFAULTS) {
                settings[key] = value;
                saveSettings();
                applyAllSettings();
                if (panelEl) renderPanel();
            }
        },
        applyAll: applyAllSettings,
        save: saveSettings,
        reset: resetSettings,
    };

    // ── Initialization ───────────────────────────────────────
    function init() {
        loadSettings();
        injectStyles();

        // Wait a bit for the map and DOM to be ready
        function waitForReady() {
            const mapEl = document.getElementById('map');
            if (!mapEl || mapEl.offsetHeight === 0) {
                setTimeout(waitForReady, 200);
                return;
            }

            createSettingsButton();
            createSettingsPanel();
            applyAllSettings();
            initKeyboard();

            console.log('[SettingsPanel] Initialized');
        }

        setTimeout(waitForReady, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

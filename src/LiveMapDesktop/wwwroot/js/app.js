/**
 * Minecraft Live Map - Frontend Application
 * Uses Leaflet.js with CRS.Simple for Minecraft coordinate system.
 */

(function () {
    'use strict';

    // ────────────────────────────────────────────
    // Configuration
    // ────────────────────────────────────────────
    const CONFIG = {
        TILE_SIZE: 256,
        MAX_TRAIL_POINTS: 100,
        WAITING_TIMEOUT_MS: 3000,
        WS_URL: 'ws://localhost:5000/ws',
        DEFAULT_SPEED: 5,
        MIN_ZOOM: -2,
        MAX_ZOOM: 6,
    };

    // ────────────────────────────────────────────
    // State
    // ────────────────────────────────────────────
    const state = {
        seed: null,
        player: { x: 0, y: 64, z: 0, yaw: 0, biome: 'Plains' },
        trail: [],
        followMode: true,
        trailVisible: true,
        map: null,
        playerMarker: null,
        trailPolyline: null,
        structureMarkers: [],
        ws: null,
        wsConnected: false,
        lastDataTime: null,
        waitingTimer: null,
        speed: CONFIG.DEFAULT_SPEED,
        biomes: new Map(),
        structures: [],
        pathIndex: 0,
    };

    // ────────────────────────────────────────────
    // Deterministic Random (seeded)
    // ────────────────────────────────────────────
    class SeededRandom {
        constructor(seed) {
            this.seed = typeof seed === 'string'
                ? this.hashString(seed)
                : (seed | 0);
            this.state = this.seed;
        }

        hashString(str) {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash |= 0;
            }
            return Math.abs(hash);
        }

        next() {
            this.state = (this.state * 1664525 + 1013904223) | 0;
            return ((this.state >>> 0) / 4294967296);
        }

        nextInt(min, max) {
            return Math.floor(this.next() * (max - min + 1)) + min;
        }
    }

    // ────────────────────────────────────────────
    // Biome & Terrain Generation
    // ────────────────────────────────────────────
    const BIOMES = [
        { name: 'Plains', color: '#7ec850', temp: 0.5 },
        { name: 'Forest', color: '#3b7a20', temp: 0.6 },
        { name: 'Desert', color: '#e8d568', temp: 0.9 },
        { name: 'Taiga', color: '#5a8a4a', temp: 0.2 },
        { name: 'Ocean', color: '#2a5a8a', temp: 0.4 },
        { name: 'Swamp', color: '#4a6a3a', temp: 0.7 },
        { name: 'Jungle', color: '#2d8a2d', temp: 0.85 },
        { name: 'Savanna', color: '#c4a44a', temp: 0.75 },
        { name: 'Snowy Tundra', color: '#e0e8f0', temp: 0.0 },
        { name: 'Mountains', color: '#8a8a8a', temp: 0.3 },
        { name: 'Mushroom Island', color: '#a040a0', temp: 0.55 },
        { name: 'River', color: '#3a6a9a', temp: 0.4 },
    ];

    function getBiomeAt(x, z, seed) {
        const rng = new SeededRandom(`${seed}:${Math.floor(x / 200)}:${Math.floor(z / 200)}`);
        const idx = rng.nextInt(0, BIOMES.length - 1);
        return BIOMES[idx];
    }

    function generateStructures(seed) {
        const rng = new SeededRandom(`${seed}:structures`);
        const structures = [];

        // Villages
        for (let i = 0; i < rng.nextInt(2, 8); i++) {
            structures.push({
                type: 'village',
                icon: '🏠',
                x: rng.nextInt(-500, 500),
                z: rng.nextInt(-500, 500),
            });
        }

        // Temples
        for (let i = 0; i < rng.nextInt(1, 4); i++) {
            structures.push({
                type: 'temple',
                icon: '🏛️',
                x: rng.nextInt(-800, 800),
                z: rng.nextInt(-800, 800),
            });
        }

        // World Spawn
        structures.push({
            type: 'spawn',
            icon: '⭐',
            x: rng.nextInt(-50, 50),
            z: rng.nextInt(-50, 50),
        });

        return structures;
    }

    // ────────────────────────────────────────────
    // Path Generation (smooth wander)
    // ────────────────────────────────────────────
    function generatePath(seed, count) {
        const rng = new SeededRandom(`${seed}:path`);
        const points = [];
        let x = 0, z = 0;
        let angle = rng.next() * Math.PI * 2;

        for (let i = 0; i < count; i++) {
            angle += (rng.next() - 0.5) * 0.5;
            x += Math.cos(angle) * (2 + rng.next() * 4);
            z += Math.sin(angle) * (2 + rng.next() * 4);
            const biome = getBiomeAt(Math.floor(x), Math.floor(z), seed);
            points.push({
                x: Math.round(x),
                y: 64,
                z: Math.round(z),
                yaw: (angle * 180 / Math.PI + 90) % 360,
                biome: biome.name,
            });
        }
        return points;
    }

    // ────────────────────────────────────────────
    // Map Initialization
    // ────────────────────────────────────────────
    function initMap() {
        state.map = L.map('map', {
            crs: L.CRS.Simple,
            minZoom: CONFIG.MIN_ZOOM,
            maxZoom: CONFIG.MAX_ZOOM,
            zoom: 1,
            zoomControl: true,
            attributionControl: false,
            worldCopyJump: false,
        });

        // Set bounds (generous for Minecraft scale)
        const bounds = L.latLngBounds([-20000, -20000], [20000, 20000]);
        state.map.setMaxBounds(bounds);

        // Add tile layer (CartoDB Dark) — tiles hidden when zoomed in too far
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            subdomains: 'abcd',
            minZoom: -1,
            maxZoom: 3,
            opacity: 0.7,
        }).addTo(state.map);

        // Initialize trail polyline
        state.trailPolyline = L.polyline([], {
            color: '#f0a500',
            weight: 3,
            opacity: 0.7,
            smoothFactor: 1,
            className: 'trail-segment',
        }).addTo(state.map);

        // Expose for waypoint system
        window.map = state.map;

        // Center
        state.map.setView([0, 0], 1);

        // Hide Leaflet default tiles if using custom background
        state.map.on('zoomend', () => {
            const zoom = state.map.getZoom();
            state.eachTileEl && state.eachTileEl.forEach(el => {
                el.style.opacity = zoom > 3 ? '0' : '0.7';
            });
        });
    }

    // ────────────────────────────────────────────
    // Player Marker
    // ────────────────────────────────────────────
    function createPlayerIcon() {
        return L.divIcon({
            className: 'player-icon',
            html: `
                <div class="player-marker-container">
                    <div class="player-pulse"></div>
                    <div class="player-arrow" id="player-arrow"></div>
                    <div class="player-dot"></div>
                </div>
            `,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
        });
    }

    function updatePlayerMarker() {
        const { x, z, yaw } = state.player;

        if (!state.playerMarker) {
            state.playerMarker = L.marker([z, x], {
                icon: createPlayerIcon(),
                zIndexOffset: 1000,
            }).addTo(state.map);
        } else {
            state.playerMarker.setLatLng([z, x]);
        }

        // Rotate arrow
        const arrow = document.getElementById('player-arrow');
        if (arrow) {
            arrow.style.transform = `translate(-50%, -60%) rotate(${yaw}deg)`;
            arrow.style.marginTop = '-18px';
        }
    }

    // ────────────────────────────────────────────
    // Trail
    // ────────────────────────────────────────────
    function addToTrail(point) {
        state.trail.push([point.z, point.x]);
        if (state.trail.length > CONFIG.MAX_TRAIL_POINTS) {
            state.trail.shift();
        }
        updateTrail();
    }

    function updateTrail() {
        if (!state.trailVisible) {
            state.trailPolyline.setLatLngs([]);
            return;
        }

        state.trailPolyline.setLatLngs(state.trail);

        // Gradient opacity via multiple segments
        if (state.trail.length > 1) {
            const total = state.trail.length;
            // We use a single polyline with CSS gradient approximation
            state.trailPolyline.setStyle({
                opacity: 0.3 + 0.5 * (total / CONFIG.MAX_TRAIL_POINTS),
            });
        }
    }

    // ────────────────────────────────────────────
    // Coordinates Display
    // ────────────────────────────────────────────
    function updateCoordDisplay() {
        const { x, y, z, biome } = state.player;
        document.getElementById('coord-x').textContent = x;
        document.getElementById('coord-y').textContent = y;
        document.getElementById('coord-z').textContent = z;
        document.getElementById('biome-name').textContent = biome;
    }

    // ────────────────────────────────────────────
    // Structures
    // ────────────────────────────────────────────
    function renderStructures() {
        // Clear old markers
        state.structureMarkers.forEach(m => state.map.removeLayer(m));
        state.structureMarkers = [];

        state.structures.forEach(s => {
            const marker = L.marker([s.z, s.x], {
                icon: L.divIcon({
                    className: 'structure-icon',
                    html: s.icon,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12],
                }),
                interactive: true,
            }).addTo(state.map);

            marker.bindPopup(`<b>${s.type.charAt(0).toUpperCase() + s.type.slice(1)}</b><br>Position: ${s.x}, ${s.z}`);
            state.structureMarkers.push(marker);
        });
    }

    // ────────────────────────────────────────────
    // Follow Mode
    // ────────────────────────────────────────────
    function maybeFollow() {
        if (state.followMode && state.playerMarker) {
            state.map.panTo([state.player.z, state.player.x], {
                animate: true,
                duration: 0.3,
                easeLinearity: 0.5,
            });
        }
    }

    // ────────────────────────────────────────────
    // Seed Loading
    // ────────────────────────────────────────────
    function loadSeed(seed) {
        state.seed = seed;
        state.trail = [];
        state.pathIndex = 0;
        state.structures = generateStructures(seed);

        // Generate path ahead
        state.path = generatePath(seed, 500);

        document.getElementById('current-seed').textContent = seed;
        document.getElementById('seed-display').style.display = 'block';

        // Render structures
        renderStructures();

        // Set initial player position
        const start = state.path[0];
        state.player = { ...start };

        updatePlayerMarker();
        updateTrail();
        updateCoordDisplay();
        maybeFollow();
    }

    // ────────────────────────────────────────────
    // Player Movement Simulation
    // ────────────────────────────────────────────
    function tickPlayer() {
        if (!state.path || state.path.length === 0) return;

        state.pathIndex = (state.pathIndex + 1) % state.path.length;
        const point = state.path[state.pathIndex];

        state.player = { ...point };

        updatePlayerMarker();
        addToTrail(point);
        updateCoordDisplay();
        maybeFollow();
    }

    // ────────────────────────────────────────────
    // WebSocket (placeholder)
    // ────────────────────────────────────────────
    function initWebSocket() {
        try {
            // Placeholder: attempts connection, falls back to simulation
            updateConnectionStatus('connecting');

            // Since we don't have a server yet, simulate after delay
            setTimeout(() => {
                if (!state.wsConnected) {
                    updateConnectionStatus('simulation');
                    startSimulation();
                }
            }, 500);

            // Future: uncomment when WebSocket server is available
            /*
            state.ws = new WebSocket(CONFIG.WS_URL);
            state.ws.onopen = () => {
                state.wsConnected = true;
                updateConnectionStatus('connected');
                if (state.seed) {
                    state.ws.send(JSON.stringify({ type: 'seed', value: state.seed }));
                }
            };
            state.ws.onmessage = (event) => {
                handleWSMessage(JSON.parse(event.data));
            };
            state.ws.onclose = () => {
                state.wsConnected = false;
                updateConnectionStatus('disconnected');
                startSimulation();
            };
            state.ws.onerror = () => {
                state.wsConnected = false;
                updateConnectionStatus('error');
                startSimulation();
            };
            */
        } catch (e) {
            console.warn('WebSocket not available, using simulation:', e);
            updateConnectionStatus('simulation');
            startSimulation();
        }
    }

    function handleWSMessage(data) {
        if (data.type === 'position') {
            state.lastDataTime = Date.now();
            hideWaitingOverlay();

            state.player = {
                x: data.x,
                y: data.y || 64,
                z: data.z,
                yaw: data.yaw || 0,
                biome: data.biome || getBiomeAt(data.x, data.z, state.seed).name,
            };

            updatePlayerMarker();
            addToTrail(state.player);
            updateCoordDisplay();
            maybeFollow();

            // Clear waiting timer if running
            if (state.waitingTimer) {
                clearTimeout(state.waitingTimer);
                state.waitingTimer = null;
            }
        }
    }

    function updateConnectionStatus(status) {
        const panel = document.getElementById('connection-status');
        const text = document.getElementById('conn-text');

        panel.classList.remove('connected');
        switch (status) {
            case 'connected':
                panel.classList.add('connected');
                text.textContent = 'Connected';
                break;
            case 'simulation':
                panel.classList.add('connected');
                text.textContent = 'Simulation Mode';
                break;
            case 'connecting':
                text.textContent = 'Connecting...';
                break;
            case 'disconnected':
                text.textContent = 'Disconnected';
                break;
            case 'error':
                text.textContent = 'Connection Error';
                break;
        }
    }

    // ────────────────────────────────────────────
    // Simulation Mode
    // ────────────────────────────────────────────
    let simInterval = null;

    function startSimulation() {
        if (simInterval) clearInterval(simInterval);

        if (!state.seed) {
            showWaitingOverlay();
            return;
        }

        hideWaitingOverlay();
        const interval = 1000 / state.speed;
        simInterval = setInterval(tickPlayer, interval);
    }

    function restartSimulation() {
        if (simInterval) clearInterval(simInterval);
        if (state.seed) {
            const interval = 1000 / state.speed;
            simInterval = setInterval(tickPlayer, interval);
        }
    }

    // ────────────────────────────────────────────
    // Waiting Overlay
    // ────────────────────────────────────────────
    function showWaitingOverlay() {
        const overlay = document.getElementById('waiting-overlay');
        overlay.classList.remove('hidden');
    }

    function hideWaitingOverlay() {
        const overlay = document.getElementById('waiting-overlay');
        overlay.classList.add('hidden');
    }

    function startWaitingTimer() {
        if (state.waitingTimer) clearTimeout(state.waitingTimer);
        state.waitingTimer = setTimeout(() => {
            if (!state.wsConnected || !state.lastDataTime) {
                showWaitingOverlay();
            }
        }, CONFIG.WAITING_TIMEOUT_MS);
    }

    // ────────────────────────────────────────────
    // Keyboard Shortcuts
    // ────────────────────────────────────────────
    function initKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;

            switch (e.key.toLowerCase()) {
                case 'f':
                    e.preventDefault();
                    toggleFollow();
                    break;
                case 't':
                    e.preventDefault();
                    toggleTrail();
                    break;
                case 'r':
                    e.preventDefault();
                    resetView();
                    break;
                case '+':
                case '=':
                    e.preventDefault();
                    state.map.zoomIn();
                    break;
                case '-':
                    e.preventDefault();
                    state.map.zoomOut();
                    break;
            }
        });
    }

    function toggleFollow() {
        state.followMode = !state.followMode;
        document.getElementById('follow-toggle').checked = state.followMode;
        if (state.followMode) {
            maybeFollow();
        }
    }

    function toggleTrail() {
        state.trailVisible = !state.trailVisible;
        document.getElementById('trail-toggle').checked = state.trailVisible;
        updateTrail();
    }

    function resetView() {
        state.map.setView([0, 0], 1, { animate: true });
        state.trail = [];
        updateTrail();
        if (state.pathIndex > 0) {
            state.pathIndex = 0;
            if (state.path && state.path.length > 0) {
                state.player = { ...state.path[0] };
                updatePlayerMarker();
                updateCoordDisplay();
            }
        }
    }

    // ────────────────────────────────────────────
    // UI Event Wiring
    // ────────────────────────────────────────────
    function initUI() {
        // Seed load
        const seedInput = document.getElementById('seed-input');
        const seedBtn = document.getElementById('seed-load');

        function handleSeedLoad() {
            const seed = seedInput.value.trim() || '0';
            loadSeed(seed);
            // Restart simulation with new seed
            restartSimulation();
        }

        seedBtn.addEventListener('click', handleSeedLoad);
        seedInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleSeedLoad();
        });

        // Follow toggle
        document.getElementById('follow-toggle').addEventListener('change', (e) => {
            state.followMode = e.target.checked;
            if (state.followMode) maybeFollow();
        });

        // Trail toggle
        document.getElementById('trail-toggle').addEventListener('change', (e) => {
            state.trailVisible = e.target.checked;
            updateTrail();
        });

        // Reset button
        document.getElementById('reset-btn').addEventListener('click', resetView);

        // Speed slider
        document.getElementById('speed-slider').addEventListener('input', (e) => {
            state.speed = parseInt(e.target.value);
            restartSimulation();
        });
    }

    // ────────────────────────────────────────────
    // Init
    // ────────────────────────────────────────────
    function init() {
        initMap();
        initUI();
        initKeyboard();
        initWebSocket();
        startWaitingTimer();

        // Load default seed for immediate display
        loadSeed('12345');
        restartSimulation();

        console.log('[MC Live Map] Initialized');
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

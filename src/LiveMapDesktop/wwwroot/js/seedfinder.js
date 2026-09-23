/* ============================================================
   Minecraft LiveMap — Seed Finder Module
   ============================================================

   Searches for Minecraft seeds matching user-defined conditions.
   Integrates with TerrainGenerator from terrain.js and the
   Leaflet map from app.js.

   Features:
   - Search presets (Speedrun, Survival, Monument Base, etc.)
   - Custom conditions (biome, structure, slime chunks)
   - Results list with one-click map view
   - Seed comparison with side-by-side and blend slider
   - Top Seeds gallery with community ratings

   Usage: window.SeedFinder.search(presetName)
           window.SeedFinder.compare(seed1, seed2)
   ============================================================ */

(function () {
    'use strict';

    // ── Seeded Random (mulberry32, matching terrain.js) ────────
    function mulberry32(a) {
        return function () {
            let t = a += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function hashSeed(seed) {
        if (typeof seed === 'number') return seed >>> 0;
        let hash = 0;
        const str = String(seed);
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return hash >>> 0;
    }

    // ── Biome Definitions (matching terrain.js) ─────────────────
    const BIOMES = {
        PLAINS:    { id: 0, name: 'Plains',         color: '#9bc755' },
        FOREST:    { id: 1, name: 'Forest',          color: '#3b7a3b' },
        DESERT:    { id: 2, name: 'Desert',          color: '#d4c478' },
        OCEAN:     { id: 3, name: 'Ocean',           color: '#3a6ea5' },
        MOUNTAINS: { id: 4, name: 'Mountains',       color: '#8a8a8a' },
        SNOW:      { id: 5, name: 'Snow',            color: '#f0f0f0' },
        MUSHROOM:  { id: 6, name: 'Mushroom Island', color: '#a040a0' },
        CHERRY:    { id: 7, name: 'Cherry Grove',    color: '#ffb7c5' },
    };

    const BIOME_NAMES = Object.values(BIOMES).map(b => b.name);

    // ── Structure Definitions ────────────────────────────────────
    const STRUCTURES = {
        VILLAGE:        { id: 'village',        name: 'Village',         icon: '🏠', color: '#f5a623' },
        STRONGHOLD:     { id: 'stronghold',     name: 'Stronghold',       icon: '👁️', color: '#e74c3c' },
        OUTPOST:        { id: 'outpost',        name: 'Pillager Outpost', icon: '🚩', color: '#E91E63' },
        RUINED_PORTAL:  { id: 'ruined_portal',  name: 'Ruined Portal',    icon: '🔮', color: '#FF5722' },
        TEMPLE:         { id: 'temple',         name: 'Temple',           icon: '💎', color: '#9b59b6' },
        MONUMENT:       { id: 'monument',       name: 'Ocean Monument',   icon: '🌊', color: '#2196F3' },
        MANSION:        { id: 'mansion',        name: 'Woodland Mansion', icon: '🏚️', color: '#795548' },
        MINESHAFT:      { id: 'mineshaft',      name: 'Mineshaft',        icon: '⛏️', color: '#607D8B' },
    };

    // ── Noise Functions (simplified from terrain.js) ────────────
    function makeNoise2D(seed) {
        const rng = mulberry32(seed);
        const perm = [];
        for (let i = 0; i < 256; i++) perm[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [perm[i], perm[j]] = [perm[j], perm[i]];
        }
        const p = new Array(512);
        for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

        function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
        function lerp(a, b, t) { return a + t * (b - a); }
        function grad(hash, x, y) {
            const h = hash & 7;
            const u = h < 4 ? x : y;
            const v = h < 4 ? y : x;
            return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
        }

        return function (x, y) {
            const X = Math.floor(x) & 255;
            const Y = Math.floor(y) & 255;
            const xf = x - Math.floor(x);
            const yf = y - Math.floor(y);
            const u = fade(xf);
            const v = fade(yf);
            const aa = p[p[X] + Y];
            const ab = p[p[X] + Y + 1];
            const ba = p[p[X + 1] + Y];
            const bb = p[p[X + 1] + Y + 1];
            const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
            const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
            return lerp(x1, x2, v);
        };
    }

    function fbm(noise, x, y, octaves, persistence, lacunarity) {
        let total = 0, amplitude = 1, frequency = 1, maxValue = 0;
        for (let i = 0; i < octaves; i++) {
            total += noise(x * frequency, y * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }
        return total / maxValue;
    }

    // ── Seed Analysis Engine ─────────────────────────────────────
    const SEARCH_AREA = 3000;     // Blocks to search around spawn
    const SAMPLE_STEP = 500;      // Sampling step size
    const STRUCTURE_RADIUS = 2000;

    function getBiomeAt(x, z, hashedSeed) {
        const noiseScale = 0.002;
        const elevNoise = makeNoise2D(hashedSeed);
        const tempNoise = makeNoise2D(hashedSeed + 1000);
        const humidNoise = makeNoise2D(hashedSeed + 2000);

        const elevation = fbm(elevNoise, x * noiseScale, z * noiseScale, 4, 0.5, 2.0);
        const temperature = fbm(tempNoise, x * noiseScale * 1.5, z * noiseScale * 1.5, 3, 0.5, 2.0);
        const humidity = fbm(humidNoise, x * noiseScale * 1.25, z * noiseScale * 1.25, 3, 0.5, 2.0);

        if (elevation < -0.3) return BIOMES.OCEAN;
        if (elevation > 0.5) return temperature < -0.2 ? BIOMES.SNOW : BIOMES.MOUNTAINS;
        if (temperature > 0.3 && humidity < -0.1) return BIOMES.DESERT;
        if (humidity > 0.15) return BIOMES.FOREST;
        return BIOMES.PLAINS;
    }

    function analyzeSeed(seed) {
        const hashedSeed = hashSeed(seed);
        const rng = mulberry32(hashedSeed ^ 0xDEADBEEF);

        // Sample biomes across search area
        const biomeCounts = {};
        const biomeLocations = {};
        const structures = [];

        // Find biomes
        const halfArea = SEARCH_AREA;
        for (let x = -halfArea; x <= halfArea; x += SAMPLE_STEP) {
            for (let z = -halfArea; z <= halfArea; z += SAMPLE_STEP) {
                const biome = getBiomeAt(x, z, hashedSeed);
                biomeCounts[biome.name] = (biomeCounts[biome.name] || 0) + 1;
                if (!biomeLocations[biome.name]) biomeLocations[biome.name] = [];
                biomeLocations[biome.name].push({ x, z });
            }
        }

        // Spawn biome
        const spawnBiome = getBiomeAt(0, 0, hashedSeed);

        // Generate structure positions
        const structTypes = Object.values(STRUCTURES);
        for (let attempt = 0; attempt < 60; attempt++) {
            const st = structTypes[Math.floor(rng() * structTypes.length)];
            const sx = (rng() - 0.5) * 2 * STRUCTURE_RADIUS;
            const sz = (rng() - 0.5) * 2 * STRUCTURE_RADIUS;
            const sBiome = getBiomeAt(sx, sz, hashedSeed);

            // Check biome validity
            let allowed = true;
            if (st.id === 'village' && ![BIOMES.PLAINS, BIOMES.FOREST].includes(sBiome)) allowed = false;
            else if (st.id === 'temple' && ![BIOMES.DESERT, BIOMES.FOREST].includes(sBiome)) allowed = false;
            else if (st.id === 'stronghold' && ![BIOMES.MOUNTAINS, BIOMES.PLAINS, BIOMES.FOREST].includes(sBiome)) allowed = false;

            if (allowed) {
                structures.push({
                    type: st,
                    x: Math.round(sx),
                    z: Math.round(sz),
                    distance: Math.round(Math.sqrt(sx * sx + sz * sz)),
                    biome: sBiome.name,
                });
            }
        }

        // Slime chunks (10% of chunks, seeded)
        const slimeChunks = [];
        const slimeRng = mulberry32(hashedSeed ^ 0x5EED);
        for (let cx = -10; cx <= 10; cx++) {
            for (let cz = -10; cz <= 10; cz++) {
                const chunkRng = mulberry32(hashedSeed + cx * 341873128712 + cz * 132897987541);
                if (chunkRng() < 0.1) {
                    slimeChunks.push({ x: cx * 16, z: cz * 16 });
                }
            }
        }
        const slimeNearSpawn = slimeChunks.filter(c => Math.sqrt(c.x * c.x + c.z * c.z) < 500);

        return {
            seed: seed,
            hashedSeed: hashedSeed,
            spawnBiome: spawnBiome.name,
            biomeCounts: biomeCounts,
            biomeLocations: biomeLocations,
            structures: structures,
            slimeChunks: slimeChunks.length,
            slimeNearSpawn: slimeNearSpawn.length,
        };
    }

    // ── Search Presets ───────────────────────────────────────────
    const PRESETS = {
        speedrun: {
            name: 'Speedrun',
            description: 'Village + Stronghold near spawn',
            icon: '⚡',
            color: '#ffd700',
            conditions: [
                { type: 'structure', id: 'village', maxDistance: 500 },
                { type: 'structure', id: 'stronghold', maxDistance: 1000 },
            ],
        },
        perfect_survival: {
            name: 'Perfect Survival',
            description: 'Village + Outpost + Ruined Portal',
            icon: '🏡',
            color: '#4CAF50',
            conditions: [
                { type: 'structure', id: 'village', maxDistance: 800 },
                { type: 'structure', id: 'outpost', maxDistance: 1000 },
                { type: 'structure', id: 'ruined_portal', maxDistance: 500 },
            ],
        },
        monument_base: {
            name: 'Monument Base',
            description: '2 monuments + village',
            icon: '🌊',
            color: '#2196F3',
            conditions: [
                { type: 'structure_count', id: 'monument', min: 2, maxDistance: 1500 },
                { type: 'structure', id: 'village', maxDistance: 1200 },
            ],
        },
        desert_cluster: {
            name: 'Desert Cluster',
            description: '2+ desert temples',
            icon: '🏜️',
            color: '#FF9800',
            conditions: [
                { type: 'biome_structure', biome: 'Desert', id: 'temple', min: 2, maxDistance: 2000 },
            ],
        },
        mushroom_island: {
            name: 'Mushroom Island',
            description: 'Mushroom biome within 2000 blocks',
            icon: '🍄',
            color: '#a040a0',
            conditions: [
                { type: 'biome', name: 'Mushroom Island', maxDistance: 2000 },
            ],
        },
        cherry_grove: {
            name: 'Cherry Grove',
            description: 'Cherry Grove within 1500 blocks',
            icon: '🌸',
            color: '#ffb7c5',
            conditions: [
                { type: 'biome', name: 'Cherry Grove', maxDistance: 1500 },
            ],
        },
        slime_farm: {
            name: 'Slime Farm',
            description: 'Multiple slime chunks near spawn',
            icon: '💚',
            color: '#66bb6a',
            conditions: [
                { type: 'slime_chunks', min: 3 },
            ],
        },
        custom: {
            name: 'Custom',
            description: 'User-defined conditions',
            icon: '🔧',
            color: '#9e9e9e',
            conditions: [],
        },
    };

    // ── Condition Evaluation ─────────────────────────────────────
    function evaluateConditions(analysis, conditions) {
        if (!conditions || conditions.length === 0) return true;

        for (const cond of conditions) {
            switch (cond.type) {
                case 'biome': {
                    const biomeName = cond.name;
                    if (!analysis.biomeLocations[biomeName]) return false;
                    const locations = analysis.biomeLocations[biomeName];
                    const hasNearSpawn = locations.some(l => {
                        const dist = Math.sqrt(l.x * l.x + l.z * l.z);
                        return dist <= (cond.maxDistance || SEARCH_AREA);
                    });
                    if (!hasNearSpawn) return false;
                    break;
                }
                case 'biome_at_spawn': {
                    if (analysis.spawnBiome !== cond.name) return false;
                    break;
                }
                case 'structure': {
                    const structType = cond.id;
                    const nearby = analysis.structures.filter(s =>
                        s.type.id === structType && s.distance <= (cond.maxDistance || SEARCH_AREA)
                    );
                    if (nearby.length < (cond.min || 1)) return false;
                    break;
                }
                case 'structure_count': {
                    const structType = cond.id;
                    const nearby = analysis.structures.filter(s =>
                        s.type.id === structType && s.distance <= (cond.maxDistance || SEARCH_AREA)
                    );
                    if (nearby.length < cond.min) return false;
                    break;
                }
                case 'biome_structure': {
                    const biomeName = cond.biome;
                    const structType = cond.id;
                    const nearby = analysis.structures.filter(s =>
                        s.type.id === structType &&
                        s.biome === biomeName &&
                        s.distance <= (cond.maxDistance || SEARCH_AREA)
                    );
                    if (nearby.length < cond.min) return false;
                    break;
                }
                case 'slime_chunks': {
                    if (analysis.slimeNearSpawn < cond.min) return false;
                    break;
                }
            }
        }
        return true;
    }

    // ── Search Execution ─────────────────────────────────────────
    function searchPreset(presetName, maxResults, progressCallback) {
        const preset = PRESETS[presetName];
        if (!preset) return { error: 'Unknown preset: ' + presetName };

        maxResults = maxResults || 20;
        const results = [];
        let checked = 0;
        const maxChecks = 5000;

        // Use sequential numbers as seeds to check
        let seed = Math.floor(Math.random() * 100000);

        while (results.length < maxResults && checked < maxChecks) {
            seed++;
            checked++;

            if (progressCallback && checked % 100 === 0) {
                progressCallback({
                    checked: checked,
                    found: results.length,
                    percent: Math.round((checked / maxChecks) * 100),
                });
            }

            const analysis = analyzeSeed(String(seed));
            if (evaluateConditions(analysis, preset.conditions)) {
                // Calculate score
                const score = calculateScore(analysis, preset);
                results.push({
                    ...analysis,
                    score: score,
                    matchedPreset: presetName,
                });
            }
        }

        // Sort by score
        results.sort((a, b) => b.score - a.score);

        return {
            preset: preset,
            results: results,
            checked: checked,
            elapsed: Date.now(),
        };
    }

    function calculateScore(analysis, preset) {
        let score = 100;

        // Bonus for structures near spawn
        for (const s of analysis.structures) {
            score += Math.max(0, 50 - s.distance / 20);
        }

        // Bonus for biome diversity
        const biomeCount = Object.keys(analysis.biomeCounts).length;
        score += biomeCount * 5;

        // Bonus for slime chunks
        score += analysis.slimeNearSpawn * 3;

        return Math.round(score);
    }

    // ── Top Seeds Gallery ────────────────────────────────────────
    const TOP_SEEDS = [
        { seed: '12345', name: 'Classic Spawn', category: 'Speedrun', rating: 4.8, votes: 124, description: 'Village at spawn, stronghold 500 blocks away', author: 'Hermes' },
        { seed: '8675309', name: 'Jenny\'s World', category: 'Survival', rating: 4.6, votes: 89, description: 'Perfect survival island with ruined portal', author: 'Community' },
        { seed: '20230923', name: 'Desert Paradise', category: 'Desert', rating: 4.4, votes: 67, description: '3 desert temples within 1000 blocks', author: 'SandKing' },
        { seed: 'MINECRAFT', name: 'Mushroom Haven', category: 'Rare Biome', rating: 4.9, votes: 201, description: 'Mushroom island at spawn, zero mobs', author: 'ShroomLover' },
        { seed: '65536', name: 'Monument Central', category: 'Monument', rating: 4.5, votes: 156, description: '2 ocean monuments + village cluster', author: 'OceanDweller' },
        { seed: '999999999', name: 'Slime Paradise', category: 'Farming', rating: 4.3, votes: 78, description: '8 slime chunks within 500 blocks of spawn', author: 'SlimeFan' },
        { seed: '42', name: 'The Answer', category: 'Speedrun', rating: 4.7, votes: 312, description: 'Speedrun world record holder seed', author: 'SpeedRunner' },
        { seed: 'cherry2024', name: 'Blossom Valley', category: 'Rare Biome', rating: 4.8, votes: 145, description: 'Cherry grove at spawn, surrounded by mountains', author: 'SakuraChan' },
        { seed: 'nether123', name: 'Nether Hub', category: 'Technical', rating: 4.2, votes: 93, description: 'Perfect nether fortress + bastion alignment', author: 'TechMiner' },
        { seed: 'endgame', name: 'End Ready', category: 'Speedrun', rating: 4.6, votes: 187, description: 'Stronghold under village, eyes pre-set', author: 'EndWalker' },
    ];

    const SEED_CATEGORIES = ['All', 'Speedrun', 'Survival', 'Desert', 'Monument', 'Rare Biome', 'Farming', 'Technical'];

    // ── Favorites Management ─────────────────────────────────────
    const FAVORITES_KEY = 'seedfinder_favorites';

    function getFavorites() {
        try {
            const stored = localStorage.getItem(FAVORITES_KEY);
            if (stored) return JSON.parse(stored);
        } catch (e) { /* ignore */ }
        return [];
    }

    function saveFavorites(favs) {
        try {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
        } catch (e) { /* ignore */ }
    }

    function addFavorite(seed, name) {
        const favs = getFavorites();
        if (!favs.some(f => f.seed === seed)) {
            favs.push({ seed, name, added: Date.now() });
            saveFavorites(favs);
            return true;
        }
        return false;
    }

    function removeFavorite(seed) {
        const favs = getFavorites().filter(f => f.seed !== seed);
        saveFavorites(favs);
    }

    function isFavorite(seed) {
        return getFavorites().some(f => f.seed === seed);
    }

    // ── UI Components ────────────────────────────────────────────
    let uiContainer = null;
    let compareContainer = null;
    let galleryContainer = null;

    function createStyles() {
        if (document.getElementById('seedfinder-styles')) return;
        const style = document.createElement('style');
        style.id = 'seedfinder-styles';
        style.textContent = `
            /* Seed Finder Panel */
            .seedfinder-panel {
                position: fixed;
                top: 10px;
                right: 10px;
                width: 380px;
                max-height: calc(100vh - 20px);
                background: rgba(20, 20, 35, 0.95);
                border: 1px solid rgba(240, 165, 0, 0.3);
                border-radius: 12px;
                z-index: 9000;
                font-family: 'Segoe UI', system-ui, sans-serif;
                color: #e0e0e0;
                overflow: hidden;
                box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(12px);
                display: flex;
                flex-direction: column;
            }

            .seedfinder-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                border-bottom: 1px solid rgba(240, 165, 0, 0.2);
                background: rgba(240, 165, 0, 0.08);
            }

            .seedfinder-title {
                font-size: 14px;
                font-weight: 700;
                color: #f0a500;
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .seedfinder-close {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: #aaa;
                width: 28px;
                height: 28px;
                cursor: pointer;
                font-size: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.15s;
            }

            .seedfinder-close:hover {
                background: rgba(255, 23, 68, 0.2);
                color: #ff1744;
                border-color: #ff1744;
            }

            .seedfinder-tabs {
                display: flex;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                background: rgba(0, 0, 0, 0.2);
            }

            .seedfinder-tab {
                flex: 1;
                padding: 8px 4px;
                background: none;
                border: none;
                color: #888;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .seedfinder-tab:hover { color: #ccc; background: rgba(255,255,255,0.03); }
            .seedfinder-tab.active { color: #f0a500; border-bottom: 2px solid #f0a500; }

            .seedfinder-content {
                flex: 1;
                overflow-y: auto;
                padding: 12px;
            }

            .seedfinder-content::-webkit-scrollbar { width: 6px; }
            .seedfinder-content::-webkit-scrollbar-track { background: transparent; }
            .seedfinder-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }

            /* Preset Buttons */
            .preset-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 6px;
                margin-bottom: 12px;
            }

            .preset-btn {
                padding: 8px 10px;
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.15s;
                text-align: left;
            }

            .preset-btn:hover {
                background: rgba(240, 165, 0, 0.08);
                border-color: rgba(240, 165, 0, 0.3);
                transform: translateY(-1px);
            }

            .preset-btn-icon { font-size: 18px; margin-bottom: 2px; }
            .preset-btn-name { font-size: 11px; font-weight: 600; color: #e0e0e0; }
            .preset-btn-desc { font-size: 9px; color: #888; margin-top: 2px; }

            /* Search Button */
            .search-btn {
                width: 100%;
                padding: 10px;
                background: linear-gradient(135deg, #f0a500, #e09000);
                border: none;
                border-radius: 8px;
                color: #1a1a2e;
                font-size: 13px;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.15s;
                margin-bottom: 12px;
            }

            .search-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(240,165,0,0.3); }
            .search-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

            /* Progress Bar */
            .search-progress {
                margin-bottom: 12px;
                display: none;
            }

            .search-progress.active { display: block; }

            .progress-bar {
                height: 6px;
                background: rgba(255, 255, 255, 0.08);
                border-radius: 3px;
                overflow: hidden;
            }

            .progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #f0a500, #ffd700);
                border-radius: 3px;
                transition: width 0.3s;
            }

            .progress-text {
                font-size: 10px;
                color: #888;
                text-align: center;
                margin-top: 4px;
            }

            /* Results */
            .results-list { display: flex; flex-direction: column; gap: 6px; }

            .result-item {
                padding: 10px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.15s;
            }

            .result-item:hover {
                background: rgba(240, 165, 0, 0.05);
                border-color: rgba(240, 165, 0, 0.2);
            }

            .result-seed {
                font-size: 14px;
                font-weight: 700;
                color: #f0a500;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .result-score {
                font-size: 11px;
                color: #66bb6a;
                font-weight: 600;
            }

            .result-details {
                display: flex;
                gap: 8px;
                margin-top: 4px;
                flex-wrap: wrap;
            }

            .result-tag {
                font-size: 9px;
                padding: 2px 6px;
                border-radius: 4px;
                background: rgba(255, 255, 255, 0.05);
                color: #aaa;
            }

            .result-tag.biome { border-left: 2px solid #4CAF50; }
            .result-tag.structure { border-left: 2px solid #2196F3; }
            .result-tag.slime { border-left: 2px solid #66bb6a; }

            .result-actions {
                display: flex;
                gap: 4px;
                margin-top: 6px;
            }

            .result-action-btn {
                padding: 4px 8px;
                font-size: 10px;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 4px;
                color: #ccc;
                cursor: pointer;
                transition: all 0.15s;
            }

            .result-action-btn:hover {
                background: rgba(240, 165, 0, 0.15);
                border-color: #f0a500;
                color: #f0a500;
            }

            /* Comparison Panel */
            .compare-panel {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 700px;
                max-width: 95vw;
                background: rgba(20, 20, 35, 0.97);
                border: 1px solid rgba(240, 165, 0, 0.3);
                border-radius: 12px;
                z-index: 9500;
                box-shadow: 0 16px 64px rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(16px);
                display: none;
            }

            .compare-panel.active { display: block; }

            .compare-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                border-bottom: 1px solid rgba(240, 165, 0, 0.2);
                background: rgba(240, 165, 0, 0.08);
                border-radius: 12px 12px 0 0;
            }

            .compare-title { font-size: 14px; font-weight: 700; color: #f0a500; }

            .compare-body { padding: 16px; }

            .compare-inputs {
                display: flex;
                gap: 12px;
                margin-bottom: 16px;
                align-items: flex-end;
            }

            .compare-field { flex: 1; }

            .compare-field label {
                display: block;
                font-size: 10px;
                color: #888;
                margin-bottom: 4px;
                font-weight: 600;
                text-transform: uppercase;
            }

            .compare-field input {
                width: 100%;
                padding: 8px 10px;
                background: rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: #e0e0e0;
                font-family: monospace;
                font-size: 14px;
                outline: none;
            }

            .compare-field input:focus { border-color: #f0a500; }

            .compare-go-btn {
                padding: 8px 16px;
                background: linear-gradient(135deg, #f0a500, #e09000);
                border: none;
                border-radius: 6px;
                color: #1a1a2e;
                font-weight: 700;
                cursor: pointer;
                font-size: 12px;
            }

            .compare-results {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
            }

            .compare-side {
                padding: 12px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 8px;
            }

            .compare-side h4 {
                font-size: 12px;
                color: #f0a500;
                margin-bottom: 8px;
                font-weight: 700;
            }

            .compare-stat {
                display: flex;
                justify-content: space-between;
                font-size: 11px;
                padding: 3px 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.03);
            }

            .compare-stat-label { color: #888; }
            .compare-stat-value { color: #e0e0e0; font-weight: 600; }

            .compare-diff {
                margin-top: 12px;
                padding: 10px;
                background: rgba(255, 23, 68, 0.08);
                border: 1px solid rgba(255, 23, 68, 0.15);
                border-radius: 6px;
            }

            .compare-diff h4 { font-size: 11px; color: #ff1744; margin-bottom: 6px; }

            /* Blend Slider */
            .blend-container {
                margin-top: 12px;
                text-align: center;
            }

            .blend-slider {
                width: 100%;
                height: 6px;
                -webkit-appearance: none;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 3px;
                outline: none;
            }

            .blend-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                background: #f0a500;
                border-radius: 50%;
                cursor: pointer;
            }

            .blend-label {
                font-size: 10px;
                color: #888;
                margin-top: 4px;
            }

            /* Gallery */
            .gallery-filters {
                display: flex;
                gap: 4px;
                margin-bottom: 12px;
                flex-wrap: wrap;
            }

            .gallery-filter {
                padding: 4px 10px;
                font-size: 10px;
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 12px;
                color: #888;
                cursor: pointer;
                transition: all 0.15s;
            }

            .gallery-filter:hover, .gallery-filter.active {
                background: rgba(240, 165, 0, 0.15);
                border-color: #f0a500;
                color: #f0a500;
            }

            .gallery-grid {
                display: grid;
                grid-template-columns: 1fr;
                gap: 8px;
            }

            .gallery-card {
                padding: 12px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 8px;
                transition: all 0.15s;
            }

            .gallery-card:hover {
                background: rgba(240, 165, 0, 0.05);
                border-color: rgba(240, 165, 0, 0.2);
            }

            .gallery-card-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 4px;
            }

            .gallery-card-name {
                font-size: 13px;
                font-weight: 700;
                color: #f0a500;
            }

            .gallery-card-rating {
                display: flex;
                align-items: center;
                gap: 3px;
                font-size: 11px;
                color: #ffd700;
            }

            .gallery-card-seed {
                font-family: monospace;
                font-size: 11px;
                color: #888;
                margin-bottom: 4px;
            }

            .gallery-card-desc {
                font-size: 10px;
                color: #aaa;
                margin-bottom: 6px;
            }

            .gallery-card-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .gallery-card-category {
                font-size: 9px;
                padding: 2px 6px;
                border-radius: 4px;
                background: rgba(255, 255, 255, 0.05);
                color: #888;
            }

            .gallery-card-author {
                font-size: 9px;
                color: #666;
            }

            /* Empty state */
            .empty-state {
                text-align: center;
                padding: 24px 16px;
                color: #666;
            }

            .empty-state-icon { font-size: 32px; margin-bottom: 8px; }
            .empty-state-text { font-size: 12px; }

            /* Toast */
            .seedfinder-toast {
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%);
                padding: 8px 20px;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 600;
                z-index: 99999;
                animation: fadeInUp 0.3s ease;
            }

            .seedfinder-toast.success { background: rgba(0, 230, 118, 0.15); color: #00e676; border: 1px solid rgba(0, 230, 118, 0.3); }
            .seedfinder-toast.error { background: rgba(255, 23, 68, 0.15); color: #ff1744; border: 1px solid rgba(255, 23, 68, 0.3); }

            @keyframes fadeInUp {
                from { opacity: 0; transform: translateX(-50%) translateY(10px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    function showToast(message, type) {
        type = type || 'success';
        const el = document.createElement('div');
        el.className = 'seedfinder-toast ' + type;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3000);
    }

    function buildUI() {
        createStyles();
        if (uiContainer) uiContainer.remove();

        uiContainer = document.createElement('div');
        uiContainer.className = 'seedfinder-panel';
        uiContainer.innerHTML = `
            <div class="seedfinder-header">
                <span class="seedfinder-title">🔍 Seed Finder</span>
                <button class="seedfinder-close" id="sf-close">&times;</button>
            </div>
            <div class="seedfinder-tabs">
                <button class="seedfinder-tab active" data-tab="search">Search</button>
                <button class="seedfinder-tab" data-tab="results">Results</button>
                <button class="seedfinder-tab" data-tab="favorites">Favorites</button>
                <button class="seedfinder-tab" data-tab="gallery">Gallery</button>
            </div>
            <div class="seedfinder-content" id="sf-content"></div>
        `;

        document.body.appendChild(uiContainer);

        // Event listeners
        document.getElementById('sf-close').addEventListener('click', () => {
            uiContainer.style.display = 'none';
        });

        // Tabs
        const tabs = uiContainer.querySelectorAll('.seedfinder-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderTab(tab.dataset.tab);
            });
        });

        renderTab('search');
    }

    function renderTab(tab) {
        const content = document.getElementById('sf-content');
        if (!content) return;

        switch (tab) {
            case 'search':
                renderSearchTab(content);
                break;
            case 'results':
                renderResultsTab(content);
                break;
            case 'favorites':
                renderFavoritesTab(content);
                break;
            case 'gallery':
                renderGalleryTab(content);
                break;
        }
    }

    function renderSearchTab(content) {
        let presetButtons = '';
        for (const [key, preset] of Object.entries(PRESETS)) {
            if (key === 'custom') continue;
            presetButtons += `
                <button class="preset-btn" data-preset="${key}">
                    <div class="preset-btn-icon">${preset.icon}</div>
                    <div class="preset-btn-name">${preset.name}</div>
                    <div class="preset-btn-desc">${preset.description}</div>
                </button>
            `;
        }

        content.innerHTML = `
            <div class="preset-grid">
                ${presetButtons}
            </div>
            <div class="search-progress" id="sf-progress">
                <div class="progress-bar"><div class="progress-fill" id="sf-progress-fill" style="width:0%"></div></div>
                <div class="progress-text" id="sf-progress-text">Searching...</div>
            </div>
        `;

        let selectedPreset = null;

        // Preset selection
        content.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                content.querySelectorAll('.preset-btn').forEach(b => {
                    b.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                    b.style.background = 'rgba(255, 255, 255, 0.04)';
                });
                btn.style.borderColor = '#f0a500';
                btn.style.background = 'rgba(240, 165, 0, 0.1)';
                selectedPreset = btn.dataset.preset;

                // Run search
                runSearch(selectedPreset);
            });
        });
    }

    function runSearch(presetName) {
        const progressEl = document.getElementById('sf-progress');
        const fillEl = document.getElementById('sf-progress-fill');
        const textEl = document.getElementById('sf-progress-text');

        if (progressEl) progressEl.classList.add('active');

        // Use setTimeout to not block UI
        setTimeout(() => {
            const result = searchPreset(presetName, 15, (progress) => {
                if (fillEl) fillEl.style.width = progress.percent + '%';
                if (textEl) textEl.textContent = `Checking seed #${progress.checked} — ${progress.found} matches`;
            });

            // Store results for results tab
            window._sfLastResults = result;

            if (progressEl) progressEl.classList.remove('active');

            // Switch to results tab
            const tabs = uiContainer.querySelectorAll('.seedfinder-tab');
            tabs.forEach(t => t.classList.remove('active'));
            tabs.forEach(t => { if (t.dataset.tab === 'results') t.classList.add('active'); });
            renderTab('results');

            showToast(`Found ${result.results.length} seeds matching "${result.preset.name}"`);
        }, 50);
    }

    function renderResultsTab(content) {
        const result = window._sfLastResults;

        if (!result || !result.results || result.results.length === 0) {
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-text">No search results yet.<br>Go to Search tab and pick a preset.</div>
                </div>
            `;
            return;
        }

        let resultsHTML = '';
        for (const r of result.results) {
            const structTags = [...new Set(r.structures.map(s => s.type.name))].slice(0, 3);
            const biomeTags = Object.keys(r.biomeCounts).slice(0, 3);

            resultsHTML += `
                <div class="result-item" data-seed="${r.seed}">
                    <div class="result-seed">
                        <span>${r.seed}</span>
                        <span class="result-score">${r.score}pts</span>
                    </div>
                    <div class="result-details">
                        ${biomeTags.map(b => `<span class="result-tag biome">${b}</span>`).join('')}
                        ${structTags.map(s => `<span class="result-tag structure">${s}</span>`).join('')}
                        ${r.slimeNearSpawn > 0 ? `<span class="result-tag slime">💚 ${r.slimeNearSpawn}</span>` : ''}
                    </div>
                    <div class="result-actions">
                        <button class="result-action-btn sf-view" data-seed="${r.seed}">View Map</button>
                        <button class="result-action-btn sf-fav" data-seed="${r.seed}">${isFavorite(r.seed) ? '★' : '☆'} Fav</button>
                        <button class="result-action-btn sf-compare" data-seed="${r.seed}">Compare</button>
                    </div>
                </div>
            `;
        }

        content.innerHTML = `
            <div style="margin-bottom:8px; font-size:11px; color:#888;">
                Found <b style="color:#f0a500">${result.results.length}</b> seeds matching "${result.preset.name}"
            </div>
            <div class="results-list">${resultsHTML}</div>
        `;

        // Bind actions
        content.querySelectorAll('.sf-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                loadSeedOnMap(btn.dataset.seed);
            });
        });

        content.querySelectorAll('.sf-fav').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const seed = btn.dataset.seed;
                if (isFavorite(seed)) {
                    removeFavorite(seed);
                    btn.textContent = '☆ Fav';
                    showToast('Removed from favorites');
                } else {
                    addFavorite(seed, seed);
                    btn.textContent = '★ Fav';
                    showToast('Added to favorites!');
                }
            });
        });

        content.querySelectorAll('.sf-compare').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openCompareDialog(btn.dataset.seed);
            });
        });
    }

    function renderFavoritesTab(content) {
        const favs = getFavorites();

        if (favs.length === 0) {
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">⭐</div>
                    <div class="empty-state-text">No favorites yet.<br>Star seeds from search results to save them here.</div>
                </div>
            `;
            return;
        }

        let items = '';
        for (const f of favs) {
            const analysis = analyzeSeed(f.seed);
            items += `
                <div class="result-item" data-seed="${f.seed}">
                    <div class="result-seed">
                        <span>${f.seed}</span>
                        <span class="result-tag" style="font-size:9px;">${analysis.spawnBiome}</span>
                    </div>
                    <div class="result-details">
                        <span class="result-tag structure">${analysis.structures.length} structures</span>
                        <span class="result-tag biome">${Object.keys(analysis.biomeCounts).length} biomes</span>
                    </div>
                    <div class="result-actions">
                        <button class="result-action-btn sf-view" data-seed="${f.seed}">View Map</button>
                        <button class="result-action-btn sf-remove-fav" data-seed="${f.seed}">✕ Remove</button>
                    </div>
                </div>
            `;
        }

        content.innerHTML = `<div class="results-list">${items}</div>`;

        content.querySelectorAll('.sf-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                loadSeedOnMap(btn.dataset.seed);
            });
        });

        content.querySelectorAll('.sf-remove-fav').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeFavorite(btn.dataset.seed);
                renderFavoritesTab(content);
                showToast('Removed from favorites');
            });
        });
    }

    function renderGalleryTab(content) {
        let category = 'All';
        let filtered = TOP_SEEDS;

        function renderCards() {
            const cards = (category === 'All' ? TOP_SEEDS : TOP_SEEDS.filter(s => s.category === category)).map(s => `
                <div class="gallery-card" data-seed="${s.seed}">
                    <div class="gallery-card-header">
                        <span class="gallery-card-name">${s.name}</span>
                        <span class="gallery-card-rating">★ ${s.rating} (${s.votes})</span>
                    </div>
                    <div class="gallery-card-seed">Seed: ${s.seed}</div>
                    <div class="gallery-card-desc">${s.description}</div>
                    <div class="gallery-card-footer">
                        <span class="gallery-card-category">${s.category}</span>
                        <span class="gallery-card-author">by ${s.author}</span>
                    </div>
                    <div class="result-actions" style="margin-top:6px;">
                        <button class="result-action-btn sf-view" data-seed="${s.seed}">View Map</button>
                        <button class="result-action-btn sf-fav" data-seed="${s.seed}">${isFavorite(s.seed) ? '★' : '☆'} Fav</button>
                        <button class="result-action-btn sf-compare" data-seed="${s.seed}">Compare</button>
                    </div>
                </div>
            `).join('');

            return `<div class="gallery-grid">${cards || '<div class="empty-state"><div class="empty-state-text">No seeds in this category</div></div>'}</div>`;
        }

        content.innerHTML = `
            <div class="gallery-filters">
                ${SEED_CATEGORIES.map(c => `
                    <button class="gallery-filter ${c === category ? 'active' : ''}" data-cat="${c}">${c}</button>
                `).join('')}
            </div>
            ${renderCards()}
        `;

        content.querySelectorAll('.gallery-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                content.querySelectorAll('.gallery-filter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                category = btn.dataset.cat;
                content.innerHTML = `
                    <div class="gallery-filters">
                        ${SEED_CATEGORIES.map(c => `
                            <button class="gallery-filter ${c === category ? 'active' : ''}" data-cat="${c}">${c}</button>
                        `).join('')}
                    </div>
                    ${renderCards()}
                `;
                bindGalleryActions();
            });
        });

        bindGalleryActions();
    }

    function bindGalleryActions() {
        const content = document.getElementById('sf-content');
        if (!content) return;

        content.querySelectorAll('.sf-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                loadSeedOnMap(btn.dataset.seed);
            });
        });

        content.querySelectorAll('.sf-fav').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const seed = btn.dataset.seed;
                if (isFavorite(seed)) {
                    removeFavorite(seed);
                    btn.textContent = '☆ Fav';
                } else {
                    addFavorite(seed, seed);
                    btn.textContent = '★ Fav';
                }
            });
        });

        content.querySelectorAll('.sf-compare').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openCompareDialog(btn.dataset.seed);
            });
        });
    }

    function loadSeedOnMap(seed) {
        // Use TerrainGenerator from terrain.js if available
        if (window.TerrainGenerator) {
            window.TerrainGenerator.loadSeed(seed);
        }

        // Use app.js integration if available
        if (typeof loadSeed === 'function') {
            loadSeed(seed);
        }

        // Update UI elements
        const seedLabel = document.getElementById('seedLabel') || document.getElementById('current-seed');
        if (seedLabel) seedLabel.textContent = seed;

        // Dispatch event
        window.dispatchEvent(new CustomEvent('seedLoaded', { detail: { seed } }));

        showToast('Loaded seed: ' + seed);
    }

    // ── Seed Comparison ──────────────────────────────────────────
    function openCompareDialog(seed1) {
        if (compareContainer) compareContainer.remove();

        compareContainer = document.createElement('div');
        compareContainer.className = 'compare-panel active';
        compareContainer.innerHTML = `
            <div class="compare-header">
                <span class="compare-title">⚖️ Seed Comparison</span>
                <button class="seedfinder-close" id="sf-compare-close">&times;</button>
            </div>
            <div class="compare-body">
                <div class="compare-inputs">
                    <div class="compare-field">
                        <label>Seed 1</label>
                        <input type="text" id="sf-compare-seed1" value="${seed1 || ''}" placeholder="Enter seed...">
                    </div>
                    <div class="compare-field">
                        <label>Seed 2</label>
                        <input type="text" id="sf-compare-seed2" value="" placeholder="Enter seed...">
                    </div>
                    <button class="compare-go-btn" id="sf-compare-go">Compare</button>
                </div>
                <div class="compare-results" id="sf-compare-results"></div>
            </div>
        `;

        document.body.appendChild(compareContainer);

        document.getElementById('sf-compare-close').addEventListener('click', () => {
            compareContainer.remove();
        });

        document.getElementById('sf-compare-go').addEventListener('click', performCompare);

        // Auto-compare if first seed provided
        if (seed1) {
            setTimeout(performCompare, 100);
        }
    }

    function performCompare() {
        const seed1 = document.getElementById('sf-compare-seed1').value.trim();
        const seed2 = document.getElementById('sf-compare-seed2').value.trim();

        if (!seed1 || !seed2) {
            showToast('Enter both seeds to compare', 'error');
            return;
        }

        const a1 = analyzeSeed(seed1);
        const a2 = analyzeSeed(seed2);
        const diff = compareAnalysis(a1, a2);

        const resultsEl = document.getElementById('sf-compare-results');

        function statRow(label, v1, v2, unit) {
            unit = unit || '';
            const diffVal = typeof v1 === 'number' && typeof v2 === 'number' ? v1 - v2 : null;
            const diffStr = diffVal !== null ? ` <span style="color:${diffVal > 0 ? '#66bb6a' : diffVal < 0 ? '#ff1744' : '#666'}">(${diffVal > 0 ? '+' : ''}${diffVal})</span>` : '';
            return `
                <div class="compare-stat">
                    <span class="compare-stat-label">${label}</span>
                    <span class="compare-stat-value">${v1}${unit} vs ${v2}${unit}${diffStr}</span>
                </div>
            `;
        }

        resultsEl.innerHTML = `
            <div class="compare-side">
                <h4>🌱 ${a1.seed}</h4>
                ${statRow('Spawn Biome', a1.spawnBiome, a2.spawnBiome)}
                ${statRow('Structures', a1.structures.length, a2.structures.length)}
                ${statRow('Biome Types', Object.keys(a1.biomeCounts).length, Object.keys(a2.biomeCounts).length)}
                ${statRow('Slime Chunks', a1.slimeNearSpawn, a2.slimeNearSpawn)}
                ${statRow('Score', calculateScore(a1, {}), calculateScore(a2, {}))}
                <div style="margin-top:8px; font-size:10px; color:#888;">
                    <b style="color:#aaa;">Structures:</b><br>
                    ${[...new Set(a1.structures.map(s => s.type.name))].slice(0, 5).join(', ') || 'None'}
                </div>
            </div>
            <div class="compare-side">
                <h4>🌱 ${a2.seed}</h4>
                <div style="font-size:11px; padding:3px 0;">
                    <span style="color:#888;">Spawn Biome:</span> <b>${a2.spawnBiome}</b>
                </div>
                <div style="font-size:11px; padding:3px 0;">
                    <span style="color:#888;">Structures:</span> <b>${a2.structures.length}</b>
                </div>
                <div style="font-size:11px; padding:3px 0;">
                    <span style="color:#888;">Biome Types:</span> <b>${Object.keys(a2.biomeCounts).length}</b>
                </div>
                <div style="font-size:11px; padding:3px 0;">
                    <span style="color:#888;">Slime Chunks:</span> <b>${a2.slimeNearSpawn}</b>
                </div>
                <div style="margin-top:8px; font-size:10px; color:#888;">
                    <b style="color:#aaa;">Structures:</b><br>
                    ${[...new Set(a2.structures.map(s => s.type.name))].slice(0, 5).join(', ') || 'None'}
                </div>
            </div>

            ${diff.length > 0 ? `
                <div style="grid-column: 1 / -1;">
                    <div class="compare-diff">
                        <h4>⚠️ Key Differences</h4>
                        ${diff.map(d => `<div style="font-size:11px; padding:2px 0; color:#ccc;">${d}</div>`).join('')}
                    </div>
                </div>
            ` : ''}

            <div style="grid-column: 1 / -1;">
                <div class="blend-container">
                    <label class="blend-label">Blend: ${a1.seed} ←→ ${a2.seed}</label>
                    <input type="range" class="blend-slider" id="sf-blend" min="0" max="100" value="50">
                    <div style="display:flex; justify-content:space-between; font-size:9px; color:#666; margin-top:2px;">
                        <span>${a1.seed}</span>
                        <span>${a2.seed}</span>
                    </div>
                </div>
            </div>

            <div style="grid-column:1/-1; display:flex; gap:8px;">
                <button class="result-action-btn" onclick="document.getElementById('sf-compare-seed1').value='${a2.seed}'; document.getElementById('sf-compare-seed2').value='${a1.seed}'; performCompare();">⇄ Swap</button>
                <button class="result-action-btn" onclick="loadSeedOnMap('${a1.seed}'); compareContainer.remove();">Load ${a1.seed}</button>
                <button class="result-action-btn" onclick="loadSeedOnMap('${a2.seed}'); compareContainer.remove();">Load ${a2.seed}</button>
            </div>
        `;

        // Blend slider animation
        const slider = document.getElementById('sf-blend');
        if (slider) {
            slider.addEventListener('input', () => {
                const val = parseInt(slider.value);
                const left = compareContainer.querySelectorAll('.compare-side')[0];
                const right = compareContainer.querySelectorAll('.compare-side')[1];
                if (left && right) {
                    const opacity = val / 100;
                    right.style.opacity = 0.3 + opacity * 0.7;
                    left.style.opacity = 0.3 + (1 - opacity) * 0.7;
                }
            });
        }
    }

    function compareAnalysis(a1, a2) {
        const diffs = [];

        if (a1.spawnBiome !== a2.spawnBiome) {
            diffs.push(`Spawn biome: <b>${a1.spawnBiome}</b> vs <b>${a2.spawnBiome}</b>`);
        }

        const s1 = a1.structures.length;
        const s2 = a2.structures.length;
        if (s1 !== s2) {
            diffs.push(`Structure count: <b>${s1}</b> vs <b>${s2}</b>`);
        }

        const b1 = Object.keys(a1.biomeCounts).length;
        const b2 = Object.keys(a2.biomeCounts).length;
        if (b1 !== b2) {
            diffs.push(`Biome diversity: <b>${b1}</b> types vs <b>${b2}</b> types`);
        }

        if (Math.abs(a1.slimeNearSpawn - a2.slimeNearSpawn) > 1) {
            diffs.push(`Slime chunks: <b>${a1.slimeNearSpawn}</b> vs <b>${a2.slimeNearSpawn}</b>`);
        }

        return diffs;
    }

    // ── Public API ───────────────────────────────────────────────
    const SeedFinder = {
        /** Open the Seed Finder panel */
        open: function () {
            if (!uiContainer) {
                buildUI();
            } else {
                uiContainer.style.display = 'flex';
                renderTab('search');
            }
        },

        /** Close the Seed Finder panel */
        close: function () {
            if (uiContainer) uiContainer.style.display = 'none';
        },

        /** Toggle the Seed Finder panel */
        toggle: function () {
            if (!uiContainer || uiContainer.style.display === 'none') {
                this.open();
            } else {
                this.close();
            }
        },

        /** Search for seeds matching a preset */
        search: function (presetName, maxResults, progressCallback) {
            return searchPreset(presetName, maxResults, progressCallback);
        },

        /** Get available presets */
        getPresets: function () {
            return Object.assign({}, PRESETS);
        },

        /** Analyze a single seed */
        analyze: function (seed) {
            return analyzeSeed(seed);
        },

        /** Evaluate custom conditions against a seed */
        evaluate: function (seed, conditions) {
            const analysis = analyzeSeed(seed);
            return evaluateConditions(analysis, conditions);
        },

        /** Compare two seeds */
        compare: function (seed1, seed2) {
            const a1 = analyzeSeed(seed1);
            const a2 = analyzeSeed(seed2);
            return {
                seed1: a1,
                seed2: a2,
                differences: compareAnalysis(a1, a2),
            };
        },

        /** Open compare dialog */
        openCompare: function (seed1) {
            openCompareDialog(seed1);
        },

        /** Get top seeds gallery */
        getTopSeeds: function (category) {
            if (category && category !== 'All') {
                return TOP_SEEDS.filter(s => s.category === category);
            }
            return [...TOP_SEEDS];
        },

        /** Get available categories */
        getCategories: function () {
            return [...SEED_CATEGORIES];
        },

        /** Get favorites list */
        getFavorites: getFavorites,

        /** Add to favorites */
        addFavorite: addFavorite,

        /** Remove from favorites */
        removeFavorite: removeFavorite,

        /** Check if seed is favorited */
        isFavorite: isFavorite,

        /** Load a seed on the map */
        loadSeed: loadSeedOnMap,

        /** Get analysis engine config */
        getConfig: function () {
            return {
                SEARCH_AREA: SEARCH_AREA,
                SAMPLE_STEP: SAMPLE_STEP,
                STRUCTURE_RADIUS: STRUCTURE_RADIUS,
            };
        },
    };

    // Export to window
    window.SeedFinder = SeedFinder;

    // Auto-bind to a button if one exists
    function bindTrigger() {
        const trigger = document.getElementById('seedfinder-trigger');
        if (trigger) {
            trigger.addEventListener('click', () => SeedFinder.toggle());
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindTrigger);
    } else {
        bindTrigger();
    }

    console.log('[SeedFinder] Initialized — window.SeedFinder ready');

})();

/* ============================================================
   Minecraft Live Map — Seeded Terrain Generator
   ============================================================

   Generates procedural Minecraft-like terrain from a seed
   for display on the Leaflet map. Deterministic: same seed
   always produces the same map.

   Exports: window.TerrainGenerator.loadSeed(seed)
   ============================================================ */

(function () {
    'use strict';

    // ── Seeded Random Number Generator ─────────────────────────
    // Simple hash function (mulberry32) for deterministic output
    function mulberry32(a) {
        return function () {
            let t = a += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    // Hash a string seed into a 32-bit integer
    function hashSeed(seed) {
        if (typeof seed === 'number') return seed >>> 0;
        let hash = 0;
        const str = String(seed);
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return hash >>> 0;
    }

    // ── Simplified Perlin-like Noise ───────────────────────────
    // Uses a hash-based gradient approach for 2D noise
    function makeNoise2D(seed) {
        const rng = mulberry32(seed);
        const permutation = [];
        for (let i = 0; i < 256; i++) permutation[i] = i;
        // Fisher-Yates shuffle
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
        }
        // Double the permutation table
        const p = new Array(512);
        for (let i = 0; i < 512; i++) p[i] = permutation[i & 255];

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

    // Multi-octave noise (fractal Brownian motion)
    function fbm(noise, x, y, octaves, persistence, lacunarity) {
        let total = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;
        for (let i = 0; i < octaves; i++) {
            total += noise(x * frequency, y * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }
        return total / maxValue;
    }

    // ── Biome Definitions ──────────────────────────────────────
    const BIOMES = {
        PLAINS:    { id: 0, name: 'Plains',    color: '#9bc755', colorDark: '#7ab83e' },
        FOREST:    { id: 1, name: 'Forest',    color: '#3b7a3b', colorDark: '#2d5c2d' },
        DESERT:    { id: 2, name: 'Desert',    color: '#d4c478', colorDark: '#c4b060' },
        OCEAN:     { id: 3, name: 'Ocean',     color: '#3a6ea5', colorDark: '#2d5580' },
        MOUNTAINS: { id: 4, name: 'Mountains', color: '#8a8a8a', colorDark: '#6e6e6e' },
        SNOW:      { id: 5, name: 'Snow',      color: '#f0f0f0', colorDark: '#d8d8d8' },
    };

    // Determine biome from temperature, humidity, elevation
    function getBiome(elevation, temperature, humidity) {
        if (elevation < -0.3) return BIOMES.OCEAN;
        if (elevation > 0.5) {
            if (temperature < -0.2) return BIOMES.SNOW;
            return BIOMES.MOUNTAINS;
        }
        if (temperature > 0.3 && humidity < -0.1) return BIOMES.DESERT;
        if (humidity > 0.15) return BIOMES.FOREST;
        return BIOMES.PLAINS;
    }

    // ── Structure Definitions ──────────────────────────────────
    const STRUCTURES = {
        VILLAGE:    { id: 'village',    name: 'Village',    icon: '🏠', color: '#f5a623' },
        TEMPLE:     { id: 'temple',     name: 'Temple',     icon: '💎', color: '#9b59b6' },
        STRONGHOLD: { id: 'stronghold', name: 'Stronghold', icon: '👁️', color: '#e74c3c' },
        RUINS:      { id: 'ruins',      name: 'Ruins',      icon: '🏚️', color: '#7f8c8d' },
    };

    // ── Terrain Generator Configuration ────────────────────────
    const TERRAIN_CONFIG = {
        worldSize: 20000,          // Total world size in blocks (x: -10000 to 10000)
        regionSize: 500,           // Size of each biome region in blocks
        gridInterval: 1000,        // Grid lines every 1000 blocks
        noiseScale: 0.002,         // Scale for biome noise
        tempScale: 0.003,          // Scale for temperature noise
        humidityScale: 0.0025,     // Scale for humidity noise
        elevationOctaves: 4,       // Octaves for elevation noise
        biomeOctaves: 3,           // Octaves for biome noise
        structureAttempts: 40,     // How many times to try placing structures
        structureMinDistance: 1500, // Min distance between structures of same type
    };

    // ── Layer Groups ───────────────────────────────────────────
    let biomeLayer = null;
    let gridLayer = null;
    let structureLayer = null;

    function initLayers() {
        if (biomeLayer) biomeLayer.remove();
        if (gridLayer) gridLayer.remove();
        if (structureLayer) structureLayer.remove();

        biomeLayer = L.layerGroup();
        gridLayer = L.layerGroup();
        structureLayer = L.layerGroup();
    }

    // ── Generate Biomes ────────────────────────────────────────
    function generateBiomes(seed) {
        const cfg = TERRAIN_CONFIG;
        const elevNoise = makeNoise2D(seed);
        const tempNoise = makeNoise2D(seed + 1000);
        const humidNoise = makeNoise2D(seed + 2000);

        const regions = [];
        const halfSize = cfg.worldSize / 2;
        const step = cfg.regionSize;

        for (let x = -halfSize; x < halfSize; x += step) {
            for (let z = -halfSize; z < halfSize; z += step) {
                // Sample noise at region center
                const cx = x + step / 2;
                const cz = z + step / 2;

                const elevation = fbm(elevNoise, cx * cfg.noiseScale, cz * cfg.noiseScale,
                    cfg.elevationOctaves, 0.5, 2.0);
                const temperature = fbm(tempNoise, cx * cfg.tempScale, cz * cfg.tempScale,
                    cfg.biomeOctaves, 0.5, 2.0);
                const humidity = fbm(humidNoise, cx * cfg.humidityScale, cz * cfg.humidityScale,
                    cfg.biomeOctaves, 0.5, 2.0);

                const biome = getBiome(elevation, temperature, humidity);

                regions.push({
                    x1: x,
                    z1: z,
                    x2: x + step,
                    z2: z + step,
                    biome: biome,
                    elevation: elevation,
                    centerX: cx,
                    centerZ: cz,
                });
            }
        }

        return regions;
    }

    // ── Draw Biome Regions ─────────────────────────────────────
    function drawBiomes(regions) {
        biomeLayer.clearLayers();

        for (const region of regions) {
            // Leaflet uses [lat, lng] = [z, x]
            const bounds = [
                [region.z1, region.x1],
                [region.z2, region.x2],
            ];

            const rect = L.rectangle(bounds, {
                color: region.biome.colorDark,
                weight: 1,
                opacity: 0.15,
                fillColor: region.biome.color,
                fillOpacity: 0.25,
                interactive: false,
            });

            rect.bindTooltip(
                `${region.biome.name} (${Math.round(region.centerX)}, ${Math.round(region.centerZ)})`,
                { sticky: true, direction: 'top', offset: [0, -10] }
            );

            rect.addTo(biomeLayer);
        }

        biomeLayer.addTo(map);
        biomeLayer.setOpacity(0.35);
    }

    // ── Generate Structures ────────────────────────────────────
    function generateStructures(seed, regions) {
        const cfg = TERRAIN_CONFIG;
        const rng = mulberry32(hashSeed(seed) ^ 0xDEADBEEF);

        const structures = [];
        const placedPositions = {};

        const attempts = cfg.structureAttempts;
        const structureTypes = Object.values(STRUCTURES);

        for (let i = 0; i < attempts; i++) {
            const structType = structureTypes[Math.floor(rng() * structureTypes.length)];

            // Pick a random region
            const region = regions[Math.floor(rng() * regions.length)];

            // Check if biome is valid for this structure
            let allowedBiomes;
            if (structType.id === 'village') allowedBiomes = [BIOMES.PLAINS, BIOMES.FOREST];
            else if (structType.id === 'temple') allowedBiomes = [BIOMES.DESERT, BIOMES.FOREST];
            else if (structType.id === 'stronghold') allowedBiomes = [BIOMES.MOUNTAINS, BIOMES.PLAINS, BIOMES.FOREST];
            else allowedBiomes = [BIOMES.PLAINS, BIOMES.DESERT, BIOMES.FOREST, BIOMES.SNOW];

            if (!allowedBiomes.includes(region.biome)) continue;

            // Random position within region
            const sx = region.x1 + rng() * cfg.regionSize;
            const sz = region.z1 + rng() * cfg.regionSize;

            // Check minimum distance from same type
            const key = structType.id;
            if (!placedPositions[key]) placedPositions[key] = [];

            let tooClose = false;
            for (const pos of placedPositions[key]) {
                const dx = sx - pos.x;
                const dz = sz - pos.z;
                if (Math.sqrt(dx * dx + dz * dz) < cfg.structureMinDistance) {
                    tooClose = true;
                    break;
                }
            }
            if (tooClose) continue;

            placedPositions[key].push({ x: sx, z: sz });

            structures.push({
                type: structType,
                x: sx,
                z: sz,
                biome: region.biome,
            });
        }

        return structures;
    }

    // ── Draw Structures ────────────────────────────────────────
    function drawStructures(structures) {
        structureLayer.clearLayers();

        for (const s of structures) {
            const icon = L.divIcon({
                className: 'structure-marker',
                html: `
                    <div style="
                        font-size: 22px;
                        text-align: center;
                        line-height: 28px;
                        width: 28px;
                        height: 28px;
                        background: rgba(0,0,0,0.5);
                        border: 2px solid ${s.type.color};
                        border-radius: 50%;
                        text-shadow: 0 0 3px #000;
                    ">${s.type.icon}</div>
                `,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
            });

            const marker = L.marker([s.z, s.x], { icon: icon }).addTo(structureLayer);

            marker.bindPopup(`
                <div style="text-align:center; font-family: sans-serif;">
                    <strong style="color: ${s.type.color}">${s.type.icon} ${s.type.name}</strong><br>
                    <span style="font-size: 12px; color: #aaa;">
                        X: ${Math.round(s.x)} | Z: ${Math.round(s.z)}<br>
                        Biome: ${s.biome.name}
                    </span>
                </div>
            `);
        }

        structureLayer.addTo(map);
    }

    // ── Draw Grid Lines ────────────────────────────────────────
    function drawGrid(seed) {
        gridLayer.clearLayers();

        const cfg = TERRAIN_CONFIG;
        const halfSize = cfg.worldSize / 2;
        const interval = cfg.gridInterval;

        const gridOptions = {
            color: '#ffffff',
            weight: 0.5,
            opacity: 0.15,
            interactive: false,
        };

        const gridBoldOptions = {
            color: '#ffffff',
            weight: 1,
            opacity: 0.3,
            interactive: false,
        };

        // Draw vertical lines (along x axis)
        for (let x = -halfSize; x <= halfSize; x += interval) {
            const isMajor = x % (interval * 5) === 0;
            const opts = isMajor ? gridBoldOptions : gridOptions;

            L.polyline(
                [[-halfSize, x], [halfSize, x]],
                opts
            ).addTo(gridLayer);
        }

        // Draw horizontal lines (along z axis)
        for (let z = -halfSize; z <= halfSize; z += interval) {
            const isMajor = z % (interval * 5) === 0;
            const opts = isMajor ? gridBoldOptions : gridOptions;

            L.polyline(
                [[z, -halfSize], [z, halfSize]],
                opts
            ).addTo(gridLayer);
        }

        // Coordinate labels
        for (let x = -halfSize; x <= halfSize; x += interval * 5) {
            for (let z = -halfSize; z <= halfSize; z += interval * 5) {
                if (x === 0 && z === 0) continue;

                const label = L.marker([z, x], {
                    icon: L.divIcon({
                        className: 'coord-label',
                        html: `<span style="
                            font-size: 9px;
                            color: rgba(255,255,255,0.5);
                            font-family: monospace;
                            white-space: nowrap;
                            text-shadow: 0 0 2px #000;
                        ">${x},${z}</span>`,
                        iconSize: [60, 12],
                        iconAnchor: [30, 6],
                    }),
                    interactive: false,
                }).addTo(gridLayer);
            }
        }

        // Origin marker
        const originIcon = L.divIcon({
            className: 'origin-marker',
            html: '<div style="position:relative; width:12px; height:12px; background:#ff4444; border-radius:50%; border:2px solid white; opacity:0.8;"></div>',
            iconSize: [12, 12],
            iconAnchor: [6, 6],
        });
        L.marker([0, 0], { icon: originIcon, interactive: false })
            .bindTooltip('Origin (0, 0)', { permanent: false })
            .addTo(gridLayer);

        gridLayer.addTo(map);
    }

    // ── Public API ─────────────────────────────────────────────
    const TerrainGenerator = {
        /**
         * Load terrain for a given seed.
         * @param {string|number} seed - The world seed (string or number).
         */
        loadSeed: function (seed) {
            if (typeof seed === 'undefined' || seed === null || seed === '') {
                seed = 'default';
            }

            console.log(`[TerrainGenerator] Loading seed: "${seed}"`);

            // Ensure map is available
            if (typeof map === 'undefined') {
                console.error('[TerrainGenerator] Leaflet map not initialized!');
                return;
            }

            // Initialize/clear layers
            initLayers();

            // Generate terrain
            const hashedSeed = hashSeed(seed);
            const regions = generateBiomes(hashedSeed);
            const structures = generateStructures(seed, regions);

            // Draw everything
            drawBiomes(regions);
            drawGrid(hashedSeed);
            drawStructures(structures);

            // Zoom to fit terrain
            const halfSize = TERRAIN_CONFIG.worldSize / 2;
            map.fitBounds([[-halfSize, -halfSize], [halfSize, halfSize]], {
                padding: [50, 50],
            });

            console.log(`[TerrainGenerator] Generated ${regions.length} regions, ${structures.length} structures for seed "${seed}"`);

            // Dispatch event for app.js integration
            try {
                window.dispatchEvent(new CustomEvent('terrainLoaded', {
                    detail: { seed, regionCount: regions.length, structureCount: structures.length }
                }));
            } catch (e) {
                // Ignore if CustomEvent not supported
            }

            return {
                seed: seed,
                hashedSeed: hashedSeed,
                regions: regions.length,
                structures: structures.length,
            };
        },

        /**
         * Get the configuration.
         */
        getConfig: function () {
            return Object.assign({}, TERRAIN_CONFIG);
        },

        /**
         * Get available biomes.
         */
        getBiomes: function () {
            return Object.assign({}, BIOMES);
        },

        /**
         * Get available structure types.
         */
        getStructureTypes: function () {
            return Object.assign({}, STRUCTURES);
        },

        /**
         * Clear all terrain layers from the map.
         */
        clear: function () {
            if (biomeLayer) biomeLayer.remove();
            if (gridLayer) gridLayer.remove();
            if (structureLayer) structureLayer.remove();
            biomeLayer = null;
            gridLayer = null;
            structureLayer = null;
        },
    };

    // Export to window
    window.TerrainGenerator = TerrainGenerator;
    window.biomeLayer = biomeLayer;
    window.gridLayer = gridLayer;
    window.structureLayer = structureLayer;

})();

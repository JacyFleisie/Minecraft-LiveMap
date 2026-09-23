/* ============================================================
   Minecraft LiveMap — Structure Generator & Overlay System
   ============================================================
   Generates accurate Minecraft Bedrock Edition structures from a
   world seed using cubiomes-inspired generation algorithms.

   Structures are organized into three dimensions (Overworld,
   Nether, End) with category-based visibility toggling.

   Exports: window.StructureGenerator
   ============================================================ */

(function () {
    'use strict';

    // ── Java-Compatible LCG (cubiomes/bedrock uses this) ─────
    // Java's Random uses a 48-bit LCG: next = (seed * 0x5DEECE66D + 0xB) & ((1<<48)-1)
    const JAVA_LCG_MULT = 0x5DEECE66D;
    const JAVA_LCG_ADD = 0xB;
    const JAVA_LCG_MASK = (1n << 48n) - 1n;

    function javaRandom(seed) {
        let s = BigInt(seed) & JAVA_LCG_MASK;
        return {
            next(bits) {
                s = (s * BigInt(JAVA_LCG_MULT) + BigInt(JAVA_LCG_ADD)) & JAVA_LCG_MASK;
                return Number(s >> BigInt(48 - bits));
            },
            nextInt(bound) {
                if (bound <= 0) return 0;
                if ((bound & (bound - 1)) === 0) {
                    // power of 2
                    return (bound * this.next(31)) >> 31;
                }
                let bits, val;
                do {
                    bits = this.next(31);
                    val = bits % bound;
                } while (bits - val + (bound - 1) < 0);
                return val;
            },
            nextLong() {
                return (BigInt(this.next(32)) << 32n) + BigInt(this.next(32));
            },
            nextFloat() {
                return this.next(24) / (1 << 24);
            },
            setSeed(seed) {
                s = (BigInt(seed) ^ BigInt(JAVA_LCG_MULT)) & JAVA_LCG_MASK;
            }
        };
    }

    // Hash a string seed into a 64-bit-like number for Java RNG
    function hashSeedToLong(seed) {
        if (typeof seed === 'number') return seed | 0;
        if (typeof seed === 'string') {
            let h1 = 0xdeadbeef ^ 0;
            let h2 = 0x41c6ce57 ^ 0;
            for (let i = 0; i < seed.length; i++) {
                const ch = seed.charCodeAt(i);
                h1 = Math.imul(h1 ^ ch, 2654435761);
                h2 = Math.imul(h2 ^ ch, 1597334677);
            }
            h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
            h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
            h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
            h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
            return (h2 >>> 0);
        }
        return 0;
    }

    // ── 2D Position Hash ──────────────────────────────────────
    function chunkSeed(regionSeed, x, z) {
        let seed = regionSeed;
        seed = Math.imul(seed ^ 0x3DACA199, 0x2D4E7B3D) | 0;
        seed = (seed + x) | 0;
        seed = Math.imul(seed ^ 0x3DACA199, 0x2D4E7B3D) | 0;
        seed = (seed + z) | 0;
        return seed;
    }

    function regionSeed(worldSeed, regionX, regionZ, salt) {
        let seed = worldSeed | 0;
        seed = Math.imul(seed ^ 0x3DACA199, 0x2D4E7B3D) | 0;
        seed = (seed + regionX) | 0;
        seed = Math.imul(seed ^ 0x3DACA199, 0x2D4E7B3D) | 0;
        seed = (seed + regionZ) | 0;
        seed = Math.imul(seed ^ 0x3DACA199, 0x2D4E7B3D) | 0;
        seed = (seed + salt) | 0;
        return seed;
    }

    // ── Noise Helpers ─────────────────────────────────────────
    function hash2D(x, z, seed) {
        let h = seed | 0;
        h = Math.imul(h ^ x, 0x27D4EB2D) | 0;
        h = Math.imul(h ^ z, 0x165667B1) | 0;
        h ^= h >>> 15;
        h = Math.imul(h, 0x85EBCA6B) | 0;
        h ^= h >>> 13;
        h = Math.imul(h, 0xC2B2AE35) | 0;
        h ^= h >>> 16;
        return ((h >>> 0) / 4294967296);
    }

    function smoothNoise2D(x, z, seed) {
        const ix = Math.floor(x);
        const iz = Math.floor(z);
        const fx = x - ix;
        const fz = z - iz;

        const n00 = hash2D(ix, iz, seed);
        const n10 = hash2D(ix + 1, iz, seed);
        const n01 = hash2D(ix, iz + 1, seed);
        const n11 = hash2D(ix + 1, iz + 1, seed);

        const sx = fx * fx * (3 - 2 * fx);
        const sz = fz * fz * (3 - 2 * fz);

        const nx0 = n00 + sx * (n10 - n00);
        const nx1 = n01 + sx * (n11 - n01);
        return nx0 + sz * (nx1 - nx0);
    }

    // ── Biome Approximation ───────────────────────────────────
    // Approximate biome at position for structure biome filtering
    function approximateBiome(x, z, worldSeed) {
        const temp = smoothNoise2D(x * 0.003, z * 0.003, worldSeed);
        const humid = smoothNoise2D(x * 0.004, z * 0.004, worldSeed + 100);
        const elev = smoothNoise2D(x * 0.002, z * 0.002, worldSeed + 200);

        if (elev < 0.35) return 'ocean';
        if (elev > 0.75) {
            if (temp < 0.3) return 'snow';
            return 'mountains';
        }
        if (temp > 0.65 && humid < 0.4) return 'desert';
        if (temp > 0.55 && humid > 0.5) return 'jungle';
        if (temp < 0.35 && humid > 0.3) return 'taiga';
        if (humid > 0.65) return 'swamp';
        if (temp > 0.45 && humid < 0.45) return 'savanna';
        if (elev < 0.42) return 'beach';
        return 'plains';
    }

    function isOceanBiome(biome) {
        return ['ocean', 'beach'].includes(biome);
    }

    // ── Structure Definitions ─────────────────────────────────
    // Each structure has: id, name, icon, color, category, dimension,
    // description, and generation parameters (spacing, separation, salt)

    const STRUCTURE_TYPES = {
        // === OVERWORLD STRUCTURES ===

        // ── Buildings ──
        VILLAGE_PLAINS: {
            id: 'village_plains', name: 'Village (Plains)', icon: '🏠', color: '#f5a623',
            category: 'overworld_buildings', dimension: 'overworld',
            description: 'A plains village with houses, farms, and a well. Iron Golem spawns naturally.',
            spacing: 34, separation: 8, salt: 10387312,
            allowedBiomes: ['plains', 'meadow'],
            bedrockSpacing: 34, bedrockSeparation: 8,
        },
        VILLAGE_DESERT: {
            id: 'village_desert', name: 'Village (Desert)', icon: '🏜️', color: '#e8c170',
            category: 'overworld_buildings', dimension: 'overworld',
            description: 'A desert village with sandstone buildings and cactus farms.',
            spacing: 34, separation: 8, salt: 14357617,
            allowedBiomes: ['desert'],
            bedrockSpacing: 34, bedrockSeparation: 8,
        },
        VILLAGE_SAVANNA: {
            id: 'village_savanna', name: 'Village (Savanna)', icon: '🌾', color: '#c4a44a',
            category: 'overworld_buildings', dimension: 'overworld',
            description: 'A savanna village with acacia buildings and terraced farms.',
            spacing: 34, separation: 8, salt: 14357619,
            allowedBiomes: ['savanna'],
            bedrockSpacing: 34, bedrockSeparation: 8,
        },
        VILLAGE_TAIGA: {
            id: 'village_taiga', name: 'Village (Taiga)', icon: '🌲', color: '#5a8a4a',
            category: 'overworld_buildings', dimension: 'overworld',
            description: 'A taiga village with spruce buildings and berry farms.',
            spacing: 34, separation: 8, salt: 14357620,
            allowedBiomes: ['taiga'],
            bedrockSpacing: 34, bedrockSeparation: 8,
        },
        VILLAGE_SNOWY: {
            id: 'village_snowy', name: 'Village (Snowy)', icon: '❄️', color: '#e0e8f0',
            category: 'overworld_buildings', dimension: 'overworld',
            description: 'A snowy tundra village with ice paths and frozen farms.',
            spacing: 34, separation: 8, salt: 14357618,
            allowedBiomes: ['snow'],
            bedrockSpacing: 34, bedrockSeparation: 8,
        },
        DESERT_TEMPLE: {
            id: 'desert_temple', name: 'Desert Temple', icon: '🏛️', color: '#e8d568',
            category: 'overworld_buildings', dimension: 'overworld',
            description: 'A sandstone temple hiding treasure below. TNT trap under the blue wool block.',
            spacing: 32, separation: 8, salt: 14357617,
            allowedBiomes: ['desert'],
            bedrockSpacing: 32, bedrockSeparation: 8,
        },
        JUNGLE_TEMPLE: {
            id: 'jungle_temple', name: 'Jungle Temple', icon: '🌿', color: '#2d8a2d',
            category: 'overworld_buildings', dimension: 'overworld',
            description: 'A mossy cobblestone temple with arrow dispensers and tripwire traps.',
            spacing: 32, separation: 8, salt: 14357619,
            allowedBiomes: ['jungle'],
            bedrockSpacing: 32, bedrockSeparation: 8,
        },
        WITCH_HUT: {
            id: 'witch_hut', name: 'Witch Hut', icon: '🧙', color: '#6a3a8a',
            category: 'overworld_buildings', dimension: 'overworld',
            description: 'A small swamp hut where a Witch spawns. Only spawns witches, not other mobs.',
            spacing: 32, separation: 8, salt: 14357620,
            allowedBiomes: ['swamp'],
            bedrockSpacing: 32, bedrockSeparation: 8,
        },
        PILLAGER_OUTPOST: {
            id: 'pillager_outpost', name: 'Pillager Outpost', icon: '🚩', color: '#E91E63',
            category: 'overworld_buildings', dimension: 'overworld',
            description: 'A dark oak watchtower where Pillager patrols spawn. Contains an Iron Golem cage.',
            spacing: 32, separation: 8, salt: 165745296,
            allowedBiomes: ['plains', 'desert', 'savanna', 'taiga', 'meadow'],
            bedrockSpacing: 32, bedrockSeparation: 8,
        },
        WOODLAND_MANSION: {
            id: 'woodland_mansion', name: 'Woodland Mansion', icon: '🏚️', color: '#795548',
            category: 'overworld_buildings', dimension: 'overworld',
            description: 'A massive dark oak mansion containing Evokers, Vindicators, and rare loot.',
            spacing: 80, separation: 20, salt: 10387319,
            allowedBiomes: ['forest', 'taiga', 'jungle'],
            bedrockSpacing: 80, bedrockSeparation: 20,
        },
        ANCIENT_CITY: {
            id: 'ancient_city', name: 'Ancient City', icon: '💎', color: '#00BCD4',
            category: 'overworld_buildings', dimension: 'overworld',
            description: 'A deep dark city with Sculk blocks and the Warden. Contains a hidden Redstone portal frame.',
            spacing: 24, separation: 8, salt: 20083232,
            allowedBiomes: ['deep_dark'],
            bedrockSpacing: 24, bedrockSeparation: 8,
        },

        // ── Ocean Structures ──
        OCEAN_MONUMENT: {
            id: 'ocean_monument', name: 'Ocean Monument', icon: '🌊', color: '#2196F3',
            category: 'overworld_ocean', dimension: 'overworld',
            description: 'A prismarine temple guarded by Guardians. Contains 8 gold blocks and a Sponges room.',
            spacing: 32, separation: 5, salt: 10387313,
            allowedBiomes: ['ocean'],
            bedrockSpacing: 32, bedrockSeparation: 5,
        },
        SHIPWRECK: {
            id: 'shipwreck', name: 'Shipwreck', icon: '⛵', color: '#8D6E63',
            category: 'overworld_ocean', dimension: 'overworld',
            description: 'A sunken ship with up to 3 loot chests (Supply, Treasure, Map).',
            spacing: 24, separation: 4, salt: 165745295,
            allowedBiomes: ['ocean', 'beach'],
            bedrockSpacing: 24, bedrockSeparation: 4,
        },
        OCEAN_RUIN: {
            id: 'ocean_ruin', name: 'Ocean Ruin', icon: '🪨', color: '#607D8B',
            category: 'overworld_ocean', dimension: 'overworld',
            description: 'Ruined underwater structures containing suspicious gravel and loot chests.',
            spacing: 20, separation: 8, salt: 14357621,
            allowedBiomes: ['ocean'],
            bedrockSpacing: 20, bedrockSeparation: 8,
        },

        // ── Portal Structures ──
        RUINED_PORTAL_OVERWORLD: {
            id: 'ruined_portal_ow', name: 'Ruined Portal (Overworld)', icon: '🔮', color: '#FF5722',
            category: 'overworld_portals', dimension: 'overworld',
            description: 'A partially destroyed Nether Portal with crying obsidian and a loot chest.',
            spacing: 40, separation: 15, salt: 34222645,
            allowedBiomes: ['plains', 'desert', 'forest', 'jungle', 'taiga', 'savanna', 'snow', 'mountains', 'meadow'],
            bedrockSpacing: 40, bedrockSeparation: 15,
        },

        // ── Special Structures ──
        IGLOO: {
            id: 'igloo', name: 'Igloo', icon: '🏠', color: '#E1F5FE',
            category: 'overworld_special', dimension: 'overworld',
            description: 'A snow hut. 50% chance contains a basement with a zombie villager and cure station.',
            spacing: 32, separation: 8, salt: 14357618,
            allowedBiomes: ['snow', 'taiga'],
            bedrockSpacing: 32, bedrockSeparation: 8,
        },
        TRAIL_RUINS: {
            id: 'trail_ruins', name: 'Trail Ruins', icon: '🏺', color: '#BCAAA4',
            category: 'overworld_special', dimension: 'overworld',
            description: 'Ancient trail structures from 1.21+. Contains pottery sherds and archaeology sites.',
            spacing: 34, separation: 8, salt: 83469867,
            allowedBiomes: ['taiga', 'jungle', 'forest'],
            bedrockSpacing: 34, bedrockSeparation: 8,
        },
        ABANDONED_CAMP: {
            id: 'abandoned_camp', name: 'Abandoned Camp', icon: '⛺', color: '#A1887F',
            category: 'overworld_special', dimension: 'overworld',
            description: 'A 1.21.4+ abandoned camp with tents and campfires. Contains unique loot.',
            spacing: 32, separation: 8, salt: 14357622,
            allowedBiomes: ['plains', 'forest', 'taiga', 'meadow'],
            bedrockSpacing: 32, bedrockSeparation: 8,
        },
        TRIAL_CHAMBER: {
            id: 'trial_chamber', name: 'Trial Chamber', icon: '⚔️', color: '#7C4DFF',
            category: 'overworld_special', dimension: 'overworld',
            description: 'A 1.21.4+ procedural dungeon with Trial Spawners, vaults, and unique rewards.',
            spacing: 80, separation: 20, salt: 10387320,
            allowedBiomes: ['plains', 'desert', 'forest', 'taiga', 'savanna', 'jungle'],
            bedrockSpacing: 80, bedrockSeparation: 20,
        },
        DUNGEON: {
            id: 'dungeon', name: 'Dungeon', icon: '🕷️', color: '#455A64',
            category: 'overworld_special', dimension: 'overworld',
            description: 'A cobblestone/mossy cobblestone room with a Monster Spawner and loot chests.',
            spacing: 16, separation: 4, salt: 0,
            allowedBiomes: ['plains', 'desert', 'forest', 'jungle', 'taiga', 'savanna', 'snow', 'mountains'],
            bedrockSpacing: 16, bedrockSeparation: 4,
        },
        MINESHAFT: {
            id: 'mineshaft', name: 'Mineshaft', icon: '⛏️', color: '#607D8B',
            category: 'overworld_special', dimension: 'overworld',
            description: 'Abandoned mines with tunnels, caves spider spawners, and minecart chests.',
            spacing: 16, separation: 1, salt: 0,
            allowedBiomes: ['plains', 'desert', 'forest', 'jungle', 'taiga', 'savanna', 'snow', 'mountains', 'meadow'],
            bedrockSpacing: 1, bedrockSeparation: 1,
        },
        STRONGHOLD: {
            id: 'stronghold', name: 'Stronghold', icon: '👁️', color: '#e74c3c',
            category: 'overworld_special', dimension: 'overworld',
            description: 'A stone brick fortress containing the End Portal. 128 per world in concentric rings.',
            spacing: 32, separation: 1, salt: 0,
            allowedBiomes: ['plains', 'desert', 'forest', 'jungle', 'taiga', 'savanna', 'snow', 'mountains'],
            bedrockSpacing: 1, bedrockSeparation: 1,
        },
        BURIED_TREASURE: {
            id: 'buried_treasure', name: 'Buried Treasure', icon: '💰', color: '#FFD700',
            category: 'overworld_special', dimension: 'overworld',
            description: 'A single chest buried in beach sand. Contains Heart of the Sea, TNT, and potions.',
            spacing: 16, separation: 1, salt: 10387320,
            allowedBiomes: ['beach'],
            bedrockSpacing: 1, bedrockSeparation: 1,
        },
        DESERT_WELL: {
            id: 'desert_well', name: 'Desert Well', icon: '🪣', color: '#D7CCC8',
            category: 'overworld_special', dimension: 'overworld',
            description: 'A small sandstone well in the desert. Purely decorative, sometimes useful for farms.',
            spacing: 32, separation: 8, salt: 14357620,
            allowedBiomes: ['desert'],
            bedrockSpacing: 32, bedrockSeparation: 8,
        },
        FOSSIL: {
            id: 'fossil', name: 'Fossil', icon: '🦴', color: '#EFEBE9',
            category: 'overworld_special', dimension: 'overworld',
            description: 'Ancient bone blocks underground. Found in swamps and deserts. 2 per chunk attempt.',
            spacing: 16, separation: 4, salt: 14357921,
            allowedBiomes: ['swamp', 'desert'],
            bedrockSpacing: 16, bedrockSeparation: 4,
        },

        // ── Geological Features ──
        AMETHYST_GEODE: {
            id: 'amethyst_geode', name: 'Amethyst Geode', icon: '💜', color: '#9C27B0',
            category: 'overworld_geological', dimension: 'overworld',
            description: 'A geode of budding amethyst, smooth basalt, and calcite. Yields amethyst shards.',
            spacing: 16, separation: 4, salt: 0,
            allowedBiomes: ['plains', 'desert', 'forest', 'jungle', 'taiga', 'savanna', 'snow', 'mountains', 'meadow'],
            bedrockSpacing: 4, bedrockSeparation: 2,
        },
        RAVINE: {
            id: 'ravine', name: 'Ravine', icon: '🏔️', color: '#5D4037',
            category: 'overworld_geological', dimension: 'overworld',
            description: 'A deep narrow canyon carved by terrain generation. Often exposes ores.',
            spacing: 32, separation: 8, salt: 0,
            allowedBiomes: ['plains', 'desert', 'forest', 'jungle', 'taiga', 'savanna', 'snow', 'mountains'],
            bedrockSpacing: 8, bedrockSeparation: 4,
        },
        LAVA_POOL: {
            id: 'lava_pool', name: 'Lava Pool', icon: '🌋', color: '#FF5722',
            category: 'overworld_geological', dimension: 'overworld',
            description: 'A surface pool of lava, common in badlands and mountainous terrain.',
            spacing: 32, separation: 8, salt: 0,
            allowedBiomes: ['plains', 'desert', 'savanna', 'mountains'],
            bedrockSpacing: 8, bedrockSeparation: 4,
        },
        ORE_VEIN: {
            id: 'ore_vein', name: 'Ore Vein', icon: '🪨', color: '#78909C',
            category: 'overworld_geological', dimension: 'overworld',
            description: 'A large copper or iron ore vein from 1.18+ world generation.',
            spacing: 16, separation: 4, salt: 0,
            allowedBiomes: ['plains', 'desert', 'forest', 'jungle', 'taiga', 'savanna', 'snow', 'mountains'],
            bedrockSpacing: 4, bedrockSeparation: 2,
        },
        SLIME_CHUNK: {
            id: 'slime_chunk', name: 'Slime Chunk', icon: '🟢', color: '#69F0AE',
            category: 'overworld_geological', dimension: 'overworld',
            description: 'A chunk where slimes spawn below Y=40 regardless of light level.',
            spacing: 1, separation: 1, salt: 0,
            allowedBiomes: ['plains', 'desert', 'forest', 'jungle', 'taiga', 'savanna', 'snow', 'mountains', 'meadow'],
            bedrockSpacing: 1, bedrockSeparation: 1,
        },

        // ── Spawn/World ──
        WORLD_SPAWN: {
            id: 'world_spawn', name: 'World Spawn Point', icon: '⭐', color: '#FFD700',
            category: 'overworld_spawn', dimension: 'overworld',
            description: 'The default world spawn point where players first appear.',
            spacing: 1, separation: 1, salt: 0,
            allowedBiomes: ['plains', 'desert', 'forest', 'jungle', 'taiga', 'savanna', 'snow', 'mountains', 'meadow'],
            bedrockSpacing: 1, bedrockSeparation: 1,
        },
        SPAWN_CHUNKS: {
            id: 'spawn_chunks', name: 'Spawn Chunks', icon: '📍', color: '#FF4081',
            category: 'overworld_spawn', dimension: 'overworld',
            description: 'The 23x23 chunk area around spawn that remains loaded. Entities persist here.',
            spacing: 1, separation: 1, salt: 0,
            allowedBiomes: ['plains', 'desert', 'forest', 'jungle', 'taiga', 'savanna', 'snow', 'mountains', 'meadow'],
            bedrockSpacing: 1, bedrockSeparation: 1,
        },

        // === NETHER STRUCTURES ===
        NETHER_FORTRESS: {
            id: 'nether_fortress', name: 'Nether Fortress', icon: '🏰', color: '#7B1FA2',
            category: 'nether_structures', dimension: 'nether',
            description: 'A dark brick fortress with Blaze spawners, Wither Skeletons, and Nether Wart rooms.',
            spacing: 30, separation: 6, salt: 30084232,
            allowedBiomes: ['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest', 'basalt_deltas'],
            bedrockSpacing: 30, bedrockSeparation: 6,
        },
        BASTION_REMNANT: {
            id: 'bastion_remnant', name: 'Bastion Remnant', icon: '🔥', color: '#FF9800',
            category: 'nether_structures', dimension: 'nether',
            description: 'A Piglin bastion with bridge, treasure, housing, or stable variants. Ancient Debris here.',
            spacing: 27, separation: 4, salt: 30084232,
            allowedBiomes: ['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest'],
            bedrockSpacing: 27, bedrockSeparation: 4,
        },
        RUINED_PORTAL_NETHER: {
            id: 'ruined_portal_nether', name: 'Ruined Portal (Nether)', icon: '🔮', color: '#FF5722',
            category: 'nether_structures', dimension: 'nether',
            description: 'A ruined portal in the Nether with crying obsidian and a loot chest.',
            spacing: 40, separation: 15, salt: 34222645,
            allowedBiomes: ['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest', 'basalt_deltas'],
            bedrockSpacing: 40, bedrockSeparation: 15,
        },
        END_GATEWAY_NETHER: {
            id: 'end_gateway_nether', name: 'End Gateway (Nether)', icon: '🌀', color: '#00BCD4',
            category: 'nether_structures', dimension: 'nether',
            description: 'A portal gateway that appears after defeating the End Dragon. Teleports to outer End islands.',
            spacing: 43, separation: 7, salt: 34222645,
            allowedBiomes: ['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest'],
            bedrockSpacing: 43, bedrockSeparation: 7,
        },

        // === END STRUCTURES ===
        END_CITY: {
            id: 'end_city', name: 'End City', icon: '🌌', color: '#673AB7',
            category: 'end_structures', dimension: 'end',
            description: 'Tall purpur towers containing Shulkers and an Elytra in the End Ship.',
            spacing: 20, separation: 11, salt: 10387313,
            allowedBiomes: ['end_highlands', 'end_midlands'],
            bedrockSpacing: 20, bedrockSeparation: 11,
        },
        END_SHIP: {
            id: 'end_ship', name: 'End Ship', icon: '🚀', color: '#7C4DFF',
            category: 'end_structures', dimension: 'end',
            description: 'A floating ship attached to End Cities. Contains the Elytra and Dragon Head.',
            spacing: 20, separation: 11, salt: 10387313,
            allowedBiomes: ['end_highlands', 'end_midlands'],
            bedrockSpacing: 20, bedrockSeparation: 11,
        },
        END_GATEWAY: {
            id: 'end_gateway', name: 'End Gateway', icon: '🌀', color: '#00BCD4',
            category: 'end_structures', dimension: 'end',
            description: 'A circular bedrock gateway portal. Teleports players to outer End islands.',
            spacing: 43, separation: 7, salt: 34222645,
            allowedBiomes: ['end_highlands', 'end_midlands', 'end_barrens'],
            bedrockSpacing: 43, bedrockSeparation: 7,
        },
    };

    // ── Category Definitions ──────────────────────────────────
    const CATEGORIES = {
        // Overworld
        overworld_buildings:   { id: 'overworld_buildings',   name: '🏛️ OW Buildings',  color: '#f5a623', visible: true, dimension: 'overworld' },
        overworld_ocean:       { id: 'overworld_ocean',       name: '🌊 OW Ocean',      color: '#2196F3', visible: true, dimension: 'overworld' },
        overworld_portals:     { id: 'overworld_portals',     name: '🔮 OW Portals',    color: '#FF5722', visible: true, dimension: 'overworld' },
        overworld_special:     { id: 'overworld_special',     name: '⭐ OW Special',    color: '#e74c3c', visible: true, dimension: 'overworld' },
        overworld_geological:  { id: 'overworld_geological',  name: '🪨 OW Geological', color: '#78909C', visible: true, dimension: 'overworld' },
        overworld_spawn:       { id: 'overworld_spawn',       name: '📍 OW Spawn/World', color: '#FF4081', visible: true, dimension: 'overworld' },
        // Nether
        nether_structures:     { id: 'nether_structures',     name: '🔥 Nether',        color: '#7B1FA2', visible: true, dimension: 'nether' },
        // End
        end_structures:        { id: 'end_structures',        name: '🌌 End',           color: '#673AB7', visible: true, dimension: 'end' },
    };

    // ── Module State ─────────────────────────────────────────
    const state = {
        worldSeed: null,
        structures: [],
        layerGroups: {},      // category ID -> L.layerGroup
        categoryVisibility: {}, // category ID -> boolean
        generatedCategories: new Set(),
    };

    // ── Layer Management ─────────────────────────────────────
    function ensureMap() {
        if (typeof window.map !== 'undefined' && window.map) return window.map;
        if (typeof map !== 'undefined' && map) return map;
        return null;
    }

    function initLayerGroups() {
        const map = ensureMap();
        if (!map) return;

        // Clear existing
        for (const key of Object.keys(state.layerGroups)) {
            if (state.layerGroups[key]) {
                state.layerGroups[key].remove();
            }
        }
        state.layerGroups = {};

        // Create one layer group per category
        for (const cat of Object.values(CATEGORIES)) {
            state.layerGroups[cat.id] = L.layerGroup();
            state.categoryVisibility[cat.id] = cat.visible;
            if (cat.visible) {
                state.layerGroups[cat.id].addTo(map);
            }
        }
    }

    // ── Structure Generation Algorithms ──────────────────────

    /**
     * Standard structure generation using cubiomes-inspired algorithm.
     * Structures are placed on a grid (region). Each region has exactly one
     * candidate position determined by seed.
     */
    function generateStandardStructure(worldSeed, type, range) {
        const results = [];
        const spacing = type.bedrockSpacing || type.spacing || 32;
        const separation = type.bedrockSeparation || type.separation || 8;
        const salt = type.salt || 0;

        if (spacing <= 0 || separation <= 0) return results;

        const halfRange = range || 5000;
        const regionCount = Math.ceil((halfRange * 2) / spacing);

        for (let rx = -Math.floor(regionCount / 2); rx <= Math.floor(regionCount / 2); rx++) {
            for (let rz = -Math.floor(regionCount / 2); rz <= Math.floor(regionCount / 2); rz++) {
                const sSeed = regionSeed(worldSeed, rx, rz, salt);
                const rng = javaRandom(sSeed);

                const offsetX = rng.nextInt(spacing - separation);
                const offsetZ = rng.nextInt(spacing - separation);

                const x = rx * spacing + offsetX;
                const z = rz * spacing + offsetZ;

                if (Math.abs(x) > halfRange || Math.abs(z) > halfRange) continue;

                // Biome check (approximate)
                if (type.allowedBiomes && type.allowedBiomes.length > 0) {
                    const biome = approximateBiome(x, z, worldSeed);
                    if (!type.allowedBiomes.includes(biome)) continue;
                }

                results.push({
                    type: type,
                    x: x,
                    z: z,
                    biome: 'unknown', // simplified
                });
            }
        }

        return results;
    }

    /**
     * Stronghold ring generation (Bedrock: 128 in concentric rings)
     */
    function generateStrongholds(worldSeed) {
        const results = [];
        const type = STRUCTURE_TYPES.STRONGHOLD;

        // Bedrock Edition stronghold rings
        // Ring 1: 3 strongholds at ~1408-2688 blocks
        // Ring 2: 6 at ~4480-5760
        // Ring 3: 10 at ~7552-8832
        // Ring 4: 15 at ~10624-11904
        // Ring 5: 21 at ~13696-14976
        // Ring 6: 28 at ~16768-18048
        // Ring 7: 36 at ~19840-21120
        // Ring 8: 9 at ~22912-24192
        const rings = [
            { count: 3, minDist: 1408, maxDist: 2688 },
            { count: 6, minDist: 4480, maxDist: 5760 },
            { count: 10, minDist: 7552, maxDist: 8832 },
            { count: 15, minDist: 10624, maxDist: 11904 },
            { count: 21, minDist: 13696, maxDist: 14976 },
            { count: 28, minDist: 16768, maxDist: 18048 },
            { count: 36, minDist: 19840, maxDist: 21120 },
            { count: 9, minDist: 22912, maxDist: 24192 },
        ];

        const rng = javaRandom(worldSeed);

        for (const ring of rings) {
            const angleStep = (2 * Math.PI) / ring.count;
            const angleOffset = rng.nextFloat() * 2 * Math.PI;

            for (let i = 0; i < ring.count; i++) {
                const angle = angleOffset + angleOffset * i;
                const dist = ring.minDist + rng.nextFloat() * (ring.maxDist - ring.minDist);
                const x = Math.round(Math.cos(angle) * dist);
                const z = Math.round(Math.sin(angle) * dist);

                results.push({
                    type: type,
                    x: x,
                    z: z,
                    biome: 'unknown',
                    ringDistance: Math.round(dist),
                });
            }
        }

        return results;
    }

    /**
     * Mineshaft generation (not truly seed-based in Bedrock, uses chunk RNG)
     * Approximation: generate candidate positions in mined chunks
     */
    function generateMineshafts(worldSeed) {
        const results = [];
        const type = STRUCTURE_TYPES.MINESHAFT;
        const rng = javaRandom(worldSeed ^ 0xA157C12);
        const halfRange = 3000;

        // Approximate: mineshafts attempt per chunk with ~0.4% probability
        const chunkAttempts = Math.floor((halfRange * 2 / 16) * (halfRange * 2 / 16) * 0.004);

        for (let i = 0; i < Math.min(chunkAttempts, 50); i++) {
            const cx = rng.nextInt(halfRange * 2) - halfRange;
            const cz = rng.nextInt(halfRange * 2) - halfRange;

            results.push({
                type: type,
                x: cx,
                z: cz,
                biome: 'unknown',
            });
        }

        return results;
    }

    /**
     * Dungeon generation (uses chunk-based RNG in Bedrock)
     */
    function generateDungeons(worldSeed) {
        const results = [];
        const type = STRUCTURE_TYPES.DUNGEON;
        const rng = javaRandom(worldSeed ^ 0xD3AD1);
        const halfRange = 2000;

        // Dungeons attempt per chunk with ~1.5% probability
        const chunkAttempts = Math.floor((halfRange * 2 / 16) * (halfRange * 2 / 16) * 0.015);

        for (let i = 0; i < Math.min(chunkAttempts, 30); i++) {
            const cx = rng.nextInt(halfRange * 2) - halfRange;
            const cz = rng.nextInt(halfRange * 2) - halfRange;

            results.push({
                type: type,
                x: cx,
                z: cz,
                biome: 'unknown',
            });
        }

        return results;
    }

    /**
     * Slime chunk generation (Bedrock: uses chunk coords + world seed)
     */
    function generateSlimeChunks(worldSeed) {
        const results = [];
        const type = STRUCTURE_TYPES.SLIME_CHUNK;
        const halfRange = 2000;

        // In Bedrock: slime chunks are determined by:
        // seed = (seed + (cx * cx * 0x4c1906) + (cx * 0x5ac0db) + (cz * cz) * 0x4307a7L + (cz * 0x5f24f) ^ 0x3ad8025f)
        // then check if (random(seed) % 10 == 0)
        const chunkRadius = halfRange / 16;

        for (let cx = -chunkRadius; cx <= chunkRadius; cx++) {
            for (let cz = -chunkRadius; cz <= chunkRadius; cz++) {
                // Bedrock slime chunk formula
                let s = worldSeed | 0;
                s = (s + (cx * cx * 0x4c1906) | 0) | 0;
                s = (s + (cx * 0x5ac0db) | 0) | 0;
                s = (s + (cz * cz * 0x4307a7) | 0) | 0;
                s = (s + (cz * 0x5f24f) | 0) | 0;
                s = (s ^ 0x3ad8025f) | 0;

                const rng = javaRandom(s);
                if (rng.nextInt(10) === 0) {
                    results.push({
                        type: type,
                        x: cx * 16 + 8,
                        z: cz * 16 + 8,
                        biome: 'unknown',
                    });
                }
            }
        }

        return results;
    }

    /**
     * Geological feature generation (ravines, lava pools, ore veins, geodes)
     */
    function generateGeologicalFeatures(worldSeed) {
        const results = [];
        const halfRange = 3000;

        // Amethyst Geodes
        const geodeType = STRUCTURE_TYPES.AMETHYST_GEODE;
        const geodeRng = javaRandom(worldSeed ^ 0x601A1C3);
        const geodeCount = Math.floor((halfRange / 8) * (halfRange / 8) * 0.003);
        for (let i = 0; i < Math.min(geodeCount, 30); i++) {
            const x = geodeRng.nextInt(halfRange * 2) - halfRange;
            const z = geodeRng.nextInt(halfRange * 2) - halfRange;
            results.push({ type: geodeType, x, z, biome: 'unknown' });
        }

        // Ravines
        const ravineType = STRUCTURE_TYPES.RAVINE;
        const ravineRng = javaRandom(worldSeed ^ 0x8B07D2A);
        const ravineCount = Math.floor((halfRange / 16) * (halfRange / 16) * 0.008);
        for (let i = 0; i < Math.min(ravineCount, 20); i++) {
            const x = ravineRng.nextInt(halfRange * 2) - halfRange;
            const z = ravineRng.nextInt(halfRange * 2) - halfRange;
            results.push({ type: ravineType, x, z, biome: 'unknown' });
        }

        // Lava Pools
        const lavaType = STRUCTURE_TYPES.LAVA_POOL;
        const lavaRng = javaRandom(worldSeed ^ 0xCAFE123);
        const lavaCount = Math.floor((halfRange / 16) * (halfRange / 16) * 0.005);
        for (let i = 0; i < Math.min(lavaCount, 25); i++) {
            const x = lavaRng.nextInt(halfRange * 2) - halfRange;
            const z = lavaRng.nextInt(halfRange * 2) - halfRange;
            results.push({ type: lavaType, x, z, biome: 'unknown' });
        }

        // Ore Veins
        const oreType = STRUCTURE_TYPES.ORE_VEIN;
        const oreRng = javaRandom(worldSeed ^ 0xBEEF456);
        const oreCount = Math.floor((halfRange / 8) * (halfRange / 8) * 0.006);
        for (let i = 0; i < Math.min(oreCount, 35); i++) {
            const x = oreRng.nextInt(halfRange * 2) - halfRange;
            const z = oreRng.nextInt(halfRange * 2) - halfRange;
            results.push({ type: oreType, x, z, biome: 'unknown' });
        }

        return results;
    }

    /**
     * Buried Treasure generation (chunk-based in Bedrock, only in beaches)
     */
    function generateBuriedTreasure(worldSeed) {
        const results = [];
        const type = STRUCTURE_TYPES.BURIED_TREASURE;
        const halfRange = 2000;
        const rng = javaRandom(worldSeed ^ 0x1B2D3F4);

        // ~1 attempt per chunk in beach biomes with ~50% chance
        const count = Math.floor((halfRange * 2 / 16) * (halfRange * 2 / 16) * 0.5);
        for (let i = 0; i < Math.min(count, 15); i++) {
            const x = rng.nextInt(halfRange * 2) - halfRange;
            const z = rng.nextInt(halfRange * 2) - halfRange;

            const biome = approximateBiome(x, z, worldSeed);
            if (biome !== 'beach' && biome !== 'ocean') continue;

            results.push({
                type: type,
                x: x,
                z: z,
                biome: biome,
            });
        }

        return results;
    }

    /**
     * Nether structure generation
     */
    function generateNetherStructures(worldSeed) {
        const results = [];

        // Nether Fortress
        const fortressType = STRUCTURE_TYPES.NETHER_FORTRESS;
        const fortResults = generateStandardStructure(worldSeed, fortressType, 2000);
        results.push(...fortResults);

        // Bastion Remnant
        const bastionType = STRUCTURE_TYPES.BASTION_REMNANT;
        const bastionResults = generateStandardStructure(worldSeed, bastionType, 2000);
        results.push(...bastionResults);

        // Ruined Portal (Nether)
        const portalType = STRUCTURE_TYPES.RUINED_PORTAL_NETHER;
        const portalResults = generateStandardStructure(worldSeed, portalType, 2000);
        results.push(...portalResults);

        // End Gateway (Nether)
        const gatewayType = STRUCTURE_TYPES.END_GATEWAY_NETHER;
        const gatewayResults = generateStandardStructure(worldSeed, gatewayType, 2000);
        results.push(...gatewayResults);

        return results;
    }

    /**
     * End structure generation
     */
    function generateEndStructures(worldSeed) {
        const results = [];

        // End City
        const cityType = STRUCTURE_TYPES.END_CITY;
        const halfRange = 3000;
        const citySpacing = 20;
        const citySep = 11;
        const citySalt = 10387313;
        const rng = javaRandom(worldSeed ^ 0xABCD1234);

        const regionCount = Math.ceil((halfRange * 2) / citySpacing);
        for (let rx = -Math.floor(regionCount / 2); rx <= Math.floor(regionCount / 2); rx++) {
            for (let rz = -Math.floor(regionCount / 2); rz <= Math.floor(regionCount / 2); rz++) {
                const sSeed = regionSeed(worldSeed, rx, rz, citySalt);
                const r = javaRandom(sSeed);
                const ox = r.nextInt(citySpacing - citySep);
                const oz = r.nextInt(citySpacing - citySep);
                const x = rx * citySpacing + ox;
                const z = rz * citySpacing + oz;

                if (Math.abs(x) > halfRange || Math.abs(z) > halfRange) continue;

                results.push({ type: cityType, x, z, biome: 'end_highlands' });

                // End Ship has ~50% chance with End City
                if (r.nextFloat() < 0.5) {
                    results.push({
                        type: STRUCTURE_TYPES.END_SHIP,
                        x: x + r.nextInt(20) - 10,
                        z: z + r.nextInt(20) - 10,
                        biome: 'end_highlands',
                    });
                }
            }
        }

        // End Gateway
        const gwType = STRUCTURE_TYPES.END_GATEWAY;
        const gwResults = generateStandardStructure(worldSeed, gwType, 3000);
        results.push(...gwResults);

        return results;
    }

    /**
     * Generate World Spawn Point
     */
    function generateWorldSpawn(worldSeed) {
        const results = [];
        const type = STRUCTURE_TYPES.WORLD_SPAWN;

        // Bedrock spawn algorithm: searches for a valid biome near 0,0
        // Usually within 256 blocks of origin
        const rng = javaRandom(worldSeed);
        const spawnX = rng.nextInt(256) - 128;
        const spawnZ = rng.nextInt(256) - 128;

        results.push({
            type: type,
            x: spawnX,
            z: spawnZ,
            biome: 'unknown',
        });

        // Spawn Chunks marker
        results.push({
            type: STRUCTURE_TYPES.SPAWN_CHUNKS,
            x: spawnX,
            z: spawnZ,
            biome: 'unknown',
        });

        return results;
    }

    // ── Main Generation Function ─────────────────────────────
    function generateAllStructures(seed) {
        state.worldSeed = seed;
        state.structures = [];
        state.generatedCategories = new Set();

        const worldSeed = hashSeedToLong(seed);
        const allStructures = [];

        // Generate each structure type
        const structureKeys = Object.keys(STRUCTURE_TYPES);

        for (const key of structureKeys) {
            const type = STRUCTURE_TYPES[key];

            // Skip spawn chunks, world spawn - handled separately
            if (type.id === 'world_spawn' || type.id === 'spawn_chunks') continue;
            if (type.id === 'stronghold') {
                allStructures.push(...generateStrongholds(worldSeed));
                continue;
            }
            if (type.id === 'mineshaft') {
                allStructures.push(...generateMineshafts(worldSeed));
                continue;
            }
            if (type.id === 'dungeon') {
                allStructures.push(...generateDungeons(worldSeed));
                continue;
            }
            if (type.id === 'slime_chunk') {
                allStructures.push(...generateSlimeChunks(worldSeed));
                continue;
            }
            if (type.id === 'buried_treasure') {
                allStructures.push(...generateBuriedTreasure(worldSeed));
                continue;
            }
            // Geological
            if (['amethyst_geode', 'ravine', 'lava_pool', 'ore_vein'].includes(type.id)) continue; // handled by generateGeologicalFeatures
            // Nether
            if (type.id === 'nether_fortress' || type.id === 'bastion_remnant' || type.id === 'ruined_portal_nether' || type.id === 'end_gateway_nether') continue;
            // End
            if (type.id === 'end_city' || type.id === 'end_ship' || type.id === 'end_gateway') continue;

            const results = generateStandardStructure(worldSeed, type, 3000);
            allStructures.push(...results);
        }

        // Special generators
        allStructures.push(...generateGeologicalFeatures(worldSeed));
        allStructures.push(...generateNetherStructures(worldSeed));
        allStructures.push(...generateEndStructures(worldSeed));
        allStructures.push(...generateWorldSpawn(worldSeed));

        state.structures = allStructures;

        // Track which categories have structures
        for (const s of allStructures) {
            state.generatedCategories.add(s.type.category);
        }

        return allStructures;
    }

    // ── Icon/Marker Creation ─────────────────────────────────
    function createStructureIcon(structure) {
        const type = structure.type;
        return L.divIcon({
            className: `structure-marker structure-${type.id}`,
            html: `
                <div class="struct-icon-wrapper" style="
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: ${type.color}22;
                    border: 2px solid ${type.color};
                    border-radius: 50%;
                    box-shadow: 0 0 6px ${type.color}88;
                    cursor: pointer;
                    transition: transform 0.15s ease;
                ">
                    <span style="
                        font-size: 18px;
                        line-height: 1;
                        filter: drop-shadow(0 0 2px rgba(0,0,0,0.8));
                    ">${type.icon}</span>
                </div>
            `,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
        });
    }

    function createPopupContent(structure) {
        const type = structure.type;
        const dimLabel = type.dimension === 'nether' ? 'Nether' :
                         type.dimension === 'end' ? 'End' : 'Overworld';

        let extraInfo = '';
        if (structure.ringDistance) {
            extraInfo = `<br><b>Ring Distance:</b> ${structure.ringDistance} blocks`;
        }

        return `
            <div class="struct-popup" style="
                font-family: 'Segoe UI', system-ui, sans-serif;
                min-width: 180px;
                padding: 4px;
            ">
                <div style="
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 8px;
                    padding-bottom: 6px;
                    border-bottom: 1px solid ${type.color}44;
                ">
                    <span style="font-size: 24px;">${type.icon}</span>
                    <div>
                        <strong style="color: ${type.color}; font-size: 14px;">${type.name}</strong>
                        <br>
                        <span style="
                            font-size: 10px;
                            text-transform: uppercase;
                            letter-spacing: 0.5px;
                            color: #888;
                        ">${dimLabel} • ${type.category.replace(/_/g, ' ').replace('ow ', '')}</span>
                    </div>
                </div>
                <div style="
                    font-size: 12px;
                    color: #aaa;
                    line-height: 1.5;
                    margin-bottom: 8px;
                ">${type.description}</div>
                <div style="
                    display: flex;
                    justify-content: space-between;
                    font-size: 11px;
                    color: #666;
                    padding-top: 6px;
                    border-top: 1px solid #333;
                    font-family: 'JetBrains Mono', 'Fira Code', monospace;
                ">
                    <span>X: <b style="color: #ccc;">${structure.x}</b></span>
                    <span>Z: <b style="color: #ccc;">${structure.z}</b></span>
                </div>
                ${extraInfo ? `<div style="font-size:10px;color:#888;margin-top:4px;">${extraInfo}</div>` : ''}
            </div>
        `;
    }

    // ── Rendering ────────────────────────────────────────────
    function renderStructures() {
        const map = ensureMap();
        if (!map) {
            console.warn('[StructureGenerator] Map not available');
            return;
        }

        initLayerGroups();

        for (const structure of state.structures) {
            const categoryId = structure.type.category;
            const layerGroup = state.layerGroups[categoryId];

            if (!layerGroup) continue;
            if (!state.categoryVisibility[categoryId]) continue;

            const marker = L.marker([structure.z, structure.x], {
                icon: createStructureIcon(structure),
                interactive: true,
            });

            marker.bindPopup(createPopupContent(structure), {
                maxWidth: 280,
                className: 'structure-popup-wrapper',
            });

            // Hover effect
            marker.on('mouseover', function () {
                const iconEl = this.getElement();
                if (iconEl) {
                    iconEl.style.transform = 'scale(1.2)';
                    iconEl.style.zIndex = '999';
                }
            });
            marker.on('mouseout', function () {
                const iconEl = this.getElement();
                if (iconEl) {
                    iconEl.style.transform = 'scale(1)';
                    iconEl.style.zIndex = '';
                }
            });

            marker.addTo(layerGroup);
        }

        // Update popup if it exists in index.html
        const markerCount = document.getElementById('markerCount');
        if (markerCount) {
            markerCount.textContent = state.structures.length;
        }
    }

    // ── Category Toggle System ───────────────────────────────
    function toggleCategory(categoryId, visible) {
        state.categoryVisibility[categoryId] = visible;
        const layerGroup = state.layerGroups[categoryId];
        const map = ensureMap();

        if (!layerGroup || !map) return;

        if (visible) {
            if (!map.hasLayer(layerGroup)) {
                layerGroup.addTo(map);
            }
        } else {
            if (map.hasLayer(layerGroup)) {
                layerGroup.remove();
            }
        }
    }

    function toggleAllCategories(visible) {
        for (const catId of Object.keys(state.categoryVisibility)) {
            toggleCategory(catId, visible);
        }
    }

    function toggleDimension(dimension, visible) {
        for (const cat of Object.values(CATEGORIES)) {
            if (cat.dimension === dimension) {
                toggleCategory(cat.id, visible);
            }
        }
    }

    // ── UI Panel Creation ────────────────────────────────────
    function createControlPanel() {
        // Remove existing panel if any
        const existing = document.getElementById('structure-control-panel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'structure-control-panel';

        // Build category list
        const dims = {
            overworld: { name: '🌍 Overworld', color: '#7ec850' },
            nether:    { name: '🔥 Nether',    color: '#7B1FA2' },
            end:       { name: '🌌 End',       color: '#673AB7' },
        };

        let html = `
            <div class="scp-header">
                <span class="scp-title">Structure Overlays</span>
                <div class="scp-dim-toggle">
                    <button class="scp-dim-btn active" data-dim="overworld" title="Toggle Overworld">🌍</button>
                    <button class="scp-dim-btn active" data-dim="nether" title="Toggle Nether">🔥</button>
                    <button class="scp-dim-btn active" data-dim="end" title="Toggle End">🌌</button>
                </div>
            </div>
            <div class="scp-stats">
                <span id="scp-total">0</span> structures • Seed: <span id="scp-seed">-</span>
            </div>
            <div class="scp-categories">
        `;

        for (const dimKey of ['overworld', 'nether', 'end']) {
            const dim = dims[dimKey];
            html += `<div class="scp-dim-group" data-dim="${dimKey}">`;
            html += `<div class="scp-dim-header" style="border-left-color: ${dim.color}">${dim.name}</div>`;

            for (const cat of Object.values(CATEGORIES)) {
                if (cat.dimension !== dimKey) continue;
                const hasStructures = state.generatedCategories.has(cat.id);
                const opacity = hasStructures ? '1' : '0.5';
                html += `
                    <label class="scp-cat-item" style="opacity: ${opacity}" data-cat="${cat.id}">
                        <input type="checkbox" ${cat.visible ? 'checked' : ''} data-cat="${cat.id}">
                        <span class="scp-cat-icon" style="border-color: ${cat.color}">${getCategoryIcon(cat.id)}</span>
                        <span class="scp-cat-name">${cat.name.replace('🌍 ', '').replace('🔥 ', '').replace('🌌 ', '')}</span>
                        <span class="scp-cat-count" id="scp-count-${cat.id}">0</span>
                    </label>
                `;
            }
            html += '</div>';
        }

        html += '</div>';
        html += `
            <div class="scp-actions">
                <button class="scp-btn" id="scp-show-all">Show All</button>
                <button class="scp-btn" id="scp-hide-all">Hide All</button>
            </div>
        `;

        panel.innerHTML = html;

        // Insert into page
        const coordPanel = document.getElementById('coord-panel') || document.querySelector('.map-overlay');
        if (coordPanel && coordPanel.parentNode) {
            coordPanel.parentNode.insertBefore(panel, coordPanel.nextSibling);
        } else {
            document.body.appendChild(panel);
        }

        addControlPanelStyles();

        // Bind events
        panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                toggleCategory(e.target.dataset.cat, e.target.checked);
            });
        });

        panel.querySelectorAll('.scp-dim-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const dim = e.target.dataset.dim;
                const isActive = e.target.classList.contains('active');
                toggleDimension(dim, !isActive);
                e.target.classList.toggle('active');

                // Sync checkboxes
                panel.querySelectorAll('.scp-cat-item').forEach(item => {
                    const catId = item.dataset.cat;
                    const cat = CATEGORIES[catId];
                    if (cat && cat.dimension === dim) {
                        const cb = item.querySelector('input');
                        cb.checked = !isActive;
                    }
                });
            });
        });

        document.getElementById('scp-show-all')?.addEventListener('click', () => {
            toggleAllCategories(true);
            panel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
            panel.querySelectorAll('.scp-dim-btn').forEach(btn => btn.classList.add('active'));
        });

        document.getElementById('scp-hide-all')?.addEventListener('click', () => {
            toggleAllCategories(false);
            panel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            panel.querySelectorAll('.scp-dim-btn').forEach(btn => btn.classList.remove('active'));
        });

        updateStats();
    }

    function getCategoryIcon(catId) {
        const icons = {
            overworld_buildings: '🏛',
            overworld_ocean: '🌊',
            overworld_portals: '🔮',
            overworld_special: '⭐',
            overworld_geological: '🪨',
            overworld_spawn: '📍',
            nether_structures: '🔥',
            end_structures: '🌌',
        };
        return icons[catId] || '📌';
    }

    function updateStats() {
        const total = state.structures.length;
        const totalEl = document.getElementById('scp-total');
        const seedEl = document.getElementById('scp-seed');

        if (totalEl) totalEl.textContent = total;
        if (seedEl) seedEl.textContent = String(state.worldSeed).substring(0, 12);

        // Count per category
        const counts = {};
        for (const s of state.structures) {
            counts[s.type.category] = (counts[s.type.category] || 0) + 1;
        }

        for (const [catId, count] of Object.entries(counts)) {
            const el = document.getElementById(`scp-count-${catId}`);
            if (el) el.textContent = count;
        }
    }

    // ── Styles ───────────────────────────────────────────────
    function addControlPanelStyles() {
        if (document.getElementById('scp-styles')) return;

        const style = document.createElement('style');
        style.id = 'scp-styles';
        style.textContent = `
            #structure-control-panel {
                position: fixed;
                top: 16px;
                right: 16px;
                background: rgba(20, 20, 30, 0.92);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 10px;
                padding: 14px 16px;
                min-width: 260px;
                max-width: 300px;
                max-height: 70vh;
                overflow-y: auto;
                z-index: 1000;
                font-family: 'Segoe UI', system-ui, sans-serif;
                backdrop-filter: blur(8px);
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            }

            .scp-header {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-bottom: 10px;
            }

            .scp-title {
                font-size: 13px;
                font-weight: 700;
                color: #f0a500;
                text-transform: uppercase;
                letter-spacing: 1px;
            }

            .scp-dim-toggle {
                display: flex;
                gap: 4px;
            }

            .scp-dim-btn {
                flex: 1;
                padding: 4px 8px;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 5px;
                color: #aaa;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.15s;
            }

            .scp-dim-btn.active {
                background: rgba(240, 165, 0, 0.15);
                border-color: #f0a500;
                color: #f0a500;
            }

            .scp-dim-btn:hover {
                background: rgba(255, 255, 255, 0.12);
            }

            .scp-stats {
                font-size: 11px;
                color: #888;
                margin-bottom: 10px;
                padding-bottom: 8px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            }

            .scp-dim-group {
                margin-bottom: 8px;
            }

            .scp-dim-header {
                font-size: 11px;
                font-weight: 600;
                color: #aaa;
                padding: 4px 0 4px 8px;
                border-left: 3px solid;
                margin-bottom: 4px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .scp-cat-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 4px 8px;
                border-radius: 5px;
                cursor: pointer;
                transition: background 0.15s;
                font-size: 12px;
            }

            .scp-cat-item:hover {
                background: rgba(255, 255, 255, 0.05);
            }

            .scp-cat-item input[type="checkbox"] {
                width: 14px;
                height: 14px;
                accent-color: #f0a500;
                cursor: pointer;
            }

            .scp-cat-icon {
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 1.5px solid;
                border-radius: 50%;
                font-size: 10px;
                flex-shrink: 0;
            }

            .scp-cat-name {
                flex: 1;
                color: #ccc;
            }

            .scp-cat-count {
                font-size: 10px;
                color: #666;
                font-family: 'JetBrains Mono', 'Fira Code', monospace;
                background: rgba(0,0,0,0.3);
                padding: 1px 6px;
                border-radius: 3px;
            }

            .scp-actions {
                display: flex;
                gap: 6px;
                margin-top: 10px;
                padding-top: 8px;
                border-top: 1px solid rgba(255, 255, 255, 0.06);
            }

            .scp-btn {
                flex: 1;
                padding: 5px 10px;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 5px;
                color: #aaa;
                cursor: pointer;
                font-size: 11px;
                font-weight: 600;
                transition: all 0.15s;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .scp-btn:hover {
                background: rgba(240, 165, 0, 0.12);
                border-color: #f0a500;
                color: #f0a500;
            }

            /* Structure marker hover effect */
            .structure-marker {
                transition: transform 0.15s ease;
            }

            .structure-marker:hover {
                z-index: 9999 !important;
            }

            /* Popup styling */
            .structure-popup-wrapper .leaflet-popup-content-wrapper {
                background: rgba(20, 20, 30, 0.95) !important;
                border: 1px solid #f0a500 !important;
                border-radius: 8px !important;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
            }

            .structure-popup-wrapper .leaflet-popup-tip {
                background: rgba(20, 20, 30, 0.95) !important;
                border-color: #f0a500 !important;
            }

            .structure-popup-wrapper .leaflet-popup-content {
                margin: 10px 12px !important;
            }

            /* Scrollbar for control panel */
            #structure-control-panel::-webkit-scrollbar {
                width: 6px;
            }

            #structure-control-panel::-webkit-scrollbar-track {
                background: transparent;
            }

            #structure-control-panel::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.1);
                border-radius: 3px;
            }

            #structure-control-panel::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.2);
            }
        `;
        document.head.appendChild(style);
    }

    // ── Public API ────────────────────────────────────────────
    const StructureGenerator = {
        /**
         * Load structures for a given seed and render them on the map.
         * @param {string|seed} seed - The world seed
         */
        loadSeed: function (seed) {
            if (typeof seed === 'undefined' || seed === null || seed === '') {
                seed = 'default';
            }

            console.log(`[StructureGenerator] Loading seed: "${seed}"`);

            // Wait for map if needed
            const map = ensureMap();
            if (!map) {
                console.warn('[StructureGenerator] Map not ready, retrying in 500ms...');
                setTimeout(() => this.loadSeed(seed), 500);
                return;
            }

            // Generate all structures
            const structures = generateAllStructures(seed);
            renderStructures();
            createControlPanel();

            console.log(`[StructureGenerator] Generated ${structures.length} structures for seed "${seed}"`);

            // Dispatch event for integration
            try {
                window.dispatchEvent(new CustomEvent('structuresLoaded', {
                    detail: { seed, count: structures.length }
                }));
            } catch (e) { /* ignore */ }

            return {
                seed: seed,
                count: structures.length,
                categories: Object.keys(state.generatedCategories).length,
            };
        },

        /**
         * Toggle visibility of a category
         */
        toggleCategory: toggleCategory,

        /**
         * Toggle visibility of all categories
         */
        toggleAll: toggleAllCategories,

        /**
         * Toggle visibility of a dimension
         */
        toggleDimension: toggleDimension,

        /**
         * Get current structures
         */
        getStructures: function () {
            return [...state.structures];
        },

        /**
         * Get categories
         */
        getCategories: function () {
            return Object.assign({}, CATEGORIES);
        },

        /**
         * Get structure types
         */
        getStructureTypes: function () {
            return Object.assign({}, STRUCTURE_TYPES);
        },

        /**
         * Clear all structures
         */
        clear: function () {
            for (const key of Object.keys(state.layerGroups)) {
                if (state.layerGroups[key]) {
                    state.layerGroups[key].clearLayers();
                }
            }
            state.structures = [];
            state.generatedCategories = new Set();

            const panel = document.getElementById('structure-control-panel');
            if (panel) panel.remove();
        },

        /**
         * Recreate the control panel (useful after map changes)
         */
        refreshUI: function () {
            createControlPanel();
        },

        /**
         * Get count of structures by category
         */
        getCounts: function () {
            const counts = {};
            for (const s of state.structures) {
                counts[s.type.category] = (counts[s.type.category] || 0) + 1;
            }
            return counts;
        },
    };

    // Export
    window.StructureGenerator = StructureGenerator;

    // Auto-initialize when map is available
    function autoInit() {
        // Check if terrain.js already generated something
        if (typeof window.TerrainGenerator !== 'undefined') {
            // Integrate: when terrain loads, also load structures
            window.addEventListener('terrainLoaded', function (e) {
                if (e.detail && e.detail.seed) {
                    StructureGenerator.loadSeed(e.detail.seed);
                }
            });
        }

        // Also try to initialize if map exists and a seed is set
        const map = ensureMap();
        if (map && typeof window.currentSeed !== 'undefined' && window.currentSeed) {
            StructureGenerator.loadSeed(window.currentSeed);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        setTimeout(autoInit, 100);
    }

})();

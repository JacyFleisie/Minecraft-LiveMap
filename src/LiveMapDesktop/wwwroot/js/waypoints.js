/* ============================================================
   Minecraft LiveMap — Waypoint System
   ============================================================
   Features:
   - Right-click to add, click to edit, drag to move
   - Categories: Home, Death, Base, Cave, Structure, Other + custom
   - 20+ emoji icons
   - X/Y/Z coords, dimension, notes, color, icon, date
   - localStorage persistence, JSON export/import
   - Search and filter by name, category, dimension
   - Routes between waypoints with 2D/3D distance
   ============================================================ */

(function () {
    'use strict';

    // ── Configuration ─────────────────────────────────────────
    const CONFIG = {
        storageKey: 'livemap_waypoints',
        routesStorageKey: 'livemap_routes',
        maxUndo: 50,
        dimensions: {
            overworld: { color: '#00e676', label: 'Overworld' },
            nether:    { color: '#ff1744', label: 'Nether' },
            end:       { color: '#d500f9', label: 'End' },
        },
    };

    // ── Default Categories ────────────────────────────────────
    const DEFAULT_CATEGORIES = [
        { id: 'home',      name: 'Home',      icon: '🏠', color: '#4CAF50', visible: true },
        { id: 'death',     name: 'Death',     icon: '💀', color: '#F44336', visible: true },
        { id: 'base',      name: 'Base',      icon: '🏰', color: '#2196F3', visible: true },
        { id: 'cave',      name: 'Cave',      icon: '⛏️', color: '#795548', visible: true },
        { id: 'structure', name: 'Structure', icon: '🏛️', color: '#9C27B0', visible: true },
        { id: 'other',     name: 'Other',     icon: '📍', color: '#607D8B', visible: true },
    ];

    // ── Available Icons ───────────────────────────────────────
    const ICONS = [
        '🏠', '💀', '⛏️', '🏰', '🚩', '📍', '💎', '🗡️', '🐉', '⭐',
        '🏛️', '🌊', '🔥', '🌌', '🏚️', '🔮', '🌿', '❄️', '🌋', '🎯',
        '💀', '👑', '🛡️', '⚔️', '🗺️', '🧭', '🔴', '🟠', '🟡', '🟢',
        '🔵', '🟣', '⚫', '⬛', '🩸', '☠️', '🧲', '💫', '🌟', '✨',
    ];

    // ── Module State ──────────────────────────────────────────
    const state = {
        map: null,
        waypoints: [],
        categories: [],
        routes: [],
        waypointLayer: null,
        routeLayer: null,
        selectedWaypoint: null,
        editingWaypoint: null,
        dragging: false,
        dragMarker: null,
        undoStack: [],
        searchQuery: '',
        filterCategory: 'all',
        filterDimension: 'all',
        showRoutes: true,
        nextId: 1,
    };

    // ── Utility ───────────────────────────────────────────────
    function uid() {
        return 'wp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    }

    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    // ── Persistence ───────────────────────────────────────────
    function saveWaypoints() {
        try {
            const data = {
                waypoints: state.waypoints,
                categories: state.categories,
                routes: state.routes,
                nextId: state.nextId,
                version: 2,
            };
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
        } catch (e) {
            console.warn('[waypoints] Failed to save:', e);
        }
    }

    function loadWaypoints() {
        try {
            const raw = localStorage.getItem(CONFIG.storageKey);
            if (!raw) {
                state.categories = deepClone(DEFAULT_CATEGORIES);
                return;
            }
            const data = JSON.parse(raw);
            state.waypoints = Array.isArray(data.waypoints) ? data.waypoints : [];
            state.categories = Array.isArray(data.categories) && data.categories.length > 0
                ? data.categories
                : deepClone(DEFAULT_CATEGORIES);
            state.routes = Array.isArray(data.routes) ? data.routes : [];
            state.nextId = data.nextId || getMaxId() + 1;
        } catch (e) {
            console.warn('[waypoints] Failed to load, using defaults:', e);
            state.categories = deepClone(DEFAULT_CATEGORIES);
        }
    }

    function getMaxId() {
        let max = 0;
        state.waypoints.forEach(w => {
            const num = parseInt((w.id || '').replace('wp_', '')) || 0;
            if (num > max) max = num;
        });
        return max;
    }

    // ── Export / Import ───────────────────────────────────────
    function exportToJSON() {
        const data = {
            waypoints: state.waypoints,
            categories: state.categories.filter(c => !DEFAULT_CATEGORIES.some(d => d.id === c.id)),
            routes: state.routes,
            exportedAt: new Date().toISOString(),
            version: 2,
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `livemap_waypoints_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Waypoints exported', 'success');
    }

    function importFromJSON() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = function (e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (ev) {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (Array.isArray(data.waypoints)) {
                        // Merge waypoints, avoid duplicates by id
                        const existingIds = new Set(state.waypoints.map(w => w.id));
                        data.waypoints.forEach(w => {
                            if (!existingIds.has(w.id)) {
                                state.waypoints.push(w);
                            }
                        });
                    }
                    if (Array.isArray(data.categories)) {
                        data.categories.forEach(c => {
                            if (!state.categories.some(ec => ec.id === c.id)) {
                                state.categories.push(c);
                            }
                        });
                    }
                    if (Array.isArray(data.routes)) {
                        state.routes = data.routes;
                    }
                    saveWaypoints();
                    renderWaypoints();
                    renderRoutes();
                    updateSidebar();
                    toast(`Imported ${data.waypoints?.length || 0} waypoints`, 'success');
                } catch (err) {
                    toast('Import failed: ' + err.message, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    function getShareableLink() {
        const data = {
            w: state.waypoints.map(w => ({
                n: w.name,
                x: w.x, y: w.y, z: w.z,
                d: w.dimension,
                c: w.category,
                i: w.icon,
            })),
        };
        const encoded = btoa(JSON.stringify(data));
        return `livemap://waypoints?data=${encoded}`;
    }

    function parseShareableLink(link) {
        try {
            const url = new URL(link);
            const data = url.searchParams.get('data');
            if (!data) return null;
            return JSON.parse(atob(data));
        } catch (e) {
            return null;
        }
    }

    // ── Waypoint CRUD ─────────────────────────────────────────
    function createWaypoint(data) {
        const wp = {
            id: data.id || uid(),
            name: data.name || 'Waypoint',
            description: data.description || '',
            x: data.x,
            y: data.y ?? 64,
            z: data.z,
            dimension: data.dimension || 'overworld',
            category: data.category || 'other',
            color: data.color || getCategoryColor(data.category || 'other'),
            icon: data.icon || getCategoryIcon(data.category || 'other'),
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        state.waypoints.push(wp);
        saveWaypoints();
        renderWaypoints();
        updateSidebar();
        return wp;
    }

    function updateWaypoint(id, updates) {
        const wp = state.waypoints.find(w => w.id === id);
        if (!wp) return;
        const prev = deepClone(wp);
        state.undoStack.push({ type: 'update', id, prev });
        if (state.undoStack.length > CONFIG.maxUndo) state.undoStack.shift();
        Object.assign(wp, updates, { updatedAt: new Date().toISOString() });
        if (updates.category) {
            wp.color = getCategoryColor(updates.category);
            wp.icon = getCategoryIcon(updates.category);
        }
        saveWaypoints();
        renderWaypoints();
        updateSidebar();
    }

    function deleteWaypoint(id) {
        const idx = state.waypoints.findIndex(w => w.id === id);
        if (idx === -1) return;
        const prev = deepClone(state.waypoints[idx]);
        state.undoStack.push({ type: 'delete', prev });
        if (state.undoStack.length > CONFIG.maxUndo) state.undoStack.shift();
        state.waypoints.splice(idx, 1);
        // Remove routes involving this waypoint
        state.routes = state.routes.filter(r => r.from !== id && r.to !== id);
        saveWaypoints();
        renderWaypoints();
        renderRoutes();
        updateSidebar();
    }

    function undo() {
        const action = state.undoStack.pop();
        if (!action) return;
        if (action.type === 'delete') {
            state.waypoints.push(action.prev);
        } else if (action.type === 'update') {
            const idx = state.waypoints.findIndex(w => w.id === action.id);
            if (idx !== -1) state.waypoints[idx] = action.prev;
        }
        saveWaypoints();
        renderWaypoints();
        renderRoutes();
        updateSidebar();
    }

    // ── Category Management ───────────────────────────────────
    function createCategory(name, icon, color) {
        const cat = {
            id: 'cat_' + name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now().toString(36),
            name,
            icon: icon || '📍',
            color: color || '#607D8B',
            visible: true,
        };
        state.categories.push(cat);
        saveWaypoints();
        updateSidebar();
        return cat;
    }

    function deleteCategory(id) {
        if (DEFAULT_CATEGORIES.some(d => d.id === id)) {
            toast('Cannot delete default category', 'error');
            return;
        }
        // Move waypoints in this category to 'other'
        state.waypoints.forEach(w => {
            if (w.category === id) {
                w.category = 'other';
                w.color = getCategoryColor('other');
                w.icon = getCategoryIcon('other');
            }
        });
        state.categories = state.categories.filter(c => c.id !== id);
        saveWaypoints();
        renderWaypoints();
        updateSidebar();
    }

    function toggleCategoryVisibility(id) {
        const cat = state.categories.find(c => c.id === id);
        if (cat) {
            cat.visible = !cat.visible;
            saveWaypoints();
            renderWaypoints();
            updateSidebar();
        }
    }

    function getCategoryColor(catId) {
        const cat = state.categories.find(c => c.id === catId);
        return cat?.color || '#607D8B';
    }

    function getCategoryIcon(catId) {
        const cat = state.categories.find(c => c.id === catId);
        return cat?.icon || '📍';
    }

    function getCategoryName(catId) {
        const cat = state.categories.find(c => c.id === catId);
        return cat?.name || catId;
    }

    // ── Route Management ──────────────────────────────────────
    function createRoute(fromId, toId) {
        if (fromId === toId) return;
        // Avoid duplicate routes
        const exists = state.routes.some(r =>
            (r.from === fromId && r.to === toId) || (r.from === toId && r.to === fromId)
        );
        if (exists) return;
        state.routes.push({ from: fromId, to: toId });
        saveWaypoints();
        renderRoutes();
    }

    function deleteRoute(fromId, toId) {
        state.routes = state.routes.filter(r =>
            !((r.from === fromId && r.to === toId) || (r.from === toId && r.to === fromId))
        );
        saveWaypoints();
        renderRoutes();
    }

    function clearAllRoutes() {
        state.routes = [];
        saveWaypoints();
        renderRoutes();
    }

    function getDistance2D(w1, w2) {
        const dx = w1.x - w2.x;
        const dz = w1.z - w2.z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    function getDistance3D(w1, w2) {
        const dx = w1.x - w2.x;
        const dy = w1.y - w2.y;
        const dz = w1.z - w2.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    // ── Map Rendering ─────────────────────────────────────────
    function createWaypointIcon(wp) {
        const dimColor = CONFIG.dimensions[wp.dimension]?.color || '#888';
        return L.divIcon({
            className: 'waypoint-icon-wrapper',
            html: `
                <div class="waypoint-marker" data-id="${wp.id}" style="--wp-color:${wp.color}; --wp-dim-color:${dimColor};">
                    <span class="waypoint-icon-emoji">${wp.icon}</span>
                    <span class="waypoint-label">${escapeHtml(wp.name)}</span>
                </div>
            `,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
        });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function renderWaypoints() {
        if (!state.waypointLayer || !state.map) return;
        state.waypointLayer.clearLayers();

        const visibleWps = state.waypoints.filter(shouldShowWaypoint);

        visibleWps.forEach(wp => {
            const marker = L.marker([wp.z, wp.x], {
                icon: createWaypointIcon(wp),
                draggable: true,
                riseOnHover: true,
                zIndexOffset: 500,
            });

            marker.waypointId = wp.id;

            // Click to select/edit
            marker.on('click', function (e) {
                L.DomEvent.stop(e);
                if (state.dragging) return;
                selectWaypoint(wp.id);
            });

            // Right-click for context menu
            marker.on('contextmenu', function (e) {
                L.DomEvent.stop(e);
                showWaypointContextMenu(e, wp.id);
            });

            // Drag start
            marker.on('dragstart', function (e) {
                state.dragging = true;
                state.dragMarker = marker;
            });

            // Drag end — update coordinates
            marker.on('dragend', function (e) {
                const ll = marker.getLatLng();
                updateWaypoint(wp.id, { x: Math.round(ll.lng), z: Math.round(ll.lat) });
                setTimeout(() => {
                    state.dragging = false;
                    state.dragMarker = null;
                }, 100);
            });

            // Tooltip
            const dimLabel = CONFIG.dimensions[wp.dimension]?.label || wp.dimension;
            marker.bindTooltip(`
                <strong>${wp.icon} ${escapeHtml(wp.name)}</strong><br>
                <span style="font-size:11px;color:#aaa;">
                    X: ${wp.x} | Y: ${wp.y} | Z: ${wp.z}<br>
                    Dim: ${dimLabel}<br>
                    ${escapeHtml(wp.description || '')}
                </span>
            `, { direction: 'top', offset: [0, -16] });

            marker.addTo(state.waypointLayer);
        });
    }

    function shouldShowWaypoint(wp) {
        // Category visibility
        const cat = state.categories.find(c => c.id === wp.category);
        if (cat && !cat.visible) return false;

        // Category filter
        if (state.filterCategory !== 'all' && wp.category !== state.filterCategory) return false;

        // Dimension filter
        if (state.filterDimension !== 'all' && wp.dimension !== state.filterDimension) return false;

        // Search query
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase();
            if (!wp.name.toLowerCase().includes(q) &&
                !wp.description.toLowerCase().includes(q) &&
                !wp.id.toLowerCase().includes(q)) {
                return false;
            }
        }

        return true;
    }

    function renderRoutes() {
        if (!state.routeLayer || !state.map) return;
        state.routeLayer.clearLayers();

        if (!state.showRoutes) return;

        state.routes.forEach(route => {
            const fromWp = state.waypoints.find(w => w.id === route.from);
            const toWp = state.waypoints.find(w => w.id === route.to);
            if (!fromWp || !toWp) return;
            if (!shouldShowWaypoint(fromWp) || !shouldShowWaypoint(toWp)) return;

            const dist2d = getDistance2D(fromWp, toWp);
            const dist3d = getDistance3D(fromWp, toWp);

            // Determine color based on dimensions
            let color = '#f0a500';
            if (fromWp.dimension !== toWp.dimension) {
                color = '#ff6600';
            } else {
                const dimColor = CONFIG.dimensions[fromWp.dimension]?.color;
                if (dimColor) color = dimColor;
            }

            const line = L.polyline([[fromWp.z, fromWp.x], [toWp.z, toWp.x]], {
                color: color,
                weight: 2,
                opacity: 0.6,
                dashArray: '5, 10',
                className: 'waypoint-route-line',
            }).addTo(state.routeLayer);

            // Distance tooltip at midpoint
            const midZ = (fromWp.z + toWp.z) / 2;
            const midX = (fromWp.x + toWp.x) / 2;

            line.bindTooltip(`
                <span style="font-size:11px;">
                    📏 <strong>${Math.round(dist2d)}</strong> blocks (2D)<br>
                    📐 <strong>${Math.round(dist3d)}</strong> blocks (3D)
                </span>
            `, { sticky: true });

            // Click route to delete
            line.on('contextmenu', function (e) {
                L.DomEvent.stop(e);
                if (confirm('Delete this route?')) {
                    deleteRoute(route.from, route.to);
                }
            });
        });
    }

    function selectWaypoint(id) {
        state.selectedWaypoint = id;
        const wp = state.waypoints.find(w => w.id === id);
        if (wp) showEditDialog(wp);
    }

    // ── Context Menu ──────────────────────────────────────────
    function showMapContextMenu(e) {
        closeAllMenus();

        const dim = 'overworld';
        const x = Math.round(e.latlng.lng);
        const z = Math.round(e.latlng.lat);

        const menu = document.createElement('div');
        menu.id = 'wp-context-menu';
        menu.className = 'wp-context-menu';
        menu.style.left = e.originalEvent.pageX + 'px';
        menu.style.top = e.originalEvent.pageY + 'px';

        menu.innerHTML = `
            <div class="wp-menu-header">Add Waypoint</div>
            <div class="wp-menu-coords">X: ${x} | Z: ${z}</div>
            <div class="wp-menu-item" data-action="add-quick">
                <span class="wp-menu-icon">📍</span> Quick Add
            </div>
            <div class="wp-menu-item" data-action="add-custom">
                <span class="wp-menu-icon">⚙️</span> Custom Waypoint...
            </div>
            <div class="wp-menu-separator"></div>
            <div class="wp-menu-item" data-action="route-from">
                <span class="wp-menu-icon">🔗</span> Start Route Here
            </div>
        `;

        document.body.appendChild(menu);

        menu.addEventListener('click', function (ev) {
            const item = ev.target.closest('.wp-menu-item');
            if (!item) return;
            const action = item.dataset.action;

            if (action === 'add-quick') {
                createWaypoint({
                    name: `Waypoint ${state.waypoints.length + 1}`,
                    x: x, z: z, dimension: dim,
                    category: 'other',
                });
                toast('Waypoint added', 'success');
            } else if (action === 'add-custom') {
                showCreateDialog(x, z, dim);
            } else if (action === 'route-from') {
                startRouteAt(x, z);
            }
            closeAllMenus();
        });

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', closeAllMenus, { once: true });
        }, 10);
    }

    function showWaypointContextMenu(e, id) {
        closeAllMenus();
        const wp = state.waypoints.find(w => w.id === id);
        if (!wp) return;

        const menu = document.createElement('div');
        menu.id = 'wp-waypoint-menu';
        menu.className = 'wp-context-menu';
        menu.style.left = e.originalEvent.pageX + 'px';
        menu.style.top = e.originalEvent.pageY + 'px';

        menu.innerHTML = `
            <div class="wp-menu-header">${wp.icon} ${escapeHtml(wp.name)}</div>
            <div class="wp-menu-coords">X: ${wp.x} | Y: ${wp.y} | Z: ${wp.z}</div>
            <div class="wp-menu-item" data-action="edit">
                <span class="wp-menu-icon">✏️</span> Edit
            </div>
            <div class="wp-menu-item" data-action="route-from">
                <span class="wp-menu-icon">🔗</span> Route From Here
            </div>
            <div class="wp-menu-item" data-action="copy-coords">
                <span class="wp-menu-icon">📋</span> Copy Coordinates
            </div>
            <div class="wp-menu-item" data-action="set-player">
                <span class="wp-menu-icon">🎯</span> Set as Player Target
            </div>
            <div class="wp-menu-separator"></div>
            <div class="wp-menu-item wp-menu-danger" data-action="delete">
                <span class="wp-menu-icon">🗑️</span> Delete
            </div>
        `;

        document.body.appendChild(menu);

        menu.addEventListener('click', function (ev) {
            const item = ev.target.closest('.wp-menu-item');
            if (!item) return;
            const action = item.dataset.action;

            switch (action) {
                case 'edit': showEditDialog(wp); break;
                case 'route-from': startRouteFromWaypoint(id); break;
                case 'copy-coords':
                    copyToClipboard(`${wp.x}, ${wp.y}, ${wp.z}`);
                    toast('Coordinates copied', 'success');
                    break;
                case 'set-player':
                    if (window.CoordReader) {
                        window.CoordReader.teleport(wp.x, wp.y, wp.z, wp.dimension);
                    }
                    toast('Player target set', 'success');
                    break;
                case 'delete':
                    if (confirm(`Delete waypoint "${wp.name}"?`)) {
                        deleteWaypoint(id);
                        toast('Waypoint deleted', 'info');
                    }
                    break;
            }
            closeAllMenus();
        });

        setTimeout(() => {
            document.addEventListener('click', closeAllMenus, { once: true });
        }, 10);
    }

    function closeAllMenus() {
        document.querySelectorAll('.wp-context-menu').forEach(m => m.remove());
    }

    function copyToClipboard(text) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).catch(() => {});
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
    }

    // ── Route Creation State ──────────────────────────────────
    let routeStartPoint = null; // { x, z } or waypoint id

    function startRouteAt(x, z) {
        routeStartPoint = { x, z };
        state.map.getContainer().style.cursor = 'crosshair';
        toast('Click a waypoint to complete route', 'info');

        // One-time click handler
        const handler = function (e) {
            state.map.off('click', handler);
            state.map.getContainer().style.cursor = '';
            // Find nearest waypoint to click
            const clickX = Math.round(e.latlng.lng);
            const clickZ = Math.round(e.latlng.lat);
            let nearest = null;
            let minDist = Infinity;
            state.waypoints.forEach(wp => {
                const dist = Math.sqrt((wp.x - clickX) ** 2 + (wp.z - clickZ) ** 2);
                if (dist < minDist && dist < 200) {
                    minDist = dist;
                    nearest = wp;
                }
            });
            if (nearest) {
                // Create temp waypoint at start
                const tempWp = createWaypoint({
                    name: `Route Point`,
                    x: routeStartPoint.x, z: routeStartPoint.z,
                    dimension: 'overworld', category: 'other',
                });
                createRoute(tempWp.id, nearest.id);
                toast(`Route created: ${Math.round(getDistance2D(tempWp, nearest))} blocks`, 'success');
            } else {
                toast('No waypoint near click', 'error');
            }
            routeStartPoint = null;
        };
        state.map.on('click', handler);
    }

    function startRouteFromWaypoint(fromId) {
        routeStartPoint = fromId;
        state.map.getContainer().style.cursor = 'crosshair';
        toast('Click another waypoint to complete route', 'info');

        const handler = function (e) {
            state.map.off('click', handler);
            state.map.getContainer().style.cursor = '';
            const clickX = Math.round(e.latlng.lng);
            const clickZ = Math.round(e.latlng.lat);
            let nearest = null;
            let minDist = Infinity;
            state.waypoints.forEach(wp => {
                if (wp.id === fromId) return;
                const dist = Math.sqrt((wp.x - clickX) ** 2 + (wp.z - clickZ) ** 2);
                if (dist < minDist && dist < 200) {
                    minDist = dist;
                    nearest = wp;
                }
            });
            if (nearest) {
                createRoute(fromId, nearest.id);
                const fromWp = state.waypoints.find(w => w.id === fromId);
                if (fromWp) {
                    toast(`Route: ${Math.round(getDistance2D(fromWp, nearest))} blocks`, 'success');
                }
            } else {
                toast('No waypoint near click', 'error');
            }
            routeStartPoint = null;
        };
        state.map.on('click', handler);
    }

    // ── Create Dialog ─────────────────────────────────────────
    function showCreateDialog(x, z, dimension) {
        state.editingWaypoint = { x, z, dimension };
        const dialog = createDialog('Create Waypoint', renderCreateForm({ x, z, dimension }), function (formData) {
            createWaypoint({
                name: formData.name || 'Waypoint',
                description: formData.description || '',
                x: x,
                y: parseInt(formData.y) || 64,
                z: z,
                dimension: formData.dimension || 'overworld',
                category: formData.category || 'other',
                icon: formData.icon || undefined,
                color: formData.color || undefined,
            });
            toast('Waypoint created', 'success');
        });
        document.body.appendChild(dialog);
    }

    function renderCreateForm(data) {
        const cats = state.categories.map(c =>
            `<option value="${c.id}" ${data.category === c.id ? 'selected' : ''}>${c.icon} ${escapeHtml(c.name)}</option>`
        ).join('');

        const dims = Object.entries(CONFIG.dimensions).map(([k, v]) =>
            `<option value="${k}" ${data.dimension === k ? 'selected' : ''}>${v.label}</option>`
        ).join('');

        const icons = ICONS.map(i =>
            `<span class="wp-icon-option" data-icon="${i}">${i}</span>`
        ).join('');

        return `
            <div class="wp-form-row">
                <label for="wp-name">Name</label>
                <input type="text" id="wp-name" value="${escapeHtml(data.name || '')}" placeholder="Waypoint name...">
            </div>
            <div class="wp-form-row">
                <label for="wp-desc">Description</label>
                <textarea id="wp-desc" placeholder="Notes...">${escapeHtml(data.description || '')}</textarea>
            </div>
            <div class="wp-form-row wp-form-row-3">
                <div><label>X</label><input type="number" id="wp-x" value="${data.x}"></div>
                <div><label>Y</label><input type="number" id="wp-y" value="${data.y || 64}"></div>
                <div><label>Z</label><input type="number" id="wp-z" value="${data.z}"></div>
            </div>
            <div class="wp-form-row wp-form-row-2">
                <div>
                    <label for="wp-dim">Dimension</label>
                    <select id="wp-dim">${dims}</select>
                </div>
                <div>
                    <label for="wp-cat">Category</label>
                    <select id="wp-cat">${cats}</select>
                </div>
            </div>
            <div class="wp-form-row">
                <label>Icon</label>
                <div class="wp-icon-grid" id="wp-icon-grid">${icons}</div>
                <input type="hidden" id="wp-icon" value="${data.icon || ''}">
            </div>
            <div class="wp-form-row">
                <label for="wp-color">Color</label>
                <input type="color" id="wp-color" value="${data.color || '#607D8B'}">
            </div>
        `;
    }

    // ── Edit Dialog ───────────────────────────────────────────
    function showEditDialog(wp) {
        state.editingWaypoint = wp;
        const dialog = createDialog(`Edit Waypoint — ${wp.name}`, renderEditForm(wp), function (formData) {
            updateWaypoint(wp.id, {
                name: formData.name,
                description: formData.description,
                x: parseInt(formData.x) || wp.x,
                y: parseInt(formData.y) || wp.y,
                z: parseInt(formData.z) || wp.z,
                dimension: formData.dimension,
                category: formData.category,
                icon: formData.icon,
                color: formData.color,
            });
            toast('Waypoint updated', 'success');
        }, function () {
            // Delete callback
            if (confirm(`Delete waypoint "${wp.name}"?`)) {
                deleteWaypoint(wp.id);
                closeAllDialogs();
                toast('Waypoint deleted', 'info');
            }
        });
        document.body.appendChild(dialog);
    }

    function renderEditForm(wp) {
        const cats = state.categories.map(c =>
            `<option value="${c.id}" ${wp.category === c.id ? 'selected' : ''}>${c.icon} ${escapeHtml(c.name)}</option>`
        ).join('');

        const dims = Object.entries(CONFIG.dimensions).map(([k, v]) =>
            `<option value="${k}" ${wp.dimension === k ? 'selected' : ''}>${v.label}</option>`
        ).join('');

        const icons = ICONS.map(i =>
            `<span class="wp-icon-option ${wp.icon === i ? 'selected' : ''}" data-icon="${i}">${i}</span>`
        ).join('');

        const date = new Date(wp.createdAt).toLocaleDateString();
        const time = new Date(wp.createdAt).toLocaleTimeString();

        return `
            <div class="wp-form-row">
                <label for="wp-name">Name</label>
                <input type="text" id="wp-name" value="${escapeHtml(wp.name)}" placeholder="Waypoint name...">
            </div>
            <div class="wp-form-row">
                <label for="wp-desc">Description</label>
                <textarea id="wp-desc" placeholder="Notes...">${escapeHtml(wp.description || '')}</textarea>
            </div>
            <div class="wp-form-row wp-form-row-3">
                <div><label>X</label><input type="number" id="wp-x" value="${wp.x}"></div>
                <div><label>Y</label><input type="number" id="wp-y" value="${wp.y}"></div>
                <div><label>Z</label><input type="number" id="wp-z" value="${wp.z}"></div>
            </div>
            <div class="wp-form-row wp-form-row-2">
                <div>
                    <label for="wp-dim">Dimension</label>
                    <select id="wp-dim">${dims}</select>
                </div>
                <div>
                    <label for="wp-cat">Category</label>
                    <select id="wp-cat">${cats}</select>
                </div>
            </div>
            <div class="wp-form-row">
                <label>Icon</label>
                <div class="wp-icon-grid" id="wp-icon-grid">${icons}</div>
                <input type="hidden" id="wp-icon" value="${wp.icon || ''}">
            </div>
            <div class="wp-form-row">
                <label for="wp-color">Color</label>
                <input type="color" id="wp-color" value="${wp.color || '#607D8B'}">
            </div>
            <div class="wp-form-meta">
                Created: ${date} ${time} | ID: ${wp.id.slice(0, 12)}...
            </div>
        `;
    }

    function createDialog(title, content, onSave, onDelete) {
        const overlay = document.createElement('div');
        overlay.className = 'wp-dialog-overlay';
        overlay.innerHTML = `
            <div class="wp-dialog">
                <div class="wp-dialog-header">
                    <span>${escapeHtml(title)}</span>
                    <button class="wp-dialog-close" title="Close">&times;</button>
                </div>
                <div class="wp-dialog-body">${content}</div>
                <div class="wp-dialog-footer">
                    ${onDelete ? '<button class="wp-btn wp-btn-danger" id="wp-btn-delete">Delete</button>' : ''}
                    <button class="wp-btn wp-btn-secondary" id="wp-btn-cancel">Cancel</button>
                    <button class="wp-btn wp-btn-primary" id="wp-btn-save">Save</button>
                </div>
            </div>
        `;

        // Icon selection
        overlay.addEventListener('click', function (e) {
            if (e.target.classList.contains('wp-icon-option')) {
                overlay.querySelectorAll('.wp-icon-option').forEach(el => el.classList.remove('selected'));
                e.target.classList.add('selected');
                overlay.querySelector('#wp-icon').value = e.target.dataset.icon;
            }
        });

        overlay.querySelector('#wp-btn-save').addEventListener('click', function () {
            const formData = {
                name: overlay.querySelector('#wp-name')?.value || 'Waypoint',
                description: overlay.querySelector('#wp-desc')?.value || '',
                x: overlay.querySelector('#wp-x')?.value || 0,
                y: overlay.querySelector('#wp-y')?.value || 64,
                z: overlay.querySelector('#wp-z')?.value || 0,
                dimension: overlay.querySelector('#wp-dim')?.value || 'overworld',
                category: overlay.querySelector('#wp-cat')?.value || 'other',
                icon: overlay.querySelector('#wp-icon')?.value || '',
                color: overlay.querySelector('#wp-color')?.value || '#607D8B',
            };
            if (onSave) onSave(formData);
            closeAllDialogs();
        });

        overlay.querySelector('#wp-btn-cancel').addEventListener('click', closeAllDialogs);
        overlay.querySelector('.wp-dialog-close').addEventListener('click', closeAllDialogs);

        if (onDelete) {
            overlay.querySelector('#wp-btn-delete').addEventListener('click', function () {
                onDelete();
            });
        }

        // Close on overlay click
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeAllDialogs();
        });

        // Close on Escape
        const escHandler = function (e) {
            if (e.key === 'Escape') {
                closeAllDialogs();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        return overlay;
    }

    function closeAllDialogs() {
        document.querySelectorAll('.wp-dialog-overlay').forEach(d => d.remove());
        state.editingWaypoint = null;
    }

    // ── Sidebar Panel ─────────────────────────────────────────
    function createSidebar() {
        // Remove existing sidebar
        const existing = document.getElementById('wp-sidebar');
        if (existing) existing.remove();

        const sidebar = document.createElement('div');
        sidebar.id = 'wp-sidebar';
        sidebar.className = 'wp-sidebar glass-panel';

        renderSidebarContent(sidebar);

        document.body.appendChild(sidebar);

        // Add toggle button
        const toggle = document.createElement('button');
        toggle.id = 'wp-sidebar-toggle';
        toggle.className = 'wp-sidebar-toggle glass-panel';
        toggle.innerHTML = '📌';
        toggle.title = 'Toggle Waypoints Panel';
        toggle.addEventListener('click', function () {
            sidebar.classList.toggle('collapsed');
            toggle.classList.toggle('active');
        });
        document.body.appendChild(toggle);

        return sidebar;
    }

    function renderSidebarContent(sidebar) {
        const cats = state.categories.map(c => {
            const count = state.waypoints.filter(w => w.category === c.id).length;
            const visible = c.visible ? '' : ' wp-cat-hidden';
            return `
                <div class="wp-cat-item${visible}" data-cat="${c.id}">
                    <span class="wp-cat-icon">${c.icon}</span>
                    <span class="wp-cat-name">${escapeHtml(c.name)}</span>
                    <span class="wp-cat-count">${count}</span>
                    <button class="wp-cat-toggle" data-cat-toggle="${c.id}" title="Toggle visibility">
                        ${c.visible ? '👁️' : '🚫'}
                    </button>
                </div>
            `;
        }).join('');

        const dimCounts = { overworld: 0, nether: 0, end: 0 };
        state.waypoints.forEach(w => { if (dimCounts[w.dimension] !== undefined) dimCounts[w.dimension]++; });

        const routeCount = state.routes.length;

        sidebar.innerHTML = `
            <div class="wp-sidebar-header">
                <span>📌 Waypoints</span>
                <span class="wp-sidebar-count">${state.waypoints.length}</span>
            </div>

            <div class="wp-sidebar-search">
                <input type="text" id="wp-search" placeholder="🔍 Search waypoints..." value="${escapeHtml(state.searchQuery)}">
            </div>

            <div class="wp-sidebar-filters">
                <select id="wp-filter-cat">
                    <option value="all">All Categories</option>
                    ${state.categories.map(c => `<option value="${c.id}" ${state.filterCategory === c.id ? 'selected' : ''}>${c.icon} ${escapeHtml(c.name)}</option>`).join('')}
                </select>
                <select id="wp-filter-dim">
                    <option value="all">All Dimensions</option>
                    <option value="overworld" ${state.filterDimension === 'overworld' ? 'selected' : ''}>🟢 Overworld</option>
                    <option value="nether" ${state.filterDimension === 'nether' ? 'selected' : ''}>🔴 Nether</option>
                    <option value="end" ${state.filterDimension === 'end' ? 'selected' : ''}>🟣 End</option>
                </select>
            </div>

            <div class="wp-sidebar-categories">
                <div class="wp-section-title">Categories</div>
                ${cats}
                <button class="wp-add-cat-btn" id="wp-add-cat">+ Add Category</button>
            </div>

            <div class="wp-sidebar-stats">
                <div class="wp-stat"><span>🟢 Overworld:</span><strong>${dimCounts.overworld}</strong></div>
                <div class="wp-stat"><span>🔴 Nether:</span><strong>${dimCounts.nether}</strong></div>
                <div class="wp-stat"><span>🟣 End:</span><strong>${dimCounts.end}</strong></div>
                <div class="wp-stat"><span>🔗 Routes:</span><strong>${routeCount}</strong></div>
            </div>

            <div class="wp-sidebar-actions">
                <button class="wp-action-btn" id="wp-btn-export" title="Export to JSON">📤 Export</button>
                <button class="wp-action-btn" id="wp-btn-import" title="Import from JSON">📥 Import</button>
                <button class="wp-action-btn" id="wp-btn-undo" title="Undo">↩️ Undo</button>
                <button class="wp-action-btn" id="wp-btn-clear-routes" title="Clear All Routes">🗑️ Routes</button>
            </div>

            <div class="wp-sidebar-list" id="wp-waypoint-list"></div>
        `;

        renderWaypointList();

        // Bind events
        sidebar.querySelector('#wp-search').addEventListener('input', function (e) {
            state.searchQuery = e.target.value;
            renderWaypointList();
            renderWaypoints();
        });

        sidebar.querySelector('#wp-filter-cat').addEventListener('change', function (e) {
            state.filterCategory = e.target.value;
            renderWaypointList();
            renderWaypoints();
        });

        sidebar.querySelector('#wp-filter-dim').addEventListener('change', function (e) {
            state.filterDimension = e.target.value;
            renderWaypointList();
            renderWaypoints();
        });

        sidebar.querySelectorAll('[data-cat-toggle]').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                toggleCategoryVisibility(this.dataset.catToggle);
            });
        });

        sidebar.querySelectorAll('.wp-cat-item').forEach(item => {
            item.addEventListener('click', function (e) {
                if (e.target.closest('.wp-cat-toggle')) return;
                const catId = this.dataset.cat;
                const select = sidebar.querySelector('#wp-filter-cat');
                select.value = (select.value === catId) ? 'all' : catId;
                state.filterCategory = select.value;
                renderWaypointList();
                renderWaypoints();
            });
        });

        sidebar.querySelector('#wp-add-cat').addEventListener('click', function () {
            const name = prompt('Category name:');
            if (name && name.trim()) {
                createCategory(name.trim());
                updateSidebar();
            }
        });

        sidebar.querySelector('#wp-btn-export').addEventListener('click', exportToJSON);
        sidebar.querySelector('#wp-btn-import').addEventListener('click', importFromJSON);
        sidebar.querySelector('#wp-btn-undo').addEventListener('click', undo);
        sidebar.querySelector('#wp-btn-clear-routes').addEventListener('click', function () {
            if (state.routes.length === 0) return;
            if (confirm('Clear all routes?')) clearAllRoutes();
        });
    }

    function renderWaypointList() {
        const list = document.getElementById('wp-waypoint-list');
        if (!list) return;

        const visibleWps = state.waypoints.filter(shouldShowWaypoint);

        if (visibleWps.length === 0) {
            list.innerHTML = '<div class="wp-empty">No waypoints found. Right-click the map to add one!</div>';
            return;
        }

        // Sort by name
        visibleWps.sort((a, b) => a.name.localeCompare(b.name));

        list.innerHTML = visibleWps.map(wp => {
            const dimLabel = CONFIG.dimensions[wp.dimension]?.label || wp.dimension;
            const dimColor = CONFIG.dimensions[wp.dimension]?.color || '#888';
            const date = new Date(wp.createdAt).toLocaleDateString();
            return `
                <div class="wp-list-item" data-id="${wp.id}" title="${escapeHtml(wp.description || '')}">
                    <span class="wp-list-icon" style="color:${wp.color}">${wp.icon}</span>
                    <div class="wp-list-info">
                        <span class="wp-list-name">${escapeHtml(wp.name)}</span>
                        <span class="wp-list-coords" style="color:${dimColor}">
                            X:${wp.x} Y:${wp.y} Z:${wp.z} | ${dimLabel}
                        </span>
                    </div>
                    <span class="wp-list-date">${date}</span>
                </div>
            `;
        }).join('');

        // Bind click events
        list.querySelectorAll('.wp-list-item').forEach(item => {
            item.addEventListener('click', function () {
                const id = this.dataset.id;
                const wp = state.waypoints.find(w => w.id === id);
                if (wp && state.map) {
                    state.map.setView([wp.z, wp.x], Math.max(state.map.getZoom(), 3));
                    showEditDialog(wp);
                }
            });
        });
    }

    function updateSidebar() {
        const sidebar = document.getElementById('wp-sidebar');
        if (sidebar) renderSidebarContent(sidebar);
    }

    // ── Toast Helper ──────────────────────────────────────────
    function toast(message, type) {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:6px;align-items:center;';
            document.body.appendChild(container);
        }
        const el = document.createElement('div');
        el.style.cssText = `padding:8px 16px;border-radius:6px;font-size:13px;font-family:system-ui;animation:wpFadeInUp 0.2s ease;${type === 'success' ? 'background:rgba(0,230,118,0.2);color:#00e676;border:1px solid rgba(0,230,118,0.3);' : type === 'error' ? 'background:rgba(255,23,68,0.2);color:#ff1744;border:1px solid rgba(255,23,68,0.3);' : 'background:rgba(74,158,255,0.2);color:#4a9eff;border:1px solid rgba(74,158,255,0.3);'}`;
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    // ── Styles ────────────────────────────────────────────────
    function addStyles() {
        if (document.getElementById('waypoints-styles')) return;

        const style = document.createElement('style');
        style.id = 'waypoints-styles';
        style.textContent = `
            /* === Waypoint Marker === */
            .waypoint-icon-wrapper {
                background: none !important;
                border: none !important;
            }
            .waypoint-marker {
                display: flex;
                flex-direction: column;
                align-items: center;
                cursor: pointer;
                transition: transform 0.15s ease;
            }
            .waypoint-marker:hover {
                transform: scale(1.25);
                z-index: 9999 !important;
            }
            .waypoint-icon-emoji {
                font-size: 28px;
                line-height: 1;
                text-shadow: 0 0 6px var(--wp-color, #607D8B), 0 0 12px var(--wp-dim-color, #888);
                filter: drop-shadow(0 0 4px rgba(0,0,0,0.8));
            }
            .waypoint-label {
                font-size: 10px;
                font-weight: 600;
                color: #fff;
                background: rgba(0,0,0,0.7);
                padding: 1px 5px;
                border-radius: 3px;
                white-space: nowrap;
                margin-top: 2px;
                text-shadow: 0 0 4px #000;
            }

            /* === Context Menu === */
            .wp-context-menu {
                position: fixed;
                z-index: 10000;
                background: rgba(20, 20, 35, 0.95);
                border: 1px solid rgba(240, 165, 0, 0.3);
                border-radius: 8px;
                padding: 4px 0;
                min-width: 180px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.6);
                backdrop-filter: blur(12px);
                animation: wpFadeIn 0.15s ease;
            }
            .wp-menu-header {
                padding: 6px 14px;
                font-size: 11px;
                font-weight: 700;
                color: #f0a500;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .wp-menu-coords {
                padding: 4px 14px;
                font-size: 10px;
                color: #888;
                font-family: monospace;
            }
            .wp-menu-item {
                padding: 7px 14px;
                font-size: 13px;
                color: #e0e0e0;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: background 0.1s;
            }
            .wp-menu-item:hover {
                background: rgba(240, 165, 0, 0.15);
            }
            .wp-menu-icon {
                font-size: 14px;
            }
            .wp-menu-separator {
                height: 1px;
                background: rgba(255,255,255,0.06);
                margin: 4px 0;
            }
            .wp-menu-danger {
                color: #ff5555;
            }
            .wp-menu-danger:hover {
                background: rgba(255, 68, 68, 0.15);
            }

            /* === Dialog === */
            .wp-dialog-overlay {
                position: fixed;
                top: 0; left: 0;
                width: 100%; height: 100%;
                background: rgba(0,0,0,0.6);
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: wpFadeIn 0.2s ease;
            }
            .wp-dialog {
                background: rgba(20, 20, 35, 0.97);
                border: 1px solid rgba(240, 165, 0, 0.25);
                border-radius: 12px;
                padding: 0;
                width: 420px;
                max-width: 90vw;
                max-height: 85vh;
                overflow-y: auto;
                box-shadow: 0 16px 64px rgba(0,0,0,0.6);
                animation: wpSlideUp 0.2s ease;
            }
            .wp-dialog-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 14px 18px;
                border-bottom: 1px solid rgba(255,255,255,0.06);
                font-weight: 600;
                color: #f0a500;
            }
            .wp-dialog-close {
                background: none;
                border: none;
                color: #888;
                font-size: 20px;
                cursor: pointer;
                padding: 0 4px;
                transition: color 0.15s;
            }
            .wp-dialog-close:hover { color: #fff; }
            .wp-dialog-body {
                padding: 16px 18px;
            }
            .wp-dialog-footer {
                padding: 12px 18px;
                border-top: 1px solid rgba(255,255,255,0.06);
                display: flex;
                gap: 8px;
                justify-content: flex-end;
            }

            /* === Form === */
            .wp-form-row {
                margin-bottom: 12px;
            }
            .wp-form-row label {
                display: block;
                font-size: 11px;
                color: #888;
                margin-bottom: 4px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .wp-form-row input[type="text"],
            .wp-form-row input[type="number"],
            .wp-form-row select,
            .wp-form-row textarea {
                width: 100%;
                padding: 8px 10px;
                background: rgba(0,0,0,0.3);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 6px;
                color: #e0e0e0;
                font-size: 13px;
                outline: none;
                transition: border-color 0.15s;
                box-sizing: border-box;
            }
            .wp-form-row input:focus,
            .wp-form-row select:focus,
            .wp-form-row textarea:focus {
                border-color: #f0a500;
            }
            .wp-form-row textarea {
                min-height: 50px;
                resize: vertical;
            }
            .wp-form-row-2, .wp-form-row-3 {
                display: flex;
                gap: 8px;
            }
            .wp-form-row-2 > div, .wp-form-row-3 > div {
                flex: 1;
            }
            .wp-form-row input[type="color"] {
                width: 100%;
                height: 32px;
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 6px;
                cursor: pointer;
                background: none;
                padding: 2px;
            }
            .wp-form-meta {
                font-size: 10px;
                color: #666;
                margin-top: 10px;
                padding-top: 8px;
                border-top: 1px solid rgba(255,255,255,0.04);
            }

            /* === Icon Grid === */
            .wp-icon-grid {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                max-height: 120px;
                overflow-y: auto;
                padding: 8px;
                background: rgba(0,0,0,0.2);
                border-radius: 6px;
            }
            .wp-icon-option {
                font-size: 18px;
                padding: 4px 6px;
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.1s;
                text-align: center;
                min-width: 28px;
            }
            .wp-icon-option:hover {
                background: rgba(240, 165, 0, 0.2);
            }
            .wp-icon-option.selected {
                background: rgba(240, 165, 0, 0.3);
                border: 1px solid #f0a500;
            }

            /* === Buttons === */
            .wp-btn {
                padding: 7px 16px;
                border: none;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .wp-btn-primary {
                background: linear-gradient(135deg, #f0a500, #c48500);
                color: #1a1a2e;
            }
            .wp-btn-primary:hover {
                box-shadow: 0 0 15px rgba(240,165,0,0.4);
                transform: translateY(-1px);
            }
            .wp-btn-secondary {
                background: rgba(255,255,255,0.06);
                color: #ccc;
                border: 1px solid rgba(255,255,255,0.1);
            }
            .wp-btn-secondary:hover {
                border-color: #f0a500;
                color: #f0a500;
            }
            .wp-btn-danger {
                background: rgba(255,68,68,0.15);
                color: #ff5555;
                border: 1px solid rgba(255,68,68,0.3);
            }
            .wp-btn-danger:hover {
                background: rgba(255,68,68,0.3);
            }

            /* === Sidebar === */
            .wp-sidebar {
                position: fixed;
                top: 80px;
                left: 16px;
                z-index: 1000;
                width: 260px;
                max-height: calc(100vh - 180px);
                overflow-y: auto;
                padding: 0;
                display: flex;
                flex-direction: column;
                transition: transform 0.3s ease, opacity 0.3s ease;
            }
            .wp-sidebar.collapsed {
                transform: translateX(-280px);
                opacity: 0;
                pointer-events: none;
            }
            .wp-sidebar-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 14px;
                font-weight: 700;
                color: #f0a500;
                border-bottom: 1px solid rgba(255,255,255,0.06);
            }
            .wp-sidebar-count {
                background: rgba(240,165,0,0.2);
                padding: 2px 8px;
                border-radius: 10px;
                font-size: 11px;
            }
            .wp-sidebar-search input {
                width: 100%;
                padding: 8px 12px;
                background: rgba(0,0,0,0.3);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 6px;
                color: #e0e0e0;
                font-size: 12px;
                outline: none;
                margin: 10px;
                width: calc(100% - 20px);
                box-sizing: border-box;
            }
            .wp-sidebar-search input:focus {
                border-color: #f0a500;
            }
            .wp-sidebar-filters {
                display: flex;
                gap: 6px;
                padding: 0 10px 10px;
            }
            .wp-sidebar-filters select {
                flex: 1;
                padding: 6px 8px;
                background: rgba(0,0,0,0.3);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 6px;
                color: #ccc;
                font-size: 11px;
                outline: none;
            }
            .wp-sidebar-categories {
                padding: 10px 10px 6px;
                border-top: 1px solid rgba(255,255,255,0.04);
            }
            .wp-section-title {
                font-size: 10px;
                font-weight: 700;
                color: #888;
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-bottom: 6px;
            }
            .wp-cat-item {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 5px 8px;
                border-radius: 6px;
                cursor: pointer;
                transition: background 0.1s;
                font-size: 12px;
            }
            .wp-cat-item:hover {
                background: rgba(240,165,0,0.1);
            }
            .wp-cat-item.wp-cat-hidden {
                opacity: 0.4;
            }
            .wp-cat-icon { font-size: 14px; }
            .wp-cat-name { flex: 1; }
            .wp-cat-count {
                font-size: 10px;
                color: #888;
                background: rgba(255,255,255,0.05);
                padding: 1px 6px;
                border-radius: 8px;
            }
            .wp-cat-toggle {
                background: none;
                border: none;
                font-size: 12px;
                cursor: pointer;
                opacity: 0.5;
                transition: opacity 0.15s;
                padding: 2px;
            }
            .wp-cat-toggle:hover { opacity: 1; }
            .wp-add-cat-btn {
                width: 100%;
                padding: 6px;
                margin-top: 6px;
                background: rgba(255,255,255,0.03);
                border: 1px dashed rgba(255,255,255,0.1);
                border-radius: 6px;
                color: #888;
                font-size: 11px;
                cursor: pointer;
                transition: all 0.15s;
            }
            .wp-add-cat-btn:hover {
                border-color: #f0a500;
                color: #f0a500;
            }
            .wp-sidebar-stats {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 4px;
                padding: 8px 10px;
                border-top: 1px solid rgba(255,255,255,0.04);
                font-size: 11px;
            }
            .wp-stat {
                display: flex;
                justify-content: space-between;
                color: #888;
            }
            .wp-stat strong { color: #e0e0e0; }
            .wp-sidebar-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                padding: 8px 10px;
                border-top: 1px solid rgba(255,255,255,0.04);
            }
            .wp-action-btn {
                flex: 1;
                min-width: 60px;
                padding: 6px 8px;
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 6px;
                color: #ccc;
                font-size: 11px;
                cursor: pointer;
                transition: all 0.15s;
            }
            .wp-action-btn:hover {
                border-color: #f0a500;
                color: #f0a500;
            }
            .wp-sidebar-list {
                padding: 6px 8px 10px;
                border-top: 1px solid rgba(255,255,255,0.04);
            }
            .wp-empty {
                text-align: center;
                padding: 20px 10px;
                color: #666;
                font-size: 12px;
            }
            .wp-list-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 8px;
                border-radius: 6px;
                cursor: pointer;
                transition: background 0.1s;
                border-bottom: 1px solid rgba(255,255,255,0.02);
            }
            .wp-list-item:hover {
                background: rgba(240,165,0,0.1);
            }
            .wp-list-icon { font-size: 18px; flex-shrink: 0; }
            .wp-list-info {
                flex: 1;
                min-width: 0;
            }
            .wp-list-name {
                display: block;
                font-size: 12px;
                font-weight: 600;
                color: #e0e0e0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .wp-list-coords {
                display: block;
                font-size: 10px;
                font-family: monospace;
            }
            .wp-list-date {
                font-size: 9px;
                color: #666;
                flex-shrink: 0;
            }

            /* === Toggle Button === */
            .wp-sidebar-toggle {
                position: fixed;
                top: 80px;
                left: 16px;
                z-index: 999;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                font-size: 18px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.3s ease;
            }
            .wp-sidebar-toggle.active {
                opacity: 1;
                pointer-events: all;
            }

            /* === Route Lines === */
            .waypoint-route-line {
                pointer-events: auto !important;
            }

            /* === Animations === */
            @keyframes wpFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes wpSlideUp {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes wpFadeInUp {
                from { opacity: 0; transform: translateY(8px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    // ── Map Event Binding ─────────────────────────────────────
    function bindMapEvents() {
        if (!state.map) return;

        // Right-click on map to add waypoint
        state.map.on('contextmenu', function (e) {
            // Don't show if clicking on a waypoint marker
            if (e.originalEvent.target.closest('.waypoint-marker')) return;
            showMapContextMenu(e);
        });

        // Click on empty map to deselect
        state.map.on('click', function (e) {
            if (!e.originalEvent.target.closest('.waypoint-marker')) {
                // Not handled by route mode
            }
        });
    }

    // ── Initialization ────────────────────────────────────────
    function init() {
        addStyles();
        loadWaypoints();

        // Find map instance — try app.js state first, then global
        let map = null;
        if (typeof state !== 'undefined' && state.map) {
            map = state.map;
        }
        if (!map && typeof window.map !== 'undefined') {
            map = window.map;
        }
        if (!map) {
            // Look for Leaflet map container
            const mapEl = document.getElementById('map');
            if (mapEl && mapEl._leaflet_map) {
                map = mapEl._leaflet_map;
            }
        }

        if (!map) {
            console.warn('[waypoints] No map found, retrying...');
            setTimeout(init, 500);
            return;
        }

        state.map = map;

        // Create layers
        state.routeLayer = L.layerGroup().addTo(map);
        state.waypointLayer = L.layerGroup().addTo(map);

        // Make state.map accessible globally for coordReader
        window.map = map;

        // Render initial state
        renderWaypoints();
        renderRoutes();
        createSidebar();
        bindMapEvents();

        console.log(`[waypoints] Initialized with ${state.waypoints.length} waypoints, ${state.categories.length} categories`);
    }

    // ── Public API ────────────────────────────────────────────
    window.WaypointSystem = {
        create: createWaypoint,
        update: updateWaypoint,
        delete: deleteWaypoint,
        undo: undo,
        export: exportToJSON,
        import: importFromJSON,
        createRoute: createRoute,
        deleteRoute: deleteRoute,
        clearRoutes: clearAllRoutes,
        getWaypoints: () => deepClone(state.waypoints),
        getCategories: () => deepClone(state.categories),
        getState: () => ({
            waypointCount: state.waypoints.length,
            categoryCount: state.categories.length,
            routeCount: state.routes.length,
        }),
        toggleSidebar: () => {
            document.getElementById('wp-sidebar')?.classList.toggle('collapsed');
            document.getElementById('wp-sidebar-toggle')?.classList.toggle('active');
        },
        addWaypointAtCenter: function () {
            const center = state.map.getCenter();
            showCreateDialog(Math.round(center.lng), Math.round(center.lat), 'overworld');
        },
        refresh: function () {
            renderWaypoints();
            renderRoutes();
            updateSidebar();
        },
    };

    // ── Start ─────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // If Leaflet is ready, init immediately or retry
        if (typeof L !== 'undefined' && document.getElementById('map')) {
            init();
        } else {
            document.addEventListener('DOMContentLoaded', init);
        }
    }
})();

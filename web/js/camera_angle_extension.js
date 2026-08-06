/**
 * ComfyUI Extension - Camera Angle Selector
 * 
 * This extension adds a 3D camera angle selector that renders directly
 * inside the CameraAngleSelector node using Three.js.
 * 
 * Features:
 * - 3D visualization of 96 camera angles
 * - Filter by direction (front, back, left, right, quarters)
 * - Filter by shot size (close-up, medium, wide)
 * - Filter by height (low, eye-level, elevated, high)
 * - Select All / Clear All buttons
 * - Selected angles list display
 */

import { app } from "../../../scripts/app.js";
import * as ThreeModule from "../vendor/three.module.js";

function loadThreeJS() {
    return Promise.resolve(ThreeModule);
}

const THREE = ThreeModule;

function createInlineLabel(text) {
    const label = document.createElement('span');
    label.textContent = text;
    label.style.cssText = 'color: #888; margin-right: 4px; font-size: 9px;';
    return label;
}

function appendLegendItem(parent, marker, color, text, extraStyle = '') {
    const item = document.createElement('span');
    if (extraStyle) item.style.cssText = extraStyle;

    const markerEl = document.createElement('b');
    markerEl.textContent = marker;
    markerEl.style.color = color;

    item.appendChild(markerEl);
    item.appendChild(document.createTextNode(` ${text}`));
    parent.appendChild(item);
}

// Camera angle data - must match Python backend
const VIEW_DIRECTIONS = [
    "front view",
    "front-right quarter view",
    "right side view",
    "back-right quarter view",
    "back view",
    "back-left quarter view",
    "left side view",
    "front-left quarter view",
];

const HEIGHT_ANGLES = [
    "low-angle shot",
    "eye-level shot",
    "elevated shot",
    "high-angle shot",
];

const SHOT_SIZES = [
    "close-up",
    "medium shot",
    "wide shot",
];

// Direction groups for filtering
const DIRECTION_GROUPS = {
    'front': [0],           // front view
    'back': [4],            // back view
    'left': [6],            // left side view
    'right': [2],           // right side view
    'front-q': [1, 7],      // front-right quarter, front-left quarter
    'back-q': [3, 5],       // back-right quarter, back-left quarter
};

// Generate all 96 combinations
function generateCameraAngles() {
    const angles = [];
    for (const direction of VIEW_DIRECTIONS) {
        for (const height of HEIGHT_ANGLES) {
            for (const size of SHOT_SIZES) {
                angles.push({
                    direction,
                    height,
                    size,
                    prompt: `<sks> ${direction} ${height} ${size}`
                });
            }
        }
    }
    return angles;
}

const CAMERA_ANGLES = generateCameraAngles();

// Color schemes - different colors for front vs back facing
const DIRECTION_COLORS = {
    front: 0x4CAF50,      // Green for front
    frontQuarter: 0x8BC34A, // Light green for front quarters
    side: 0xFFEB3B,       // Yellow for sides
    backQuarter: 0xFF9800, // Orange for back quarters
    back: 0xF44336,       // Red for back
};

// Map direction index to color
function getDirectionColor(dirIdx) {
    switch(dirIdx) {
        case 0: return DIRECTION_COLORS.front;        // front
        case 1: return DIRECTION_COLORS.frontQuarter; // front-right
        case 7: return DIRECTION_COLORS.frontQuarter; // front-left
        case 2: return DIRECTION_COLORS.side;         // right
        case 6: return DIRECTION_COLORS.side;         // left
        case 3: return DIRECTION_COLORS.backQuarter;  // back-right
        case 5: return DIRECTION_COLORS.backQuarter;  // back-left
        case 4: return DIRECTION_COLORS.back;         // back
        default: return 0x888888;
    }
}

// Height indicator colors (for the cone)
const HEIGHT_COLORS = [
    0xe74c3c, // low-angle - red
    0x3498db, // eye-level - blue
    0x9b59b6, // elevated - purple
    0x1abc9c, // high-angle - teal
];

const SELECTED_COLOR = 0xe94560;
const ANGLE_CAMERA_DISTANCE_OPTIONS = [0.6, 1.0, 1.8];
const ANGLE_CAMERA_DISTANCE_RADII = {
    0.6: 1.55,
    1.0: 2.25,
    1.8: 2.75,
};
const ANGLE_CAMERA_SUBJECT_HEIGHT = 2.75;
const ANGLE_CAMERA_SUBJECT_MIN_WIDTH = 1.2;
const ANGLE_CAMERA_SUBJECT_MAX_WIDTH = 3.0;
const ANGLE_CAMERA_SUBJECT_OPACITY = 0.68;
const ANGLE_CAMERA_WIDGET_MIN_HEIGHT = 420;
const ANGLE_CAMERA_WIDGET_HEIGHT = 460;
const ANGLE_CAMERA_WIDGET_NODE_CHROME = 190;

function angleCameraRadius(distance) {
    return ANGLE_CAMERA_DISTANCE_RADII[distance] || ANGLE_CAMERA_DISTANCE_RADII[1.0];
}

/**
 * Create the 3D Camera Angle Widget for a node
 */
class CameraAngle3DWidget {
    constructor(node) {
        this.node = node;
        this.selectedIndices = new Set();
        
        // Three.js references
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.cameraMeshes = [];
        this.resizeObserver = null;
        this.animationId = null;
        
        // DOM elements
        this.container = null;
        this.canvas = null;
        this.controlsPanel = null;
        this.selectionList = null;
        this.tooltip = null;
        
        // Filter state
        this.activeFilters = {
            directions: new Set(), // empty = all
            heights: new Set(),
            sizes: new Set(),
        };
        
        // Mouse state
        this.isDragging = false;
        this.previousMousePosition = { x: 0, y: 0 };
        this.dragDistance = 0;
        this.mouse = null;
        this.raycaster = null;
        
        // Layout - will be updated dynamically
        this.minSize = 300;
        this.viewportArea = null;
    }
    
    async initialize() {
        try {
            await loadThreeJS();
        } catch (e) {
            console.error("CameraAngleSelector: Failed to load Three.js:", e);
            return false;
        }
        
        this.createContainer();
        this.initThreeJS();
        this.createSubject();
        this.createCameraMarkers();
        this.setupEventListeners();
        this.startAnimation();
        
        // Load initial value from widget
        this.loadFromWidget();
        
        return true;
    }
    
    createContainer() {
        // Create main container
        this.container = document.createElement('div');
        this.container.className = 'camera-angle-3d-container';
        this.container.style.cssText = `
            width: 100%;
            height: 100%;
            position: relative;
            overflow: hidden;
            background: #1a1a2e;
            border-radius: 4px;
            border: 1px solid #0f3460;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
        `;
        
        // Create 3D viewport area - will maintain 1:1 aspect ratio
        this.viewportArea = document.createElement('div');
        this.viewportArea.style.cssText = `
            width: 100%;
            aspect-ratio: 1 / 1;
            position: relative;
            flex-shrink: 0;
            min-height: 200px;
        `;
        
        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = `
            width: 100%;
            height: 100%;
            display: block;
            cursor: grab;
            outline: none;
        `;
        this.viewportArea.appendChild(this.canvas);
        
        // Create tooltip
        this.tooltip = document.createElement('div');
        this.tooltip.style.cssText = `
            position: absolute;
            background: rgba(22, 33, 62, 0.95);
            color: #fff;
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 11px;
            pointer-events: none;
            display: none;
            z-index: 100;
            border: 1px solid #0f3460;
            white-space: nowrap;
            font-family: sans-serif;
        `;
        this.viewportArea.appendChild(this.tooltip);
        
        this.container.appendChild(this.viewportArea);
        
        // Create controls panel
        this.createControlsPanel();
        
        // Create selection list
        this.createSelectionList();
    }
    
    createControlsPanel() {
        this.controlsPanel = document.createElement('div');
        this.controlsPanel.style.cssText = `
            padding: 8px;
            background: #16213e;
            border-top: 1px solid #0f3460;
            font-family: sans-serif;
            font-size: 10px;
        `;
        
        // Direction filters row
        const dirRow = document.createElement('div');
        dirRow.style.cssText = 'margin-bottom: 6px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;';
        dirRow.appendChild(createInlineLabel('DIR:'));
        
        const dirButtons = [
            { label: 'Front', key: 'front', color: '#4CAF50' },
            { label: 'F-Qtr', key: 'front-q', color: '#8BC34A' },
            { label: 'Side', key: 'side', color: '#FFEB3B', textColor: '#000' },
            { label: 'B-Qtr', key: 'back-q', color: '#FF9800' },
            { label: 'Back', key: 'back', color: '#F44336' },
        ];
        
        dirButtons.forEach(btn => {
            const button = this.createFilterButton(btn.label, 'directions', btn.key, btn.color, btn.textColor);
            dirRow.appendChild(button);
        });
        
        this.controlsPanel.appendChild(dirRow);
        
        // Shot size filters row
        const sizeRow = document.createElement('div');
        sizeRow.style.cssText = 'margin-bottom: 6px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;';
        sizeRow.appendChild(createInlineLabel('SIZE:'));
        
        const sizeButtons = [
            { label: 'Close', key: 0, color: '#4a90d9' },
            { label: 'Medium', key: 1, color: '#50c878' },
            { label: 'Wide', key: 2, color: '#f39c12' },
        ];
        
        sizeButtons.forEach(btn => {
            const button = this.createFilterButton(btn.label, 'sizes', btn.key, btn.color);
            sizeRow.appendChild(button);
        });
        
        this.controlsPanel.appendChild(sizeRow);
        
        // Height filters row
        const heightRow = document.createElement('div');
        heightRow.style.cssText = 'margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;';
        heightRow.appendChild(createInlineLabel('HGT:'));
        
        const heightButtons = [
            { label: 'Low', key: 0, color: '#e74c3c' },
            { label: 'Eye', key: 1, color: '#3498db' },
            { label: 'Elev', key: 2, color: '#9b59b6' },
            { label: 'High', key: 3, color: '#1abc9c' },
        ];
        
        heightButtons.forEach(btn => {
            const button = this.createFilterButton(btn.label, 'heights', btn.key, btn.color);
            heightRow.appendChild(button);
        });
        
        this.controlsPanel.appendChild(heightRow);
        
        // Action buttons row
        const actionRow = document.createElement('div');
        actionRow.style.cssText = 'display: flex; gap: 6px; justify-content: flex-start;';
        
        const selectVisibleBtn = this.createActionButton('Select Filtered', () => this.selectFiltered());
        const selectAllBtn = this.createActionButton('Select All', () => this.selectAll());
        const clearAllBtn = this.createActionButton('Clear All', () => this.clearAll(), '#e74c3c');
        
        actionRow.appendChild(selectVisibleBtn);
        actionRow.appendChild(selectAllBtn);
        actionRow.appendChild(clearAllBtn);
        
        this.controlsPanel.appendChild(actionRow);
        
        // Add legend
        const legendRow = document.createElement('div');
        legendRow.style.cssText = 'margin-top: 8px; padding-top: 6px; border-top: 1px solid #0f3460; display: flex; gap: 12px; flex-wrap: wrap; font-size: 9px; color: #888;';
        appendLegendItem(legendRow, 'o', '#4a90d9', 'Close (inner)');
        appendLegendItem(legendRow, 'o', '#50c878', 'Medium (middle)');
        appendLegendItem(legendRow, 'o', '#f39c12', 'Wide (outer)');

        const facingItem = document.createElement('span');
        facingItem.style.marginLeft = 'auto';
        const frontMarker = document.createElement('b');
        frontMarker.textContent = '#';
        frontMarker.style.color = '#4CAF50';
        const backMarker = document.createElement('b');
        backMarker.textContent = '#';
        backMarker.style.color = '#F44336';
        facingItem.appendChild(frontMarker);
        facingItem.appendChild(document.createTextNode(' Front '));
        facingItem.appendChild(backMarker);
        facingItem.appendChild(document.createTextNode(' Back'));
        legendRow.appendChild(facingItem);
        this.controlsPanel.appendChild(legendRow);
        
        this.container.appendChild(this.controlsPanel);
    }
    
    createFilterButton(label, filterType, filterKey, bgColor, textColor = '#fff') {
        const button = document.createElement('button');
        button.textContent = label;
        button.dataset.filterType = filterType;
        button.dataset.filterKey = filterKey;
        button.style.cssText = `
            padding: 3px 8px;
            border: 2px solid ${bgColor};
            background: transparent;
            color: ${bgColor};
            border-radius: 3px;
            cursor: pointer;
            font-size: 10px;
            font-weight: bold;
            transition: all 0.2s;
        `;
        
        button.addEventListener('click', () => {
            const isActive = this.activeFilters[filterType].has(filterKey);
            if (isActive) {
                this.activeFilters[filterType].delete(filterKey);
                button.style.background = 'transparent';
                button.style.color = bgColor;
            } else {
                this.activeFilters[filterType].add(filterKey);
                button.style.background = bgColor;
                button.style.color = textColor;
            }
            this.updateCameraVisibility();
        });
        
        return button;
    }
    
    createActionButton(label, onClick, bgColor = '#0f3460') {
        const button = document.createElement('button');
        button.textContent = label;
        button.style.cssText = `
            padding: 4px 10px;
            border: none;
            background: ${bgColor};
            color: #fff;
            border-radius: 3px;
            cursor: pointer;
            font-size: 10px;
            font-weight: bold;
            transition: opacity 0.2s;
        `;
        button.addEventListener('mouseenter', () => button.style.opacity = '0.8');
        button.addEventListener('mouseleave', () => button.style.opacity = '1');
        button.addEventListener('click', onClick);
        return button;
    }
    
    createSelectionList() {
        const listContainer = document.createElement('div');
        listContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            background: #0d1b2a;
            border-top: 1px solid #0f3460;
            padding: 6px;
            min-height: 80px;
        `;
        
        const header = document.createElement('div');
        header.style.cssText = `
            color: #888;
            font-size: 10px;
            margin-bottom: 4px;
            font-family: sans-serif;
            display: flex;
            justify-content: space-between;
        `;
        const title = document.createElement('span');
        title.textContent = 'Selected Angles:';
        const count = document.createElement('span');
        count.id = 'selection-count-' + this.node.id;
        count.textContent = '0';
        header.appendChild(title);
        header.appendChild(count);
        listContainer.appendChild(header);
        
        this.selectionList = document.createElement('div');
        this.selectionList.style.cssText = `
            font-family: monospace;
            font-size: 9px;
            color: #ccc;
            line-height: 1.6;
        `;
        listContainer.appendChild(this.selectionList);
        
        this.container.appendChild(listContainer);
    }
    
    updateSelectionList() {
        const sortedIndices = Array.from(this.selectedIndices).sort((a, b) => a - b);
        
        // Update count
        const countEl = document.getElementById('selection-count-' + this.node.id);
        if (countEl) countEl.textContent = sortedIndices.length;
        
        // Build list items
        this.selectionList.replaceChildren();
        
        sortedIndices.forEach(idx => {
            const angle = CAMERA_ANGLES[idx];
            const item = document.createElement('div');
            item.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 2px 4px;
                background: rgba(15, 52, 96, 0.5);
                border-radius: 2px;
                margin-bottom: 2px;
            `;
            
            const text = document.createElement('span');
            text.textContent = `${angle.direction} | ${angle.height} | ${angle.size}`;
            text.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;';
            
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.style.cssText = `
                background: none;
                border: none;
                color: #e94560;
                cursor: pointer;
                font-size: 14px;
                padding: 0 4px;
                line-height: 1;
            `;
            removeBtn.addEventListener('click', () => this.deselectByIndex(idx));
            
            item.appendChild(text);
            item.appendChild(removeBtn);
            this.selectionList.appendChild(item);
        });
        
        if (sortedIndices.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'Click cameras in the 3D view to select angles';
            empty.style.cssText = 'color: #555; font-style: italic;';
            this.selectionList.appendChild(empty);
        }
    }
    
    deselectByIndex(idx) {
        this.selectedIndices.delete(idx);
        const group = this.cameraMeshes[idx];
        if (group) {
            this.setSelected(group, false);
        }
        this.updateSelectionList();
        this.syncToWidget();
    }
    
    updateCameraVisibility() {
        this.cameraMeshes.forEach((group, idx) => {
            const { dirIdx, heightIdx, sizeIdx } = group.userData;
            
            let visible = true;
            
            // Check direction filter
            if (this.activeFilters.directions.size > 0) {
                let dirMatch = false;
                for (const dirKey of this.activeFilters.directions) {
                    if (dirKey === 'side') {
                        if (dirIdx === 2 || dirIdx === 6) dirMatch = true;
                    } else {
                        const indices = DIRECTION_GROUPS[dirKey] || [];
                        if (indices.includes(dirIdx)) dirMatch = true;
                    }
                }
                visible = visible && dirMatch;
            }
            
            // Check height filter
            if (this.activeFilters.heights.size > 0) {
                visible = visible && this.activeFilters.heights.has(heightIdx);
            }
            
            // Check size filter
            if (this.activeFilters.sizes.size > 0) {
                visible = visible && this.activeFilters.sizes.has(sizeIdx);
            }
            
            group.visible = visible;
        });
    }
    
    selectFiltered() {
        this.cameraMeshes.forEach((group, idx) => {
            if (group.visible && !this.selectedIndices.has(idx)) {
                this.selectedIndices.add(idx);
                this.setSelected(group, true);
            }
        });
        this.updateSelectionList();
        this.syncToWidget();
    }
    
    selectAll() {
        this.cameraMeshes.forEach((group, idx) => {
            if (!this.selectedIndices.has(idx)) {
                this.selectedIndices.add(idx);
                this.setSelected(group, true);
            }
        });
        this.updateSelectionList();
        this.syncToWidget();
    }
    
    clearAll() {
        this.cameraMeshes.forEach((group, idx) => {
            if (this.selectedIndices.has(idx)) {
                this.selectedIndices.delete(idx);
                this.setSelected(group, false);
            }
        });
        this.updateSelectionList();
        this.syncToWidget();
    }
    
    initThreeJS() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);
        
        // Camera - positioned to see all three layers of camera markers
        // 1:1 aspect ratio for the viewport
        this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
        this.camera.position.set(0, 3, 10);
        this.camera.lookAt(0, 0, 0);
        
        // Renderer - size will be set by resize observer
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas, 
            antialias: true 
        });
        const size = this.viewportArea.clientWidth || 300;
        this.renderer.setSize(size, size);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 7);
        this.scene.add(directionalLight);
        
        const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
        backLight.position.set(-5, 5, -7);
        this.scene.add(backLight);
        
        // Grid
        const gridHelper = new THREE.GridHelper(10, 20, 0x0f3460, 0x16213e);
        gridHelper.position.y = -2;
        this.scene.add(gridHelper);
        
        // Raycaster for click detection
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
    }
    
    createSubject() {
        const group = new THREE.Group();
        group.name = 'subject';
        
        // Head
        const headGeometry = new THREE.SphereGeometry(0.4, 32, 32);
        const headMaterial = new THREE.MeshPhongMaterial({ 
            color: 0x0f3460,
            emissive: 0x0a1f3d,
            shininess: 30
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 1.2;
        group.add(head);
        
        // Face indicator (nose) - shows which way is "front"
        const noseGeometry = new THREE.ConeGeometry(0.1, 0.2, 8);
        const noseMaterial = new THREE.MeshPhongMaterial({ 
            color: 0x4CAF50,  // Green to match front cameras
            emissive: 0x2E7D32
        });
        const nose = new THREE.Mesh(noseGeometry, noseMaterial);
        nose.rotation.x = -Math.PI / 2;
        nose.position.set(0, 1.2, 0.45);
        group.add(nose);
        
        // Torso
        const torsoGeometry = new THREE.CylinderGeometry(0.3, 0.35, 1.0, 32);
        const torsoMaterial = new THREE.MeshPhongMaterial({ 
            color: 0x16213e,
            emissive: 0x0a1f3d,
            shininess: 30
        });
        const torso = new THREE.Mesh(torsoGeometry, torsoMaterial);
        torso.position.y = 0.3;
        group.add(torso);
        
        // Shoulders
        const shoulderGeometry = new THREE.BoxGeometry(1.2, 0.15, 0.3);
        const shoulderMaterial = new THREE.MeshPhongMaterial({ 
            color: 0x1a2a4a,
            emissive: 0x0a1f3d,
            shininess: 30
        });
        const shoulders = new THREE.Mesh(shoulderGeometry, shoulderMaterial);
        shoulders.position.y = 0.8;
        group.add(shoulders);
        
        // Base
        const baseGeometry = new THREE.CylinderGeometry(0.5, 0.6, 0.1, 32);
        const baseMaterial = new THREE.MeshPhongMaterial({ 
            color: 0x0f3460,
            emissive: 0x051020
        });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.y = -0.25;
        group.add(base);
        
        // Front/Back labels on base
        this.createTextLabel(group, 'F', 0, -0.19, 0.4, 0x4CAF50);
        this.createTextLabel(group, 'B', 0, -0.19, -0.4, 0xF44336);
        
        // Rotate the subject so its front faces +X (where "front view" cameras are)
        // The nose/face points +Z by default, cameras at dirIdx=0 are at +X
        group.rotation.y = Math.PI / 2;
        
        // Orbit sphere wireframes for each shot size layer
        const sizeRadii = [2.0, 2.5, 3.0]; // close-up, medium, wide
        const sizeColors = [0x4a90d9, 0x50c878, 0xf39c12]; // blue, green, orange
        
        sizeRadii.forEach((radius, idx) => {
            const orbitGeometry = new THREE.SphereGeometry(radius, 24, 24);
            const orbitMaterial = new THREE.MeshBasicMaterial({ 
                color: sizeColors[idx],
                wireframe: true,
                transparent: true,
                opacity: 0.15
            });
            const orbit = new THREE.Mesh(orbitGeometry, orbitMaterial);
            group.add(orbit);
        });
        
        this.scene.add(group);
    }
    
    createTextLabel(parent, text, x, y, z, color) {
        // Create a simple sprite-based label
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 32, 32);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(x, y, z);
        sprite.scale.set(0.3, 0.3, 1);
        parent.add(sprite);
    }
    
    createCameraMarkers() {
        // Different radii for each shot size - close-up closer, wide further out
        const sizeRadii = [2.0, 2.5, 3.0]; // close-up, medium, wide
        const heightLevels = [-0.8, 0, 0.8, 1.6];
        
        for (let dirIdx = 0; dirIdx < VIEW_DIRECTIONS.length; dirIdx++) {
            const angle = (dirIdx / VIEW_DIRECTIONS.length) * Math.PI * 2;
            
            // Get direction-based color
            const dirColor = getDirectionColor(dirIdx);
            
            for (let heightIdx = 0; heightIdx < HEIGHT_ANGLES.length; heightIdx++) {
                const y = heightLevels[heightIdx];
                
                for (let sizeIdx = 0; sizeIdx < SHOT_SIZES.length; sizeIdx++) {
                    // Each shot size is at a different radius
                    const radius = sizeRadii[sizeIdx];
                    const x = Math.cos(angle) * radius;
                    const z = Math.sin(angle) * radius;
                    
                    const globalIdx = dirIdx * 12 + heightIdx * 3 + sizeIdx;
                    const sizeMultiplier = 0.8 + sizeIdx * 0.2; // Smaller cameras overall
                    
                    const cameraGroup = new THREE.Group();
                    
                    // Camera body (colored by DIRECTION - front/back differentiation)
                    const bodyGeometry = new THREE.BoxGeometry(
                        0.12 * sizeMultiplier, 
                        0.08 * sizeMultiplier, 
                        0.16 * sizeMultiplier
                    );
                    const bodyMaterial = new THREE.MeshPhongMaterial({ 
                        color: dirColor,
                        emissive: 0x000000,
                        shininess: 50
                    });
                    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
                    cameraGroup.add(body);
                    
                    // Camera lens
                    const lensGeometry = new THREE.CylinderGeometry(
                        0.04 * sizeMultiplier, 
                        0.04 * sizeMultiplier, 
                        0.06 * sizeMultiplier, 
                        16
                    );
                    const lensMaterial = new THREE.MeshPhongMaterial({ 
                        color: 0x333333,
                        emissive: 0x111111
                    });
                    const lens = new THREE.Mesh(lensGeometry, lensMaterial);
                    lens.rotation.x = Math.PI / 2;
                    lens.position.z = 0.1 * sizeMultiplier;
                    cameraGroup.add(lens);
                    
                    // Height indicator ring (colored by height)
                    const ringGeometry = new THREE.TorusGeometry(0.06 * sizeMultiplier, 0.012, 8, 16);
                    const ringMaterial = new THREE.MeshPhongMaterial({ 
                        color: HEIGHT_COLORS[heightIdx],
                        emissive: 0x000000
                    });
                    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
                    ring.rotation.x = Math.PI / 2;
                    ring.position.y = 0.06 * sizeMultiplier;
                    cameraGroup.add(ring);
                    
                    // Position and orient
                    cameraGroup.position.set(x, y, z);
                    cameraGroup.lookAt(0, 0, 0);
                    
                    // Store metadata
                    cameraGroup.userData = {
                        angleIndex: globalIdx,
                        angleData: CAMERA_ANGLES[globalIdx],
                        isCamera: true,
                        originalColor: dirColor,
                        heightIdx,
                        sizeIdx,
                        dirIdx
                    };
                    
                    this.scene.add(cameraGroup);
                    this.cameraMeshes.push(cameraGroup);
                }
            }
        }
    }
    
    setupEventListeners() {
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', this.onMouseLeave.bind(this));
        this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
        
        // Resize observer - maintains 1:1 aspect ratio
        this.resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const width = entry.contentRect.width;
                const height = entry.contentRect.height;
                if (width > 0 && height > 0 && this.camera && this.renderer) {
                    // Use the smaller dimension to maintain 1:1 aspect in the viewport
                    const size = Math.min(width, height);
                    this.camera.aspect = 1;
                    this.camera.updateProjectionMatrix();
                    this.renderer.setSize(size, size);
                }
            }
        });
        this.resizeObserver.observe(this.viewportArea);
    }
    
    startAnimation() {
        const animate = () => {
            this.animationId = requestAnimationFrame(animate);
            this.renderer.render(this.scene, this.camera);
        };
        animate();
    }
    
    // Mouse event handlers
    onMouseDown(event) {
        this.isDragging = true;
        this.dragDistance = 0;
        this.previousMousePosition = {
            x: event.clientX,
            y: event.clientY
        };
        this.canvas.style.cursor = 'grabbing';
    }
    
    onMouseMove(event) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        if (this.isDragging) {
            const deltaX = event.clientX - this.previousMousePosition.x;
            const deltaY = event.clientY - this.previousMousePosition.y;
            
            this.dragDistance += Math.abs(deltaX) + Math.abs(deltaY);
            
            // Rotate the scene
            this.scene.rotation.y += deltaX * 0.005;
            this.scene.rotation.x += deltaY * 0.005;
            this.scene.rotation.x = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, this.scene.rotation.x));
            
            this.previousMousePosition = {
                x: event.clientX,
                y: event.clientY
            };
        } else {
            // Update tooltip on hover
            this.updateTooltip(event);
        }
    }
    
    onMouseUp(event) {
        // If minimal drag, treat as click
        if (this.dragDistance < 5) {
            this.handleClick();
        }
        
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
    }
    
    onMouseLeave() {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
        this.tooltip.style.display = 'none';
    }
    
    onWheel(event) {
        event.preventDefault();
        
        // Zoom in/out by moving camera along its forward direction
        const zoomSpeed = 0.5;
        const delta = event.deltaY > 0 ? zoomSpeed : -zoomSpeed;
        
        // Get current distance from origin
        const currentDistance = this.camera.position.length();
        const newDistance = Math.max(5, Math.min(20, currentDistance + delta));
        
        // Scale camera position to new distance
        this.camera.position.normalize().multiplyScalar(newDistance);
    }
    
    handleClick() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Collect all meshes from visible camera groups
        const allMeshes = [];
        this.cameraMeshes.forEach(group => {
            if (group.visible) {
                group.traverse(child => {
                    if (child.isMesh) {
                        child.userData.parentGroup = group;
                        allMeshes.push(child);
                    }
                });
            }
        });
        
        const intersects = this.raycaster.intersectObjects(allMeshes);
        
        if (intersects.length > 0) {
            const clickedMesh = intersects[0].object;
            const group = clickedMesh.userData.parentGroup;
            
            if (group && group.userData.isCamera) {
                this.toggleSelection(group);
            }
        }
    }
    
    toggleSelection(group) {
        const index = group.userData.angleIndex;
        
        if (this.selectedIndices.has(index)) {
            this.selectedIndices.delete(index);
            this.setSelected(group, false);
        } else {
            this.selectedIndices.add(index);
            this.setSelected(group, true);
        }
        
        this.updateSelectionList();
        this.syncToWidget();
    }
    
    setSelected(group, isSelected) {
        group.traverse(child => {
            if (child.isMesh && child.material) {
                if (isSelected) {
                    child.material.emissive.setHex(SELECTED_COLOR);
                    child.material.emissiveIntensity = 0.6;
                } else {
                    child.material.emissive.setHex(0x000000);
                    child.material.emissiveIntensity = 0;
                }
            }
        });
    }
    
    updateTooltip(event) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const allMeshes = [];
        this.cameraMeshes.forEach(group => {
            if (group.visible) {
                group.traverse(child => {
                    if (child.isMesh) {
                        child.userData.parentGroup = group;
                        allMeshes.push(child);
                    }
                });
            }
        });
        
        const intersects = this.raycaster.intersectObjects(allMeshes);
        
        if (intersects.length > 0) {
            const hoveredMesh = intersects[0].object;
            const group = hoveredMesh.userData.parentGroup;
            
            if (group && group.userData.isCamera) {
                const data = group.userData.angleData;
                const rect = this.canvas.getBoundingClientRect();
                const isSelected = this.selectedIndices.has(group.userData.angleIndex);
                
                this.tooltip.textContent = [
                    data.direction,
                    data.height,
                    data.size,
                    isSelected ? 'Selected' : 'Click to select',
                ].join('\n');
                this.tooltip.style.whiteSpace = 'pre-line';
                this.tooltip.style.color = isSelected ? '#e94560' : '#fff';
                this.tooltip.style.display = 'block';
                this.tooltip.style.left = (event.clientX - rect.left + 10) + 'px';
                this.tooltip.style.top = (event.clientY - rect.top + 10) + 'px';
                return;
            }
        }
        
        this.tooltip.style.display = 'none';
    }
    
    // Sync selection to the hidden widget value
    syncToWidget() {
        const value = JSON.stringify(Array.from(this.selectedIndices).sort((a, b) => a - b));
        
        // Find the selected_indices widget
        const widget = this.node.widgets?.find(w => w.name === 'selected_indices');
        if (widget) {
            widget.value = value;
            if (widget.callback) {
                widget.callback(value);
            }
        }
        
        // Mark graph as needing update
        if (app.graph) {
            app.graph.setDirtyCanvas(true, true);
        }
    }
    
    // Load selection state from widget
    loadFromWidget() {
        const widget = this.node.widgets?.find(w => w.name === 'selected_indices');
        if (widget && widget.value) {
            try {
                const indices = JSON.parse(widget.value);
                if (Array.isArray(indices)) {
                    this.selectedIndices.clear();
                    indices.forEach(idx => {
                        if (typeof idx === 'number' && idx >= 0 && idx < this.cameraMeshes.length) {
                            this.selectedIndices.add(idx);
                            this.setSelected(this.cameraMeshes[idx], true);
                        }
                    });
                    this.updateSelectionList();
                }
            } catch (e) {
                console.error("CameraAngleSelector: Failed to parse widget value:", e);
            }
        } else {
            this.updateSelectionList();
        }
    }
    
    // Cleanup
    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.forceContextLoss();
        }
        
        // Dispose geometries and materials
        this.scene?.traverse(child => {
            if (child.isMesh) {
                child.geometry?.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material?.dispose();
                }
            }
        });
    }
}

class QwenAngleCameraWidget {
    constructor(node) {
        this.node = node;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.container = null;
        this.preview = null;
        this.promptEl = null;
        this.animationId = null;
        this.resizeObserver = null;
        this.isDragging = false;
        this.lastPointer = { x: 0, y: 0 };
        this.subject = null;
        this.subjectFrame = null;
        this.subjectMaterial = null;
        this.cameraMarker = null;
        this.guideLine = null;
        this.railsGroup = null;
        this.elevationArc = null;
        this.lastPreviewUrl = null;
        this.previewTimer = null;
        this.lastStateKey = "";
        this.lastRenderSize = { width: 0, height: 0 };
    }

    widget(name) {
        return this.node.widgets?.find(w => w.name === name);
    }

    getValue(name, fallback) {
        const w = this.widget(name);
        const value = Number(w?.value);
        return Number.isFinite(value) ? value : fallback;
    }

    setValue(name, value) {
        const w = this.widget(name);
        if (w) {
            w.value = value;
            app.canvas?.setDirty?.(true, false);
        }
    }

    snap(value, options) {
        return options.reduce((best, current) => {
            const currentDistance = Math.abs(current - value);
            const bestDistance = Math.abs(best - value);
            return currentDistance < bestDistance || (Math.abs(currentDistance - bestDistance) <= 1e-9 && current > best)
                ? current
                : best;
        });
    }

    getState() {
        return {
            azimuth: this.snap((this.getValue('azimuth', 0) + 360) % 360, [0, 45, 90, 135, 180, 225, 270, 315]),
            elevation: this.snap(this.getValue('elevation', 0), [-30, 0, 30, 60]),
            distance: this.snap(this.getValue('distance', 1.0), ANGLE_CAMERA_DISTANCE_OPTIONS),
        };
    }

    cameraPrompt(state = this.getState()) {
        const azimuthNames = {
            0: 'front view',
            45: 'front-right quarter view',
            90: 'right side view',
            135: 'back-right quarter view',
            180: 'back view',
            225: 'back-left quarter view',
            270: 'left side view',
            315: 'front-left quarter view',
        };
        const elevationNames = {
            '-30': 'low-angle shot',
            0: 'eye-level shot',
            30: 'elevated shot',
            60: 'high-angle shot',
        };
        const distanceNames = {
            '0.6': 'close-up',
            1: 'medium shot',
            '1.8': 'wide shot',
        };
        return `<sks> ${azimuthNames[state.azimuth]} ${elevationNames[state.elevation]} ${distanceNames[state.distance]}`;
    }

    createContainer() {
        this.container = document.createElement('div');
        this.container.className = 'qwen-angle-camera-control';
        this.container.style.cssText = `
            width: 100%;
            height: ${ANGLE_CAMERA_WIDGET_HEIGHT}px;
            min-height: ${ANGLE_CAMERA_WIDGET_MIN_HEIGHT}px;
            position: relative;
            overflow: hidden;
            background: #171820;
            border: 1px solid #34384a;
            border-radius: 6px;
            box-sizing: border-box;
        `;

        this.promptEl = document.createElement('div');
        this.promptEl.style.cssText = `
            position: absolute;
            left: 10px;
            right: 10px;
            bottom: 10px;
            z-index: 2;
            padding: 7px 9px;
            border-radius: 5px;
            background: rgba(0,0,0,0.72);
            color: #9ef7c4;
            font: 11px/1.35 monospace;
            white-space: nowrap;
            text-overflow: ellipsis;
            overflow-wrap: anywhere;
            overflow: hidden;
            pointer-events: none;
        `;
        this.container.appendChild(this.promptEl);

        const hint = document.createElement('div');
        hint.textContent = 'drag: angle / wheel: distance';
        hint.style.cssText = `
            position: absolute;
            top: 8px;
            left: 10px;
            z-index: 2;
            color: rgba(255,255,255,0.72);
            font: 11px sans-serif;
            pointer-events: none;
        `;
        this.container.appendChild(hint);
    }

    async initialize() {
        await loadThreeJS();
        this.createContainer();
        this.initScene();
        this.bindEvents();
        this.updateScene();
        this.start();
        return true;
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x171820);

        this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
        this.camera.position.set(4.4, 3.2, 5.4);
        this.camera.lookAt(0, 0.65, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.domElement.style.cssText = `
            display: block;
            width: 100%;
            height: 100%;
        `;
        this.container.insertBefore(this.renderer.domElement, this.promptEl);

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
        const light = new THREE.DirectionalLight(0xffffff, 0.85);
        light.position.set(3, 6, 5);
        this.scene.add(light);
        this.scene.add(new THREE.GridHelper(5, 10, 0x34384a, 0x252936));
        this.createRails();

        this.subjectMaterial = new THREE.MeshBasicMaterial({
            color: 0xd6d2c8,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: ANGLE_CAMERA_SUBJECT_OPACITY,
        });
        this.subject = new THREE.Mesh(
            new THREE.PlaneGeometry(1.65, ANGLE_CAMERA_SUBJECT_HEIGHT),
            this.subjectMaterial
        );
        this.subject.position.set(0, 0.85, 0);
        this.scene.add(this.subject);

        this.subjectFrame = new THREE.Mesh(
            new THREE.BoxGeometry(1.73, ANGLE_CAMERA_SUBJECT_HEIGHT + 0.08, 0.03),
            new THREE.MeshStandardMaterial({ color: 0x2b2f3d, roughness: 0.7 })
        );
        this.subjectFrame.position.copy(this.subject.position);
        this.subjectFrame.position.z = -0.025;
        this.scene.add(this.subjectFrame);

        const camBody = new THREE.Group();
        camBody.add(new THREE.Mesh(
            new THREE.BoxGeometry(0.28, 0.2, 0.32),
            new THREE.MeshStandardMaterial({ color: 0x6aa7ff, metalness: 0.25, roughness: 0.35 })
        ));
        const lens = new THREE.Mesh(
            new THREE.CylinderGeometry(0.075, 0.095, 0.18, 18),
            new THREE.MeshStandardMaterial({ color: 0x9ec6ff, metalness: 0.25, roughness: 0.25 })
        );
        lens.rotation.x = Math.PI / 2;
        lens.position.z = 0.24;
        camBody.add(lens);
        this.cameraMarker = camBody;
        this.scene.add(this.cameraMarker);

        const lineGeo = new THREE.BufferGeometry();
        this.guideLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x9ef7c4 }));
        this.scene.add(this.guideLine);

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);
        this.resize();
        this.updateSubjectTexture();
        this.previewTimer = window.setInterval(() => this.updateSubjectTexture(), 1000);
    }

    createRails() {
        const targetY = 0.85;
        this.railsGroup = new THREE.Group();

        const ringMaterial = new THREE.LineBasicMaterial({ color: 0x465063, transparent: true, opacity: 0.72 });

        for (const radius of ANGLE_CAMERA_DISTANCE_OPTIONS.map(angleCameraRadius)) {
            const points = [];
            for (let i = 0; i <= 96; i++) {
                const t = (i / 96) * Math.PI * 2;
                points.push(new THREE.Vector3(Math.sin(t) * radius, targetY, Math.cos(t) * radius));
            }
            this.railsGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), ringMaterial));
        }

        this.elevationArc = new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: 0x9b72ff, transparent: true, opacity: 0.78 })
        );
        this.railsGroup.add(this.elevationArc);

        this.scene.add(this.railsGroup);
    }

    updateElevationArc(state) {
        if (!this.elevationArc) return;
        const targetY = 0.85;
        const radius = angleCameraRadius(state.distance);
        const theta = THREE.MathUtils.degToRad(state.azimuth);
        const points = [];

        for (let elev = 0; elev <= 90; elev += 3) {
            const phi = THREE.MathUtils.degToRad(elev);
            points.push(new THREE.Vector3(
                Math.sin(theta) * radius * Math.cos(phi),
                targetY + radius * Math.sin(phi),
                Math.cos(theta) * radius * Math.cos(phi)
            ));
        }

        this.elevationArc.geometry.dispose();
        this.elevationArc.geometry = new THREE.BufferGeometry().setFromPoints(points);
    }

    linkedPreviewUrl() {
        const input = this.node.inputs?.find(i => i.name === 'image');
        if (!input?.link || !app.graph?.links) return null;

        const link = app.graph.links[input.link];
        const originId = Array.isArray(link) ? link[1] : link?.origin_id;
        if (originId == null) return null;

        const origin = app.graph.getNodeById ? app.graph.getNodeById(originId) : app.graph._nodes_by_id?.[originId];
        if (!origin || origin.type !== 'LoadImage') return null;

        const imageWidget = origin.widgets?.find(w => w.name === 'image');
        let filename = imageWidget?.value || origin.widgets_values?.[0];
        if (!filename || typeof filename !== 'string') return null;

        let type = 'input';
        const match = filename.match(/\s+\[(input|output|temp)\]$/);
        if (match) {
            type = match[1];
            filename = filename.replace(/\s+\[(input|output|temp)\]$/, '');
        }

        return `/view?filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}&subfolder=`;
    }

    updateSubjectTexture() {
        if (!this.subjectMaterial || !THREE) return;
        const url = this.linkedPreviewUrl();
        if (url === this.lastPreviewUrl) return;
        this.lastPreviewUrl = url;

        if (!url) {
            this.subjectMaterial.map = null;
            this.subjectMaterial.color.set(0xd6d2c8);
            this.subjectMaterial.needsUpdate = true;
            return;
        }

        const loader = new THREE.TextureLoader();
        loader.load(url, (texture) => {
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            this.subjectMaterial.map = texture;
            this.subjectMaterial.color.set(0xffffff);
            this.subjectMaterial.needsUpdate = true;

            const image = texture.image;
            if (image?.width && image?.height && this.subject) {
                const aspect = image.width / image.height;
                const height = ANGLE_CAMERA_SUBJECT_HEIGHT;
                const width = Math.max(
                    ANGLE_CAMERA_SUBJECT_MIN_WIDTH,
                    Math.min(ANGLE_CAMERA_SUBJECT_MAX_WIDTH, height * aspect)
                );
                this.subject.geometry.dispose();
                this.subject.geometry = new THREE.PlaneGeometry(width, height);
                if (this.subjectFrame) {
                    this.subjectFrame.geometry.dispose();
                    this.subjectFrame.geometry = new THREE.BoxGeometry(width + 0.08, height + 0.08, 0.03);
                }
            }
        });
    }

    updateScene() {
        const state = this.getState();
        const stateKey = `${state.azimuth}|${state.elevation}|${state.distance}`;
        if (stateKey === this.lastStateKey) return;
        this.lastStateKey = stateKey;

        this.setValue('azimuth', state.azimuth);
        this.setValue('elevation', state.elevation);
        this.setValue('distance', state.distance);

        const radius = angleCameraRadius(state.distance);
        const theta = THREE.MathUtils.degToRad(state.azimuth);
        const phi = THREE.MathUtils.degToRad(state.elevation);
        const target = new THREE.Vector3(0, 0.85, 0);
        const pos = new THREE.Vector3(
            radius * Math.sin(theta) * Math.cos(phi),
            target.y + radius * Math.sin(phi),
            radius * Math.cos(theta) * Math.cos(phi)
        );

        this.cameraMarker.position.copy(pos);
        this.cameraMarker.lookAt(target);
        this.guideLine.geometry.setFromPoints([target, pos]);
        this.updateElevationArc(state);
        this.promptEl.textContent = this.cameraPrompt(state);
    }

    bindEvents() {
        this.container.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.isDragging = true;
            this.lastPointer = { x: event.clientX, y: event.clientY };
            this.container.setPointerCapture(event.pointerId);
        });

        this.container.addEventListener('pointermove', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!this.isDragging) return;
            const dx = event.clientX - this.lastPointer.x;
            const dy = event.clientY - this.lastPointer.y;
            this.lastPointer = { x: event.clientX, y: event.clientY };
            this.setValue('azimuth', (this.getValue('azimuth', 0) + dx * 0.6 + 360) % 360);
            this.setValue('elevation', Math.max(-30, Math.min(60, this.getValue('elevation', 0) - dy * 0.35)));
            this.updateScene();
        });

        this.container.addEventListener('pointerup', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.isDragging = false;
            this.container.releasePointerCapture(event.pointerId);
            this.updateScene();
        });

        this.container.addEventListener('pointercancel', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.isDragging = false;
        });

        this.container.addEventListener('wheel', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const current = this.getState().distance;
            const currentIndex = ANGLE_CAMERA_DISTANCE_OPTIONS.indexOf(current);
            const direction = event.deltaY > 0 ? 1 : -1;
            const nextIndex = Math.max(
                0,
                Math.min(ANGLE_CAMERA_DISTANCE_OPTIONS.length - 1, currentIndex + direction)
            );
            this.setValue('distance', ANGLE_CAMERA_DISTANCE_OPTIONS[nextIndex]);
            this.updateScene();
        }, { passive: false });
    }

    resize() {
        if (!this.renderer || !this.container) return;
        const nodeWidth = Number(this.node?.size?.[0]) || 430;
        const nodeHeight = Number(this.node?.size?.[1]) || 720;
        const width = Math.max(260, Math.floor(nodeWidth - 28));
        const height = Math.max(
            ANGLE_CAMERA_WIDGET_MIN_HEIGHT,
            Math.floor(nodeHeight - ANGLE_CAMERA_WIDGET_NODE_CHROME)
        );

        this.container.style.width = `${width}px`;
        this.container.style.minWidth = `${width}px`;
        this.container.style.maxWidth = `${width}px`;
        this.container.style.height = `${height}px`;
        this.container.style.minHeight = `${height}px`;
        this.container.style.maxHeight = 'none';
        this.container.style.marginLeft = 'auto';
        this.container.style.marginRight = 'auto';

        const host = this.container.parentElement;
        if (host) {
            host.style.width = `${width}px`;
            host.style.minWidth = `${width}px`;
            host.style.maxWidth = `${width}px`;
            host.style.height = `${height}px`;
            host.style.minHeight = `${height}px`;
            host.style.maxHeight = 'none';
            host.style.overflow = 'visible';
            host.style.boxSizing = 'border-box';
        }

        if (width === this.lastRenderSize.width && height === this.lastRenderSize.height) {
            return;
        }

        this.lastRenderSize = { width, height };
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        const target = new THREE.Vector3(0, 0.85, 0);
        const aspectBoost = Math.max(1, 1.15 / this.camera.aspect);
        this.camera.position.set(4.4 * aspectBoost, 3.2 * aspectBoost, 5.4 * aspectBoost);
        this.camera.lookAt(target);
        this.camera.updateProjectionMatrix();
    }

    start() {
        const render = () => {
            this.animationId = requestAnimationFrame(render);
            this.resize();
            this.updateScene();
            this.renderer.render(this.scene, this.camera);
        };
        render();
    }

    destroy() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        if (this.previewTimer) window.clearInterval(this.previewTimer);
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.forceContextLoss();
        }
    }
}

/**
 * Register the extension with ComfyUI
 */
app.registerExtension({
    name: "Comfy.CameraAngleSelector",
    
    async nodeCreated(node) {
        if (node.comfyClass === "QwenImageEdit2511AngleCamera") {
            const widget3D = new QwenAngleCameraWidget(node);
            const success = await widget3D.initialize();
            if (!success) return;

            const domWidget = node.addDOMWidget('qwen_angle_camera_view', 'customCanvas', widget3D.container, {
                getValue: () => JSON.stringify(widget3D.getState()),
                setValue: () => widget3D.updateScene(),
            });
            domWidget.widget3D = widget3D;
            domWidget.computeSize = () => [
                Math.max(260, Math.floor((node.size?.[0] || 430) - 28)),
                ANGLE_CAMERA_WIDGET_HEIGHT + 20
            ];

            if (!node.size || node.size[0] < 430 || node.size[1] < 720) {
                node.setSize([
                    Math.max(430, node.size?.[0] || 430),
                    Math.max(720, node.size?.[1] || 720)
                ]);
            }
            node.resizable = true;

            const originalOnResize = node.onResize;
            node.onResize = function(size) {
                if (originalOnResize) originalOnResize.call(this, size);
                requestAnimationFrame(() => {
                    widget3D.lastRenderSize = { width: 0, height: 0 };
                    widget3D.resize();
                    app.canvas?.setDirty?.(true, true);
                });
            };

            for (const name of ['azimuth', 'elevation', 'distance']) {
                const widget = node.widgets?.find(w => w.name === name);
                if (widget?.callback) {
                    const original = widget.callback;
                    widget.callback = function(value) {
                        original.call(this, value);
                        widget3D.updateScene();
                    };
                }
            }

            const originalOnRemoved = node.onRemoved;
            node.onRemoved = function() {
                widget3D.destroy();
                if (originalOnRemoved) originalOnRemoved.call(this);
            };
            return;
        }

        // Only handle CameraAngleSelector nodes
        if (node.comfyClass !== "CameraAngleSelector") {
            return;
        }
        
        console.log("CameraAngleSelector: Initializing 3D widget for node", node.id);
        
        // Create the 3D widget
        const widget3D = new CameraAngle3DWidget(node);
        
        // Initialize async
        const success = await widget3D.initialize();
        if (!success) {
            console.error("CameraAngleSelector: Failed to initialize 3D widget");
            return;
        }
        
        // Hide the original selected_indices widget
        const selectedIndicesWidget = node.widgets?.find(w => w.name === 'selected_indices');
        if (selectedIndicesWidget) {
            selectedIndicesWidget.type = 'hidden';
            // ComfyUI sometimes uses computeSize, set to minimal
            if (selectedIndicesWidget.computeSize) {
                selectedIndicesWidget.computeSize = () => [0, -4];
            }
        }
        
        // Add the DOM widget to the node
        const domWidget = node.addDOMWidget('camera_3d_view', 'customCanvas', widget3D.container, {
            getValue: () => {
                const w = node.widgets?.find(w => w.name === 'selected_indices');
                return w?.value || '[]';
            },
            setValue: (v) => {
                const w = node.widgets?.find(w => w.name === 'selected_indices');
                if (w) w.value = v;
                widget3D.loadFromWidget();
            }
        });
        
        // Store reference for cleanup
        domWidget.widget3D = widget3D;
        
        // Set minimum size for the node
        node.setSize([400, 650]);
        
        // Allow node to be resized
        node.resizable = true;
        
        // Handle node removal
        const originalOnRemoved = node.onRemoved;
        node.onRemoved = function() {
            widget3D.destroy();
            if (originalOnRemoved) {
                originalOnRemoved.call(this);
            }
        };
    }
});

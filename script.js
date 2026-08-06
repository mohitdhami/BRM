/**
 * ================================================================
 * script.js - Backup Reserve Manager Application Logic
 * ================================================================
 * 
 * This file contains all the application logic including:
 * - Firebase initialization and Google Sign-In
 * - Per-user data isolation (each user has their own data)
 * - CRUD operations for reserve items
 * - Cloud synchronization with Firestore
 * - UPI QR code generation
 * - Action/task management
 * - Export/Import functionality
 * - UI rendering and event handling
 * ================================================================
 */

// ============================================================
// FIREBASE CONFIGURATION
// ============================================================

/** Firebase configuration object - public keys for client-side use */
const firebaseConfig = {
    apiKey: "AIzaSyC-HgNBgtp6eF7WRUL-2s_8t4w1lRvn78M",
    authDomain: "reserve-manager-ea55b.firebaseapp.com",
    projectId: "reserve-manager-ea55b",
    storageBucket: "reserve-manager-ea55b.firebasestorage.app",
    messagingSenderId: "173279165908",
    appId: "1:173279165908:web:b1166f2eddb15835b92a41",
    measurementId: "G-Q3Y01CXT5B"
};

// ============================================================
// FIREBASE INITIALIZATION
// ============================================================

/** Firebase app instance */
let firebaseApp = null;
/** Firestore database instance */
let db = null;
/** Firebase authentication instance */
let auth = null;

try {
    firebaseApp = firebase.initializeApp(firebaseConfig);
    db = firebase.firestore(firebaseApp);
    auth = firebase.auth(firebaseApp);
    console.log('✅ Firebase initialized successfully');
} catch (error) {
    console.warn('⚠️ Firebase initialization failed:', error);
}

// ============================================================
// APPLICATION STATE
// ============================================================

/**
 * Application state object containing all runtime data
 */
const state = {
    /** Array of reserve items (excluding the system config item) */
    reserves: [],

    /** Next available ID for new reserve items */
    nextId: 1,

    /** List of saved UPI IDs for QR generation */
    upiIds: [],

    /** Currently selected/default UPI ID */
    upiDefault: '',

    /** List of action/task items with completion status */
    actions: [],

    /** ID of the reserve item currently viewed in the detail modal */
    selectedId: null,

    /** ID of the reserve item currently being edited (null for add mode) */
    editId: null,

    /** Timestamp of the last successful server sync */
    serverTimestamp: null,

    /** Flag indicating if a sync operation is in progress */
    isSyncing: false,

    /** Flag indicating if data has been loaded from server */
    isLoaded: false,

    /** Currently authenticated user object from Firebase */
    user: null,

    /** Current search term for filtering reserves */
    searchTerm: '',

    /** The document path for the current user's data */
    getUserDocPath: function() {
        if (!this.user) return null;
        // Use the user's UID to create a unique document path
        return `users/${this.user.uid}/data/main`;
    }
};

// ============================================================
// DOM REFERENCE SHORTCUTS
// ============================================================

/**
 * Helper function to get DOM element by ID
 * @param {string} id - Element ID
 * @returns {HTMLElement|null} DOM element or null if not found
 */
const $ = (id) => document.getElementById(id);

/**
 * DOM element references for frequently accessed elements
 */
const dom = {
    // Auth overlay
    authOverlay: $('authOverlay'),
    authError: $('authError'),
    googleSignInBtn: $('googleSignInBtn'),
    userEmailDisplay: $('userEmailDisplay'),

    // Main app container
    app: $('app'),

    // Table and stats
    tableBody: $('tableBody'),
    itemCount: $('itemCount'),
    totalOnline: $('totalOnline'),
    totalCash: $('totalCash'),
    totalReserves: $('totalReserves'),

    // Status and feedback
    syncStatus: $('syncStatus'),
    toast: $('toast'),

    // Drop overlay
    dropOverlay: $('dropOverlay'),

    // Actions
    actionsList: $('actionsList'),
    actionsBadge: $('actionsBadge'),

    // Search and filters
    searchInput: $('searchInput'),
    categoryInput: $('categoryInput'),

    // Buttons
    addBtn: $('addBtn'),
    exportBtn: $('exportBtn'),
    importBtn: $('importBtn'),
    upiBtn: $('upiBtn'),
    actionsBtn: $('actionsBtn'),
    signOutBtn: $('signOutBtn'),
    fileInput: $('fileInput')
};

/** Timer reference for toast auto-dismiss */
let toastTimer = null;

// ============================================================
// TOAST NOTIFICATION SYSTEM
// ============================================================

/**
 * Display a toast notification
 * @param {string} message - Message to display
 * @param {boolean} isError - Whether this is an error message
 */
function showToast(message, isError = false) {
    if (!dom.toast) return;

    dom.toast.textContent = message;
    dom.toast.className = 'toast' + (isError ? ' error' : '');
    dom.toast.classList.add('show');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        dom.toast.classList.remove('show');
    }, 3000);
}

// ============================================================
// SYNC STATUS INDICATOR
// ============================================================

/**
 * Update the sync status indicator
 * @param {string} icon - FontAwesome icon name (without 'fa-' prefix)
 * @param {string} label - Status label text
 */
function setSyncStatus(icon, label) {
    if (!dom.syncStatus) return;

    const icons = {
        synced: 'fa-check-circle',
        syncing: 'fa-spinner fa-spin',
        error: 'fa-exclamation-circle',
        offline: 'fa-circle',
        warning: 'fa-exclamation-triangle'
    };

    dom.syncStatus.innerHTML = `<i class="fas ${icons[icon] || 'fa-circle'}"></i> ${label}`;
    dom.syncStatus.className = 'sync-status ' + (icon || 'offline');
}

// ============================================================
// TABLE RENDERER
// ============================================================

/**
 * Render the main reserve table with current data
 * Groups items by category and applies search filter
 */
function renderTable() {
    if (!dom.tableBody) return;

    // Filter out the system config item
    const items = state.reserves.filter(r => r.item !== '__UPI_CONFIG__');

    // Apply search filter
    const search = state.searchTerm.toLowerCase().trim();
    let filtered = items;
    if (search) {
        filtered = items.filter(r =>
            r.item.toLowerCase().includes(search) ||
            (r.category && r.category.toLowerCase().includes(search)) ||
            (r.desc && r.desc.toLowerCase().includes(search))
        );
    }

    // Group items by category
    const groups = new Map();
    filtered.forEach(r => {
        const cat = r.category || 'General';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(r);
    });

    // Build HTML
    let html = '';
    let totalOnline = 0;
    let totalCash = 0;

    if (filtered.length === 0) {
        html = `<tr class="empty-row"><td colspan="7">${
            search ? 'No items match your search.' : 'No reserves. Add your first reserve!'
        }</td></tr>`;
    } else {
        // Iterate over categories
        for (const [category, categoryItems] of groups) {
            html += `<tr class="category-header"><td colspan="7"><i class="fas fa-folder-open"></i> ${category} (${categoryItems.length})</td></tr>`;

            let seq = 0;
            for (const r of categoryItems) {
                seq++;
                const available = (r.online || 0) + (r.cash || 0);
                const covered = r.required ? (available / r.required) * 100 : 0;
                totalOnline += r.online || 0;
                totalCash += r.cash || 0;

                const desc = r.desc || '';
                const truncated = desc.length > 100 ? desc.substring(0, 100) + '…' : desc;
                const hasMore = desc.length > 100;

                html += `<tr>
                    <td style="text-align:center;font-weight:600;color:#1a4a62;">${seq}</td>
                    <td class="col-item">
                        <span class="badge">${r.id}</span>
                        <span class="item-link" data-id="${r.id}">${r.item}</span>
                        ${auth?.currentUser ? '<i class="fas fa-cloud cloud-badge" style="font-size:0.6rem;margin-left:4px;color:#28a745;" title="Auto-synced"></i>' : ''}
                    </td>
                    <td class="col-online">${r.online}</td>
                    <td class="col-cash">${r.cash}</td>
                    <td class="col-required">${r.required}</td>
                    <td class="col-covered">${covered.toFixed(2)}%</td>
                    <td class="col-desc">
                        <span>${truncated}</span>
                        ${hasMore ? `<span class="expand-hint" data-id="${r.id}">…more</span>` : ''}
                    </td>
                </tr>`;
            }
        }
    }

    // Update DOM
    dom.tableBody.innerHTML = html;
    dom.itemCount.textContent = filtered.length;
    dom.totalOnline.textContent = totalOnline.toLocaleString('en-IN');
    dom.totalCash.textContent = totalCash.toLocaleString('en-IN');
    dom.totalReserves.textContent = (totalOnline + totalCash).toLocaleString('en-IN');

    // Attach click events for item links and expand hints
    document.querySelectorAll('.item-link, .expand-hint').forEach(el => {
        el.onclick = function(e) {
            e.stopPropagation();
            const id = parseInt(this.dataset.id);
            if (!isNaN(id)) openDetail(id);
        };
    });
}

// ============================================================
// ACTIONS LIST RENDERER
// ============================================================

/**
 * Render the actions/tasks list in the actions modal
 * Updates the badge with pending action count
 */
function renderActions() {
    const list = dom.actionsList;
    const badge = dom.actionsBadge;
    if (!list) return;

    // Update badge
    const pending = state.actions.filter(a => !a.completed).length;
    if (badge) {
        badge.textContent = pending;
        badge.style.display = pending > 0 ? 'inline-flex' : 'none';
    }

    // Render actions
    if (state.actions.length === 0) {
        list.innerHTML = `<div style="padding:1rem;text-align:center;color:#6c757d;">
            <i class="fas fa-check-circle" style="font-size:1.5rem;display:block;margin-bottom:0.5rem;"></i>
            No pending actions. Add one below!
        </div>`;
        return;
    }

    let html = '';
    state.actions.forEach((action, index) => {
        html += `<div class="action-item ${action.completed ? 'completed' : ''}">
            <span class="action-content">${index + 1}. ${action.text}</span>
            <div class="action-buttons">
                <button onclick="window.toggleAction(${index})" class="action-btn ${action.completed ? 'action-btn-completed' : 'action-btn-done'}">✓</button>
                <button onclick="window.deleteAction(${index})" class="action-btn action-btn-delete"><i class="fas fa-times" style="font-size:0.6rem;"></i></button>
            </div>
        </div>`;
    });
    list.innerHTML = html;
}

// ============================================================
// UPI LIST RENDERER
// ============================================================

/**
 * Render the UPI IDs list in the UPI modal
 * Updates the selector dropdown and tag list
 */
function renderUpiList() {
    const sel = document.getElementById('upiSelector');
    const list = document.getElementById('savedUpiList');
    if (!sel || !list) return;

    // Populate dropdown
    sel.innerHTML = '';
    if (state.upiIds.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '-- No UPI IDs --';
        sel.appendChild(opt);
    } else {
        state.upiIds.forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = id;
            sel.appendChild(opt);
        });
        sel.value = state.upiDefault || state.upiIds[0] || '';
    }

    // Populate tag list
    list.innerHTML = '';
    state.upiIds.forEach(id => {
        const tag = document.createElement('span');
        tag.className = 'upi-tag';
        tag.innerHTML = `${id} <span class="remove-tag" data-upi="${id}"><i class="fas fa-times-circle"></i></span>`;

        // Remove handler
        tag.querySelector('.remove-tag').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Remove UPI ID "${id}"?`)) {
                state.upiIds = state.upiIds.filter(u => u !== id);
                if (state.upiDefault === id) state.upiDefault = state.upiIds[0] || '';
                renderUpiList();
                generateQR();
                triggerSync();
            }
        });

        // Select handler
        tag.addEventListener('click', () => {
            state.upiDefault = id;
            sel.value = id;
            generateQR();
        });

        list.appendChild(tag);
    });

    if (state.upiIds.length === 0) {
        list.innerHTML = '<span style="color:#6c757d;font-size:0.8rem;padding:0.3rem;">No UPI IDs. Add one below.</span>';
    }

    // Update display
    const selected = sel.value || state.upiIds[0] || '';
    state.upiDefault = selected;
    document.getElementById('upiIdDisplay').textContent = selected || '-';
}

// ============================================================
// QR CODE GENERATOR
// ============================================================

/** QRCode instance reference for cleanup */
let qrInstance = null;

/**
 * Generate a UPI QR code based on the selected UPI ID and amount
 * Uses the QRCode.js library
 */
function generateQR() {
    const upi = document.getElementById('upiSelector')?.value || state.upiIds[0] || '';
    const container = document.getElementById('qrcode');
    if (!container) return;

    if (!upi) {
        container.innerHTML = '<p style="color:#6f8fa3;padding:0.5rem;">No UPI ID available</p>';
        document.getElementById('upiIdDisplay').textContent = '-';
        return;
    }

    state.upiDefault = upi;
    const payee = 'Reserve Manager';
    const note = 'Reserve contribution';
    const amt = parseFloat(document.getElementById('upiAmountInput')?.value);

    let amtParam = '';
    let amtDisplay = 'User decides';
    if (!isNaN(amt) && amt > 0) {
        amtParam = '&am=' + amt.toFixed(2);
        amtDisplay = '₹' + amt.toFixed(2);
    }

    // Update details display
    document.getElementById('upiIdDisplay').textContent = upi;
    document.getElementById('upiAmountDisplay').textContent = amtDisplay;
    document.getElementById('upiPayeeDisplay').textContent = payee;
    document.getElementById('upiNoteDisplay').textContent = note;

    // Build UPI URI
    const uri = `upi://pay?pa=${upi}&pn=${encodeURIComponent(payee)}${amtParam}&cu=INR&tn=${encodeURIComponent(note)}`;

    // Generate QR code
    container.innerHTML = '';
    try {
        qrInstance = new QRCode(container, {
            text: uri,
            width: 220,
            height: 220,
            colorDark: '#0b2b3d',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
    } catch (error) {
        console.error('QR generation error:', error);
        container.innerHTML = '<p style="color:#dc3545;">Error generating QR code</p>';
    }
}

// ============================================================
// DETAIL CARD MODAL
// ============================================================

/**
 * Open the detail card modal for a specific reserve item
 * @param {number} id - ID of the reserve item to display
 */
function openDetail(id) {
    const item = state.reserves.find(r => r.id === id);
    if (!item) {
        showToast('Item not found', true);
        return;
    }

    state.selectedId = id;
    document.getElementById('cardTitle').textContent = item.item;
    document.getElementById('cardCategory').textContent = item.category || 'General';

    const available = (item.online || 0) + (item.cash || 0);
    const covered = item.required ? (available / item.required) * 100 : 0;

    const body = document.getElementById('cardBody');
    body.innerHTML = `
        <div class="card-grid">
            <div class="card-field"><span class="card-label">ID</span><span class="card-value">#${item.id}</span></div>
            <div class="card-field"><span class="card-label">Category</span><span class="card-value">${item.category || 'General'}</span></div>
            <div class="card-field"><span class="card-label">Online Balance</span><span class="card-value mono">₹${item.online}</span></div>
            <div class="card-field"><span class="card-label">Cash Balance</span><span class="card-value mono">₹${item.cash}</span></div>
            <div class="card-field"><span class="card-label">Total Available</span><span class="card-value mono highlight">₹${available}</span></div>
            <div class="card-field"><span class="card-label">Required Deposits</span><span class="card-value mono">₹${item.required}</span></div>
            <div class="card-field card-full">
                <span class="card-label">Covered %</span>
                <span class="card-value mono" style="color:${covered >= 100 ? '#28a745' : covered >= 50 ? '#ffc107' : '#dc3545'};font-size:1.4rem;font-weight:700;">
                    ${covered.toFixed(2)}%
                </span>
            </div>
            <div class="card-field card-full">
                <span class="card-label">Description</span>
                <div class="card-description">${item.desc || '<em>No description</em>'}</div>
            </div>
        </div>
    `;

    document.getElementById('cardOverlay').classList.add('active');
}

/**
 * Close the detail card modal
 */
function closeDetail() {
    document.getElementById('cardOverlay').classList.remove('active');
    state.selectedId = null;
}

// ============================================================
// FORM MODAL (ADD / EDIT)
// ============================================================

/**
 * Open the add/edit form modal
 * @param {Object|null} editItem - Item to edit, or null for add mode
 */
function openForm(editItem = null) {
    state.editId = editItem ? editItem.id : null;

    const title = document.getElementById('formTitle');
    title.innerHTML = state.editId ? '<i class="fas fa-edit"></i> Edit Reserve' : '<i class="fas fa-plus-circle"></i> Add Reserve';

    const name = document.getElementById('itemName');
    const cat = document.getElementById('categoryInput');
    const online = document.getElementById('onlineAmount');
    const cash = document.getElementById('cashAmount');
    const required = document.getElementById('requiredAmount');
    const desc = document.getElementById('descText');

    if (editItem) {
        name.value = editItem.item;
        cat.value = editItem.category || 'General';
        online.value = editItem.online || 0;
        cash.value = editItem.cash || 0;
        required.value = editItem.required || 0;
        desc.value = editItem.desc || '';
    } else {
        name.value = '';
        cat.value = '';
        online.value = 0;
        cash.value = 0;
        required.value = 0;
        desc.value = '';
    }

    updateCoveredDisplay();
    document.getElementById('formOverlay').classList.add('active');
}

/**
 * Close the add/edit form modal
 */
function closeForm() {
    document.getElementById('formOverlay').classList.remove('active');
    state.editId = null;
}

/**
 * Update the covered percentage display based on form inputs
 */
function updateCoveredDisplay() {
    const online = parseFloat(document.getElementById('onlineAmount')?.value) || 0;
    const cash = parseFloat(document.getElementById('cashAmount')?.value) || 0;
    const req = parseFloat(document.getElementById('requiredAmount')?.value) || 0;
    const disp = document.getElementById('coveredDisplay');

    if (disp) {
        disp.value = req ? ((online + cash) / req * 100).toFixed(4) + '%' : '0%';
    }
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Save a reserve item (add new or update existing)
 * @param {Event} e - Form submit event
 */
function saveReserve(e) {
    e.preventDefault();

    const name = document.getElementById('itemName').value.trim();
    if (!name) {
        showToast('Backup Item is required.', true);
        return;
    }

    const category = document.getElementById('categoryInput').value.trim() || 'General';
    const data = {
        item: name,
        category: category,
        online: parseFloat(document.getElementById('onlineAmount').value) || 0,
        cash: parseFloat(document.getElementById('cashAmount').value) || 0,
        required: parseFloat(document.getElementById('requiredAmount').value) || 0,
        desc: document.getElementById('descText').value.trim() || ''
    };

    if (state.editId !== null) {
        // Edit mode - update existing item
        const idx = state.reserves.findIndex(r => r.id === state.editId);
        if (idx !== -1) {
            state.reserves[idx] = { ...state.reserves[idx], ...data };
        }
    } else {
        // Add mode - create new item
        data.id = state.nextId++;
        state.reserves.push(data);
    }

    closeForm();
    renderTable();
    triggerSync();
    showToast('✅ Item saved successfully');
}

/**
 * Delete the currently selected reserve item
 */
function deleteReserve() {
    if (state.selectedId === null) return;

    const item = state.reserves.find(r => r.id === state.selectedId);
    if (!item) return;

    if (!confirm(`Delete "${item.item}"?`)) return;

    state.reserves = state.reserves.filter(r => r.id !== state.selectedId);
    closeDetail();
    renderTable();
    triggerSync();
    showToast('🗑️ Item deleted');
}

// ============================================================
// ACTION (TASK) OPERATIONS
// ============================================================

/**
 * Toggle the completion status of an action
 * @param {number} index - Index of the action in the actions array
 */
window.toggleAction = function(index) {
    if (index >= 0 && index < state.actions.length) {
        state.actions[index].completed = !state.actions[index].completed;
        renderActions();
        triggerSync();
        showToast(state.actions[index].completed ? '✅ Action completed!' : '🔄 Action reopened');
    }
};

/**
 * Delete an action from the list
 * @param {number} index - Index of the action in the actions array
 */
window.deleteAction = function(index) {
    if (index >= 0 && index < state.actions.length) {
        if (confirm(`Delete action "${state.actions[index].text}"?`)) {
            state.actions.splice(index, 1);
            renderActions();
            triggerSync();
            showToast('🗑️ Action removed');
        }
    }
};

/**
 * Add a new action from the input field
 */
function addAction() {
    const input = document.getElementById('newActionInput');
    const text = input.value.trim();
    if (!text) {
        showToast('⚠️ Please enter an action', true);
        return;
    }

    state.actions.push({
        text: text,
        completed: false,
        createdAt: new Date().toISOString()
    });

    input.value = '';
    renderActions();
    triggerSync();
    showToast('✅ Action added');
}

// ============================================================
// UPI OPERATIONS
// ============================================================

/**
 * Add a new UPI ID from the input field
 */
function addUpiId() {
    const input = document.getElementById('newUpiInput');
    const id = input.value.trim();

    if (!id) {
        showToast('Please enter a UPI ID.', true);
        return;
    }

    if (state.upiIds.includes(id)) {
        showToast('UPI ID already exists.', true);
        return;
    }

    state.upiIds.push(id);
    input.value = '';
    renderUpiList();
    generateQR();
    triggerSync();
    showToast('✅ UPI ID added');
}

/**
 * Remove the selected UPI ID
 */
function removeUpiId() {
    const sel = document.getElementById('upiSelector');
    const selected = sel.value;

    if (!selected) {
        showToast('⚠️ No UPI ID selected', true);
        return;
    }

    if (confirm(`Remove UPI ID "${selected}"?`)) {
        state.upiIds = state.upiIds.filter(u => u !== selected);
        if (state.upiDefault === selected) state.upiDefault = state.upiIds[0] || '';
        renderUpiList();
        generateQR();
        triggerSync();
        showToast('🗑️ UPI ID removed');
    }
}

// ============================================================
// DATA EXPORT / IMPORT
// ============================================================

/**
 * Export all data as a JSON file download
 */
function exportData() {
    if (state.reserves.length === 0) {
        showToast('No data to export.', true);
        return;
    }

    // Include system configuration
    const config = {
        id: Date.now(),
        item: '__UPI_CONFIG__',
        category: 'System',
        online: 0,
        cash: 0,
        required: 0,
        desc: JSON.stringify({
            upiIds: state.upiIds,
            actions: state.actions
        })
    };

    const allData = [...state.reserves, config];
    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_reserves_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('📥 JSON exported successfully');
}

/**
 * Import data from a JSON file
 * @param {File} file - The JSON file to import
 */
function importData(file) {
    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const parsed = JSON.parse(e.target.result);

            if (!Array.isArray(parsed)) {
                alert('Invalid JSON: Root must be an array.');
                return;
            }

            if (state.reserves.length > 0 && !confirm('⚠️ This will REPLACE all current data. Continue?')) {
                return;
            }

            // Extract configuration
            const config = parsed.find(r => r.item === '__UPI_CONFIG__');
            if (config && config.desc) {
                try {
                    const ud = JSON.parse(config.desc);
                    if (ud.upiIds && Array.isArray(ud.upiIds)) {
                        state.upiIds = ud.upiIds;
                        state.upiDefault = state.upiIds[0] || '';
                        renderUpiList();
                    }
                    if (ud.actions && Array.isArray(ud.actions)) {
                        state.actions = ud.actions;
                        renderActions();
                    }
                } catch (e) {
                    console.warn('Failed to parse config:', e);
                }
            }

            // Load reserves
            state.reserves = parsed.filter(r => r.item !== '__UPI_CONFIG__');
            state.reserves.forEach(r => {
                if (!r.category) r.category = 'General';
            });

            // Update next ID
            const maxId = state.reserves.reduce((max, r) => Math.max(max, r.id || 0), 0);
            state.nextId = maxId + 1;

            renderTable();
            triggerSync();
            showToast(`📥 Imported ${state.reserves.length} items`);

        } catch (error) {
            alert('❌ Failed to parse JSON: ' + error.message);
        }
    };

    reader.readAsText(file);
}

// ============================================================
// CLOUD SYNCHRONIZATION - PER USER DATA
// ============================================================

/**
 * Get the Firestore document reference for the current user's data
 * Each user gets their own document path: users/{uid}/data/main
 * @returns {firebase.firestore.DocumentReference|null}
 */
function getUserDocRef() {
    if (!auth?.currentUser) {
        console.log('⏳ No user signed in');
        return null;
    }
    // Use sub-collection per user for better security and isolation
    return db.collection('users').doc(auth.currentUser.uid).collection('data').doc('main');
}

/**
 * Trigger a sync with the Firestore server for the current user
 * Pushes local data and checks for server updates
 */
async function triggerSync() {
    // Guard conditions
    if (!auth?.currentUser) {
        console.log('⏳ Not signed in, skipping sync');
        return;
    }
    if (state.isSyncing) {
        console.log('⏳ Sync already in progress');
        return;
    }
    if (!state.isLoaded) {
        console.log('⏳ Data not loaded, skipping sync');
        return;
    }

    state.isSyncing = true;
    setSyncStatus('syncing', 'Syncing...');

    try {
        const docRef = getUserDocRef();
        if (!docRef) {
            state.isSyncing = false;
            return;
        }

        // Check for server updates
        const snap = await docRef.get({ source: 'server' });
        if (snap.exists) {
            const data = snap.data();
            const serverTs = data.updatedAt || data.lastSync;

            if (serverTs && state.serverTimestamp) {
                const sDate = new Date(serverTs);
                const lDate = new Date(state.serverTimestamp);

                if (sDate > lDate) {
                    // Server has newer data - reload
                    await loadFromServer(true);
                    state.isSyncing = false;
                    return;
                }
            }
        }

        // Push local data to server
        const config = {
            id: Date.now(),
            item: '__UPI_CONFIG__',
            category: 'System',
            online: 0,
            cash: 0,
            required: 0,
            desc: JSON.stringify({
                upiIds: state.upiIds,
                actions: state.actions
            })
        };

        const allData = [...state.reserves, config];

        await docRef.set({
            reserves: allData,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastSync: new Date().toISOString(),
            userId: auth.currentUser.uid,
            userEmail: auth.currentUser.email
        });

        state.serverTimestamp = new Date().toISOString();
        setSyncStatus('synced', 'Synced');

    } catch (error) {
        console.error('Sync error:', error);
        setSyncStatus('error', 'Sync Failed');
        showToast('❌ Sync failed: ' + error.message, true);
    }

    state.isSyncing = false;
}

/**
 * Load data from the Firestore server for the current user
 * @param {boolean} silent - Whether to suppress user-facing notifications
 */
async function loadFromServer(silent = false) {
    if (!db) {
        setSyncStatus('error', 'Firebase not available');
        showToast('❌ Firebase not initialized', true);
        state.isLoaded = false;
        renderTable();
        return;
    }

    if (!auth?.currentUser) {
        setSyncStatus('error', 'Not signed in');
        showToast('❌ Please sign in to load data', true);
        state.isLoaded = false;
        renderTable();
        return;
    }

    try {
        if (!silent) showToast('🔄 Loading your data from server...');
        setSyncStatus('syncing', 'Loading...');

        const docRef = getUserDocRef();
        if (!docRef) {
            state.isLoaded = false;
            return;
        }

        const snap = await docRef.get({ source: 'server' });

        if (snap.exists) {
            const data = snap.data();
            state.serverTimestamp = data.updatedAt || data.lastSync || new Date().toISOString();
            const reserves = data.reserves || [];

            // Extract system configuration
            const config = reserves.find(r => r.item === '__UPI_CONFIG__');
            if (config && config.desc) {
                try {
                    const ud = JSON.parse(config.desc);
                    if (ud.upiIds && Array.isArray(ud.upiIds)) {
                        state.upiIds = ud.upiIds;
                        state.upiDefault = state.upiIds[0] || '';
                        renderUpiList();
                    }
                    if (ud.actions && Array.isArray(ud.actions)) {
                        state.actions = ud.actions;
                        renderActions();
                    }
                } catch (e) {
                    console.warn('Failed to parse config:', e);
                }
            }

            // Load reserves
            state.reserves = reserves.filter(r => r.item !== '__UPI_CONFIG__');
            state.reserves.forEach(r => {
                if (!r.category) r.category = 'General';
            });

            const maxId = state.reserves.reduce((max, r) => Math.max(max, r.id || 0), 0);
            state.nextId = maxId + 1;
            state.isLoaded = true;

            renderTable();
            setSyncStatus('synced', `${state.reserves.length} items loaded (${auth.currentUser.email})`);
            if (!silent) showToast(`✅ Loaded ${state.reserves.length} items from your account`);

        } else {
            // No data on server - start fresh for this user
            state.reserves = [];
            state.nextId = 1;
            state.isLoaded = true;

            renderTable();
            setSyncStatus('synced', 'Ready (empty)');
            if (!silent) showToast('📭 No data found for your account');
        }

    } catch (error) {
        console.error('Load error:', error);
        state.isLoaded = false;
        setSyncStatus('error', 'Server unavailable');
        if (!silent) showToast('❌ Cannot connect to server', true);
        renderTable();
    }
}

// ============================================================
// GOOGLE SIGN-IN / SIGN-OUT
// ============================================================

/**
 * Sign in with Google using Firebase Auth popup
 */
async function signInWithGoogle() {
    if (!auth) {
        dom.authError.textContent = 'Firebase Auth not available';
        return;
    }

    dom.authError.textContent = '';

    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);

        state.user = result.user;
        dom.authOverlay.classList.add('hidden');
        dom.app.style.display = 'flex';

        // Update user display
        const userDisplay = document.getElementById('userDisplay');
        if (userDisplay) {
            userDisplay.textContent = `👤 ${result.user.displayName || result.user.email}`;
        }

        // Load data after sign-in
        await loadFromServer(false);

        // Set up periodic sync
        setupAutoSync();

        showToast('✅ Signed in as ' + (result.user.displayName || result.user.email));

    } catch (error) {
        dom.authError.textContent = 'Sign-in failed: ' + error.message;
        showToast('❌ Sign-in failed', true);
    }
}

/**
 * Sign out the current user
 */
function signOut() {
    if (!auth) return;

    auth.signOut()
        .then(() => {
            state.user = null;
            state.isLoaded = false;
            state.reserves = [];
            state.upiIds = [];
            state.actions = [];
            dom.app.style.display = 'none';
            dom.authOverlay.classList.remove('hidden');
            showToast('Signed out');
            renderTable();
        })
        .catch(error => {
            showToast('Sign out error', true);
        });
}

/**
 * Set up automatic synchronization
 * - Interval-based sync every 30 seconds
 * - Sync on page visibility change
 * - Sync before page unload
 */
function setupAutoSync() {
    // Periodic sync
    setInterval(() => {
        if (auth?.currentUser && state.isLoaded && !state.isSyncing) {
            triggerSync();
        }
    }, 30000);

    // Visibility change sync
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && auth?.currentUser && state.isLoaded && !state.isSyncing) {
            triggerSync();
        }
    });

    // Before unload sync
    window.addEventListener('beforeunload', () => {
        if (auth?.currentUser && state.isLoaded && !state.isSyncing) {
            triggerSync();
        }
    });
}

// ============================================================
// FIREBASE SECURITY RULES (IMPORTANT!)
// ============================================================
/**
 * You MUST set up Firestore Security Rules to ensure data isolation:
 * 
 * rules_version = '2';
 * service cloud.firestore {
 *   match /databases/{database}/documents {
 *     // Users can only access their own data
 *     match /users/{userId}/data/{docId} {
 *       allow read, write: if request.auth != null && request.auth.uid == userId;
 *     }
 *   }
 * }
 */

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * Initialize the application - set up all event listeners and UI
 */
function initApp() {
    // ---------- AUTH ----------
    dom.googleSignInBtn.addEventListener('click', signInWithGoogle);
    dom.signOutBtn.addEventListener('click', signOut);

    // ---------- SEARCH ----------
    dom.searchInput.addEventListener('input', function() {
        state.searchTerm = this.value;
        renderTable();
    });

    // ---------- ADD RESERVE ----------
    dom.addBtn.addEventListener('click', () => openForm(null));

    // ---------- FORM ----------
    document.getElementById('formCloseBtn').addEventListener('click', closeForm);
    document.getElementById('formOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeForm();
    });
    document.getElementById('reserveForm').addEventListener('submit', saveReserve);

    // Covered % auto-update
    document.getElementById('onlineAmount').addEventListener('input', updateCoveredDisplay);
    document.getElementById('cashAmount').addEventListener('input', updateCoveredDisplay);
    document.getElementById('requiredAmount').addEventListener('input', updateCoveredDisplay);

    // ---------- DETAIL CARD ----------
    document.getElementById('cardCloseBtn').addEventListener('click', closeDetail);
    document.getElementById('cardCloseActionBtn').addEventListener('click', closeDetail);
    document.getElementById('cardOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeDetail();
    });

    document.getElementById('cardEditBtn').addEventListener('click', () => {
        if (state.selectedId === null) return;
        const item = state.reserves.find(r => r.id === state.selectedId);
        if (item) {
            closeDetail();
            openForm(item);
        }
    });

    document.getElementById('cardDeleteBtn').addEventListener('click', deleteReserve);

    // ---------- ACTIONS ----------
    dom.actionsBtn.addEventListener('click', () => {
        renderActions();
        document.getElementById('actionsOverlay').classList.add('active');
    });

    document.getElementById('actionsCloseBtn').addEventListener('click', () => {
        document.getElementById('actionsOverlay').classList.remove('active');
    });

    document.getElementById('actionsOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            document.getElementById('actionsCloseBtn').click();
        }
    });

    document.getElementById('addActionBtn').addEventListener('click', addAction);
    document.getElementById('newActionInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addAction();
    });

    // ---------- UPI ----------
    dom.upiBtn.addEventListener('click', () => {
        renderUpiList();
        if (state.upiIds.length > 0) {
            document.getElementById('upiSelector').value = state.upiDefault || state.upiIds[0];
            generateQR();
        }
        document.getElementById('upiOverlay').classList.add('active');
    });

    document.getElementById('upiCloseBtn').addEventListener('click', () => {
        document.getElementById('upiOverlay').classList.remove('active');
        if (qrInstance) {
            qrInstance.clear();
            qrInstance = null;
        }
    });

    document.getElementById('upiOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            document.getElementById('upiCloseBtn').click();
        }
    });

    document.getElementById('addUpiBtn').addEventListener('click', addUpiId);
    document.getElementById('removeUpiBtn').addEventListener('click', removeUpiId);
    document.getElementById('newUpiInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addUpiId();
    });
    document.getElementById('refreshUpiBtn').addEventListener('click', () => {
        renderUpiList();
        generateQR();
    });
    document.getElementById('upiSelector').addEventListener('change', generateQR);
    document.getElementById('upiAmountInput').addEventListener('input', generateQR);

    // ---------- EXPORT / IMPORT ----------
    dom.exportBtn.addEventListener('click', exportData);

    dom.importBtn.addEventListener('click', () => {
        if (state.reserves.length > 0 && !confirm('⚠️ This will REPLACE all current data. Continue?')) {
            return;
        }
        dom.fileInput.click();
    });

    dom.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            importData(e.target.files[0]);
            e.target.value = '';
        }
    });

    // ---------- DRAG & DROP ----------
    let dragCounter = 0;

    dom.app.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (dragCounter === 1) dom.dropOverlay.classList.add('active');
    }, { passive: false });

    dom.app.addEventListener('dragover', (e) => {
        e.preventDefault();
    }, { passive: false });

    dom.app.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) dom.dropOverlay.classList.remove('active');
    }, { passive: false });

    dom.app.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dom.dropOverlay.classList.remove('active');

        const file = e.dataTransfer.files[0];
        if (file && (file.type === 'application/json' || file.name.endsWith('.json'))) {
            if (state.reserves.length > 0 && !confirm('⚠️ This will REPLACE all current data. Continue?')) {
                return;
            }
            importData(file);
        } else {
            alert('Please drop a .json file.');
        }
    }, { passive: false });

    // ---------- KEYBOARD SHORTCUTS ----------
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById('cardOverlay').classList.contains('active')) closeDetail();
            if (document.getElementById('formOverlay').classList.contains('active')) closeForm();
            if (document.getElementById('upiOverlay').classList.contains('active')) {
                document.getElementById('upiCloseBtn').click();
            }
            if (document.getElementById('actionsOverlay').classList.contains('active')) {
                document.getElementById('actionsCloseBtn').click();
            }
        }
    });

    // ---------- AUTO-LOAD IF ALREADY SIGNED IN ----------
    if (auth?.currentUser) {
        state.user = auth.currentUser;
        dom.authOverlay.classList.add('hidden');
        dom.app.style.display = 'flex';
        loadFromServer(false).then(() => {
            setupAutoSync();
        });
    }

    console.log('✅ App initialized successfully');
}

// ============================================================
// APPLICATION START
// ============================================================

/**
 * Start the application when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
    dom.app.style.display = 'none';
    initApp();
});

/**
 * ================================================================
 * script.js - Backup Reserve Manager Application Logic
 * ================================================================
 */

// ============================================================
// FIREBASE CONFIGURATION
// ============================================================

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

let firebaseApp = null;
let db = null;
let auth = null;

try {
    firebaseApp = firebase.initializeApp(firebaseConfig);
    db = firebase.firestore(firebaseApp);
    auth = firebase.auth(firebaseApp);
    
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .then(() => console.log('✅ Auth persistence set to LOCAL'))
        .catch((error) => console.warn('⚠️ Auth persistence error:', error));
    
    console.log('✅ Firebase initialized successfully');
} catch (error) {
    console.warn('⚠️ Firebase initialization failed:', error);
}

// ============================================================
// APPLICATION STATE
// ============================================================

const state = {
    reserves: [],
    nextId: 1,
    upiIds: [],
    upiDefault: '',
    actions: [],
    selectedId: null,
    editId: null,
    serverTimestamp: null,
    isSyncing: false,
    isLoaded: false,
    user: null,
    searchTerm: '',
    initialized: false,
    theme: 'light' // 'light' or 'dark'
};

// ============================================================
// DOM REFERENCES
// ============================================================

const $ = (id) => document.getElementById(id);

const dom = {
    authOverlay: $('authOverlay'),
    authError: $('authError'),
    googleSignInBtn: $('googleSignInBtn'),
    userDisplay: $('userDisplay'),
    app: $('app'),
    tableBody: $('tableBody'),
    itemCount: $('itemCount'),
    totalOnline: $('totalOnline'),
    totalCash: $('totalCash'),
    totalReserves: $('totalReserves'),
    syncStatus: $('syncStatus'),
    toast: $('toast'),
    dropOverlay: $('dropOverlay'),
    actionsList: $('actionsList'),
    actionsBadge: $('actionsBadge'),
    searchInput: $('searchInput'),
    categoryInput: $('categoryInput'),
    addBtn: $('addBtn'),
    exportBtn: $('exportBtn'),
    importBtn: $('importBtn'),
    upiBtn: $('upiBtn'),
    actionsBtn: $('actionsBtn'),
    signOutBtn: $('signOutBtn'),
    fileInput: $('fileInput'),
    themeToggle: $('themeToggle')
};

let toastTimer = null;

// ============================================================
// THEME MANAGEMENT
// ============================================================

/**
 * Apply theme to the entire app
 */
function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    
    // Update toggle button icon
    if (dom.themeToggle) {
        dom.themeToggle.innerHTML = theme === 'dark' 
            ? '<i class="fas fa-sun"></i>'
            : '<i class="fas fa-moon"></i>';
        dom.themeToggle.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
    
    // Update body background
    if (theme === 'dark') {
        document.body.style.background = 'linear-gradient(145deg, #1a1a2e 0%, #16213e 100%)';
    } else {
        document.body.style.background = 'linear-gradient(145deg, #e8eef5 0%, #d5dfe9 100%)';
    }
}

/**
 * Toggle between light and dark themes
 */
function toggleTheme() {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
}

/**
 * Load saved theme from localStorage
 */
function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
}

// ============================================================
// TOAST NOTIFICATION
// ============================================================

function showToast(message, isError = false) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.className = 'toast' + (isError ? ' error' : '');
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 3000);
}

// ============================================================
// SYNC STATUS
// ============================================================

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
// CALCULATOR - COMPLETELY REWRITTEN FOR RELIABILITY
// ============================================================

// ============================================================
// CALCULATOR - WITH CLEAN RESET ON FORM CLOSE
// ============================================================

/**
 * Safely evaluate a mathematical expression
 * Supports +, -, *, / and parentheses
 */
function safeEvaluate(expr) {
    if (!expr || typeof expr !== 'string' || expr.trim() === '') return null;
    
    let sanitized = expr.replace(/\s/g, '');
    if (!sanitized) return null;

    if (/\/\s*0(?!\.)/.test(sanitized)) {
        return null;
    }

    if (!/^[0-9+\-*/().]+$/.test(sanitized)) {
        return null;
    }

    if (/[+\-*/]{2,}/.test(sanitized.replace(/^\-/, ''))) {
        return null;
    }

    if (/\d+\.\d+\./.test(sanitized)) {
        return null;
    }

    let parenCount = 0;
    for (const char of sanitized) {
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        if (parenCount < 0) return null;
    }
    if (parenCount !== 0) return null;

    if (/[+\-*/]$/.test(sanitized)) {
        return null;
    }

    if (/\(\)/.test(sanitized)) {
        return null;
    }

    try {
        const result = new Function(`return (${sanitized})`)();
        if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
            return Math.round(result * 1000000) / 1000000;
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Check if a string contains mathematical operators
 */
function isExpression(value) {
    if (!value || typeof value !== 'string') return false;
    return /[+\-*/]/.test(value) && !/^[\d.]+$/.test(value);
}

/**
 * Get the numeric value from an input (handles expressions)
 */
function getNumericValue(input) {
    if (!input) return 0;
    const val = input.value.trim();
    if (!val) return 0;

    if (isExpression(val)) {
        const result = safeEvaluate(val);
        return result !== null ? result : 0;
    }

    const num = parseFloat(val);
    return !isNaN(num) && isFinite(num) ? num : 0;
}

/**
 * Update covered percentage display
 */
function updateCoveredDisplay() {
    const onlineInput = document.getElementById('onlineAmount');
    const cashInput = document.getElementById('cashAmount');
    const requiredInput = document.getElementById('requiredAmount');

    if (!onlineInput || !cashInput || !requiredInput) return;

    const online = getNumericValue(onlineInput);
    const cash = getNumericValue(cashInput);
    const required = getNumericValue(requiredInput);

    const disp = document.getElementById('coveredDisplay');
    if (disp) {
        if (required > 0 && isFinite(required)) {
            const percentage = ((online + cash) / required) * 100;
            disp.value = isFinite(percentage) ? percentage.toFixed(4) + '%' : '0%';
        } else {
            disp.value = '0%';
        }
    }
}

/**
 * Evaluate and set the final value for an input
 */
function evaluateAndSetValue(input) {
    if (!input) return false;

    const val = input.value.trim();
    if (!val) {
        input.value = '0';
        input.className = input.className.replace(' valid', '').replace(' error', '');
        updateCoveredDisplay();
        return true;
    }

    if (isExpression(val)) {
        const result = safeEvaluate(val);
        if (result !== null && isFinite(result)) {
            const displayVal = Number.isInteger(result) ? result.toString() : result.toFixed(4);
            input.value = displayVal;
            input.className = input.className.replace(' error', '');
            showToast(`🧮 ${val} = ${displayVal}`, false);
            updateCoveredDisplay();
            return true;
        } else {
            input.className = input.className + ' error';
            showToast('⚠️ Invalid expression: ' + val, true);
            return false;
        }
    }

    const num = parseFloat(val);
    if (!isNaN(num) && isFinite(num)) {
        input.value = num;
    } else {
        input.value = '0';
    }
    input.className = input.className.replace(' valid', '').replace(' error', '');
    updateCoveredDisplay();
    return true;
}

/**
 * Show real-time preview of calculation
 */
function updatePreview(input) {
    if (!input) return;
    
    const val = input.value.trim();
    let preview = input.parentElement.querySelector('.calc-preview');
    
    // Create preview if it doesn't exist
    if (!preview) {
        preview = document.createElement('span');
        preview.className = 'calc-preview';
        preview.style.cssText = `
            font-size: 0.7rem;
            font-weight: 600;
            margin-left: 6px;
            opacity: 0;
            transition: opacity 0.2s ease;
            font-family: monospace;
            white-space: nowrap;
            flex-shrink: 0;
            min-width: 40px;
        `;
        input.parentElement.appendChild(preview);
    }
    
    // Reset preview visibility when input is empty
    if (!val) {
        preview.textContent = '';
        preview.style.opacity = '0';
        input.className = input.className.replace(' valid', '').replace(' error', '');
        return;
    }
    
    // Update preview based on input
    if (isExpression(val)) {
        const result = safeEvaluate(val);
        if (result !== null && isFinite(result)) {
            const displayVal = Number.isInteger(result) ? result.toString() : result.toFixed(4);
            preview.textContent = `= ${displayVal}`;
            preview.style.color = '#28a745';
            preview.style.opacity = '1';
            input.className = input.className.replace(' error', '') + ' valid';
        } else {
            preview.textContent = '⚠️';
            preview.style.color = '#dc3545';
            preview.style.opacity = '1';
            input.className = input.className.replace(' valid', '') + ' error';
        }
    } else {
        preview.textContent = '';
        preview.style.opacity = '0';
        input.className = input.className.replace(' valid', '').replace(' error', '');
    }
}

/**
 * Clean up calculator for a single input (remove wrapper and preview)
 */
function cleanupCalculator(input) {
    if (!input) return;
    
    // Remove calculator setup flag
    delete input.dataset.calculatorSetup;
    
    // Remove wrapper if it exists
    const wrapper = input.parentElement;
    if (wrapper && wrapper.classList && wrapper.classList.contains('calc-wrapper')) {
        // Remove preview
        const preview = wrapper.querySelector('.calc-preview');
        if (preview) preview.remove();
        
        // Unwrap the input
        wrapper.parentNode.insertBefore(input, wrapper);
        wrapper.remove();
    }
    
    // Reset input styles and classes
    input.className = input.className.replace(' valid', '').replace(' error', '');
    input.style.borderColor = '';
    input.style.background = '';
}

/**
 * Clean up all calculator inputs
 */
function cleanupCalculatorInputs() {
    const inputs = document.querySelectorAll('#onlineAmount, #cashAmount, #requiredAmount');
    inputs.forEach(input => cleanupCalculator(input));
}

/**
 * Setup calculator on a single input
 */
function setupCalculator(input) {
    if (!input) return;
    
    // Skip if already setup
    if (input.dataset.calculatorSetup === 'true') return;
    input.dataset.calculatorSetup = 'true';
    
    // Ensure input has a wrapper for preview
    let wrapper = input.parentElement;
    if (!wrapper.classList || !wrapper.classList.contains('calc-wrapper')) {
        wrapper = document.createElement('div');
        wrapper.className = 'calc-wrapper';
        wrapper.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            width: 100%;
        `;
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);
    }
    
    let previewTimeout = null;
    input.addEventListener('input', function() {
        clearTimeout(previewTimeout);
        previewTimeout = setTimeout(() => {
            updatePreview(this);
            updateCoveredDisplay();
        }, 100);
    });
    
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            evaluateAndSetValue(this);
            const inputs = ['onlineAmount', 'cashAmount', 'requiredAmount'];
            const currentId = this.id;
            const currentIndex = inputs.indexOf(currentId);
            if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
                const nextInput = document.getElementById(inputs[currentIndex + 1]);
                if (nextInput) nextInput.focus();
            }
        }
    });
    
    input.addEventListener('blur', function() {
        evaluateAndSetValue(this);
    });
    
    input.addEventListener('focus', function() {
        this.select();
    });
}

/**
 * Setup all calculator inputs with fresh state
 */
function setupCalculatorInputs() {
    // First cleanup any existing calculator state
    cleanupCalculatorInputs();
    
    // Then setup fresh
    const inputs = document.querySelectorAll('#onlineAmount, #cashAmount, #requiredAmount');
    inputs.forEach(input => {
        // Reset value if it's 0 (keep existing values for edit mode)
        if (input.value === '0') {
            input.value = '0';
        }
        setupCalculator(input);
    });
}

// ============================================================
// TABLE RENDERER
// ============================================================

function renderTable() {
    if (!dom.tableBody) return;

    const items = state.reserves.filter(r => r.item !== '__UPI_CONFIG__');
    const search = state.searchTerm.toLowerCase().trim();
    let filtered = items;
    if (search) {
        filtered = items.filter(r =>
            r.item.toLowerCase().includes(search) ||
            (r.category && r.category.toLowerCase().includes(search)) ||
            (r.desc && r.desc.toLowerCase().includes(search))
        );
    }

    const groups = new Map();
    filtered.forEach(r => {
        const cat = r.category || 'General';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(r);
    });

    let html = '';
    let totalOnline = 0;
    let totalCash = 0;

    if (filtered.length === 0) {
        html = `<tr class="empty-row"><td colspan="7">${
            search ? 'No items match your search.' : 'No reserves. Add your first reserve!'
        }</td></tr>`;
    } else {
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
                    <td style="text-align:center;font-weight:600;color:var(--text-secondary);">${seq}</td>
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

    dom.tableBody.innerHTML = html;
    dom.itemCount.textContent = filtered.length;
    dom.totalOnline.textContent = totalOnline.toLocaleString('en-IN');
    dom.totalCash.textContent = totalCash.toLocaleString('en-IN');
    dom.totalReserves.textContent = (totalOnline + totalCash).toLocaleString('en-IN');

    document.querySelectorAll('.item-link, .expand-hint').forEach(el => {
        el.onclick = function(e) {
            e.stopPropagation();
            const id = parseInt(this.dataset.id);
            if (!isNaN(id)) openDetail(id);
        };
    });
}

// ============================================================
// RENDER ACTIONS
// ============================================================

function renderActions() {
    const list = dom.actionsList;
    const badge = dom.actionsBadge;
    if (!list) return;

    const pending = state.actions.filter(a => !a.completed).length;
    if (badge) {
        badge.textContent = pending;
        badge.style.display = pending > 0 ? 'inline-flex' : 'none';
    }

    if (state.actions.length === 0) {
        list.innerHTML = `<div style="padding:1rem;text-align:center;color:var(--text-muted);">
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

function renderUpiList() {
    const sel = document.getElementById('upiSelector');
    const list = document.getElementById('savedUpiList');
    if (!sel || !list) return;

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

    list.innerHTML = '';
    state.upiIds.forEach(id => {
        const tag = document.createElement('span');
        tag.className = 'upi-tag';
        tag.innerHTML = `${id} <span class="remove-tag" data-upi="${id}"><i class="fas fa-times-circle"></i></span>`;

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

        tag.addEventListener('click', () => {
            state.upiDefault = id;
            sel.value = id;
            generateQR();
        });

        list.appendChild(tag);
    });

    if (state.upiIds.length === 0) {
        list.innerHTML = '<span style="color:var(--text-muted);font-size:0.8rem;padding:0.3rem;">No UPI IDs. Add one below.</span>';
    }

    const selected = sel.value || state.upiIds[0] || '';
    state.upiDefault = selected;
    document.getElementById('upiIdDisplay').textContent = selected || '-';
}

// ============================================================
// QR CODE GENERATOR
// ============================================================

let qrInstance = null;

function generateQR() {
    const upi = document.getElementById('upiSelector')?.value || state.upiIds[0] || '';
    const container = document.getElementById('qrcode');
    if (!container) return;

    if (!upi) {
        container.innerHTML = '<p style="color:var(--text-muted);padding:0.5rem;">No UPI ID available</p>';
        document.getElementById('upiIdDisplay').textContent = '-';
        return;
    }

    state.upiDefault = upi;
    const payee = 'Reserve Manager';
    const note = 'Reserve contribution';
    const amt = parseFloat(document.getElementById('upiAmountInput')?.value);

    let amtParam = '';
    let amtDisplay = 'User decides';
    if (!isNaN(amt) && amt > 0 && isFinite(amt)) {
        amtParam = '&am=' + amt.toFixed(2);
        amtDisplay = '₹' + amt.toFixed(2);
    }

    document.getElementById('upiIdDisplay').textContent = upi;
    document.getElementById('upiAmountDisplay').textContent = amtDisplay;
    document.getElementById('upiPayeeDisplay').textContent = payee;
    document.getElementById('upiNoteDisplay').textContent = note;

    const uri = `upi://pay?pa=${upi}&pn=${encodeURIComponent(payee)}${amtParam}&cu=INR&tn=${encodeURIComponent(note)}`;

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
// DETAIL CARD
// ============================================================

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

function closeDetail() {
    document.getElementById('cardOverlay').classList.remove('active');
    state.selectedId = null;
}

// ============================================================
// FORM MODAL
// ============================================================

/**
 * Open the add/edit form modal
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

    // Reset all inputs to fresh state
    if (editItem) {
        name.value = editItem.item || '';
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

    // Reset any visual styles and remove calculator state
    [online, cash, required].forEach(input => {
        input.style.borderColor = '';
        input.style.background = '';
        input.className = input.className.replace(' valid', '').replace(' error', '');
        // Remove any old calculator state
        delete input.dataset.calculatorSetup;
    });

    updateCoveredDisplay();
    document.getElementById('formOverlay').classList.add('active');
    
    // Setup calculator inputs after form is shown with a clean slate
    setTimeout(() => {
        setupCalculatorInputs();
    }, 100);
}

/**
 * Close the add/edit form modal
 */
function closeForm() {
    // Clean up calculator state before closing
    cleanupCalculatorInputs();
    
    document.getElementById('formOverlay').classList.remove('active');
    state.editId = null;
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

function saveReserve(e) {
    e.preventDefault();

    // Evaluate all number inputs before saving
    const inputs = document.querySelectorAll('#onlineAmount, #cashAmount, #requiredAmount');
    let allValid = true;
    inputs.forEach(input => {
        const valid = evaluateAndSetValue(input);
        if (!valid) allValid = false;
    });

    if (!allValid) {
        showToast('⚠️ Please fix invalid expressions before saving', true);
        return;
    }

    const name = document.getElementById('itemName').value.trim();
    if (!name) {
        showToast('Backup Item is required.', true);
        return;
    }

    const category = document.getElementById('categoryInput').value.trim() || 'General';
    const online = parseFloat(document.getElementById('onlineAmount').value) || 0;
    const cash = parseFloat(document.getElementById('cashAmount').value) || 0;
    const required = parseFloat(document.getElementById('requiredAmount').value) || 0;

    // Validate numbers
    if (!isFinite(online) || !isFinite(cash) || !isFinite(required)) {
        showToast('⚠️ Invalid numeric values detected', true);
        return;
    }

    const data = {
        item: name,
        category: category,
        online: online,
        cash: cash,
        required: required,
        desc: document.getElementById('descText').value.trim() || ''
    };

    if (state.editId !== null) {
        const idx = state.reserves.findIndex(r => r.id === state.editId);
        if (idx !== -1) {
            state.reserves[idx] = { ...state.reserves[idx], ...data };
        }
    } else {
        data.id = state.nextId++;
        state.reserves.push(data);
    }

    closeForm();
    renderTable();
    triggerSync();
    showToast('✅ Item saved successfully');
}

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
// ACTION OPERATIONS
// ============================================================

window.toggleAction = function(index) {
    if (index >= 0 && index < state.actions.length) {
        state.actions[index].completed = !state.actions[index].completed;
        renderActions();
        triggerSync();
        showToast(state.actions[index].completed ? '✅ Action completed!' : '🔄 Action reopened');
    }
};

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

function exportData() {
    if (state.reserves.length === 0) {
        showToast('No data to export.', true);
        return;
    }

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

            state.reserves = parsed.filter(r => r.item !== '__UPI_CONFIG__');
            state.reserves.forEach(r => {
                if (!r.category) r.category = 'General';
            });

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
// CLOUD SYNCHRONIZATION
// ============================================================

function getUserDocRef() {
    if (!auth?.currentUser) return null;
    return db.collection('users').doc(auth.currentUser.uid).collection('data').doc('main');
}

async function triggerSync() {
    if (!auth?.currentUser || state.isSyncing || !state.isLoaded) return;

    state.isSyncing = true;
    setSyncStatus('syncing', 'Syncing...');

    try {
        const docRef = getUserDocRef();
        if (!docRef) { state.isSyncing = false; return; }

        const snap = await docRef.get({ source: 'server' });
        if (snap.exists) {
            const data = snap.data();
            const serverTs = data.updatedAt || data.lastSync;
            if (serverTs && state.serverTimestamp) {
                const sDate = new Date(serverTs);
                const lDate = new Date(state.serverTimestamp);
                if (sDate > lDate) {
                    await loadFromServer(true);
                    state.isSyncing = false;
                    return;
                }
            }
        }

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
            userEmail: auth.currentUser.email,
            userName: auth.currentUser.displayName || auth.currentUser.email
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

            state.reserves = reserves.filter(r => r.item !== '__UPI_CONFIG__');
            state.reserves.forEach(r => {
                if (!r.category) r.category = 'General';
            });

            const maxId = state.reserves.reduce((max, r) => Math.max(max, r.id || 0), 0);
            state.nextId = maxId + 1;
            state.isLoaded = true;

            renderTable();
            setSyncStatus('synced', `${state.reserves.length} items loaded`);
            if (!silent) showToast(`✅ Loaded ${state.reserves.length} items from your account`);

        } else {
            state.reserves = [];
            state.nextId = 1;
            state.isLoaded = true;

            await docRef.set({
                reserves: [],
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastSync: new Date().toISOString(),
                userId: auth.currentUser.uid,
                userEmail: auth.currentUser.email,
                userName: auth.currentUser.displayName || auth.currentUser.email
            });

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

        if (dom.userDisplay) {
            dom.userDisplay.textContent = `👤 ${result.user.displayName || result.user.email}`;
        }

        await loadFromServer(false);
        setupAutoSync();
        showToast('✅ Signed in as ' + (result.user.displayName || result.user.email));

    } catch (error) {
        dom.authError.textContent = 'Sign-in failed: ' + error.message;
        showToast('❌ Sign-in failed', true);
    }
}

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
            if (dom.userDisplay) {
                dom.userDisplay.textContent = '';
            }
            showToast('Signed out');
            renderTable();
        })
        .catch(error => {
            showToast('Sign out error', true);
        });
}

function setupAutoSync() {
    setInterval(() => {
        if (auth?.currentUser && state.isLoaded && !state.isSyncing) {
            triggerSync();
        }
    }, 30000);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && auth?.currentUser && state.isLoaded && !state.isSyncing) {
            triggerSync();
        }
    });

    window.addEventListener('beforeunload', () => {
        if (auth?.currentUser && state.isLoaded && !state.isSyncing) {
            triggerSync();
        }
    });
}

// ============================================================
// AUTH STATE CHANGE HANDLER
// ============================================================

function handleAuthStateChange(user) {
    if (user) {
        console.log('✅ User authenticated:', user.email);
        state.user = user;
        
        dom.authOverlay.classList.add('hidden');
        dom.app.style.display = 'flex';
        
        if (dom.userDisplay) {
            dom.userDisplay.textContent = `👤 ${user.displayName || user.email}`;
        }
        
        if (!state.isLoaded) {
            loadFromServer(false).then(() => {
                setupAutoSync();
            });
        }
    } else {
        console.log('🔒 User signed out');
        
        if (!dom.authOverlay.classList.contains('hidden')) {
            return;
        }
        
        state.user = null;
        state.isLoaded = false;
        state.reserves = [];
        state.upiIds = [];
        state.actions = [];
        
        dom.app.style.display = 'none';
        dom.authOverlay.classList.remove('hidden');
        if (dom.userDisplay) {
            dom.userDisplay.textContent = '';
        }
        renderTable();
    }
}

// ============================================================
// INITIALIZATION
// ============================================================

function initApp() {
    // Load theme first
    loadTheme();

    // Auth state listener
    if (auth) {
        auth.onAuthStateChanged(handleAuthStateChange);
    } else {
        console.warn('⚠️ Auth not available');
        dom.authOverlay.classList.remove('hidden');
        dom.app.style.display = 'none';
    }

    // Theme toggle
    if (dom.themeToggle) {
        dom.themeToggle.addEventListener('click', toggleTheme);
    }

    // Auth buttons
    dom.googleSignInBtn.addEventListener('click', signInWithGoogle);
    dom.signOutBtn.addEventListener('click', signOut);

    // Search with clear button
    dom.searchInput.addEventListener('input', function() {
        state.searchTerm = this.value;
        renderTable();
    });

    const searchContainer = dom.searchInput?.closest('.search-container');
    if (searchContainer) {
        let clearBtn = searchContainer.querySelector('.search-clear-btn');
        if (!clearBtn) {
            clearBtn = document.createElement('button');
            clearBtn.className = 'search-clear-btn';
            clearBtn.innerHTML = '<i class="fas fa-times-circle"></i>';
            clearBtn.style.cssText = `
                background: none;
                border: none;
                color: var(--text-muted);
                cursor: pointer;
                padding: 0 6px;
                font-size: 0.9rem;
                display: none;
                transition: color 0.2s ease;
            `;
            clearBtn.addEventListener('click', function() {
                dom.searchInput.value = '';
                dom.searchInput.dispatchEvent(new Event('input'));
                this.style.display = 'none';
                dom.searchInput.focus();
            });
            clearBtn.addEventListener('mouseenter', function() {
                this.style.color = '#dc3545';
            });
            clearBtn.addEventListener('mouseleave', function() {
                this.style.color = 'var(--text-muted)';
            });
            searchContainer.appendChild(clearBtn);
        }

        dom.searchInput.addEventListener('input', function() {
            const clearBtn = searchContainer.querySelector('.search-clear-btn');
            if (clearBtn) {
                clearBtn.style.display = this.value.length > 0 ? 'block' : 'none';
            }
        });
    }

    // Add Reserve
    dom.addBtn.addEventListener('click', () => openForm(null));

    // Form
    document.getElementById('formCloseBtn').addEventListener('click', closeForm);
    document.getElementById('formOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeForm();
    });
    document.getElementById('reserveForm').addEventListener('submit', saveReserve);

    // Detail Card
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

    // Actions
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

    // UPI
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

    // Export / Import
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

    // Drag & Drop
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

    // Keyboard shortcuts
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

    console.log('✅ App initialized successfully');
}

// ============================================================
// APPLICATION START
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    dom.app.style.display = 'none';
    dom.authOverlay.classList.remove('hidden');
    initApp();
});

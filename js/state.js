// Global State Variables

let GAS_URL = localStorage.getItem('md_tracker_url') || "";

let worker = null;
let stream = null;
let isProcessing = false;
let isGameActive = false;
let currentCoin = "不明";
let gameStartTime = 0;
let timerInterval = null;
let lastResultTime = 0;
let logData = [];
let filteredData = [];
let deckList = [];
let sessionStartTime = 0;
let pipWindowRef = null;

// Turn Detection State
let isDeterminingTurn = false;
let turnDetectStartTime = 0;
let currentOCRMode = "ALL";
let webglManager = new WebGLManager();

// レイアウト設定
let pipLayoutMode = localStorage.getItem('md_pip_layout') || 'portrait';

// Editing State
let editingRowId = null;

// Optimistic UI State
let lastLocalUpdateTime = 0; // Timestamp of last local change
let isSyncing = false; // Flag to indicate background sync status

// --- Optimistic State Management ---

function optimisticAdd(newRow) {
    // Generate a temporary ID if not provided (for new entries)
    // Use negative timestamp to avoid collision with 1-based index from GAS
    if (!newRow.id) newRow.id = -(Date.now());

    // Add to top (newest first)
    logData.unshift(newRow);

    markLocalUpdate();
    refreshUI();
}

function optimisticUpdate(id, updatedRow) {
    const idx = logData.findIndex(r => r.id === id);
    if (idx !== -1) {
        // Merge existing data with updates to preserve ID and other fields
        logData[idx] = { ...logData[idx], ...updatedRow };
        markLocalUpdate();
        refreshUI();
    }
}

function optimisticDelete(id) {
    logData = logData.filter(r => r.id !== id);
    markLocalUpdate();
    refreshUI();
}

function markLocalUpdate() {
    lastLocalUpdateTime = Date.now();
}

function refreshUI() {
    if (typeof renderHome === 'function') renderHome();
    if (typeof renderHistory === 'function') renderHistory();
    if (typeof applyFilter === 'function') applyFilter();

    // If PiP is open, it might need updates too (usually handled by renderHome helpers)
    if (typeof updatePipStats === 'function') updatePipStats();
}

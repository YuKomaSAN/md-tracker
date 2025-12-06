// Main Entry Point

window.onload = () => {
    if (window.location.hash === "#compact") document.body.classList.add("compact-mode");
    window.addEventListener('storage', (e) => {
        if (e.key === 'md_refresh_signal') loadData();
        if (e.key === 'md_session_start') { sessionStartTime = parseInt(e.newValue); renderHome(); }
    });
    const savedSession = localStorage.getItem('md_session_start');
    if (savedSession) sessionStartTime = parseInt(savedSession);
    setupEventListeners();
    if (GAS_URL) loadData();
    renderSavedFilters();
};

function setupEventListeners() {
    // --- Static Elements (Safe to use addEventListener) ---

    // Header
    const btnSaveUrl = document.getElementById('btnSaveUrl');
    if (btnSaveUrl) btnSaveUrl.addEventListener('click', saveUrl);

    // Tabs
    const tabHome = document.getElementById('tab_home');
    if (tabHome) tabHome.addEventListener('click', () => changeTab('home'));
    const tabMonitor = document.getElementById('tab_monitor');
    if (tabMonitor) tabMonitor.addEventListener('click', () => changeTab('monitor'));
    const tabHistory = document.getElementById('tab_history');
    if (tabHistory) tabHistory.addEventListener('click', () => changeTab('history'));
    const tabAnalyze = document.getElementById('tab_analyze');
    if (tabAnalyze) tabAnalyze.addEventListener('click', () => changeTab('analyze'));

    // Main Controls (Non-portable)
    const btnStartSystem = document.getElementById('btnStartSystem');
    if (btnStartSystem) btnStartSystem.addEventListener('click', startSystem);

    // PiP Placeholder (Always in main window)
    const btnClosePiP = document.getElementById('btnClosePiP');
    if (btnClosePiP) btnClosePiP.addEventListener('click', closePiP);

    // Refresh Buttons
    const btnRefreshRecent = document.getElementById('btnRefreshRecent');
    if (btnRefreshRecent) btnRefreshRecent.addEventListener('click', loadData);
    const btnRefreshHistory = document.getElementById('btnRefreshHistory');
    if (btnRefreshHistory) btnRefreshHistory.addEventListener('click', loadData);

    // Filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => setFilterTime(e.target.dataset.filter));
    });
    const filterMatchType = document.getElementById('filterMatchType');
    if (filterMatchType) filterMatchType.addEventListener('change', applyFilter);
    const btnApplyCustomFilter = document.getElementById('btnApplyCustomFilter');
    if (btnApplyCustomFilter) btnApplyCustomFilter.addEventListener('click', () => setFilterTime('custom'));
    const btnSaveFilter = document.getElementById('btnSaveFilter');
    if (btnSaveFilter) btnSaveFilter.addEventListener('click', saveFilter);

    // Filter Event Listeners (moved from analyze.js DOMContentLoaded)
    ['filterMatchType', 'filterMyDeck', 'filterOppDeck', 'filterCoin', 'filterTurn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', applyFilter);
    });

    // Edit Modal
    const btnSubmitEdit = document.getElementById('btnSubmitEdit');
    if (btnSubmitEdit) btnSubmitEdit.addEventListener('click', submitEdit);
    const btnCancelEdit = document.getElementById('btnCancelEdit');
    if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeModal);

    const editMyDeck = document.getElementById('editMyDeck');
    if (editMyDeck) editMyDeck.addEventListener('change', (e) => checkNewDeck(e.target));
    const editOppDeck = document.getElementById('editOppDeck');
    if (editOppDeck) editOppDeck.addEventListener('change', (e) => checkNewDeck(e.target));

    // --- Portable Controls (Keep using onclick/onchange in setupPortableListeners) ---
    // These elements move between Main Window and PiP Window.
    // Using addEventListener causes issues with event loss or duplication during moves.
    setupPortableListeners(document);

    // --- Table Event Delegation ---
    const handleTableClick = (e) => {
        const target = e.target;
        if (target.classList.contains('btn-edit')) {
            editLog(parseInt(target.dataset.id));
        } else if (target.classList.contains('btn-delete')) {
            deleteLog(parseInt(target.dataset.id));
        }
    };
    const recentTable = document.getElementById('recentTable');
    if (recentTable) recentTable.addEventListener('click', handleTableClick);
    const historyTable = document.getElementById('historyTable');
    if (historyTable) historyTable.addEventListener('click', handleTableClick);
}

function changeTab(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    const tabBtn = document.getElementById('tab_' + id);
    if (tabBtn) tabBtn.classList.add('active');
    if (id !== 'record' && id !== 'monitor') loadData();
}

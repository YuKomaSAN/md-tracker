const CONFIG = {
    OCR: {
        WHITELIST_RESTRICTED: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789勝利敗北',
        WHITELIST_ALL: ''
    },
    TIMEOUTS: {
        TURN_DETECT: 15000,
        RESULT_COOLDOWN: 10000,
        RESIZE_DELAY: 100,
        LOAD_DELAY: 1500,
        LOOP_FAST: 50,
        LOOP_SLOW: 300
    },
    PIP: {
        LANDSCAPE: { WIDTH: 1150, HEIGHT: 170 },
        PORTRAIT: { WIDTH: 320, HEIGHT: 650 }
    },
    ROI: {
        TURN: { x: 0.30, y: 0.58, w: 0.40, h: 0.12, scale: 1.0 },
        GAME: { x: 0.10, y: 0.33, w: 0.8, h: 0.34, scale: 1.0 },
        WAIT: { x: 0.33, y: 0.63, w: 0.33, h: 0.10, scale: 1.0 }
    }
};

let GAS_URL = localStorage.getItem('md_tracker_url') || "";
if (GAS_URL) document.getElementById('gasUrlInput').value = GAS_URL;

let worker = null; let stream = null; let isProcessing = false;
let isGameActive = false; let currentCoin = "不明";
let gameStartTime = 0; let timerInterval = null; let lastResultTime = 0;
let logData = []; let filteredData = []; let deckList = [];
let sessionStartTime = 0;
let pipWindowRef = null;

// Turn Detection State
let isDeterminingTurn = false;
let turnDetectStartTime = 0;
let currentOCRMode = "ALL";
let webglManager = new WebGLManager();

// レイアウト設定
let pipLayoutMode = localStorage.getItem('md_pip_layout') || 'portrait';

window.onload = () => {
    if (window.location.hash === "#compact") document.body.classList.add("compact-mode");
    window.addEventListener('storage', (e) => {
        if (e.key === 'md_refresh_signal') loadData();
        if (e.key === 'md_session_start') { sessionStartTime = parseInt(e.newValue); renderHome(); }
    });
    const savedSession = localStorage.getItem('md_session_start');
    if (savedSession) sessionStartTime = parseInt(savedSession);
    setupEventListeners();
    if (GAS_URL) loadData(); renderSavedFilters();
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

    // Edit Modal
    const btnSubmitEdit = document.getElementById('btnSubmitEdit');
    if (btnSubmitEdit) btnSubmitEdit.addEventListener('click', submitEdit);
    const btnCancelEdit = document.getElementById('btnCancelEdit');
    if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeModal);

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

function setupPortableListeners(doc) {
    // Settings
    const myDeckSelect = doc.getElementById('myDeckSelect');
    if (myDeckSelect) {
        myDeckSelect.onchange = (e) => checkNewDeck(e.target);
    }

    const oppDeckSelect = doc.getElementById('oppDeckSelect');
    if (oppDeckSelect) {
        oppDeckSelect.onchange = (e) => checkNewDeck(e.target);
    }

    // Manual Controls
    const btnManualStart = doc.getElementById('btnManualStart');
    if (btnManualStart) btnManualStart.onclick = manualStart;

    const btnResetGame = doc.getElementById('btnResetGame');
    if (btnResetGame) btnResetGame.onclick = resetGame;

    const btnForceWin = doc.getElementById('btnForceWin');
    if (btnForceWin) btnForceWin.onclick = () => finish('WIN', '手動');

    const btnForceLose = doc.getElementById('btnForceLose');
    if (btnForceLose) btnForceLose.onclick = () => finish('LOSE', '手動');

    // Layout Toggle
    const btnToggleLayout = doc.getElementById('btnToggleLayout');
    if (btnToggleLayout) {
        btnToggleLayout.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleLayout();
        };
    }
}

function getUI(id) {
    let el = document.getElementById(id);
    if (!el && pipWindowRef && pipWindowRef.document) {
        el = pipWindowRef.document.getElementById(id);
    }
    return el;
}

// --- PiP機能 ---
async function togglePiP() {
    if (!('documentPictureInPicture' in window)) return alert("非対応ブラウザです");
    if (pipWindowRef) { pipWindowRef.close(); return; }

    try {
        // 初期サイズ設定
        const width = pipLayoutMode === 'landscape' ? CONFIG.PIP.LANDSCAPE.WIDTH : CONFIG.PIP.PORTRAIT.WIDTH;
        const height = pipLayoutMode === 'landscape' ? CONFIG.PIP.LANDSCAPE.HEIGHT : CONFIG.PIP.PORTRAIT.HEIGHT;

        const pipWin = await documentPictureInPicture.requestWindow({ width: width, height: height });
        pipWindowRef = pipWin;
        log("PiPウィンドウ作成成功");

        setTimeout(() => {
            try {
                pipWin.resizeTo(width, height);
                log("PiPリサイズ実行(遅延)");
            } catch (e) {
                console.error("Resize failed:", e);
                log("PiPリサイズ失敗: " + e);
            }
        }, CONFIG.TIMEOUTS.RESIZE_DELAY);

        pipWin.document.body.style.backgroundColor = "#181818";
        pipWin.document.body.style.color = "#e0e0e0";

        // 初期クラス設定
        if (pipLayoutMode === 'landscape') {
            pipWin.document.body.classList.add('landscape');
        } else {
            pipWin.document.body.classList.remove('landscape');
        }

        // CSSコピー
        [...document.styleSheets].forEach(styleSheet => {
            try {
                const css = [...styleSheet.cssRules].map(r => r.cssText).join('');
                const style = document.createElement('style');
                style.textContent = css;
                pipWin.document.head.appendChild(style);
            } catch (e) { }
        });

        const links = document.querySelectorAll('link[rel="stylesheet"]');
        links.forEach(link => {
            const newLink = document.createElement('link');
            newLink.rel = 'stylesheet';
            newLink.href = link.href;
            pipWin.document.head.appendChild(newLink);
        });

        // コンテンツ移動
        const pipContent = document.getElementById('pipContent');
        if (pipContent) {
            pipContent.style.display = "flex";
            pipWin.document.body.appendChild(pipContent);
            log("PiPコンテンツ移動成功");
        } else {
            log("PiPコンテンツが見つかりません", "important");
        }

        const controls = document.getElementById('portableControls');
        const target = pipContent ? pipContent.querySelector('#pipControlsTarget') : null;
        if (controls && target) {
            target.appendChild(controls);
            log("PiPコントロール移動成功");
        } else {
            log("PiPコントロール移動失敗: " + (controls ? "Targetなし" : "Controlsなし"), "important");
        }

        // イベントリスナー再設定 (PiP内)
        renderSelects(pipWin.document);
        setupPortableListeners(pipWin.document);

        document.getElementById('pipPlaceholder').style.display = "block";

        pipWin.addEventListener("pagehide", () => {
            const parent = document.getElementById("mainControlCol");
            const placeholder = document.getElementById('pipPlaceholder');
            if (parent && controls) parent.insertBefore(controls, placeholder);

            if (pipContent) {
                document.body.appendChild(pipContent);
                pipContent.style.display = "none";
            }
            if (placeholder) placeholder.style.display = "none";
            pipWindowRef = null;

            // メインウィンドウに戻ったのでリスナー再設定
            setupPortableListeners(document);
        });
    } catch (e) {
        console.error(e);
        alert("PiPエラー: " + e);
    }
}

function toggleLayout() {
    if (!pipWindowRef) {
        console.error("PiP window reference is missing");
        return;
    }

    try {
        if (pipLayoutMode === 'portrait') {
            // → 横長へ変更 (Landscape)
            pipLayoutMode = 'landscape';

            // 画面からはみ出さないように位置調整 (横幅が増えるため左にずらす)
            const currentX = pipWindowRef.screenX;
            const targetWidth = CONFIG.PIP.LANDSCAPE.WIDTH;
            const screenW = pipWindowRef.screen.availWidth;

            if (currentX + targetWidth > screenW) {
                const newX = Math.max(0, screenW - targetWidth - 50);
                pipWindowRef.moveTo(newX, pipWindowRef.screenY);
            }

            pipWindowRef.resizeTo(CONFIG.PIP.LANDSCAPE.WIDTH, CONFIG.PIP.LANDSCAPE.HEIGHT);
            pipWindowRef.document.body.classList.add('landscape');
        } else {
            // → 縦長へ変更 (Portrait)
            pipLayoutMode = 'portrait';

            // 画面からはみ出さないように位置調整
            const currentY = pipWindowRef.screenY;
            const targetHeight = CONFIG.PIP.PORTRAIT.HEIGHT;
            const screenH = pipWindowRef.screen.availHeight;

            if (currentY + targetHeight > screenH) {
                const newY = Math.max(0, screenH - targetHeight - 50);
                pipWindowRef.moveTo(pipWindowRef.screenX, newY);
            }

            // 即時リサイズ実行
            pipWindowRef.resizeTo(CONFIG.PIP.PORTRAIT.WIDTH, CONFIG.PIP.PORTRAIT.HEIGHT);
            pipWindowRef.document.body.classList.remove('landscape');
        }
        localStorage.setItem('md_pip_layout', pipLayoutMode);
    } catch (e) {
        console.error("Layout toggle failed:", e);
        alert("レイアウト切り替えエラー: " + e.message);
    }
}

function closePiP() {
    if (pipWindowRef) {
        pipWindowRef.close();
    }
}

// --- 共通ユーティリティ ---
function showToast(msg) { const t = document.getElementById("toast"); t.innerText = msg; t.className = "show"; setTimeout(function () { t.className = t.className.replace("show", ""); }, 3000); }
function parseDuration(val) {
    if (val === undefined || val === null || val === "") return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        if (!isNaN(Number(val))) return Number(val);
        const m = val.match(/(\d+)分(\d+)秒/);
        if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
    } return 0;
}
function formatSeconds(sec) { const m = Math.floor(sec / 60); const s = sec % 60; return `${m}分${String(s).padStart(2, '0')}秒`; }
function toTimeStr(val) { const sec = parseDuration(val); return sec > 0 ? formatSeconds(sec) : "-"; }

function resetSession() { const now = Date.now(); localStorage.setItem('md_session_start', now); sessionStartTime = now; showToast("ここからの成績を集計します"); renderHome(); }
function saveUrl() { localStorage.setItem('md_tracker_url', document.getElementById('gasUrlInput').value); showToast("保存しました"); loadData(); }

function changeTab(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    const tabBtn = document.getElementById('tab_' + id);
    if (tabBtn) tabBtn.classList.add('active');
    if (id !== 'record' && id !== 'monitor') loadData();
}

// --- データロード ---
function loadData() {
    if (!GAS_URL) { showToast("GAS URLが設定されていません"); return; }
    const cbName = 'cb_' + Date.now();
    window[cbName] = (data) => {
        logData = data.logs || []; deckList = data.decks || [];
        renderSelects(document);
        if (pipWindowRef) renderSelects(pipWindowRef.document);
        if (!document.body.classList.contains("compact-mode")) { renderHome(); renderHistory(); applyFilter(); } else { renderHome(); }
        delete window[cbName]; document.body.removeChild(document.getElementById(cbName));
    };
    const script = document.createElement('script');
    script.src = `${GAS_URL}?callback=${cbName}&nocache=${Date.now()}`;
    document.body.appendChild(script);
    const last = localStorage.getItem('md_last_deck');
    const myDeckSel = doc.getElementById('myDeckSelect');
    if (last && deckList.includes(last) && myDeckSel && !myDeckSel.value) {
        myDeckSel.value = last;
    }
}

function renderSelects(doc) {
    if (!doc) return;
    const ids = ['myDeckSelect', 'oppDeckSelect', 'editMyDeck', 'editOppDeck', 'filterMyDeck', 'filterOppDeck'];

    // Extract unique decks from logs for filters
    const uniqueMyDecks = [...new Set(logData.map(d => d.myDeck).filter(d => d))].sort();
    const uniqueOppDecks = [...new Set(logData.map(d => d.oppDeck).filter(d => d))].sort();

    ids.forEach(id => {
        const el = doc.getElementById(id);
        if (!el) return;
        const current = el.value;

        let html = "";
        let listToUse = deckList;

        if (id.startsWith('filter')) {
            html = `<option value="all">すべて</option>`;
            if (id === 'filterMyDeck') listToUse = uniqueMyDecks;
            if (id === 'filterOppDeck') listToUse = uniqueOppDecks;
        } else {
            html = `<option value="">(選択なし)</option>`;
        }

        html += listToUse.map(d => `<option value="${d}">${d}</option>`).join('');

        if (!id.startsWith('filter')) {
            html += `<option value="その他">その他</option>`;
        }

        if (id.includes('Select') && !id.startsWith('filter')) {
            html += `<option value="__NEW__" style="color:#4da3ff;">＋ 新規追加...</option>`;
        }

        el.innerHTML = html;

        if (current && (listToUse.includes(current) || current === 'all' || current === 'その他')) {
            el.value = current;
        }
    });

    // Restore last deck (only for myDeckSelect)
    const last = localStorage.getItem('md_last_deck');
    const myDeckSel = doc.getElementById('myDeckSelect');
    if (last && deckList.includes(last) && myDeckSel && !myDeckSel.value) {
        myDeckSel.value = last;
    }
}

// --- ホーム画面 ---
function renderHome() {
    const sessionData = sessionStartTime > 0 ? logData.filter(d => new Date(d.date).getTime() >= sessionStartTime) : logData;
    const labelText = sessionStartTime > 0 ? "勝率 (セッション)" : "勝率 (全期間)";
    if (document.getElementById('lbl_winRate')) document.getElementById('lbl_winRate').innerText = labelText;

    const total = sessionData.length;
    let wins = 0, coins = 0, totalSec = 0, countSec = 0;
    let firstTurnCount = 0, firstTurnWins = 0, secondTurnCount = 0, secondTurnWins = 0;

    if (total > 0) {
        sessionData.forEach(d => {
            const r = d.result || "";
            const isWin = r.includes("WIN");
            if (isWin) wins++;
            if ((d.coin || "").includes("表")) coins++;

            const isFirst = (d.turn || "").includes("先") || (d.turn || "") === "First";
            const isSecond = (d.turn || "").includes("後") || (d.turn || "") === "Second";

            if (isFirst) {
                firstTurnCount++;
                if (isWin) firstTurnWins++;
            } else if (isSecond) {
                secondTurnCount++;
                if (isWin) secondTurnWins++;
            }

            const sec = parseDuration(d.duration); if (sec > 0) { totalSec += sec; countSec++; }
        });
    }
    const winRate = total > 0 ? Math.round((wins / total) * 100) + "%" : "--%";
    const coinRate = total > 0 ? Math.round((coins / total) * 100) + "%" : "--%";
    const avgTime = countSec > 0 ? formatSeconds(Math.floor(totalSec / countSec)) : "-";

    const firstTurnRate = total > 0 ? Math.round((firstTurnCount / total) * 100) + "%" : "--%";
    const firstWinRate = firstTurnCount > 0 ? Math.round((firstTurnWins / firstTurnCount) * 100) + "%" : "--%";
    const secondWinRate = secondTurnCount > 0 ? Math.round((secondTurnWins / secondTurnCount) * 100) + "%" : "--%";

    if (document.getElementById('db_winRate')) {
        document.getElementById('db_winRate').innerText = winRate;
        document.getElementById('db_totalMatches').innerText = total + "戦";
        document.getElementById('db_coinRate').innerText = coinRate;
        document.getElementById('db_avgTime').innerText = avgTime;

        if (document.getElementById('db_firstTurnRate')) document.getElementById('db_firstTurnRate').innerText = firstTurnRate;
        if (document.getElementById('db_firstWinRate')) document.getElementById('db_firstWinRate').innerText = firstWinRate;
        if (document.getElementById('db_secondWinRate')) document.getElementById('db_secondWinRate').innerText = secondWinRate;
        if (document.getElementById('db_firstMatches')) document.getElementById('db_firstMatches').innerText = firstTurnCount + "戦";
        if (document.getElementById('db_secondMatches')) document.getElementById('db_secondMatches').innerText = secondTurnCount + "戦";
    }

    const pipT = getUI('pip_total');
    if (pipT) { pipT.innerText = total; getUI('pip_win').innerText = winRate; getUI('pip_coin_r').innerText = coinRate; }

    if (document.getElementById('recentTable')) {
        const recent = logData.slice(0, 10);
        const tbody = document.querySelector("#recentTable tbody"); tbody.innerHTML = "";
        recent.forEach(row => {
            const tr = document.createElement("tr");
            const res = row.result || "-"; const resClass = res.includes("WIN") ? "win" : "lose"; const timeStr = toTimeStr(row.duration);
            tr.innerHTML = `<td>${row.myDeck}</td><td>${row.oppDeck || "-"}</td><td>${row.turn}</td><td>${timeStr}</td><td class="${resClass}">${res}</td><td><button class="btn-edit" data-id="${row.id}" style="padding:2px 6px; font-size:0.8em;">編集</button> <button class="btn-delete" data-id="${row.id}" style="padding:2px 6px; font-size:0.8em; background:#d32f2f;">削除</button></td>`;
            tbody.appendChild(tr);
        });
    }
}
// --- 履歴 ---
function renderHistory() {
    const tbody = document.querySelector("#historyTable tbody"); tbody.innerHTML = "";
    logData.slice(0, 100).forEach(row => {
        const tr = document.createElement("tr");
        let dateStr = "---"; try { const d = new Date(row.date); if (!isNaN(d.getTime())) dateStr = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; } catch (e) { }
        const res = row.result || "-"; const resClass = res.includes("WIN") ? "win" : "lose"; const timeStr = toTimeStr(row.duration);
        tr.innerHTML = `<td>${dateStr}</td><td>${row.type || "-"}</td><td>${row.myDeck}</td><td>${row.oppDeck || "-"}</td><td>${row.turn}</td><td>${timeStr}</td><td class="${resClass}">${res}</td><td><button class="btn-edit" data-id="${row.id}" style="padding:2px 6px; font-size:0.8em;">編集</button> <button class="btn-delete" data-id="${row.id}" style="padding:2px 6px; font-size:0.8em; background:#d32f2f;">削除</button></td>`;
        tbody.appendChild(tr);
    });
}

// --- 分析 ---
let currentTimeFilter = 'all';
function setFilterTime(type) {
    currentTimeFilter = type;
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('active');
        if (b.dataset.filter === type) b.classList.add('active');
    });
    applyFilter();
}

// Add event listeners for new filters
document.addEventListener('DOMContentLoaded', () => {
    ['filterMatchType', 'filterMyDeck', 'filterOppDeck', 'filterCoin', 'filterTurn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', applyFilter);
    });
});

function applyFilter() {
    const now = new Date();
    const matchType = document.getElementById('filterMatchType').value;
    const myDeck = document.getElementById('filterMyDeck') ? document.getElementById('filterMyDeck').value : 'all';
    const oppDeck = document.getElementById('filterOppDeck') ? document.getElementById('filterOppDeck').value : 'all';
    const coin = document.getElementById('filterCoin') ? document.getElementById('filterCoin').value : 'all';
    const turn = document.getElementById('filterTurn') ? document.getElementById('filterTurn').value : 'all';

    console.log("applyFilter called.", { matchType, myDeck, oppDeck, coin, turn, timeFilter: currentTimeFilter });

    filteredData = logData.filter(row => {
        if (matchType !== 'all' && row.type !== matchType) return false;
        if (myDeck !== 'all' && row.myDeck !== myDeck) return false;
        if (oppDeck !== 'all' && row.oppDeck !== oppDeck) return false;

        if (coin !== 'all') {
            if (coin === '表' && !(row.coin || "").includes("表")) return false;
            if (coin === '裏' && !(row.coin || "").includes("裏")) return false;
        }

        if (turn !== 'all') {
            const isFirst = (row.turn || "").includes("先") || (row.turn || "") === "First";
            const isSecond = (row.turn || "").includes("後") || (row.turn || "") === "Second";
            if (turn === '先攻' && !isFirst) return false;
            if (turn === '後攻' && !isSecond) return false;
        }

        if (currentTimeFilter === 'all') return true;
        const d = new Date(row.date); if (isNaN(d.getTime())) return false;
        const diffMs = now - d;
        if (currentTimeFilter === '1h') return diffMs <= 3600000;
        if (currentTimeFilter === '24h') return diffMs <= 86400000;
        if (currentTimeFilter === 'week') { const dN = now.getDay() || 7; const m = new Date(now); m.setHours(0, 0, 0, 0); m.setDate(now.getDate() - dN + 1); return d >= m; }
        if (currentTimeFilter === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        if (currentTimeFilter === 'custom') { const s = document.getElementById('dateStart').value ? new Date(document.getElementById('dateStart').value) : null; const e = document.getElementById('dateEnd').value ? new Date(document.getElementById('dateEnd').value) : null; if (s && d < s) return false; if (e && d > e) return false; return true; }
        return true;
    });
    renderStats();
}

function renderStats() {
    console.log("renderStats called. filteredData:", filteredData.length);
    const total = filteredData.length;
    // if (total === 0) block removed to ensure tables are always rendered with headers
    let wins = 0, coins = 0, totalSec = 0, countSec = 0;
    let firstTurnCount = 0, firstTurnWins = 0, secondTurnCount = 0, secondTurnWins = 0;
    const myStats = {}, oppStats = {};

    filteredData.forEach(d => {
        const isWin = (d.result || "").includes("WIN");
        if (isWin) wins++;
        if ((d.coin || "").includes("表")) coins++;

        const isFirst = (d.turn || "").includes("先") || (d.turn || "") === "First";
        const isSecond = (d.turn || "").includes("後") || (d.turn || "") === "Second";

        if (isFirst) {
            firstTurnCount++;
            if (isWin) firstTurnWins++;
        } else if (isSecond) {
            secondTurnCount++;
            if (isWin) secondTurnWins++;
        }

        const sec = parseDuration(d.duration); if (sec > 0) { totalSec += sec; countSec++; }

        const updateStat = (obj, key, win, time, isFirst, isSecond) => {
            if (!obj[key]) obj[key] = { t: 0, w: 0, timeSum: 0, timeCnt: 0, fT: 0, fW: 0, sT: 0, sW: 0 };
            obj[key].t++;
            if (win) obj[key].w++;
            if (time > 0) { obj[key].timeSum += time; obj[key].timeCnt++; }
            if (isFirst) {
                obj[key].fT++;
                if (win) obj[key].fW++;
            }
            if (isSecond) {
                obj[key].sT++;
                if (win) obj[key].sW++;
            }
        };
        updateStat(myStats, d.myDeck || "未設定", isWin, sec, isFirst, isSecond);
        updateStat(oppStats, d.oppDeck || "不明", isWin, sec, isFirst, isSecond);
    });

    const firstTurnRate = total > 0 ? Math.round((firstTurnCount / total) * 100) + "%" : "--%";
    const firstWinRate = firstTurnCount > 0 ? Math.round((firstTurnWins / firstTurnCount) * 100) + "%" : "--%";
    const secondWinRate = secondTurnCount > 0 ? Math.round((secondTurnWins / secondTurnCount) * 100) + "%" : "--%";

    document.getElementById('st_total').innerText = total;
    document.getElementById('st_winRate').innerText = Math.round((wins / total) * 100) + "%";
    document.getElementById('st_coin').innerText = Math.round((coins / total) * 100) + "%";
    document.getElementById('st_avgTime').innerText = countSec > 0 ? formatSeconds(Math.floor(totalSec / countSec)) : "-";

    if (document.getElementById('st_firstTurnRate')) document.getElementById('st_firstTurnRate').innerText = firstTurnRate;
    if (document.getElementById('st_firstWinRate')) document.getElementById('st_firstWinRate').innerText = firstWinRate;
    if (document.getElementById('st_secondWinRate')) document.getElementById('st_secondWinRate').innerText = secondWinRate;
    if (document.getElementById('st_firstMatches')) document.getElementById('st_firstMatches').innerText = firstTurnCount + "戦";
    if (document.getElementById('st_secondMatches')) document.getElementById('st_secondMatches').innerText = secondTurnCount + "戦";
    renderTable('tableMyDeck', myStats); renderTable('tableOppDeck', oppStats);
}

function renderTable(id, stats) {
    const t = document.getElementById(id);
    if (!t) return;
    const header = `<tr><th>デッキ</th><th>数</th><th>勝率</th><th>先攻率</th><th>平均時間</th></tr>`;
    const rows = Object.keys(stats).sort((a, b) => stats[b].t - stats[a].t).map(k => {
        const s = stats[k];
        const rate = Math.round((s.w / s.t) * 100) + "%";
        const avgT = s.timeCnt > 0 ? formatSeconds(Math.floor(s.timeSum / s.timeCnt)) : "-";
        const fRate = s.t > 0 ? Math.round((s.fT / s.t) * 100) + "%" : "-";
        const fWin = s.fT > 0 ? Math.round((s.fW / s.fT) * 100) + "%" : "-";
        const sWin = s.sT > 0 ? Math.round((s.sW / s.sT) * 100) + "%" : "-";

        const winRateDisplay = `
            <div>${rate}</div>
            <div style="font-size:0.8em; color:#aaa;">先:${fWin} / 後:${sWin}</div>
        `;

        return `<tr><td>${k}</td><td>${s.t}</td><td>${winRateDisplay}</td><td>${fRate}</td><td>${avgT}</td></tr>`;
    }).join('');
    t.innerHTML = header + rows;
}
function editLog(id) {
    const row = logData.find(r => r.id === id); if (!row) return;
    editingRowId = id;
    document.getElementById('editMyDeck').value = row.myDeck; document.getElementById('editOppDeck').value = row.oppDeck;
    document.getElementById('editTurn').value = (row.turn.includes("先") || row.turn === "First") ? "先攻" : "後攻";
    document.getElementById('editResult').value = (row.result || "").includes("WIN") ? "WIN" : "LOSE";
    document.getElementById('editMatchType').value = row.type || "ランクマッチ";
    document.getElementById('editModal').style.display = 'flex';
}
function closeModal() { document.getElementById('editModal').style.display = 'none'; }
async function submitEdit() {
    const row = logData.find(r => r.id === editingRowId);
    const payload = {
        action: 'update_log', id: editingRowId, startTime: row.date, endTime: row.date, duration: row.duration || 0,
        myDeck: document.getElementById('editMyDeck').value, oppDeck: document.getElementById('editOppDeck').value,
        coinToss: row.coin, turn: document.getElementById('editTurn').value, result: document.getElementById('editResult').value, matchType: document.getElementById('editMatchType').value
    };
    await fetch(GAS_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
    localStorage.setItem('md_refresh_signal', Date.now());
    closeModal(); setTimeout(loadData, CONFIG.TIMEOUTS.LOAD_DELAY);
}
function deleteLog(id) { if (confirm("削除しますか？")) { fetch(GAS_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'delete_log', id: id }) }); localStorage.setItem('md_refresh_signal', Date.now()); setTimeout(loadData, CONFIG.TIMEOUTS.LOAD_DELAY); } }

function saveFilter() {
    const s = document.getElementById('dateStart').value;
    const e = document.getElementById('dateEnd').value;
    const targetDoc = pipWindowRef ? pipWindowRef.document : document;
    showInputModal(targetDoc, "フィルタ名:", (name) => {
        if (name) {
            const saved = JSON.parse(localStorage.getItem('md_saved_filters') || "[]");
            saved.push({ name: name, start: s, end: e });
            localStorage.setItem('md_saved_filters', JSON.stringify(saved));
            renderSavedFilters();
        }
    });
}
function renderSavedFilters() { document.getElementById('savedFilters').innerHTML = (JSON.parse(localStorage.getItem('md_saved_filters') || "[]")).map((f, i) => `<span class="saved-tag" onclick="loadSavedFilter(${i})">${f.name}</span>`).join(""); }
function loadSavedFilter(i) { const f = JSON.parse(localStorage.getItem('md_saved_filters'))[i]; document.getElementById('dateStart').value = f.start; document.getElementById('dateEnd').value = f.end; setFilterTime('custom'); }

async function checkNewDeck(sel) {
    if (sel.value === "__NEW__") {
        const targetDoc = sel.ownerDocument;
        showInputModal(targetDoc, "デッキ名:", async (n) => {
            if (n) {
                await fetch(GAS_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'add_deck', newDeck: n }) });
                setTimeout(loadData, 2000);
                sel.value = n;
            } else {
                sel.value = "";
            }
        });
    }
    if (sel.id === 'myDeckSelect') localStorage.setItem('md_last_deck', sel.value);
}

// --- カスタム入力モーダル ---
function showInputModal(doc, message, callback) {
    const existing = doc.getElementById('customInputModal');
    if (existing) existing.remove();

    const modalOverlay = doc.createElement('div');
    modalOverlay.id = 'customInputModal';
    modalOverlay.style.position = 'fixed';
    modalOverlay.style.top = '0';
    modalOverlay.style.left = '0';
    modalOverlay.style.width = '100%';
    modalOverlay.style.height = '100%';
    modalOverlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
    modalOverlay.style.display = 'flex';
    modalOverlay.style.justifyContent = 'center';
    modalOverlay.style.alignItems = 'center';
    modalOverlay.style.zIndex = '10000';

    const modalContent = doc.createElement('div');
    modalContent.style.backgroundColor = '#2d2d2d';
    modalContent.style.padding = '20px';
    modalContent.style.borderRadius = '8px';
    modalContent.style.border = '1px solid #444';
    modalContent.style.minWidth = '250px';
    modalContent.style.textAlign = 'center';
    modalContent.style.color = '#fff';

    const msgP = doc.createElement('p');
    msgP.innerText = message;
    msgP.style.marginBottom = '10px';
    modalContent.appendChild(msgP);

    const input = doc.createElement('input');
    input.type = 'text';
    input.style.width = '100%';
    input.style.padding = '8px';
    input.style.marginBottom = '15px';
    input.style.backgroundColor = '#1a1a1a';
    input.style.border = '1px solid #555';
    input.style.color = '#fff';
    input.style.borderRadius = '4px';
    modalContent.appendChild(input);

    const btnContainer = doc.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.justifyContent = 'flex-end';
    btnContainer.style.gap = '10px';

    const btnCancel = doc.createElement('button');
    btnCancel.innerText = 'キャンセル';
    btnCancel.style.padding = '5px 10px';
    btnCancel.style.backgroundColor = '#555';
    btnCancel.style.color = '#fff';
    btnCancel.style.border = 'none';
    btnCancel.style.borderRadius = '4px';
    btnCancel.style.cursor = 'pointer';
    btnCancel.onclick = () => {
        modalOverlay.remove();
        callback(null);
    };

    const btnOk = doc.createElement('button');
    btnOk.innerText = 'OK';
    btnOk.style.padding = '5px 10px';
    btnOk.style.backgroundColor = '#4caf50';
    btnOk.style.color = '#fff';
    btnOk.style.border = 'none';
    btnOk.style.borderRadius = '4px';
    btnOk.style.cursor = 'pointer';
    btnOk.onclick = () => {
        const val = input.value;
        modalOverlay.remove();
        callback(val);
    };

    btnContainer.appendChild(btnCancel);
    btnContainer.appendChild(btnOk);
    modalContent.appendChild(btnContainer);
    modalOverlay.appendChild(modalContent);
    doc.body.appendChild(modalOverlay);

    input.focus();
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            btnOk.click();
        }
    };
}

function log(m, t = "info") { const b = document.getElementById('logs'); const c = t === "important" ? "#ff0" : t === "raw" ? "#555" : "#0f0"; b.innerHTML = `<span style="color:${c}">[${new Date().toLocaleTimeString()}] ${m}</span><br>` + b.innerHTML; }

async function startSystem() {
    if (!GAS_URL) return alert("URL未設定");
    document.getElementById('btnStartSystem').disabled = true; log("起動...", "important");
    try {
        if (!worker) { worker = await Tesseract.createWorker(); await worker.loadLanguage('eng+jpn'); await worker.initialize('eng+jpn'); log("OCR準備完了", "important"); }
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "never" } });
        const video = document.getElementById('video'); video.srcObject = stream;

        // Initialize WebGL
        const canvas = document.getElementById('displayCanvas');
        if (!webglManager.init(canvas)) {
            alert("WebGL initialization failed. Check console.");
            return;
        }

        video.onloadedmetadata = () => { video.play(); loop(); };
    } catch (e) { document.getElementById('btnStartSystem').disabled = false; }
}

function determinePhase() {
    if (isDeterminingTurn) return "TURN";
    if (isGameActive) return "GAME";
    return "WAIT";
}

function updateOverlay(guide, phase) {
    if (!guide) return;
    const roi = CONFIG.ROI[phase];
    guide.style.left = (roi.x * 100) + "%";
    guide.style.width = (roi.w * 100) + "%";
    guide.style.top = (roi.y * 100) + "%";
    guide.style.height = (roi.h * 100) + "%";

    if (phase === "TURN") {
        guide.style.borderColor = "#ff0";
        if (document.getElementById('monitorMode')) document.getElementById('monitorMode').innerText = "手番判定中 (黄色文字)";
    } else if (phase === "GAME") {
        guide.style.borderColor = "#f00";
        if (document.getElementById('monitorMode')) document.getElementById('monitorMode').innerText = "試合中 (中央監視)";
    } else {
        guide.style.borderColor = "#0f0";
        if (document.getElementById('monitorMode')) document.getElementById('monitorMode').innerText = "待機中 (下部監視)";
    }
}

// applyImageFilter removed (replaced by WebGL)

async function updateOCRMode(phase) {
    const desiredMode = (phase === "GAME") ? "RESTRICTED" : "ALL";
    if (currentOCRMode !== desiredMode) {
        if (desiredMode === "RESTRICTED") {
            await worker.setParameters({ tessedit_char_whitelist: CONFIG.OCR.WHITELIST_RESTRICTED });
            log("OCRモード: 限定 (英数字+勝敗)", "raw");
        } else {
            await worker.setParameters({ tessedit_char_whitelist: CONFIG.OCR.WHITELIST_ALL });
            log("OCRモード: 全開放 (日本語含む)", "raw");
        }
        currentOCRMode = desiredMode;
    }
}

async function loop() {
    if (!stream || !stream.active) return;
    if (isProcessing) { requestAnimationFrame(loop); return; }
    const video = document.getElementById('video');
    if (video.videoWidth === 0) { requestAnimationFrame(loop); return; }
    isProcessing = true;

    try {
        const canvas = document.getElementById('displayCanvas');
        // const ctx = canvas.getContext('2d'); // Removed for WebGL
        const guide = document.getElementById('cropGuide');

        // 1. Determine Phase
        const phase = determinePhase();

        // 2. Timeout Check (Specific to TURN phase)
        if (phase === "TURN" && Date.now() - turnDetectStartTime > CONFIG.TIMEOUTS.TURN_DETECT) {
            log("手番判定タイムアウト: 判定モードを終了します", "important");
            isDeterminingTurn = false;
            // Continue processing this frame as normal (will switch to GAME or WAIT next loop)
        }

        // 3. Update Overlay & UI
        updateOverlay(guide, phase);

        // 4. Capture & Crop Image
        const roi = CONFIG.ROI[phase];
        const cX = video.videoWidth * roi.x;
        const cY = video.videoHeight * roi.y;
        const cW = video.videoWidth * roi.w;
        const cH = video.videoHeight * roi.h;

        const scale = roi.scale || 1.0;
        const targetW = Math.floor(cW * scale);
        const targetH = Math.floor(cH * scale);
        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW; canvas.height = targetH;
        }

        // 5. WebGL Processing
        webglManager.updateTexture(video);
        webglManager.applyFilter(phase, isGameActive, roi);

        // 6. OCR
        await updateOCRMode(phase);
        const ret = await worker.recognize(webglManager.getCanvas());
        const txt = ret.data.text.replace(/\s+/g, "").toUpperCase();

        if (txt.length > 1) {
            log("OCR: " + txt, "raw");
            analyze(txt);
        }

    } catch (e) {
        console.error(e);
    } finally {
        isProcessing = false;
        setTimeout(loop, isDeterminingTurn ? CONFIG.TIMEOUTS.LOOP_FAST : CONFIG.TIMEOUTS.LOOP_SLOW);
    }
}

function analyze(t) {
    // 1. Turn Detection Mode
    if (isDeterminingTurn) {
        if (t.includes("先攻")) {
            setTurn("先攻", "手番判定: 先攻");
            manualStart(); // Confirm game start (already active, but resets determining flag)
            return;
        }
        if (t.includes("後攻")) {
            setTurn("後攻", "手番判定: 後攻");
            manualStart();
            return;
        }
        // Fail-safe: if we see game elements, assume we missed it and stop detection
        if (t.includes("LP8000") || t.includes("DRAW") || t.includes("TURN")) {
            log("手番判定スキップ: 試合要素検知", "important");
            manualStart();
            return;
        }
        return;
    }

    // 2. Waiting Mode (Coin Toss)
    if (!isGameActive && !isDeterminingTurn) {
        if ((t.includes("相手") || t.includes("対戦")) && t.includes("選択")) {
            setCoin("裏", "コイン: 裏 (相手選択)");
            startTurnDetection();
        }
        else if (t.includes("選択") || t.includes("先攻") || t.includes("後攻")) {
            if (t.includes("選択")) {
                setCoin("表", "コイン: 表 (自分選択)");
                startTurnDetection();
            }
            // Irregular case: Direct detection of Turn without Coin Toss screen
            else if (t.includes("先攻") || t.includes("後攻")) {
                log("手番判定モードへ直接移行", "important");
                startTurnDetection();
            }
        }
        // Direct Game Start detection
        else if (t.includes("LP8000") || t.includes("TURN") || t.includes("DRAW")) {
            manualStart();
        }
    }

    // 3. Game Active (Result)
    if (isGameActive) {
        if (Date.now() - lastResultTime < CONFIG.TIMEOUTS.RESULT_COOLDOWN) return;
        // Garbage filter: Result text should be short (WIN/LOSE/VICTORY).
        // If text is too long, it's likely noise.
        if (t.length > 13) return;

        if (t.includes("CLOSE")) return;
        if (t.includes("VICTORY") || t.includes("VICTDRY") || t.includes("VICT0RY") || t.includes("VIGTORY") || t.includes("VlCTORY") || t.includes("勝利")) finish("WIN", t);
        else if (/[LI1|][O0DQ][S5$B8][E3F]/.test(t) || t.includes("DEFEAT") || t.includes("敗北")) finish("LOSE", t);
    }
}

function startTurnDetection() {
    if (isDeterminingTurn) return;
    isDeterminingTurn = true;
    turnDetectStartTime = Date.now();

    // Start Game Timer immediately (User Request)
    if (!isGameActive) {
        isGameActive = true;
        gameStartTime = Date.now();
        startTimer();
        updateUI();
        log("試合開始 (手番判定中...)", "important");
    }

    if (document.getElementById('monitorMode')) document.getElementById('monitorMode').innerText = "手番判定中 (黄色文字)";
}

function setCoin(c, msg) {
    if (currentCoin !== c) {
        currentCoin = c;
        log(msg, "important");
        updateUI();
    }
}

function setTurn(tr, msg) {
    const tE = getUI('turnOrder');
    if (tE) tE.value = tr;
    log(msg, "important");
    updateUI();
}

function manualStart() {
    isDeterminingTurn = false; // Stop turn detection
    if (!isGameActive) {
        isGameActive = true;
        gameStartTime = Date.now();
        startTimer();
        updateUI();
        log("試合開始", "important");
    }
}

function finish(r, w) {
    lastResultTime = Date.now(); const sec = Math.floor((lastResultTime - gameStartTime) / 1000); log(`決着:${r}`, "important");

    const myD = getUI('myDeckSelect') ? getUI('myDeckSelect').value : "";
    const oppD = getUI('oppDeckSelect') ? getUI('oppDeckSelect').value : "";
    const turn = getUI('turnOrder') ? getUI('turnOrder').value : "";
    const type = getUI('matchType') ? getUI('matchType').value : "";

    const p = {
        action: 'record', startTime: new Date(gameStartTime).toLocaleString('ja-JP'), endTime: new Date(lastResultTime).toLocaleString('ja-JP'),
        duration: sec, myDeck: myD, oppDeck: oppD, coinToss: currentCoin, turn: turn, result: r, matchType: type
    };
    fetch(GAS_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(p) }).then(() => { showToast("記録しました"); localStorage.setItem('md_refresh_signal', Date.now()); resetGame(); setTimeout(loadData, 2000); });
}

function resetGame() {
    isGameActive = false; isDeterminingTurn = false; currentCoin = "不明";
    const tE = getUI('turnOrder'); if (tE) tE.value = "Unknown";
    const oE = getUI('oppDeckSelect'); if (oE) oE.value = "";
    stopTimer(); updateUI();
}

function startTimer() { if (timerInterval) clearInterval(timerInterval); timerInterval = setInterval(() => { const s = Math.floor((Date.now() - gameStartTime) / 1000); document.getElementById('timeVal').innerText = s + "s"; const pT = getUI('pip_time'); if (pT) pT.innerText = s + "s"; }, 1000); }
function stopTimer() { if (timerInterval) clearInterval(timerInterval); document.getElementById('timeVal').innerText = "0s"; const pT = getUI('pip_time'); if (pT) pT.innerText = "0s"; }

function updateUI() {
    const txt = isGameActive ? "試合中" : "待機中"; const cls = isGameActive ? "status-badge active-badge" : "status-badge";
    document.getElementById('stateBadge').innerText = txt; document.getElementById('stateBadge').className = cls; document.getElementById('coinVal').innerText = currentCoin;
    const pS = getUI('pip_state'); if (pS) { pS.innerText = txt; pS.style.color = isGameActive ? "#ff5252" : "#aaa"; }
    const pC = getUI('pip_coin'); if (pC) pC.innerText = `Coin: ${currentCoin}`;
}

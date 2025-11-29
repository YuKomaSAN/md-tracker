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
const TURN_DETECT_TIMEOUT_MS = 15000;
let currentOCRMode = "ALL";

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

    // Main Controls
    const btnStartSystem = document.getElementById('btnStartSystem');
    if (btnStartSystem) btnStartSystem.addEventListener('click', startSystem);

    const btnOpenPiP = document.getElementById('btnOpenPiP');
    if (btnOpenPiP) btnOpenPiP.addEventListener('click', togglePiP);

    const btnResetSession = document.getElementById('btnResetSession');
    if (btnResetSession) btnResetSession.addEventListener('click', resetSession);

    // PiP Placeholder
    const btnClosePiP = document.getElementById('btnClosePiP');
    if (btnClosePiP) btnClosePiP.addEventListener('click', closePiP);

    // Recent & History Refresh
    const btnRefreshRecent = document.getElementById('btnRefreshRecent');
    if (btnRefreshRecent) btnRefreshRecent.addEventListener('click', loadData);

    const btnRefreshHistory = document.getElementById('btnRefreshHistory');
    if (btnRefreshHistory) btnRefreshHistory.addEventListener('click', loadData);

    // Filter
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

    // Portable Controls (handled separately for PiP support)
    setupPortableListeners(document);
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
        // 初期サイズ設定 (横長は1150px, 縦長は320px)
        const width = pipLayoutMode === 'landscape' ? 1150 : 320;
        const height = pipLayoutMode === 'landscape' ? 170 : 650;

        const pipWin = await documentPictureInPicture.requestWindow({ width: width, height: height });
        pipWindowRef = pipWin;
        log("PiPウィンドウ作成成功");

        // requestWindowはInnerサイズを指定するが、resizeToはOuterサイズを指定する。
        // レイアウト変更時(resizeTo使用)とサイズ感を合わせるため、ここでresizeToを呼ぶ。
        // 即時実行だと効かない場合があるため、少し遅延させる
        setTimeout(() => {
            try {
                pipWin.resizeTo(width, height);
                log("PiPリサイズ実行(遅延)");
            } catch (e) {
                console.error("Resize failed:", e);
                log("PiPリサイズ失敗: " + e);
            }
        }, 100);

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
            const targetWidth = 1150;
            const screenW = pipWindowRef.screen.availWidth;

            if (currentX + targetWidth > screenW) {
                const newX = Math.max(0, screenW - targetWidth - 50);
                pipWindowRef.moveTo(newX, pipWindowRef.screenY);
            }

            pipWindowRef.resizeTo(1150, 170);
            pipWindowRef.document.body.classList.add('landscape');
        } else {
            // → 縦長へ変更 (Portrait)
            pipLayoutMode = 'portrait';

            // 画面からはみ出さないように位置調整
            const currentY = pipWindowRef.screenY;
            const targetHeight = 650;
            const screenH = pipWindowRef.screen.availHeight;

            if (currentY + targetHeight > screenH) {
                const newY = Math.max(0, screenH - targetHeight - 50);
                pipWindowRef.moveTo(pipWindowRef.screenX, newY);
            }

            // 即時リサイズ実行
            pipWindowRef.resizeTo(320, 650);
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
    if (!GAS_URL) return;
    const cbName = 'cb_' + Date.now();
    window[cbName] = (data) => {
        logData = data.logs || []; deckList = data.decks || [];
        updateSelectors();
        if (!document.body.classList.contains("compact-mode")) { renderHome(); renderHistory(); applyFilter(); } else { renderHome(); }
        delete window[cbName]; document.body.removeChild(document.getElementById(cbName));
    };
    const script = document.createElement('script');
    script.src = `${GAS_URL}?callback=${cbName}&nocache=${Date.now()}`;
    document.body.appendChild(script);
}

function updateSelectors() {
    const ids = ['myDeckSelect', 'oppDeckSelect', 'editMyDeck', 'editOppDeck'];
    ids.forEach(id => {
        const el = id.startsWith('edit') ? document.getElementById(id) : getUI(id);
        if (!el) return;
        const current = el.value; el.innerHTML = `<option value="">(選択なし)</option>`;
        deckList.forEach(d => el.innerHTML += `<option value="${d}">${d}</option>`);
        if (id.includes('Select')) el.innerHTML += `<option value="__NEW__" style="color:#4da3ff;">＋ 新規追加...</option>`;
        if (current && deckList.includes(current)) el.value = current;
    });
    const last = localStorage.getItem('md_last_deck');
    const myDeckSel = getUI('myDeckSelect');
    if (last && deckList.includes(last) && myDeckSel && !myDeckSel.value) myDeckSel.value = last;
}

// --- ホーム画面 ---
function renderHome() {
    const sessionData = sessionStartTime > 0 ? logData.filter(d => new Date(d.date).getTime() >= sessionStartTime) : logData;
    const labelText = sessionStartTime > 0 ? "勝率 (セッション)" : "勝率 (全期間)";
    if (document.getElementById('lbl_winRate')) document.getElementById('lbl_winRate').innerText = labelText;

    const total = sessionData.length;
    let wins = 0, coins = 0, totalSec = 0, countSec = 0;
    if (total > 0) {
        sessionData.forEach(d => {
            const r = d.result || ""; if (r.includes("WIN")) wins++; if ((d.coin || "").includes("表")) coins++;
            const sec = parseDuration(d.duration); if (sec > 0) { totalSec += sec; countSec++; }
        });
    }
    const winRate = total > 0 ? Math.round((wins / total) * 100) + "%" : "--%";
    const coinRate = total > 0 ? Math.round((coins / total) * 100) + "%" : "--%";
    const avgTime = countSec > 0 ? formatSeconds(Math.floor(totalSec / countSec)) : "-";

    if (document.getElementById('db_winRate')) { document.getElementById('db_winRate').innerText = winRate; document.getElementById('db_totalMatches').innerText = total + "戦"; document.getElementById('db_coinRate').innerText = coinRate; document.getElementById('db_avgTime').innerText = avgTime; }

    const pipT = getUI('pip_total');
    if (pipT) { pipT.innerText = total; getUI('pip_win').innerText = winRate; getUI('pip_coin_r').innerText = coinRate; }

    if (document.getElementById('recentTable')) {
        const recent = logData.slice(0, 10);
        const tbody = document.querySelector("#recentTable tbody"); tbody.innerHTML = "";
        recent.forEach(row => {
            const tr = document.createElement("tr");
            const res = row.result || "-"; const resClass = res.includes("WIN") ? "win" : "lose"; const timeStr = toTimeStr(row.duration);
            tr.innerHTML = `<td>${row.myDeck}</td><td>${row.oppDeck || "-"}</td><td>${row.turn}</td><td>${timeStr}</td><td class="${resClass}">${res}</td><td><button onclick="editLog(${row.id})" style="padding:2px 6px; font-size:0.8em;">編集</button> <button onclick="deleteLog(${row.id})" style="padding:2px 6px; font-size:0.8em; background:#d32f2f;">削除</button></td>`;
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
        tr.innerHTML = `<td>${dateStr}</td><td>${row.type || "-"}</td><td>${row.myDeck}</td><td>${row.oppDeck || "-"}</td><td>${row.turn}</td><td>${timeStr}</td><td class="${resClass}">${res}</td><td><button onclick="editLog(${row.id})" style="padding:2px 6px; font-size:0.8em;">編集</button> <button onclick="deleteLog(${row.id})" style="padding:2px 6px; font-size:0.8em; background:#d32f2f;">削除</button></td>`;
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

function applyFilter() {
    const now = new Date(); const matchType = document.getElementById('filterMatchType').value;
    filteredData = logData.filter(row => {
        if (matchType !== 'all' && row.type !== matchType) return false;
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
    const total = filteredData.length;
    if (total === 0) { document.getElementById('st_total').innerText = "0"; document.getElementById('st_winRate').innerText = "0%"; document.getElementById('st_avgTime').innerText = "-"; document.getElementById('tableMyDeck').innerHTML = ""; document.getElementById('tableOppDeck').innerHTML = ""; return; }
    let wins = 0, coins = 0, totalSec = 0, countSec = 0; const myStats = {}, oppStats = {};
    filteredData.forEach(d => {
        const isWin = (d.result || "").includes("WIN"); if (isWin) wins++; if ((d.coin || "").includes("表")) coins++;
        const sec = parseDuration(d.duration); if (sec > 0) { totalSec += sec; countSec++; }
        const updateStat = (obj, key, win, time) => { if (!obj[key]) obj[key] = { t: 0, w: 0, timeSum: 0, timeCnt: 0 }; obj[key].t++; if (win) obj[key].w++; if (time > 0) { obj[key].timeSum += time; obj[key].timeCnt++; } };
        updateStat(myStats, d.myDeck || "未設定", isWin, sec); updateStat(oppStats, d.oppDeck || "不明", isWin, sec);
    });
    document.getElementById('st_total').innerText = total; document.getElementById('st_winRate').innerText = Math.round((wins / total) * 100) + "%"; document.getElementById('st_coin').innerText = Math.round((coins / total) * 100) + "%"; document.getElementById('st_avgTime').innerText = countSec > 0 ? formatSeconds(Math.floor(totalSec / countSec)) : "-";
    renderTable('tableMyDeck', myStats); renderTable('tableOppDeck', oppStats);
}

function renderTable(id, stats) {
    const t = document.getElementById(id); t.innerHTML = `<tr><th>デッキ</th><th>数</th><th>勝率</th><th>平均時間</th></tr>`;
    Object.keys(stats).sort((a, b) => stats[b].t - stats[a].t).forEach(k => {
        const s = stats[k]; const rate = Math.round((s.w / s.t) * 100) + "%"; const avgT = s.timeCnt > 0 ? formatSeconds(Math.floor(s.timeSum / s.timeCnt)) : "-";
        t.innerHTML += `<tr><td>${k}</td><td>${s.t}</td><td>${rate}</td><td>${avgT}</td></tr>`;
    });
}

let editingRowId = null;
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
    closeModal(); setTimeout(loadData, 1500);
}
function deleteLog(id) { if (confirm("削除しますか？")) { fetch(GAS_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'delete_log', id: id }) }); localStorage.setItem('md_refresh_signal', Date.now()); setTimeout(loadData, 1500); } }

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
        video.onloadedmetadata = () => { video.play(); loop(); };
    } catch (e) { document.getElementById('btnStartSystem').disabled = false; }
}

async function loop() {
    if (!stream || !stream.active) return;
    if (isProcessing) { requestAnimationFrame(loop); return; }
    const video = document.getElementById('video');
    if (video.videoWidth === 0) { requestAnimationFrame(loop); return; }
    isProcessing = true;
    try {
        const canvas = document.getElementById('displayCanvas'); const ctx = canvas.getContext('2d'); const guide = document.getElementById('cropGuide');
        let cX, cY, cW, cH;
        let filterType = "standard";

        // Determine Phase
        let phase = "WAIT";
        if (isDeterminingTurn) phase = "TURN";
        else if (isGameActive) phase = "GAME";

        // Priority 1: Turn Detection Mode
        if (phase === "TURN") {
            // Top 58%, Height 12%, Left 30%, Width 40% (Verified settings)
            cX = video.videoWidth * 0.30;
            cW = video.videoWidth * 0.40;
            cY = video.videoHeight * 0.58;
            cH = video.videoHeight * 0.12;
            filterType = "yellow_boost";

            if (guide) {
                guide.style.left = "30%"; guide.style.width = "40%";
                guide.style.top = "58%"; guide.style.height = "12%";
                guide.style.borderColor = "#ff0"; // Yellow guide
            }
            if (document.getElementById('monitorMode')) document.getElementById('monitorMode').innerText = "手番判定中 (黄色文字)";

            // Timeout Check
            if (Date.now() - turnDetectStartTime > TURN_DETECT_TIMEOUT_MS) {
                log("手番判定タイムアウト: 判定モードを終了します", "important");
                isDeterminingTurn = false;
                // Game is already active, so just return to normal monitoring
            }
        }
        // Priority 2: Game Active (Normal Monitoring)
        else if (phase === "GAME") {
            cX = 0; cW = video.videoWidth; cY = video.videoHeight * 0.33; cH = video.videoHeight * 0.34;
            filterType = "standard";
            if (guide) { guide.style.left = "0%"; guide.style.width = "100%"; guide.style.top = "33%"; guide.style.height = "34%"; guide.style.borderColor = "#f00"; }
            if (document.getElementById('monitorMode')) document.getElementById('monitorMode').innerText = "試合中 (中央監視)";
        }
        // Priority 3: Waiting (Coin Toss Monitoring)
        else {
            cX = video.videoWidth * 0.33; cW = video.videoWidth * 0.33; cY = video.videoHeight * 0.63; cH = video.videoHeight * 0.10;
            filterType = "standard";
            if (guide) { guide.style.left = "33%"; guide.style.width = "33%"; guide.style.top = "63%"; guide.style.height = "10%"; guide.style.borderColor = "#0f0"; }
            if (document.getElementById('monitorMode')) document.getElementById('monitorMode').innerText = "待機中 (下部監視)";
        }

        // Canvas Resize (Match crop size for full resolution)
        const targetW = Math.floor(cW);
        const targetH = Math.floor(cH);
        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW; canvas.height = targetH;
        }

        ctx.drawImage(video, cX, cY, cW, cH, 0, 0, canvas.width, canvas.height);

        let imgD = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let d = imgD.data;

        if (filterType === "yellow_boost") {
            // Yellow Boost Filter
            for (let i = 0; i < d.length; i += 4) {
                const r = d[i]; const g = d[i + 1]; const b = d[i + 2];
                const yellowScore = (r + g) / 2 - b;
                const val = yellowScore > 40 ? 255 : 0;
                d[i] = d[i + 1] = d[i + 2] = val;
            }
        } else {
            // Standard Filter
            let th = isGameActive ? 172 : 72; let cont = isGameActive ? 0 : 105;
            const f = (259 * (cont + 255)) / (255 * (259 - cont));
            for (let i = 0; i < d.length; i += 4) {
                let g = (d[i] + d[i + 1] + d[i + 2]) / 3;
                if (cont !== 0) g = f * (g - 128) + 128;
                const c = g > th ? 255 : 0;
                d[i] = d[i + 1] = d[i + 2] = c;
            }
        }
        ctx.putImageData(imgD, 0, 0);

        // Dynamic OCR Mode Switching
        // Sync with phase: Only restrict in "GAME" phase
        const desiredMode = (phase === "GAME") ? "RESTRICTED" : "ALL";
        if (currentOCRMode !== desiredMode) {
            if (desiredMode === "RESTRICTED") {
                await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789勝利敗北' });
                log("OCRモード: 限定 (英数字+勝敗)", "raw");
            } else {
                await worker.setParameters({ tessedit_char_whitelist: '' });
                log("OCRモード: 全開放 (日本語含む)", "raw");
            }
            currentOCRMode = desiredMode;
        }

        const ret = await worker.recognize(canvas);
        const txt = ret.data.text.replace(/\s+/g, "").toUpperCase();
        if (txt.length > 1) log("OCR: " + txt, "raw");
        if (txt.length > 1) analyze(txt);
    } catch (e) { console.error(e); } finally {
        isProcessing = false;
        // Faster loop during turn detection
        setTimeout(loop, isDeterminingTurn ? 50 : 300);
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
        if (Date.now() - lastResultTime < 10000) return;
        if (t.includes("CLOSE")) return;
        if (t.includes("VICTORY") || t.includes("VICTDRY") || t.includes("VICT0RY") || t.includes("VIGTORY") || t.includes("VlCTORY") || t.includes("勝利")) finish("WIN", t);
        else if (t.includes("LOSE") || t.includes("L0SE") || t.includes("LDSE") || t.includes("DEFEAT") || t.includes("敗北") || t.includes("LOBE")) finish("LOSE", t);
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
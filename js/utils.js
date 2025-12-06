// Configuration and Utilities

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

// --- 共通ユーティリティ ---
function showToast(msg) {
    const t = document.getElementById("toast");
    t.innerText = msg;
    t.className = "show";
    setTimeout(function () { t.className = t.className.replace("show", ""); }, 3000);
}

function parseDuration(val) {
    if (val === undefined || val === null || val === "") return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        if (!isNaN(Number(val))) return Number(val);
        const m = val.match(/(\d+)分(\d+)秒/);
        if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
    } return 0;
}

function formatSeconds(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}分${String(s).padStart(2, '0')}秒`;
}

function toTimeStr(val) {
    const sec = parseDuration(val);
    return sec > 0 ? formatSeconds(sec) : "-";
}

function log(m, t = "info") {
    const b = document.getElementById('logs');
    if (!b) return;
    const c = t === "important" ? "#ff0" : t === "raw" ? "#555" : "#0f0";
    b.innerHTML = `<span style="color:${c}">[${new Date().toLocaleTimeString()}] ${m}</span><br>` + b.innerHTML;
}

function saveUrl() {
    const val = document.getElementById('gasUrlInput').value;
    localStorage.setItem('md_tracker_url', val);
    GAS_URL = val;
    showToast("保存しました");
    loadData();
}

// --- データロード ---
function loadData(isManual = false) {
    if (!GAS_URL) { showToast("GAS URLが設定されていません"); return; }

    // Safety check: Don't overwrite recent local changes with potentially stale server data
    if (!isManual && (Date.now() - lastLocalUpdateTime < 5000)) return;

    const cbName = 'cb_' + Date.now();
    window[cbName] = (data) => {
        logData = data.logs || []; deckList = data.decks || [];
        renderSelects(document);
        if (pipWindowRef) renderSelects(pipWindowRef.document);

        // Restore last deck (Moved inside callback to ensure deckList is ready)
        const last = localStorage.getItem('md_last_deck');
        const myDeckSel = document.getElementById('myDeckSelect');
        if (last && deckList.includes(last) && myDeckSel && !myDeckSel.value) {
            myDeckSel.value = last;
        }

        if (!document.body.classList.contains("compact-mode")) {
            renderHome();
            renderHistory();
            if (typeof applyFilter === 'function') applyFilter();
        } else {
            renderHome();
        }
        delete window[cbName];
        const scriptTag = document.getElementById(cbName);
        if (scriptTag) document.body.removeChild(scriptTag);
    };
    const script = document.createElement('script');
    script.id = cbName;
    script.src = `${GAS_URL}?callback=${cbName}&nocache=${Date.now()}`;
    document.body.appendChild(script);
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

        if (!id.startsWith('filter')) {
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

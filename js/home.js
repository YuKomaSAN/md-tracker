// Home Tab & Game Logic

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

function resetSession() {
    const now = Date.now();
    localStorage.setItem('md_session_start', now);
    sessionStartTime = now;
    showToast("ここからの成績を集計します");
    renderHome();
}

// --- Game Control Logic ---

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

function resetGame() {
    isGameActive = false; isDeterminingTurn = false; currentCoin = "不明";
    const tE = getUI('turnOrder'); if (tE) tE.value = "Unknown";
    const oE = getUI('oppDeckSelect'); if (oE) oE.value = "";
    stopTimer(); updateUI();
}

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const s = Math.floor((Date.now() - gameStartTime) / 1000);
        document.getElementById('timeVal').innerText = s + "s";
        const pT = getUI('pip_time');
        if (pT) pT.innerText = s + "s";
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    document.getElementById('timeVal').innerText = "0s";
    const pT = getUI('pip_time');
    if (pT) pT.innerText = "0s";
}

function updateUI() {
    const txt = isGameActive ? "試合中" : "待機中";
    const cls = isGameActive ? "status-badge active-badge" : "status-badge";
    document.getElementById('stateBadge').innerText = txt;
    document.getElementById('stateBadge').className = cls;
    document.getElementById('coinVal').innerText = currentCoin;
    const pS = getUI('pip_state');
    if (pS) {
        pS.innerText = txt;
        pS.style.color = isGameActive ? "#ff5252" : "#aaa";
    }
    const pC = getUI('pip_coin');
    if (pC) pC.innerText = `Coin: ${currentCoin}`;
}

function finish(r, w) {
    lastResultTime = Date.now();
    const sec = Math.floor((lastResultTime - gameStartTime) / 1000);
    log(`決着:${r}`, "important");

    const myD = getUI('myDeckSelect') ? getUI('myDeckSelect').value : "";
    const oppD = getUI('oppDeckSelect') ? getUI('oppDeckSelect').value : "";
    const turn = getUI('turnOrder') ? getUI('turnOrder').value : "";
    const type = getUI('matchType') ? getUI('matchType').value : "";
    const coin = currentCoin; // Capture currentCoin before reset

    // 1. Construct new row for local update
    // Use ISO string or similar consistent format if possible, but existing code uses toLocaleString('ja-JP')
    const nowStr = new Date(lastResultTime).toLocaleString('ja-JP');

    const newRow = {
        action: 'record', // Technically not part of row data but harmless
        startTime: new Date(gameStartTime).toLocaleString('ja-JP'),
        endTime: nowStr,
        date: new Date(gameStartTime).toISOString(), // Used for sorting in renderHome
        duration: sec,
        myDeck: myD,
        oppDeck: oppD,
        coin: coin, // Note: payload uses 'coinToss', local uses 'coin' (mapped in utils.js/gas) - wait, gas uses 'coinToss' in payload but row[4] is 'coin'. utils.js loadData maps row[4] to 'coin'.
        // Let's use 'coin' for local display consistency.
        turn: turn,
        result: r,
        type: type // Maps to 'matchType' in payload
    };

    // 2. Update UI Immediately
    optimisticAdd(newRow);
    showToast("記録しました (同期中...)");
    resetGame();

    // 3. Send to Backend (Background)
    const payload = {
        action: 'record',
        startTime: newRow.startTime,
        endTime: newRow.endTime,
        duration: sec,
        myDeck: myD,
        oppDeck: oppD,
        coinToss: coin,
        turn: turn,
        result: r,
        matchType: type
    };

    fetch(GAS_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) })
        .catch(e => console.error("Sync failed", e));

    // 4. No Reload
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

// Monitor Tab & OCR Logic

async function startSystem() {
    if (!GAS_URL) return alert("URL未設定");
    document.getElementById('btnStartSystem').disabled = true;
    log("起動...", "important");
    try {
        if (!worker) {
            worker = await Tesseract.createWorker();
            await worker.loadLanguage('eng+jpn');
            await worker.initialize('eng+jpn');
            log("OCR準備完了", "important");
        }
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "never" } });
        const video = document.getElementById('video');
        video.srcObject = stream;

        // Initialize WebGL
        const canvas = document.getElementById('displayCanvas');
        if (!webglManager.init(canvas)) {
            alert("WebGL initialization failed. Check console.");
            return;
        }

        video.onloadedmetadata = () => { video.play(); loop(); };
    } catch (e) {
        document.getElementById('btnStartSystem').disabled = false;
    }
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

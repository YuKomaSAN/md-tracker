let worker = null;
let stream = null;
let isProcessing = false;

// State
let isGameActive = false;
let isDeterminingTurn = false;
let currentCoin = "Unknown";
let currentTurn = "Unknown";
let lastResultTime = 0;

// Config
const TURN_DETECT_TIMEOUT_MS = 15000;
let turnDetectStartTime = 0;

window.onload = async () => {
    log("Initializing Tesseract...");
    worker = await Tesseract.createWorker();
    await worker.loadLanguage('eng+jpn');
    await worker.initialize('eng+jpn');
    log("Tesseract Ready.");

    document.getElementById('btnStart').onclick = startCapture;
    document.getElementById('btnReset').onclick = resetState;
};

async function startCapture() {
    try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "never" } });
        const video = document.getElementById('video');
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
            loop();
        };
        log("Capture started.");
    } catch (e) {
        console.error(e);
        log("Error starting capture: " + e.message);
    }
}

function resetState() {
    isGameActive = false;
    isDeterminingTurn = false;
    currentCoin = "Unknown";
    currentTurn = "Unknown";
    updateUI();
    log("State Reset.");
}

async function loop() {
    if (!stream || !stream.active) return;
    if (isProcessing) { requestAnimationFrame(loop); return; }

    const video = document.getElementById('video');
    if (video.videoWidth === 0) { requestAnimationFrame(loop); return; }

    isProcessing = true;
    try {
        const canvas = document.getElementById('displayCanvas');
        const ctx = canvas.getContext('2d');

        // Determine Crop & Filter based on State
        let cX, cY, cW, cH;
        let filterType = "standard"; // standard, yellow_boost

        if (isDeterminingTurn) {
            // Turn Detection Mode (Yellow Text Focus)
            // Adjusted based on user feedback: Avoid capturing selection buttons below
            // Top 58%, Height 12%, Left 30%, Width 40%
            cX = video.videoWidth * 0.30;
            cW = video.videoWidth * 0.40;
            cY = video.videoHeight * 0.58;
            cH = video.videoHeight * 0.12;
            filterType = "yellow_boost";

            // Timeout check
            if (Date.now() - turnDetectStartTime > TURN_DETECT_TIMEOUT_MS) {
                log("Turn detection timed out. Starting game anyway.");
                manualStart();
            }
        } else if (isGameActive) {
            // Game Mode (Center/Win/Lose)
            cX = 0;
            cW = video.videoWidth;
            cY = video.videoHeight * 0.33;
            cH = video.videoHeight * 0.34;
            filterType = "standard";
        } else {
            // Waiting Mode (Coin Toss / Bottom)
            cX = video.videoWidth * 0.33;
            cW = video.videoWidth * 0.33;
            cY = video.videoHeight * 0.63;
            cH = video.videoHeight * 0.10;
            filterType = "standard";
        }

        // Update Info UI
        document.getElementById('cropInfo').innerText = `X:${Math.round(cX)} Y:${Math.round(cY)} W:${Math.round(cW)} H:${Math.round(cH)}`;
        document.getElementById('filterName').innerText = filterType;

        // Draw cropped image
        // Fix: Ensure canvas height is updated if aspect ratio changes
        const targetHeight = cH * (800 / cW);
        if (canvas.width !== 800 || Math.abs(canvas.height - targetHeight) > 1) {
            canvas.width = 800;
            canvas.height = targetHeight;
        }
        ctx.drawImage(video, cX, cY, cW, cH, 0, 0, canvas.width, canvas.height);

        // Apply Filter
        let imgD = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let d = imgD.data;

        if (filterType === "yellow_boost") {
            // Yellow Boost Filter: (R+G)/2 - B
            // Thresholding to extract yellow text
            for (let i = 0; i < d.length; i += 4) {
                const r = d[i];
                const g = d[i + 1];
                const b = d[i + 2];

                // Yellow score: High R and G, Low B
                const yellowScore = (r + g) / 2 - b;

                // Threshold (adjust as needed, 40-50 is usually good for bright yellow on dark bg)
                const val = yellowScore > 40 ? 255 : 0;

                d[i] = d[i + 1] = d[i + 2] = val;
            }
        } else {
            // Standard High Contrast (existing logic)
            let th = isGameActive ? 172 : 72;
            let cont = isGameActive ? 0 : 105;
            const f = (259 * (cont + 255)) / (255 * (259 - cont));
            for (let i = 0; i < d.length; i += 4) {
                let g = (d[i] + d[i + 1] + d[i + 2]) / 3;
                if (cont !== 0) g = f * (g - 128) + 128;
                const c = g > th ? 255 : 0;
                d[i] = d[i + 1] = d[i + 2] = c;
            }
        }
        ctx.putImageData(imgD, 0, 0);

        // OCR
        const ret = await worker.recognize(canvas);
        const txt = ret.data.text.replace(/\s+/g, "").toUpperCase();

        if (txt.length > 1) {
            // log("OCR: " + txt); // Verbose
            analyze(txt);
        }

    } catch (e) {
        console.error(e);
    } finally {
        isProcessing = false;
        setTimeout(loop, 50);
    }
}

function analyze(t) {
    // 1. Turn Detection Mode
    if (isDeterminingTurn) {
        if (t.includes("先攻")) {
            setTurn("First", "Detected '先攻'");
            manualStart();
            return;
        }
        if (t.includes("後攻")) {
            setTurn("Second", "Detected '後攻'");
            manualStart();
            return;
        }
        // Fail-safe: if we see game elements, assume we missed it and start game
        if (t.includes("LP8000") || t.includes("DRAW") || t.includes("TURN")) {
            log("Game started without turn confirmation.");
            manualStart();
            return;
        }
        return;
    }

    // 2. Waiting Mode (Coin Toss)
    if (!isGameActive && !isDeterminingTurn) {
        if ((t.includes("相手") || t.includes("対戦")) && t.includes("選択")) {
            setCoin("Tails", "Coin Toss: Tails (Opponent selecting)");
            startTurnDetection();
        }
        else if (t.includes("選択") || t.includes("先攻") || t.includes("後攻")) {
            // If we see "Select", it's definitely Coin Toss (Heads)
            if (t.includes("選択")) {
                setCoin("Heads", "Coin Toss: Heads (We are selecting)");
                startTurnDetection();
            }
            // If we see "First" or "Second" directly (e.g. skipped Coin Toss screen or testing),
            // we should also transition to Turn Detection to confirm with Yellow Filter.
            else if (t.includes("先攻") || t.includes("後攻")) {
                log("Detected potential Turn keyword in Waiting Mode. Switching to Turn Detection...");
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
        if (t.includes("VICTORY") || t.includes("勝利")) finish("WIN", t);
        else if (t.includes("LOSE") || t.includes("敗北")) finish("LOSE", t);
    }
}

function startTurnDetection() {
    if (isDeterminingTurn) return;
    isDeterminingTurn = true;
    turnDetectStartTime = Date.now();
    updateUI();
    log(">>> Started Turn Detection Mode (Yellow Filter)");
}

function setCoin(c, msg) {
    if (currentCoin !== c) {
        currentCoin = c;
        log(msg);
        updateUI();
    }
}

function setTurn(tr, msg) {
    currentTurn = tr;
    log(msg);
    updateUI();
}

function manualStart() {
    if (!isGameActive) {
        isGameActive = true;
        isDeterminingTurn = false; // Stop turn detection
        log(">>> Game Started");
        updateUI();
    }
}

function finish(r, w) {
    log(`>>> Game Finished: ${r} (${w})`);
    lastResultTime = Date.now();
    // Reset after a delay for testing
    setTimeout(resetState, 5000);
}

function updateUI() {
    let mode = "WAITING";
    if (isDeterminingTurn) mode = "DETECTING TURN";
    if (isGameActive) mode = "GAME ACTIVE";

    document.getElementById('modeDisplay').innerText = mode;
    document.getElementById('coinDisplay').innerText = currentCoin;
    document.getElementById('turnDisplay').innerText = currentTurn;

    const modeEl = document.getElementById('modeDisplay');
    if (isDeterminingTurn) modeEl.style.color = "#ffff00";
    else if (isGameActive) modeEl.style.color = "#00ff00";
    else modeEl.style.color = "#aaa";
}

function log(m) {
    const b = document.getElementById('logs');
    b.innerHTML = `[${new Date().toLocaleTimeString()}] ${m}<br>` + b.innerHTML;
}

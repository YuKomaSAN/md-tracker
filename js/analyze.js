// Analyze Tab Logic

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

function renderSavedFilters() {
    document.getElementById('savedFilters').innerHTML = (JSON.parse(localStorage.getItem('md_saved_filters') || "[]")).map((f, i) => `<span class="saved-tag" onclick="loadSavedFilter(${i})">${f.name}</span>`).join("");
}

function loadSavedFilter(i) {
    const f = JSON.parse(localStorage.getItem('md_saved_filters'))[i];
    document.getElementById('dateStart').value = f.start;
    document.getElementById('dateEnd').value = f.end;
    setFilterTime('custom');
}

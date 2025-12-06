// History Tab Logic

function renderHistory() {
    const tbody = document.querySelector("#historyTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    logData.slice(0, 100).forEach(row => {
        const tr = document.createElement("tr");
        let dateStr = "---";
        try {
            const d = new Date(row.date);
            if (!isNaN(d.getTime())) dateStr = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
        } catch (e) { }
        const res = row.result || "-";
        const resClass = res.includes("WIN") ? "win" : "lose";
        const timeStr = toTimeStr(row.duration);
        tr.innerHTML = `<td>${dateStr}</td><td>${row.type || "-"}</td><td>${row.myDeck}</td><td>${row.oppDeck || "-"}</td><td>${row.turn}</td><td>${timeStr}</td><td class="${resClass}">${res}</td><td><button class="btn-edit" data-id="${row.id}" style="padding:2px 6px; font-size:0.8em;">編集</button> <button class="btn-delete" data-id="${row.id}" style="padding:2px 6px; font-size:0.8em; background:#d32f2f;">削除</button></td>`;
        tbody.appendChild(tr);
    });
}

function editLog(id) {
    const row = logData.find(r => r.id === id); if (!row) return;
    editingRowId = id;
    document.getElementById('editMyDeck').value = row.myDeck;
    document.getElementById('editOppDeck').value = row.oppDeck;
    document.getElementById('editTurn').value = (row.turn.includes("先") || row.turn === "First") ? "先攻" : "後攻";
    document.getElementById('editResult').value = (row.result || "").includes("WIN") ? "WIN" : "LOSE";
    document.getElementById('editMatchType').value = row.type || "ランクマッチ";
    document.getElementById('editModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('editModal').style.display = 'none';
}

async function submitEdit() {
    const row = logData.find(r => r.id === editingRowId);
    const payload = {
        action: 'update_log',
        id: editingRowId,
        startTime: row.date,
        endTime: row.date,
        duration: row.duration || 0,
        myDeck: document.getElementById('editMyDeck').value,
        oppDeck: document.getElementById('editOppDeck').value,
        coinToss: row.coin,
        turn: document.getElementById('editTurn').value,
        result: document.getElementById('editResult').value,
        matchType: document.getElementById('editMatchType').value
    };
    await fetch(GAS_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
    localStorage.setItem('md_refresh_signal', Date.now());
    closeModal();
    setTimeout(loadData, CONFIG.TIMEOUTS.LOAD_DELAY);
}

function deleteLog(id) {
    if (confirm("削除しますか？")) {
        fetch(GAS_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'delete_log', id: id }) });
        localStorage.setItem('md_refresh_signal', Date.now());
        setTimeout(loadData, CONFIG.TIMEOUTS.LOAD_DELAY);
    }
}

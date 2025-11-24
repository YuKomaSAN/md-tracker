/* ==============================================
   MD Tracker v3.5 Backend (Time Fix)
   ============================================== */

const SHEET_LOG = 'Log';
const SHEET_CONFIG = 'Config';

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName(SHEET_LOG);
  const configSheet = ss.getSheetByName(SHEET_CONFIG);
  
  // A. ログデータの取得
  let logs = [];
  const lastRow = logSheet.getLastRow();
  if (lastRow >= 2) {
    // A列(1)〜I列(9)を取得
    const data = logSheet.getRange(2, 1, lastRow - 1, 9).getValues();
    logs = data.map((row, i) => ({
      id: i + 2,
      date: row[0],     // A: 開始
      // row[1]は終了時間なので使わない
      duration: row[2], // C: 時間 (★ここが抜けていました！)
      myDeck: row[3],   // D: 自分デッキ
      coin: row[4],     // E: コイン
      turn: row[5],     // F: 手番
      result: row[6],   // G: 勝敗
      oppDeck: row[7],  // H: 相手デッキ
      type: row[8]      // I: 種別
    })).reverse();
  }

  // B. デッキリストの取得
  let decks = [];
  const lastDeckRow = configSheet.getLastRow();
  if (lastDeckRow >= 2) {
    decks = configSheet.getRange(2, 1, lastDeckRow - 1, 1).getValues().flat();
  }

  const jsonString = JSON.stringify({ logs: logs, decks: decks });
  const callback = e.parameter.callback;
  
  if (callback) {
    return ContentService.createTextOutput(`${callback}(${jsonString})`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    return ContentService.createTextOutput(jsonString).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = params.action;
    
    if (action === 'record') {
      const sheet = ss.getSheetByName(SHEET_LOG);
      sheet.appendRow([
        params.startTime, params.endTime, params.duration,
        params.myDeck, params.coinToss, params.turn, params.result, params.oppDeck,
        params.matchType
      ]);
      return response("Recorded");
    }
    
    if (action === 'update_log') {
      const sheet = ss.getSheetByName(SHEET_LOG);
      const row = params.id;
      sheet.getRange(row, 1, 1, 9).setValues([[
        params.startTime, params.endTime, params.duration,
        params.myDeck, params.coinToss, params.turn, params.result, params.oppDeck,
        params.matchType
      ]]);
      return response("Updated");
    }

    if (action === 'delete_log') {
      const sheet = ss.getSheetByName(SHEET_LOG);
      sheet.deleteRow(params.id);
      return response("Deleted");
    }
    
    if (action === 'add_deck') {
      const sheet = ss.getSheetByName(SHEET_CONFIG);
      const currentDecks = sheet.getRange("A:A").getValues().flat();
      if (!currentDecks.includes(params.newDeck)) {
        sheet.appendRow([params.newDeck]);
      }
      return response("Deck Added");
    }

    return response("Unknown Action");

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", msg: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function response(msg) {
  return ContentService.createTextOutput(JSON.stringify({status: "success", message: msg})).setMimeType(ContentService.MimeType.JSON);
}
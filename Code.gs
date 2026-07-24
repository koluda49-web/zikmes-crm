/**
 * Code.gs — webhook для новой Google Таблицы, лист "Уведомления".
 *
 * Установка:
 * 1. В Google Таблице: Расширения → Apps Script.
 * 2. Вставить этот код в Code.gs, сохранить.
 * 3. Развернуть → Новое развёртывание → тип "Веб-приложение":
 *      - Выполнять от имени: я
 *      - У кого есть доступ: Все
 * 4. Скопировать URL веб-приложения в config.txt (GOOGLE_SHEET_WEBHOOK).
 *
 * ВАЖНО: после любого изменения этого файла нужно делать НОВУЮ версию
 * развёртывания (Управление развёртываниями → карандаш → Новая версия →
 * Развернуть), иначе doPost продолжит работать по старому коду.
 */

var SHEET_NAME = "Уведомления";
var HEADERS = ["Дата запуска парсера", "ID заказа", "Телефон", "Сумма", "Дата истечения", "Статус платежа", "Ссылка на заказ"];

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var action = data.action;

  if (action === "upload_notifications") {
    return uploadNotifications(data.rows, data.run_date);
  }

  return jsonResponse({ ok: false, error: "unknown action: " + action });
}

function uploadNotifications(rows, runDate) {
  var sheet = getOrCreateSheet();

  if (needsSeparator(sheet, runDate)) {
    insertSeparatorRow(sheet, runDate);
  }

  rows.forEach(function (r) {
    sheet.appendRow([
      runDate,
      r.order_id,
      r.phone,
      r.amount,
      r.expires,
      r.status,
      r.order_url,
    ]);
  });

  return jsonResponse({ ok: true, added: rows.length });
}

function needsSeparator(sheet, runDate) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return false; // в таблице пока только заголовок (или пусто) — разделять не от чего
  }
  var lastRunDateInSheet = sheet.getRange(lastRow, 1).getValue();
  // Если последняя строка — уже строка ЭТОГО прогона (например, предыдущая
  // пачка того же запуска), разделитель не нужен — это продолжение.
  return String(lastRunDateInSheet) !== String(runDate);
}

function insertSeparatorRow(sheet, runDate) {
  var sepRow = sheet.getLastRow() + 1;
  var numCols = HEADERS.length;
  var range = sheet.getRange(sepRow, 1, 1, numCols);
  range.merge();
  range.setValue("— Прогон: " + runDate + " —");
  range.setBackground("#d9d9d9");
  range.setFontWeight("bold");
  range.setHorizontalAlignment("center");
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

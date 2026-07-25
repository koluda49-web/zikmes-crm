/**
 * WEB APP «Рассрочка Зикмес».
 *
 * GET (без action или action=dashboard) → HTML-дашборд (RassrochkaDashboard.html)
 * GET ?action=exportReport             → JSON для Flask SSE («Выгрузка в отчёт по ЗП»)
 *
 * Использует из Code.gs того же проекта:
 *   COL_ID, COL_DEALER, COL_STATUS, COL_RECORD, COL_PAYMENT_NUM,
 *   HEADER_ROW, FIRST_DATA_ROW, createExcelFile()
 * Использует из updateAllDebtors.gs:
 *   updateAllDebtors()
 */

var REPORT_SHEET_NAME = '';   // '' = первый лист таблицы

/* ───── doGet ───── */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';

  if (!action || action === 'dashboard') {
    return HtmlService.createHtmlOutputFromFile('RassrochkaDashboard')
      .setTitle('Рассрочка Зикмес — Скрипты')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (action === 'exportReport') {
    return _jsonResp_(exportReportData_());
  }

  return _jsonResp_({ ok: false, error: 'unknown action: ' + action });
}

/* ───── Публичные функции для google.script.run ───── */

function runUpdateAllDebtors() {
  return updateAllDebtors();
}

function runGetSheetNames() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheets().map(function(s) { return s.getName(); });
}

function runExportReport(sheetName) {
  return exportReportData_(sheetName);
}

/* ───── Логика экспорта ───── */

function exportReportData_(sheetName) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet;
    if (sheetName) {
      sheet = ss.getSheetByName(sheetName) || ss.getSheets()[0];
    } else {
      sheet = REPORT_SHEET_NAME
        ? (ss.getSheetByName(REPORT_SHEET_NAME) || ss.getSheets()[0])
        : ss.getSheets()[0];
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < FIRST_DATA_ROW) {
      return { ok: false, error: 'Нет данных на листе' };
    }

    var lastCol = sheet.getLastColumn();
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();

    var reportRows = [['ID', 'Дилер', 'Статус', 'Отчёт']];
    for (var i = HEADER_ROW; i < values.length; i++) {
      var row = values[i];
      var pn = row[COL_PAYMENT_NUM - 1];
      if (pn !== 0 && pn !== '0') continue;
      var id     = row[COL_ID - 1];
      var dealer = row[COL_DEALER - 1];
      var status = row[COL_STATUS - 1];
      var record = row[COL_RECORD - 1];
      if (id === '' && dealer === '' && status === '' && record === '') continue;
      reportRows.push([id, dealer, status, record]);
    }

    if (reportRows.length === 1) {
      return { ok: false, error: 'Нет строк с № платежа = 0' };
    }

    var fileUrl = createExcelFile(reportRows, sheet.getName());
    return { ok: true, url: fileUrl, rows: reportRows.length - 1 };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

function _jsonResp_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

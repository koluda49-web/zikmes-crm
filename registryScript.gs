/**
 * РЕЕСТР ДОЛЖНИКОВ - скрипт для НОВОЙ таблицы "Реестр должников".
 * Вставляется в Расширения -> Apps Script ИМЕННО ЭТОЙ (новой) таблицы.
 *
 * Что делает:
 *  1) Забирает должников из исходной таблицы "Рассрочка Зикмес" (листы месяц-год
 *     2025+ и "25 долж"/"26 долж", статус = "Должник") и добавляет в реестр
 *     тех, кого там ещё нет - НЕ трогая уже внесённые комментарии менеджера/юриста.
 *  2) По кнопке проверяет, где юрист/менеджер поставили чекбокс "Решено" -
 *     меняет статус этого платежа в ИСХОДНОЙ таблице на "Погашен" и убирает
 *     строку из реестра.
 *  3) Позволяет настроить права редактирования: колонки менеджера редактирует
 *     только менеджер(ы), колонки юриста - только юрист(ы).
 *
 * УСТАНОВКА:
 * 1. Открой ЭТУ (новую) таблицу -> Расширения -> Apps Script.
 * 2. Вставь этот код в Code.gs, сохрани.
 * 3. Обнови страницу таблицы (F5) - появится меню "Реестр должников".
 * 4. Меню -> "Инициализировать лист" (один раз, создаст заголовки и чекбоксы).
 * 5. Меню -> "Обновить реестр" - подтягивает должников.
 * 6. Когда впишете email в MANAGER_EMAILS / LAWYER_EMAILS ниже - запустите
 *    меню -> "Настроить права доступа" (тоже один раз, потом при изменении списка).
 *
 * ВАЖНО про права: "Обновить реестр" меняет статус в ИСХОДНОЙ таблице, поэтому
 * запускать эту кнопку должен тот, у кого есть доступ на редактирование ОБЕИХ
 * таблиц (реестра и исходной). Менеджеру/юристу для своей работы (комментарии,
 * чекбокс) доступ к исходной таблице не нужен - только к реестру.
 */

// ==== НАСТРОЙКИ - ЗАПОЛНИТЕ ПОЗЖЕ ====
var SOURCE_SPREADSHEET_ID = '1rD1WChulpVdzwX6PZ1B4OI7PlmhfU3PqOl1iIbBM3WI'; // "Рассрочка Зикмес"
var REGISTRY_SHEET_NAME = 'Реестр';

// Впишите сюда email всех менеджеров и юристов через запятую, в кавычках, например:
// var MANAGER_EMAILS = ['manager1@gmail.com', 'manager2@gmail.com'];
var MANAGER_EMAILS = [];
var LAWYER_EMAILS = [];

// Колонки реестра (номера, чтобы легко менять расположение)
var COL_ID = 1;            // A
var COL_FIO = 2;           // B
var COL_SUM = 3;           // C
var COL_DEALER = 4;        // D
var COL_YEAR = 5;          // E
var COL_SRC_SHEET = 6;     // F - технический: название исходного листа
var COL_SRC_ROW = 7;       // G - технический: номер строки в исходном листе
var COL_MGR_COMMENT = 8;   // H
var COL_MGR_DATE = 9;      // I
var COL_LAWYER_STAGE = 10; // J
var COL_LAWYER_DATE = 11;  // K
var COL_RESOLVED = 12;     // L - чекбокс "Решено"
var COL_CRM_LINK = 13;     // M - ссылка на заказ в CRM (a.ok-crm.com)
var COL_ASSIGNEE = 14;     // N - кто сейчас разбирается (выпадающий список)
var REGISTRY_NUM_COLS = 14;

var CRM_ORDER_URL_PREFIX = 'https://a.ok-crm.com/order/view/';

var LAWYER_STAGE_OPTIONS = ['Отправлена претензия', 'Отправлено в суд', 'В суде'];
var ASSIGNEE_OPTIONS = ['Менеджер', 'Юрист'];
var VALIDATION_ROWS = 3000; // на сколько строк вперёд ставим выпадающие списки/календарь с запасом

var HEADERS = [
  'АЙДИ', 'ФИО, телефон', 'Сумма', 'Дилер', 'Год',
  'Лист-источник', '№ строки-источник',
  'Комментарий менеджера', 'Дата комментария',
  'Стадия (юрист)', 'Дата стадии',
  'Решено',
  'Ссылка на CRM',
  'Кто сейчас разбирается'
];

// ==== Лист "Обзвон" (для автообзвона должников через МТС, scrape_crm.py) ====
var CALLS_SHEET_NAME = 'Обзвон';
var CALLS_ARCHIVE_SHEET_NAME = 'Архив обзвона';
// только АЙДИ, ФИО+телефон, Дилер из реестра - плюс колонки самого обзвона
var CALLS_HEADERS = [
  'АЙДИ', 'ФИО, телефон', 'Дилер',
  'Телефон (для обзвона)',
  'Дата батча',
  'Результат обзвона',
  'Дата результата'
];
var CALLS_COL_ID = 1;         // A
var CALLS_COL_FIO = 2;        // B
var CALLS_COL_DEALER = 3;     // C
var CALLS_COL_PHONE = 4;      // D
var CALLS_COL_BATCH_DATE = 5; // E
var CALLS_COL_RESULT = 6;     // F
var CALLS_COL_RESULT_DATE = 7; // G
var CALLS_NUM_COLS = 7;

// Секретный ключ веб-приложения - придумайте свой и впишите такой же в scrape_crm.py,
// чтобы посторонний не мог дёргать веб-хук, зная только его URL.
var WEBHOOK_SECRET = 'shtenli';

/**
 * Достаёт из текста "ФИО, телефон" все номера, приводит к формату 375XXXXXXXXX
 * (та же логика, что normalize_phone() в scrape_crm.py). Может вернуть несколько
 * номеров, если клиент указал несколько телефонов через запятую.
 */
function extractPhones_(fioText) {
  if (!fioText) return [];
  var matches = String(fioText).match(/\+?\d[\d\s\-]{7,}\d/g) || [];
  var result = [];
  var seen = {};
  matches.forEach(function (raw) {
    var digits = raw.replace(/\D/g, '');
    if (digits.indexOf('80') === 0) digits = '375' + digits.substring(2);
    if (digits.indexOf('00375') === 0) digits = digits.substring(2);
    if (digits.indexOf('375') !== 0) return;
    digits = digits.substring(0, 12);
    if (digits.length !== 12) return;
    if (!seen[digits]) {
      seen[digits] = true;
      result.push(digits);
    }
  });
  return result;
}


function buildCrmLink_(id) {
  if (id === null || id === '' || id === undefined) return '';
  var idNum = Number(id);
  var idStr = isNaN(idNum) ? String(id) : String(Math.round(idNum));
  return CRM_ORDER_URL_PREFIX + idStr;
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Реестр должников')
    .addItem('Инициализировать лист (один раз)', 'initRegistrySheet')
    .addItem('Обновить реестр (решённые + новые)', 'updateRegistry')
    .addSeparator()
    .addItem('Перенести обзвоненных в архив', 'archiveCompletedCalls')
    .addSeparator()
    .addItem('Настроить права доступа', 'setupPermissions')
    .addToUi();
}

/**
 * Создаёт лист "Реестр" (если его нет), прописывает заголовки, чекбоксы,
 * календарь для дат и выпадающие списки для стадии/ответственного.
 * Можно запускать повторно (например, после обновления скрипта) - только
 * заголовки/форматирование, существующие данные не трогает.
 */
function initRegistrySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REGISTRY_SHEET_NAME);

  if (!sheet) {
    // если это первая/единственная таблица с дефолтным "Лист1" - переименуем его
    var sheets = ss.getSheets();
    if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
      sheet = sheets[0];
      sheet.setName(REGISTRY_SHEET_NAME);
    } else {
      sheet = ss.insertSheet(REGISTRY_SHEET_NAME);
    }
  }

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#efefef');
  sheet.setFrozenRows(1);

  // 1) Календарь для дат (менеджер и юрист) - клик по ячейке открывает date picker
  var dateRule = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true).build();
  sheet.getRange(2, COL_MGR_DATE, VALIDATION_ROWS, 1).setDataValidation(dateRule).setNumberFormat('dd.MM.yyyy');
  sheet.getRange(2, COL_LAWYER_DATE, VALIDATION_ROWS, 1).setDataValidation(dateRule).setNumberFormat('dd.MM.yyyy');

  // 2) Выпадающий список стадии юриста
  var stageRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(LAWYER_STAGE_OPTIONS, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(2, COL_LAWYER_STAGE, VALIDATION_ROWS, 1).setDataValidation(stageRule);

  // 3) Выпадающий список "кто сейчас разбирается"
  var assigneeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ASSIGNEE_OPTIONS, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(2, COL_ASSIGNEE, VALIDATION_ROWS, 1).setDataValidation(assigneeRule);

  SpreadsheetApp.getUi().alert('Готово! Лист "' + REGISTRY_SHEET_NAME + '" инициализирован (заголовки, календарь, выпадающие списки). Теперь запустите "Обновить реестр".');
}

/**
 * Главная функция: сначала обрабатывает отмеченные "Решено" строки,
 * потом добавляет новых должников из исходной таблицы.
 */
function updateRegistry() {
  var sourceSs;
  try {
    sourceSs = SpreadsheetApp.openById(SOURCE_SPREADSHEET_ID);
    // пробное обращение, чтобы сразу проверить реальный доступ на РЕДАКТИРОВАНИЕ,
    // а не только на чтение (getSheets() само по себе может не вскрыть проблему)
    sourceSs.getSheets();
  } catch (e) {
    SpreadsheetApp.getUi().alert(
      'Нет доступа к исходной таблице "Рассрочка Зикмес"!\n\n' +
      'Похоже, у вашего аккаунта Google нет прав на редактирование исходной ' +
      'таблицы должников. Кнопку "Обновить реестр" должен нажимать тот, у кого ' +
      'есть доступ на редактирование ОБЕИХ таблиц - реестра и исходной.\n\n' +
      'Ничего не изменилось и не удалилось - можно попробовать снова после ' +
      'того, как вам откроют доступ к исходной таблице.'
    );
    return;
  }

  var result = processResolvedRows_(sourceSs);
  var staleRemoved = removeStaleRows_(sourceSs);
  var addedCount = syncNewDebtors_(sourceSs);
  var callBatchCount = createCallBatch_();

  var message = 'Готово!\n' +
    'Обработано решённых (по галочке): ' + result.processed + ' (статус в исходной таблице изменён на "Погашен", строки убраны из реестра)\n' +
    'Убрано как уже погашенные напрямую в исходной таблице (без галочки): ' + staleRemoved + '\n' +
    'Добавлено новых должников: ' + addedCount + '\n' +
    'Добавлено номеров в новый батч обзвона (лист "' + CALLS_SHEET_NAME + '"): ' + callBatchCount;

  if (result.failed > 0) {
    message += '\n\nВНИМАНИЕ: ' + result.failed + ' отмеченных строк НЕ обработано ' +
      '(не удалось найти/изменить платёж в исходной таблице) - они остались в реестре, ' +
      'чекбокс всё ещё стоит, можно попробовать обновить ещё раз.';
  }

  // При вызове через google.script.run (web app) getUi() недоступен — возвращаем строку
  try { SpreadsheetApp.getUi().alert(message); } catch (e) {}
  return message;
}

/** Публичная обёртка для вызова из HTML-дашборда через google.script.run */
function runUpdateRegistry() {
  return updateRegistry();
}

/**
 * Проверяет чекбокс "Решено" по всем строкам реестра. Для отмеченных -
 * меняет статус соответствующего платежа в ИСХОДНОЙ таблице на "Погашен"
 * и удаляет строку из реестра (снизу вверх, чтобы не сбить нумерацию).
 * Строка удаляется из реестра ТОЛЬКО если статус в исходной таблице
 * реально удалось поменять - иначе остаётся на месте для повторной попытки.
 */
function processResolvedRows_(sourceSs) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REGISTRY_SHEET_NAME);
  if (!sheet) return { processed: 0, failed: 0 };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { processed: 0, failed: 0 };

  var data = sheet.getRange(2, 1, lastRow - 1, REGISTRY_NUM_COLS).getValues();

  var rowsToDelete = []; // номера строк реестра (реальные, в самом листе) на удаление
  var processed = 0;
  var failed = 0;

  data.forEach(function (row, i) {
    var resolved = row[COL_RESOLVED - 1];
    if (resolved !== true) return;

    var srcSheetName = row[COL_SRC_SHEET - 1];
    var srcRowNum = row[COL_SRC_ROW - 1];
    var success = false;

    if (srcSheetName && srcRowNum) {
      try {
        var srcSheet = sourceSs.getSheetByName(String(srcSheetName));
        if (srcSheet) {
          srcSheet.getRange(srcRowNum, 10).setValue('Погашен'); // колонка J - статус
          success = true;
        }
      } catch (e) {
        success = false;
      }
    }

    if (success) {
      rowsToDelete.push(i + 2); // +2: реальный номер строки в реестре
      processed++;
    } else {
      failed++;
    }
  });

  // удаляем строки снизу вверх, чтобы не сбить нумерацию оставшихся
  rowsToDelete.sort(function (a, b) { return b - a; });
  rowsToDelete.forEach(function (r) {
    sheet.deleteRow(r);
  });

  return { processed: processed, failed: failed };
}

/**
 * Проверяет все записи реестра (независимо от галочки "Решено") - если статус
 * соответствующего платежа в ИСХОДНОЙ таблице уже не "Должник" (кто-то поменял
 * его вручную, в обход реестра), убирает такую запись из реестра автоматически.
 * Читает статус пакетно (один запрос на каждый исходный лист), а не по одной
 * ячейке, чтобы не тормозить на большом количестве записей.
 */
function removeStaleRows_(sourceSs) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REGISTRY_SHEET_NAME);
  if (!sheet) return 0;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var data = sheet.getRange(2, 1, lastRow - 1, REGISTRY_NUM_COLS).getValues();

  // группируем записи реестра по исходному листу, чтобы прочитать статус
  // одним пакетным запросом на лист, а не по одной ячейке
  var bySheet = {};
  data.forEach(function (row, i) {
    var srcSheetName = row[COL_SRC_SHEET - 1];
    var srcRowNum = row[COL_SRC_ROW - 1];
    if (!srcSheetName || !srcRowNum) return;
    if (!bySheet[srcSheetName]) bySheet[srcSheetName] = [];
    bySheet[srcSheetName].push({ regRow: i + 2, srcRowNum: srcRowNum });
  });

  var rowsToDelete = [];

  Object.keys(bySheet).forEach(function (sheetName) {
    var srcSheet;
    try {
      srcSheet = sourceSs.getSheetByName(sheetName);
    } catch (e) {
      return;
    }
    if (!srcSheet) return;

    var srcLastRow = srcSheet.getLastRow();
    if (srcLastRow < 2) return;

    var statusValues = srcSheet.getRange(2, 10, srcLastRow - 1, 1).getValues(); // колонка J

    bySheet[sheetName].forEach(function (item) {
      var idx = item.srcRowNum - 2; // смещение внутри statusValues
      if (idx < 0 || idx >= statusValues.length) return; // строка могла быть удалена в исходнике - пропускаем
      var status = statusValues[idx][0];
      var statusStr = status ? String(status).trim() : '';
      if (statusStr !== 'Должник') {
        rowsToDelete.push(item.regRow);
      }
    });
  });

  rowsToDelete.sort(function (a, b) { return b - a; });
  rowsToDelete.forEach(function (r) {
    sheet.deleteRow(r);
  });

  return rowsToDelete.length;
}

/**
 * Сканирует исходную таблицу (листы месяц-год 2025+ и "25 долж"/"26 долж"),
 * находит строки со статусом "Должник" и добавляет в реестр только те,
 * которых там ещё нет (сверяет по паре "лист-источник + номер строки").
 * Существующие строки (и их комментарии) не трогает.
 */
function syncNewDebtors_(sourceSs) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REGISTRY_SHEET_NAME);
  if (!sheet) {
    throw new Error('Сначала запустите "Инициализировать лист"');
  }

  // ключи уже существующих в реестре строк: "ЛистИсточник|НомерСтроки"
  var existingKeys = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var existing = sheet.getRange(2, COL_SRC_SHEET, lastRow - 1, 2).getValues();
    existing.forEach(function (row) {
      if (row[0] && row[1]) {
        existingKeys[row[0] + '|' + row[1]] = true;
      }
    });

    // дозаполняем ссылку на CRM тем существующим строкам, где её ещё нет
    // (например, они были добавлены до появления этой колонки)
    var idAndLink = sheet.getRange(2, COL_ID, lastRow - 1, COL_CRM_LINK - COL_ID + 1).getValues();
    var linksToFill = [];
    idAndLink.forEach(function (row, i) {
      var id = row[0];
      var link = row[COL_CRM_LINK - COL_ID];
      if (id && !link) {
        linksToFill.push({ row: i + 2, link: buildCrmLink_(id) });
      }
    });
    linksToFill.forEach(function (item) {
      sheet.getRange(item.row, COL_CRM_LINK).setValue(item.link);
    });
  }

  var monthPattern = /^(Январь|Февраль|Март|Апрель|Май|Июнь|Июль|Август|Сентябрь|Октябрь|Ноябрь|Декабрь)\s*(\d{2,4})/i;
  var doljPattern = /^(\d{2,4})\s*долж/i;

  function normalizeYear(rawYear) {
    var y = parseInt(rawYear, 10);
    if (y < 100) y += 2000;
    return y;
  }

  function isTargetSheet(name) {
    var m = name.match(monthPattern);
    if (m) return normalizeYear(m[2]) >= 2025;
    var d = name.match(doljPattern);
    if (d) return normalizeYear(d[1]) >= 2025;
    return false;
  }

  var newRows = [];

  sourceSs.getSheets().forEach(function (srcSheet) {
    var name = srcSheet.getName().trim();
    if (!isTargetSheet(name)) return;

    var srcLastRow = srcSheet.getLastRow();
    if (srcLastRow < 2) return;

    var values = srcSheet.getRange(2, 1, srcLastRow - 1, 10).getValues();

    var currentId = null, currentFio = null, currentDealer = null;

    values.forEach(function (row, i) {
      var rowNum = i + 2;
      var id = row[0], fio = row[1], sum = row[3], year = row[5], dealer = row[8], status = row[9];

      if (id !== null && id !== '') {
        currentId = id;
        currentFio = fio;
        currentDealer = dealer;
      }
      // ВАЖНО: дилер берётся ТОЛЬКО из шапки клиента (строка с АЙДИ).
      // В строках-платежах ниже эта колонка иногда содержит случайные числа
      // (ошибки ручного ввода в исходной таблице) - их подхватывать нельзя.

      if (!status || String(status).trim() !== 'Должник') return;

      var key = name + '|' + rowNum;
      if (existingKeys[key]) return; // уже в реестре - пропускаем

      newRows.push([
        currentId, currentFio, sum, currentDealer, year,
        name, rowNum,
        '', '', '', '', false, // комментарии/стадия пустые, чекбокс не отмечен
        buildCrmLink_(currentId),
        '' // кто сейчас разбирается - пусто, назначат позже вручную
      ]);
      existingKeys[key] = true; // на случай дублей внутри этого же прогона
    });
  });

  if (newRows.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, REGISTRY_NUM_COLS).setValues(newRows);
    sheet.getRange(startRow, COL_RESOLVED, newRows.length, 1).insertCheckboxes();
  }

  return newRows.length;
}

/**
 * Создаёт новый "батч" обзвона в листе "Обзвон": для каждого текущего должника
 * из реестра достаёт номер(а) телефона и ДОБАВЛЯЕТ (не перезаписывая) строки
 * внизу листа - по одной строке на каждый найденный телефон, с датой батча.
 * Столбцы "Результат обзвона"/"Дата результата" изначально пустые - их заполнит
 * веб-хук doPost, когда python-скрипт пришлёт результаты обзвона по МТС.
 */
function createCallBatch_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var regSheet = ss.getSheetByName(REGISTRY_SHEET_NAME);
  if (!regSheet) return 0;

  var callsSheet = ss.getSheetByName(CALLS_SHEET_NAME);
  if (!callsSheet) {
    callsSheet = ss.insertSheet(CALLS_SHEET_NAME);
    callsSheet.getRange(1, 1, 1, CALLS_HEADERS.length).setValues([CALLS_HEADERS])
      .setFontWeight('bold').setBackground('#efefef');
    callsSheet.setFrozenRows(1);
  }

  var lastRow = regSheet.getLastRow();
  if (lastRow < 2) return 0;

  // Собираем ID, которые уже есть в архиве - их в новый батч не добавляем
  var archivedIds = {};
  var archiveSheet = ss.getSheetByName(CALLS_ARCHIVE_SHEET_NAME);
  if (archiveSheet && archiveSheet.getLastRow() >= 2) {
    var archiveData = archiveSheet.getRange(2, CALLS_COL_ID, archiveSheet.getLastRow() - 1, 1).getValues();
    archiveData.forEach(function (row) {
      if (row[0]) archivedIds[String(row[0])] = true;
    });
  }

  var data = regSheet.getRange(2, 1, lastRow - 1, REGISTRY_NUM_COLS).getValues();
  var batchDate = new Date();
  var newRows = [];
  var seenIds = {}; // дубли внутри текущего батча

  data.forEach(function (row) {
    var id = row[COL_ID - 1];
    if (!id) return;
    var idStr = String(id);

    // пропускаем если уже в этом батче или уже есть в архиве обзвона
    if (seenIds[idStr] || archivedIds[idStr]) return;

    var fio = row[COL_FIO - 1];
    var dealer = row[COL_DEALER - 1];
    var phones = extractPhones_(fio);
    if (phones.length === 0) return;

    newRows.push([id, fio, dealer, phones[0], batchDate, '', '']);
    seenIds[idStr] = true;
  });

  if (newRows.length > 0) {
    var startRow = callsSheet.getLastRow() + 1;
    callsSheet.getRange(startRow, 1, newRows.length, CALLS_NUM_COLS).setValues(newRows);
  }

  return newRows.length;
}

/**
 * Веб-приложение для scrape_crm.py:
 *  - GET  ?action=get_debtor_batch&secret=...   - отдаёт список ещё не обработанных
 *    номеров (где "Результат обзвона" пусто) в формате JSON, для загрузки в МТС.
 *  - POST {action:"upload_debtor_call_results", secret:"...", rows:[{phone,result,date}]}
 *    - сопоставляет по номеру телефона и записывает результат в лист "Обзвон".
 *
 * Разворачивается через Развернуть -> Новое развёртывание -> Веб-приложение
 * (Выполнять от имени: я; Доступ: у любого пользователя). URL веб-приложения
 * нужно будет вписать в scrape_crm.py вместе с WEBHOOK_SECRET.
 */
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var action = params.action || '';

  // HTML-дашборд — без секрета, при пустом action или action=dashboard
  if (!action || action === 'dashboard') {
    return HtmlService.createHtmlOutputFromFile('RegistryDashboard')
      .setTitle('Реестр должников — Скрипты')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // МТС-вебхук — требует секрет
  if (params.secret !== WEBHOOK_SECRET) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'bad secret' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'get_debtor_batch') {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var callsSheet = ss.getSheetByName(CALLS_SHEET_NAME);
    var rows = [];
    if (callsSheet) {
      var lastRow = callsSheet.getLastRow();
      if (lastRow >= 2) {
        var data = callsSheet.getRange(2, 1, lastRow - 1, CALLS_NUM_COLS).getValues();
        data.forEach(function (row) {
          var result = row[CALLS_COL_RESULT - 1];
          if (result) return; // уже есть результат - пропускаем
          rows.push({
            id: row[CALLS_COL_ID - 1],
            fio: row[CALLS_COL_FIO - 1],
            phone: row[CALLS_COL_PHONE - 1]
          });
        });
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: rows.length + ' номеров на обзвон', rows: rows }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var data = JSON.parse(e.postData.contents);

  if (data.secret !== WEBHOOK_SECRET) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'bad secret' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (data.action === 'upload_debtor_call_results') {
    var updated = uploadDebtorCallResults_(data.rows || []);
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'обновлено строк: ' + updated, updated: updated }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Записывает результаты обзвона в лист "Обзвон", сопоставляя по нормализованному
 * номеру телефона. Для каждого номера ищет САМУЮ РАННЮЮ ещё не обработанную строку
 * (пустой "Результат обзвона") с таким же телефоном и заполняет её.
 */
function uploadDebtorCallResults_(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var callsSheet = ss.getSheetByName(CALLS_SHEET_NAME);
  if (!callsSheet) return 0;

  var lastRow = callsSheet.getLastRow();
  if (lastRow < 2) return 0;

  var data = callsSheet.getRange(2, 1, lastRow - 1, CALLS_NUM_COLS).getValues();

  // индекс: номер телефона -> список номеров строк у которых ещё нет результата
  var byPhone = {};
  data.forEach(function (row, i) {
    var phone = row[CALLS_COL_PHONE - 1];
    var result = row[CALLS_COL_RESULT - 1];
    if (!phone || result) return;
    if (!byPhone[phone]) byPhone[phone] = [];
    byPhone[phone].push(i + 2);
  });

  var updatedCount = 0;
  var rowsToArchive = [];

  rows.forEach(function (item) {
    var digits = String(item.phone || '').replace(/\D/g, '');
    if (digits.indexOf('80') === 0) digits = '375' + digits.substring(2);
    if (digits.indexOf('00375') === 0) digits = digits.substring(2);
    digits = digits.substring(0, 12);

    var candidates = byPhone[digits];
    if (!candidates || candidates.length === 0) return;

    var result = item.result || '';
    var date = item.date || new Date();

    // записываем результат во ВСЕ строки с этим номером (один клиент может
    // иметь несколько строк в реестре - по числу просроченных платежей)
    candidates.forEach(function (rowNum) {
      callsSheet.getRange(rowNum, CALLS_COL_RESULT).setValue(result);
      callsSheet.getRange(rowNum, CALLS_COL_RESULT_DATE).setValue(date);
      updatedCount++;
      if (result) rowsToArchive.push(rowNum);
    });

    // очищаем список - все строки по этому номеру уже обработаны
    delete byPhone[digits];
  });

  // Переносим прослушанные строки в лист "Архив обзвона"
  if (rowsToArchive.length > 0) {
    var archiveSheet = ss.getSheetByName(CALLS_ARCHIVE_SHEET_NAME);
    if (!archiveSheet) {
      archiveSheet = ss.insertSheet(CALLS_ARCHIVE_SHEET_NAME);
      // заголовки - те же, что у листа Обзвон
      archiveSheet.getRange(1, 1, 1, CALLS_HEADERS.length)
        .setValues([CALLS_HEADERS])
        .setFontWeight('bold')
        .setBackground('#d9ead3');
      archiveSheet.setFrozenRows(1);
    }

    // Копируем строки в архив (снизу вверх, чтобы не сбить нумерацию при удалении)
    var archiveLastRow = archiveSheet.getLastRow();
    rowsToArchive.sort(function (a, b) { return a - b; });
    rowsToArchive.forEach(function (rowNum) {
      var rowData = callsSheet.getRange(rowNum, 1, 1, CALLS_NUM_COLS).getValues();
      archiveSheet.getRange(archiveLastRow + 1, 1, 1, CALLS_NUM_COLS).setValues(rowData);
      archiveLastRow++;
    });

    // Удаляем из листа "Обзвон" снизу вверх
    rowsToArchive.sort(function (a, b) { return b - a; });
    rowsToArchive.forEach(function (rowNum) {
      callsSheet.deleteRow(rowNum);
    });
  }

  return updatedCount;
}

/**
 * Разово переносит ВСЕ строки из листа "Обзвон" у которых заполнен
 * "Результат обзвона" (любой статус) в лист "Архив обзвона".
 * Удобно для первоначальной очистки, если звонки уже были сделаны
 * до того как архивирование стало автоматическим.
 */
function archiveCompletedCalls() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var callsSheet = ss.getSheetByName(CALLS_SHEET_NAME);
  if (!callsSheet || callsSheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Лист "' + CALLS_SHEET_NAME + '" пуст или не существует.');
    return;
  }

  var archiveSheet = ss.getSheetByName(CALLS_ARCHIVE_SHEET_NAME);
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet(CALLS_ARCHIVE_SHEET_NAME);
    archiveSheet.getRange(1, 1, 1, CALLS_HEADERS.length)
      .setValues([CALLS_HEADERS])
      .setFontWeight('bold')
      .setBackground('#d9ead3');
    archiveSheet.setFrozenRows(1);
  }

  var lastRow = callsSheet.getLastRow();
  var data = callsSheet.getRange(2, 1, lastRow - 1, CALLS_NUM_COLS).getValues();
  var rowsToArchive = [];

  data.forEach(function (row, i) {
    var result = row[CALLS_COL_RESULT - 1];
    if (result) rowsToArchive.push(i + 2); // реальный номер строки в листе
  });

  if (rowsToArchive.length === 0) {
    SpreadsheetApp.getUi().alert('Нет строк с заполненным результатом обзвона — нечего переносить.');
    return;
  }

  // Копируем в архив
  var archiveLastRow = archiveSheet.getLastRow();
  rowsToArchive.forEach(function (rowNum) {
    var rowData = callsSheet.getRange(rowNum, 1, 1, CALLS_NUM_COLS).getValues();
    archiveSheet.getRange(archiveLastRow + 1, 1, 1, CALLS_NUM_COLS).setValues(rowData);
    archiveLastRow++;
  });

  // Удаляем из "Обзвона" снизу вверх
  rowsToArchive.sort(function (a, b) { return b - a; });
  rowsToArchive.forEach(function (rowNum) {
    callsSheet.deleteRow(rowNum);
  });

  SpreadsheetApp.getUi().alert(
    'Готово! Перенесено в архив: ' + rowsToArchive.length + ' строк.'
  );
}

/**
 * Настраивает права редактирования: колонки менеджера (H:I) редактируют
 * только email из MANAGER_EMAILS, колонки юриста (J:K) - только LAWYER_EMAILS.
 * Остальные пользователи с доступом к таблице эти диапазоны редактировать
 * не смогут (только просматривать). Запускать после заполнения списков email.
 */
function setupPermissions() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REGISTRY_SHEET_NAME);
  if (!sheet) {
    throw new Error('Сначала запустите "Инициализировать лист"');
  }

  if (MANAGER_EMAILS.length === 0 && LAWYER_EMAILS.length === 0) {
    SpreadsheetApp.getUi().alert(
      'Список email пуст. Откройте скрипт (Расширения -> Apps Script) и впишите ' +
      'адреса в MANAGER_EMAILS и LAWYER_EMAILS в самом начале файла, затем запустите ' +
      'эту функцию ещё раз.'
    );
    return;
  }

  var maxRows = Math.max(sheet.getMaxRows(), 2000);

  protectRange_(sheet, 2, COL_MGR_COMMENT, maxRows - 1, 2, MANAGER_EMAILS, 'Комментарии менеджера');
  protectRange_(sheet, 2, COL_LAWYER_STAGE, maxRows - 1, 2, LAWYER_EMAILS, 'Стадия юриста');

  SpreadsheetApp.getUi().alert('Права доступа настроены.');
}

function protectRange_(sheet, row, col, numRows, numCols, emails, description) {
  var range = sheet.getRange(row, col, numRows, numCols);
  var protection = range.protect().setDescription(description);

  // убираем всех текущих редакторов диапазона (кроме владельца - он не убирается)
  var currentEditors = protection.getEditors();
  if (currentEditors.length > 0) {
    protection.removeEditors(currentEditors);
  }
  if (protection.canDomainEdit()) {
    protection.setDomainEdit(false);
  }

  emails.forEach(function (email) {
    try {
      protection.addEditor(email);
    } catch (e) {
      // некорректный email - пропускаем, остальные всё равно применятся
    }
  });
}

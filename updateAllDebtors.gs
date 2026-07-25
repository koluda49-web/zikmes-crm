/**
 * Собирает должников со всех листов вида "Месяц Год" начиная с 2025 года
 * (Январь 2025, Ноябрь 2025, Март 2026 и т.п.), а также с листов "25 долж" и "26 долж".
 *
 * В отличие от предыдущей версии - строки КОПИРУЮТСЯ как есть, вместе
 * с исходным форматированием (цвет ячейки дилера, цветная "пилюля" статуса
 * и т.п.), а не пересобираются вручную в виде голого текста.
 *
 * Для каждого клиента переносится:
 *   - "шапка" клиента (строка с № платежа = 0, там же АЙДИ/ФИО/дилер) -
 *     для контекста, чтобы было понятно, чей это долг;
 *   - только те строки платежей, где статус = "Должник" (остальные,
 *     например "Погашен", пропускаются).
 * Клиенты, у которых нет ни одной строки "Должник", в выгрузку не попадают.
 *
 * УСТАНОВКА: как и раньше - отдельный файл в Apps Script, вызывается
 * через пункт меню "Отчёт" -> "Обновить всех должников".
 */
function updateAllDebtors() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var targetSheetName = 'Все должники';
  var targetSheet = ss.getSheetByName(targetSheetName);

  // Сохраняем вручную введённый курс валюты, если лист уже существовал -
  // clear() ниже стирает всё содержимое, включая эту ячейку, поэтому
  // значение нужно забрать заранее и вернуть обратно после очистки.
  // Важно: сохраняем ТОЛЬКО если там реально число - иначе можно случайно
  // "законсервировать" какой-то мусор (например, ФИО клиента из старой версии).
  var savedRate = '';
  if (targetSheet) {
    try {
      var rawSaved = targetSheet.getRange('B1').getValue();
      if (typeof rawSaved === 'number' && !isNaN(rawSaved)) {
        savedRate = rawSaved;
      } else if (typeof rawSaved === 'string') {
        var parsed = parseFloat(rawSaved.replace(',', '.').trim());
        if (!isNaN(parsed) && rawSaved.trim() !== '') {
          savedRate = parsed;
        }
      }
    } catch (e) { /* лист пуст или ещё не создавался - оставляем пусто */ }
  } else {
    targetSheet = ss.insertSheet(targetSheetName);
  }

  targetSheet.clear();

  // На исходных листах ФИО клиента иногда лежит в объединённой (merged) ячейке,
  // и copyTo переносит это объединение в целевой лист. clear() объединения не снимает,
  // поэтому старые "склейки" накладываются на новые данные при следующих запусках -
  // снимаем все объединения явно перед тем, как писать что-либо на лист.
  try {
    targetSheet.getRange(1, 1, targetSheet.getMaxRows(), targetSheet.getMaxColumns()).breakApart();
  } catch (e) { /* нечего снимать - игнорируем */ }

  // высота строк тоже не сбрасывается через clear() - если в предыдущем запуске
  // где-то осталась разросшаяся строка (из-за многострочного ФИО/телефона),
  // она может "наезжать" на панель сверху - сбрасываем на стандартную высоту.
  try {
    targetSheet.setRowHeights(1, targetSheet.getMaxRows(), 21);
  } catch (e) { /* игнорируем */ }

  // Панель сверху: курс валюты + итоги (общий и по годам).
  // Резервируем строки 1-9 (до 5 строк под годовые итоги с запасом),
  // сами значения впишем в конце, когда посчитаем все суммы.
  targetSheet.getRange('A1').setValue('Курс валюты (введите вручную, руб. за 1 у.е.):').setFontWeight('bold');
  targetSheet.getRange('B1').setValue(savedRate).setFontWeight('bold').setBackground('#fff2cc');

  var monthPattern = /^(Январь|Февраль|Март|Апрель|Май|Июнь|Июль|Август|Сентябрь|Октябрь|Ноябрь|Декабрь)\s*(\d{2,4})/i;
  var doljPattern = /^(\d{2,4})\s*долж/i;
  var NUM_COLS = 12; // A..L - охватывает АЙДИ..+/-, дальше в исходниках идёт разное "мусорное" наполнение

  function normalizeYear(rawYear) {
    var y = parseInt(rawYear, 10);
    if (y < 100) y += 2000;
    return y;
  }

  function normalizeYearFromValue(val) {
    // "год" в строке платежа может быть числом (2025) или текстом ("2025")
    var y = parseInt(String(val).trim(), 10);
    if (isNaN(y)) return String(val).trim();
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

  var sheets = ss.getSheets();
  var outRow = 12; // строки 1-11 зарезервированы под панель курса валюты и итогов (с запасом под годы)
  var totalDebtRows = 0;

  // Целевой лист по умолчанию имеет ограниченное число строк - если данных много,
  // может не хватить места и copyTo упадёт с ошибкой "за пределами листа".
  // Эта функция расширяет лист заранее, если нужной строки ещё не существует.
  function ensureEnoughRows(neededRow) {
    var currentMaxRows = targetSheet.getMaxRows();
    if (neededRow > currentMaxRows) {
      targetSheet.insertRowsAfter(currentMaxRows, neededRow - currentMaxRows + 200); // +200 строк запаса
    }
  }
  var totalClients = 0;
  var grandTotalSum = 0;
  var yearTotals = {}; // { '2025': sum, '2026': sum }
  var errors = []; // список ошибок по листам, если что-то пойдёт не так
  var skippedByTimeout = []; // листы, которые не успели обработать из-за лимита времени

  var startTime = new Date().getTime();
  var MAX_RUNTIME_MS = 4.5 * 60 * 1000; // 4.5 минуты - оставляем запас до жёсткого лимита в 6 минут

  for (var sIdx = 0; sIdx < sheets.length; sIdx++) {
    var sheet = sheets[sIdx];
    var name = sheet.getName().trim();
    if (name === targetSheetName) continue;
    if (!isTargetSheet(name)) continue;

    // если приближаемся к лимиту времени - останавливаемся, не начиная новый лист
    if (new Date().getTime() - startTime > MAX_RUNTIME_MS) {
      skippedByTimeout.push(name);
      continue;
    }

    try {
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) continue;

      var numColsForThisSheet = Math.min(NUM_COLS, sheet.getMaxColumns());

      // Читаем СРАЗУ все нужные колонки одним вызовом - потом переиспользуем
      // эти же значения для записи, без повторного обращения к исходному листу.
      var values = sheet.getRange(2, 1, lastRow - 1, numColsForThisSheet).getValues();

      // Разбиваем лист на "блоки" по клиентам: блок начинается там, где
      // в колонке A (АЙДИ) не пусто, и содержит все строки-платежи под ним.
      // rowIndex - это индекс внутри массива values (для повторного использования),
      // rowNum - реальный номер строки в исходном листе (нужен только для проверки фильтра).
      var blocks = [];
      var currentBlock = null;

      values.forEach(function (row, i) {
        var rowNum = i + 2;
        var id = row[0];

        if (id !== null && id !== '') {
          currentBlock = { headerIdx: i, headerRowNum: rowNum, debtRows: [] };
          blocks.push(currentBlock);
        }

        if (currentBlock) {
          var status = row[9];
          if (status && String(status).trim() === 'Должник') {
            currentBlock.debtRows.push({ idx: i, rowNum: rowNum, sum: row[3], year: row[5] });
          }
        }
      });

      // Проверка видимости строки (скрыта фильтром) - один быстрый вызов на лист,
      // построчная проверка нужна только если на листе реально есть фильтр.
      var sheetFilter = null;
      try {
        sheetFilter = sheet.getFilter();
      } catch (e) { /* нет фильтра или метод недоступен */ }

      function isRowVisible(rowNum) {
        if (!sheetFilter) return true;
        try {
          return !sheet.isRowHiddenByFilter(rowNum);
        } catch (e) {
          return true;
        }
      }

      // Собираем ВСЕ строки для этого листа в памяти и пишем ОДНИМ вызовом setValues
      // в конце - вместо множества мелких copyTo (это и было главным тормозом).
      var outputRows = [];
      var dealerCells = []; // A1-адреса ячеек дилера (для зелёной заливки)
      var statusCells = []; // A1-адреса ячеек статуса "Должник" (для красной заливки)
      var sheetOutRowStart = outRow;

      blocks.forEach(function (block) {
        var visibleDebtRows = block.debtRows.filter(function (d) {
          return isRowVisible(d.rowNum);
        });

        if (visibleDebtRows.length === 0) return; // либо долгов нет, либо все скрыты - пропускаем клиента

        totalClients++;

        var headerVisible = isRowVisible(block.headerRowNum);
        if (headerVisible) {
          outputRows.push(values[block.headerIdx]);
          dealerCells.push('I' + (sheetOutRowStart + outputRows.length - 1));
        }

        visibleDebtRows.forEach(function (d) {
          outputRows.push(values[d.idx]);
          statusCells.push('J' + (sheetOutRowStart + outputRows.length - 1));

          totalDebtRows++;
          var s = parseFloat(d.sum);
          if (!isNaN(s)) {
            grandTotalSum += s;
            var y = d.year ? String(normalizeYearFromValue(d.year)) : 'Без года';
            yearTotals[y] = (yearTotals[y] || 0) + s;
          }
        });

        outputRows.push(new Array(numColsForThisSheet).fill('')); // пустая строка-разделитель
      });

      if (outputRows.length > 0) {
        ensureEnoughRows(sheetOutRowStart + outputRows.length - 1);
        targetSheet.getRange(sheetOutRowStart, 1, outputRows.length, numColsForThisSheet)
          .setValues(outputRows);

        if (dealerCells.length > 0) {
          targetSheet.getRangeList(dealerCells).setBackground('#93c47d');
        }
        if (statusCells.length > 0) {
          targetSheet.getRangeList(statusCells)
            .setBackground('#cc4125')
            .setFontColor('#ffffff');
        }

        outRow += outputRows.length;
      }
    } catch (e) {
      errors.push(name + ': ' + e.message);
    }
  }

  // Панель сверху: заполняем итоговые значения (уже без формул с запятыми/точками
  // с запятой - в предыдущей версии это ломалось из-за русской локали таблицы,
  // где разделитель аргументов формулы - ";", а не ",").

  targetSheet.getRange('A2').setValue('ОБЩИЙ ИТОГ ДОЛГА (РУБ.):').setFontWeight('bold').setFontSize(12);
  targetSheet.getRange('B2').setValue(grandTotalSum).setFontWeight('bold').setFontSize(12).setBackground('#f4cccc');

  var rateNum = parseFloat(String(savedRate).replace(',', '.'));
  var totalUe = (!isNaN(rateNum) && rateNum > 0) ? (grandTotalSum / rateNum) : '';
  targetSheet.getRange('A3').setValue('ОБЩИЙ ИТОГ ДОЛГА (У.Е.):').setFontWeight('bold').setFontSize(12);
  targetSheet.getRange('B3').setValue(totalUe).setFontWeight('bold').setFontSize(12).setBackground('#d9ead3');
  if (totalUe === '') {
    targetSheet.getRange('C3').setValue('(впишите курс в B1, чтобы увидеть сумму в у.е.)');
  }

  // итоги по годам - тоже в панели сверху, начиная со строки 5
  var years = Object.keys(yearTotals).sort();
  years.forEach(function (y, idx) {
    var r = 5 + idx;
    targetSheet.getRange(r, 1).setValue('ИТОГО ЗА ' + y + ' ГОД (РУБ.):').setFontWeight('bold');
    targetSheet.getRange(r, 2).setValue(yearTotals[y]).setFontWeight('bold').setBackground('#d9ead3');
  });

  SpreadsheetApp.flush();

  var message = 'Готово! Клиентов с долгом: ' + totalClients +
    ', просроченных платежей: ' + totalDebtRows +
    ', общая сумма долга: ' + grandTotalSum;

  if (errors.length > 0) {
    message += '\n\nВНИМАНИЕ! Не удалось обработать ' + errors.length + ' лист(ов):\n' + errors.join('\n');
  }

  if (skippedByTimeout.length > 0) {
    message += '\n\nСкрипт приближался к лимиту времени выполнения и не успел обработать ' +
      skippedByTimeout.length + ' лист(ов) (запустите ещё раз, чтобы дообработать):\n' +
      skippedByTimeout.join(', ');
  }

  // При вызове через google.script.run (web app) getUi() недоступен — возвращаем строку
  try { SpreadsheetApp.getUi().alert(message); } catch (e) {}
  return message;
}

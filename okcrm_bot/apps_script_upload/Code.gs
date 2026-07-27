/**
 * Zikmes CRM — Google Drive Upload Endpoint
 *
 * Деплой:
 *   1. Откройте script.google.com -> Новый проект -> вставьте этот код
 *   2. Сохраните, затем: Развернуть -> Новое развёртывание
 *   3. Тип: Веб-приложение
 *      Выполнять от имени: Меня (koluda49@gmail.com)
 *      Кто имеет доступ: Все
 *   4. Нажмите "Развернуть", скопируйте URL
 *   5. Добавьте URL в env vars Render: GOOGLE_APPS_SCRIPT_URL = <url>
 *
 * Необязательно: для защиты по ключу — добавьте в Script Properties
 *   (Проект -> Настройки -> Свойства скрипта): UPLOAD_KEY = любой_секрет
 *   И в Render: GOOGLE_APPS_SCRIPT_KEY = тот_же_секрет
 */

function doPost(e) {
  try {
    // Необязательная проверка ключа
    var scriptKey = PropertiesService.getScriptProperties().getProperty('UPLOAD_KEY');
    if (scriptKey) {
      var requestKey = (e.parameter && e.parameter.key) ? e.parameter.key : '';
      if (requestKey !== scriptKey) {
        return makeResponse({ok: false, error: 'Unauthorized'});
      }
    }

    var data = JSON.parse(e.postData.contents);
    var folderId = data.folderId;
    var fileName = data.fileName;
    var fileContentB64 = data.fileContent;
    var mimeType = data.mimeType
      || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    var folder = DriveApp.getFolderById(folderId);
    var bytes = Utilities.base64Decode(fileContentB64);
    var blob = Utilities.newBlob(bytes, mimeType, fileName);
    var file = folder.createFile(blob);

    return makeResponse({ok: true, fileId: file.getId(), fileName: file.getName()});

  } catch (err) {
    return makeResponse({ok: false, error: err.toString()});
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput('Zikmes Drive Upload v1.0 — OK')
    .setMimeType(ContentService.MimeType.TEXT);
}

function makeResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

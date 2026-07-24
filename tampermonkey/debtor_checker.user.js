// ==UserScript==
// @name         Проверка должников рассрочки
// @namespace    http://tampermonkey.net/
// @version      4.2
// @updateURL    https://raw.githubusercontent.com/koluda49-web/zikmes-crm/main/tampermonkey/debtor_checker.user.js
// @downloadURL  https://raw.githubusercontent.com/koluda49-web/zikmes-crm/main/tampermonkey/debtor_checker.user.js
// @description  Проверяет просроченные платежи в CRM и обновляет статусы в Google Sheets
// @author       You
// @match        https://a.ok-crm.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      a.ok-crm.com
// @connect      sheets.googleapis.com
// @connect      accounts.google.com
// ==/UserScript==

(function () {
    'use strict';

    // ===================== КОНФИГУРАЦИЯ =====================
    const CONFIG = {
        SPREADSHEET_ID: '1rD1WChulpVdzwX6PZ1B4OI7PlmhfU3PqOl1iIbBM3WI',
        // Листы которые всегда пропускаем (точные названия)
        SKIP_SHEETS: ['Все должники', 'Статистика', '2023 долж', '2024 долж', '26 долж', 'Список 2025 -2026', 'Сводная таблица 6', 'Отчёт'],
        // Колонки Google Sheets (0-based: A=0, B=1, C=2, D=3, E=4, F=5, J=9)
        COL_ID: 0,        // A — АЙДИ
        COL_SUM: 3,       // D — сумма платежа
        COL_DATE_DAY: 4,  // E — день.месяц (03.08)
        COL_DATE_YEAR: 5, // F — год (2025)
        COL_STATUS: 9,    // J — статус должника
        OVERDUE_DAYS: 7,
        GOOGLE_CLIENT_ID: '974900437551-dsnncbnaeo9vk71mlsh2m7riv1hrkksg.apps.googleusercontent.com',
        GOOGLE_SCOPES: 'https://www.googleapis.com/auth/spreadsheets',
        REQUEST_DELAY: 1500,
    };

    // ===================== СТИЛИ =====================
    GM_addStyle(`
        #dc-panel {
            position: fixed;
            top: 60px;
            right: 16px;
            width: 360px;
            background: #1a1f2e;
            border: 1px solid #2d3550;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 13px;
            color: #c8d0e7;
            z-index: 99999;
            overflow: hidden;
        }
        #dc-header {
            background: #252b3d;
            padding: 12px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            border-bottom: 1px solid #2d3550;
            user-select: none;
        }
        #dc-header h3 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: #e8eaf6;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        #dc-header h3::before { content: '⚠'; color: #f59e0b; }
        #dc-toggle { background: none; border: none; color: #8892b0; cursor: pointer; font-size: 18px; padding: 0; }
        #dc-body { padding: 14px 16px; }
        #dc-panel.collapsed #dc-body { display: none; }
        .dc-btn {
            display: block; width: 100%; padding: 9px 0;
            border: none; border-radius: 8px; font-size: 13px;
            font-weight: 600; cursor: pointer; margin-bottom: 8px;
            transition: opacity 0.15s;
        }
        .dc-btn:hover { filter: brightness(1.1); }
        .dc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .dc-btn-auth   { background: #4285f4; color: #fff; }
        .dc-btn-run    { background: #10b981; color: #fff; }
        .dc-btn-stop   { background: #ef4444; color: #fff; }
        .dc-btn-single { background: #6366f1; color: #fff; }
        #dc-status {
            background: #0f1420; border-radius: 8px;
            padding: 10px 12px; min-height: 60px; max-height: 200px;
            overflow-y: auto; font-size: 12px; line-height: 1.7;
            margin-bottom: 8px; white-space: pre-wrap; word-break: break-all;
        }
        #dc-progress { height: 4px; background: #1e2535; border-radius: 2px; margin-bottom: 8px; overflow: hidden; }
        #dc-progress-bar { height: 100%; background: linear-gradient(90deg,#10b981,#6366f1); width: 0%; transition: width 0.3s; }
        #dc-stats { display: flex; gap: 8px; margin-bottom: 8px; }
        .dc-stat { flex: 1; background: #0f1420; border-radius: 8px; padding: 8px; text-align: center; }
        .dc-stat-num { font-size: 20px; font-weight: 700; line-height: 1.2; }
        .dc-stat-lbl { font-size: 10px; color: #6b7280; text-transform: uppercase; }
        .dc-stat.checked .dc-stat-num { color: #6366f1; }
        .dc-stat.debtors .dc-stat-num { color: #ef4444; }
        .dc-stat.updated .dc-stat-num { color: #10b981; }
        #dc-token-status { font-size: 11px; color: #6b7280; text-align: center; margin-bottom: 8px; }
        #dc-token-status.ok { color: #10b981; }
        #dc-token-status.err { color: #ef4444; }
        .dc-divider { border: none; border-top: 1px solid #2d3550; margin: 10px 0; }
        #dc-sheets-wrap { margin-bottom: 8px; display: none; }
        #dc-sheets-label { font-size: 11px; color: #8892b0; margin-bottom: 6px; display: flex; justify-content: space-between; }
        #dc-sheets-list { display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto; }
        .dc-sheet-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #c8d0e7; cursor: pointer; padding: 3px 0; }
        .dc-sheet-item input { cursor: pointer; accent-color: #10b981; }
        #dc-sheets-all { font-size: 11px; color: #10b981; cursor: pointer; text-decoration: underline; }
    `);

    // ===================== СОСТОЯНИЕ =====================
    let accessToken = GM_getValue('dc_access_token', null);
    let tokenExpiry = GM_getValue('dc_token_expiry', 0);
    let stopFlag = false;
    let running = false;

    // ===================== UI =====================
    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'dc-panel';
        panel.innerHTML = `
            <div id="dc-header">
                <h3>Проверка должников</h3>
                <button id="dc-toggle">−</button>
            </div>
            <div id="dc-body">
                <div id="dc-token-status">● Не авторизован</div>
                <button class="dc-btn dc-btn-auth" id="dc-auth-btn">🔑 Авторизация Google</button>
                <hr class="dc-divider">
                <div id="dc-stats">
                    <div class="dc-stat checked"><div class="dc-stat-num" id="st-checked">0</div><div class="dc-stat-lbl">Проверено</div></div>
                    <div class="dc-stat debtors"><div class="dc-stat-num" id="st-debtors">0</div><div class="dc-stat-lbl">Должников</div></div>
                    <div class="dc-stat updated"><div class="dc-stat-num" id="st-updated">0</div><div class="dc-stat-lbl">Обновлено</div></div>
                </div>
                <div id="dc-progress"><div id="dc-progress-bar"></div></div>
                <div id="dc-sheets-wrap">
                    <div id="dc-sheets-label">
                        <span>📋 Выберите листы:</span>
                        <span>
                            <span id="dc-sheets-all">Все</span>
                            &nbsp;|&nbsp;
                            <span id="dc-sheets-none" style="color:#ef4444;cursor:pointer;text-decoration:underline;font-size:11px">Снять</span>
                        </span>
                    </div>
                    <div id="dc-sheets-list"></div>
                </div>
                <div id="dc-status">Готов к работе.</div>
                <button class="dc-btn dc-btn-run" id="dc-run-btn" disabled>▶ Запустить проверку всех</button>
                <button class="dc-btn dc-btn-single" id="dc-single-btn" disabled>🔍 Проверить текущий заказ</button>
                <button class="dc-btn dc-btn-stop" id="dc-stop-btn" style="display:none">■ Остановить</button>
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('dc-toggle').onclick = () => {
            panel.classList.toggle('collapsed');
            document.getElementById('dc-toggle').textContent = panel.classList.contains('collapsed') ? '+' : '−';
        };
        document.getElementById('dc-auth-btn').onclick = doAuth;
        document.getElementById('dc-run-btn').onclick = runAll;
        document.getElementById('dc-stop-btn').onclick = () => { stopFlag = true; };
        document.getElementById('dc-single-btn').onclick = checkCurrentOrder;
        document.getElementById('dc-sheets-all').onclick = () => {
            document.querySelectorAll('.dc-sheet-cb').forEach(cb => cb.checked = true);
        };
        document.getElementById('dc-sheets-none').onclick = () => {
            document.querySelectorAll('.dc-sheet-cb').forEach(cb => cb.checked = false);
        };
        checkTokenStatus();
    }

    function log(msg, append = true) {
        const el = document.getElementById('dc-status');
        if (!el) return;
        const ts = new Date().toLocaleTimeString('ru-RU');
        if (append) { el.textContent += `[${ts}] ${msg}\n`; el.scrollTop = el.scrollHeight; }
        else el.textContent = `[${ts}] ${msg}\n`;
    }
    function setStat(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
    function setProgress(pct) { const el = document.getElementById('dc-progress-bar'); if (el) el.style.width = Math.min(100, pct) + '%'; }
    function setRunning(val) {
        running = val;
        const r = document.getElementById('dc-run-btn');
        const s = document.getElementById('dc-stop-btn');
        const si = document.getElementById('dc-single-btn');
        if (r) r.style.display = val ? 'none' : 'block';
        if (s) s.style.display = val ? 'block' : 'none';
        if (si) si.disabled = val;
    }

    // ===================== АВТОРИЗАЦИЯ =====================
    function checkTokenStatus() {
        const el = document.getElementById('dc-token-status');
        const runBtn = document.getElementById('dc-run-btn');
        const singleBtn = document.getElementById('dc-single-btn');
        if (!el) return;
        if (accessToken && Date.now() < tokenExpiry) {
            el.className = 'ok'; el.textContent = '● Авторизован (Google)';
            if (runBtn) runBtn.disabled = false;
            if (singleBtn) singleBtn.disabled = false;
            loadSheetsList();
        } else {
            el.className = 'err'; el.textContent = '● Не авторизован';
            if (runBtn) runBtn.disabled = true;
            if (singleBtn) singleBtn.disabled = true;
        }
    }

    async function loadSheetsList() {
        try {
            const sheets = await getSheetNames();
            const available = sheets.filter(s => !CONFIG.SKIP_SHEETS.includes(s));
            const wrap = document.getElementById('dc-sheets-wrap');
            const list = document.getElementById('dc-sheets-list');
            if (!wrap || !list) return;
            list.innerHTML = '';
            available.forEach(name => {
                const label = document.createElement('label');
                label.className = 'dc-sheet-item';
                label.innerHTML = `<input type="checkbox" class="dc-sheet-cb" value="${name}"> ${name}`;
                list.appendChild(label);
            });
            wrap.style.display = 'block';
        } catch(e) {
            // не критично
        }
    }

    function getSelectedSheets() {
        const checked = document.querySelectorAll('.dc-sheet-cb:checked');
        if (checked.length === 0) return null; // ничего не выбрано
        return Array.from(checked).map(cb => cb.value);
    }

    function doAuth() {
        const redirectUri = window.location.origin + '/oauth2callback';
        const scope = encodeURIComponent(CONFIG.GOOGLE_SCOPES);
        const state = Math.random().toString(36).slice(2);
        GM_setValue('dc_oauth_state', state);

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${CONFIG.GOOGLE_CLIENT_ID}&` +
            `redirect_uri=${encodeURIComponent(redirectUri)}&` +
            `response_type=token&` +
            `scope=${scope}&` +
            `state=${state}&` +
            `prompt=select_account`;

        // Открываем в новой вкладке вместо попапа
        const authTab = window.open(authUrl, '_blank');

        log('⏳ Авторизация открыта в новой вкладке. После входа вернитесь сюда.');

        // Слушаем сообщения от вкладки авторизации
        const messageHandler = (event) => {
            if (event.data && event.data.type === 'dc_oauth_token') {
                window.removeEventListener('message', messageHandler);
                accessToken = event.data.token;
                tokenExpiry = Date.now() + (event.data.expiresIn || 3600) * 1000;
                GM_setValue('dc_access_token', accessToken);
                GM_setValue('dc_token_expiry', tokenExpiry);
                log('✓ Авторизация прошла успешно!');
                checkTokenStatus();
            }
        };
        window.addEventListener('message', messageHandler);

        // Перехватываем редирект на /oauth2callback
        const checkInterval = setInterval(() => {
            if (!authTab || authTab.closed) {
                clearInterval(checkInterval);
                // Проверяем не получили ли токен через другой механизм
                const savedToken = GM_getValue('dc_access_token', null);
                const savedExpiry = GM_getValue('dc_token_expiry', 0);
                if (savedToken && Date.now() < savedExpiry && savedToken !== accessToken) {
                    accessToken = savedToken;
                    tokenExpiry = savedExpiry;
                    log('✓ Авторизация прошла успешно!');
                    checkTokenStatus();
                }
                return;
            }
            try {
                const url = authTab.location.href;
                if (url.includes('access_token=') || url.includes('/oauth2callback')) {
                    clearInterval(checkInterval);
                    const hash = url.split('#')[1] || url.split('?')[1] || '';
                    const params = new URLSearchParams(hash);
                    const token = params.get('access_token');
                    if (token) {
                        authTab.close();
                        accessToken = token;
                        const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
                        tokenExpiry = Date.now() + expiresIn * 1000;
                        GM_setValue('dc_access_token', accessToken);
                        GM_setValue('dc_token_expiry', tokenExpiry);
                        log('✓ Авторизация прошла успешно!');
                        checkTokenStatus();
                    }
                }
            } catch (e) {
                // Cross-origin — ждём пока не вернётся на наш домен
            }
        }, 300);
    }

    // ===================== SHEETS API =====================
    function sheetsRequest(method, path, body = null) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method, url: `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}${path}`,
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                data: body ? JSON.stringify(body) : undefined,
                onload: r => r.status >= 200 && r.status < 300 ? resolve(JSON.parse(r.responseText)) : reject(new Error(`Sheets ${r.status}: ${r.responseText}`)),
                onerror: e => reject(e),
            });
        });
    }

    async function getSheetNames() {
        const data = await sheetsRequest('GET', '?fields=sheets.properties');
        return data.sheets.map(s => s.properties.title);
    }

    async function getSheetValues(sheetName) {
        const data = await sheetsRequest('GET', `/values/${encodeURIComponent(sheetName)}`);
        return data.values || [];
    }

    function colIndexToLetter(idx) {
        let letter = ''; idx += 1;
        while (idx > 0) { const rem = (idx-1)%26; letter = String.fromCharCode(65+rem)+letter; idx = Math.floor((idx-1)/26); }
        return letter;
    }

    // Кэш sheetId по названию листа
    const sheetIdCache = {};

    async function getSheetId(sheetName) {
        if (sheetIdCache[sheetName]) return sheetIdCache[sheetName];
        const data = await sheetsRequest('GET', '?fields=sheets.properties');
        for (const s of data.sheets) {
            sheetIdCache[s.properties.title] = s.properties.sheetId;
        }
        return sheetIdCache[sheetName] || 0;
    }

    async function paintCellRed(sheetName, rowIndex, colIndex) {
        const sheetId = await getSheetId(sheetName);
        await sheetsRequest('POST', ':batchUpdate', {
            requests: [{
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: rowIndex - 1,
                        endRowIndex: rowIndex,
                        startColumnIndex: colIndex,
                        endColumnIndex: colIndex + 1,
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: { red: 0.8, green: 0.0, blue: 0.0 },
                            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true }
                        }
                    },
                    fields: 'userEnteredFormat(backgroundColor,textFormat)'
                }
            }]
        });
    }

    async function resetCellFormat(sheetName, rowIndex, colIndex) {
        const sheetId = await getSheetId(sheetName);
        await sheetsRequest('POST', ':batchUpdate', {
            requests: [{
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: rowIndex - 1,
                        endRowIndex: rowIndex,
                        startColumnIndex: colIndex,
                        endColumnIndex: colIndex + 1,
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: { red: 1, green: 1, blue: 1 },
                            textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: false }
                        }
                    },
                    fields: 'userEnteredFormat(backgroundColor,textFormat)'
                }
            }]
        });
    }

    async function updateCell(sheetName, rowIndex, colIndex, value) {
        const col = colIndexToLetter(colIndex);
        const range = `${sheetName}!${col}${rowIndex}`;
        await sheetsRequest('PUT', `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
            range, majorDimension: 'ROWS', values: [[value]],
        });
    }

    // ===================== CRM ПАРСЕР =====================
    function fetchCRMOrder(orderId) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://a.ok-crm.com/order/view/${orderId}`,
                headers: { 'Accept': 'text/html' },
                onload: r => r.status === 200 ? resolve(r.responseText) : r.status === 404 ? resolve(null) : reject(new Error(`CRM ${r.status}`)),
                onerror: e => reject(e),
            });
        });
    }

    function parseCRMPayments(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Ищем таблицу внутри блока платежей
        // Блок платежей: div с id содержащим "payment" или заголовок "Платежи"
        let paymentsTable = null;

        // Метод 1: ищем по id виджета платежей
        const paymentWidget = doc.querySelector('#w15-widget-payment, [id*="widget-payment"]');
        if (paymentWidget) {
            paymentsTable = paymentWidget.querySelector('table');
        }

        // Метод 2: ищем заголовок "Платежи" и берём следующую таблицу
        if (!paymentsTable) {
            const allElements = doc.querySelectorAll('h3, h4, .box-header, .panel-title, .card-title');
            for (const el of allElements) {
                if (el.textContent.trim() === 'Платежи') {
                    let next = el.closest('.box, .panel, .card');
                    if (next) { paymentsTable = next.querySelector('table'); }
                    if (paymentsTable) break;
                }
            }
        }

        // Метод 3: ищем таблицу с нужными заголовками
        if (!paymentsTable) {
            for (const tbl of doc.querySelectorAll('table')) {
                const text = tbl.textContent.toLowerCase();
                if (text.includes('сумма') && text.includes('статус') && text.includes('истекает')) {
                    paymentsTable = tbl;
                    break;
                }
            }
        }

        if (!paymentsTable) return null;

        // Определяем индексы колонок по data-col-seq (Krajee GridView)
        // data-col-seq: 1=Сумма, 2=Валюта, 3=Метод оплаты, 4=Дата платежа, 6=Статус, 8=Истекает
        const payments = [];
        const dataRows = paymentsTable.querySelectorAll('tr[data-key], tbody tr');

        for (const row of dataRows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 3) continue;

            let sum = 0, status = '', expiryText = '', dateText = '';

            // Пробуем через data-col-seq
            let foundBySeq = false;
            for (const cell of cells) {
                const seq = cell.getAttribute('data-col-seq');
                if (seq === '1') {
                    sum = parseFloat(cell.textContent.trim().replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
                    foundBySeq = true;
                }
                if (seq === '4') dateText = cell.textContent.trim();
                if (seq === '6') {
                    const btn = cell.querySelector('button.kv-editable-value') || cell.querySelector('button') || cell.querySelector('a') || cell;
                    status = btn.textContent.trim();
                }
                if (seq === '8') expiryText = cell.textContent.trim();
            }

            // Если data-col-seq не найден — берём по позиции
            if (!foundBySeq && cells.length >= 6) {
                sum = parseFloat(cells[1]?.textContent.trim().replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
                dateText = cells[4]?.textContent.trim() || '';
                const statusCell = cells[5];
                const btn = statusCell?.querySelector('button.kv-editable-value') || statusCell?.querySelector('button') || statusCell?.querySelector('a') || statusCell;
                status = btn?.textContent.trim() || '';
                expiryText = cells[7]?.textContent.trim() || '';
            }

            if (sum <= 0) continue;

            const expiryDate = parseDate(expiryText);
            const payDate = parseDate(dateText);

            payments.push({ sum, status, expiryText, expiryDate, dateText, payDate });
        }

        return payments.length > 0 ? payments : null;
    }

    function parseDate(str) {
        if (!str) return null;
        str = str.trim();
        let m = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (m) return new Date(+m[3], +m[2]-1, +m[1]);
        m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(+m[1], +m[2]-1, +m[3]);
        return null;
    }

    // ===================== ЛОГИКА СТАТУСОВ =====================
    function isDebtor(payment) {
        const s = payment.status.toLowerCase();
        // Оплачен/Погашен/Неактивный — не должник
        if (s.includes('погаш') || s.includes('оплач') || s.includes('paid') || s.includes('неактив') || s.includes('inactive')) return false;
        // Просрочен — всегда должник
        if (s.includes('просрочен') || s.includes('overdue')) return true;
        // Ожидает оплаты — должник если просрочка > 7 дней
        if (s.includes('ожида') || s.includes('pending')) {
            const deadline = payment.expiryDate || payment.payDate;
            if (deadline) {
                const today = new Date(); today.setHours(0,0,0,0);
                return (today - deadline) / 86400000 > CONFIG.OVERDUE_DAYS;
            }
        }
        return false;
    }

    // ===================== СТРУКТУРА ТАБЛИЦЫ =====================
    // ID только в первой строке клиента, остальные строки без ID — платежи
    function groupRowsById(rows, sheet) {
        const blocks = [];
        let current = null;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const idVal = String(row[CONFIG.COL_ID] || '').trim();
            const rowIndex = i + 1; // 1-based для Sheets API
            if (idVal && !isNaN(idVal) && idVal !== '') {
                current = { id: parseInt(idVal, 10), sheet, paymentRows: [] };
                // Первая строка клиента — тоже может быть платёж (платёж 0)
                const hasDate = String(row[CONFIG.COL_DATE_DAY] || '').trim() !== '';
                if (hasDate) current.paymentRows.push({ rowIndex, rowData: row });
                blocks.push(current);
            } else if (current) {
                // Строка без ID — проверяем наличие даты в колонке E
                const hasDate = String(row[CONFIG.COL_DATE_DAY] || '').trim() !== '';
                if (hasDate) current.paymentRows.push({ rowIndex, rowData: row });
            }
        }
        return blocks;
    }

    // ===================== СОПОСТАВЛЕНИЕ ПЛАТЕЖЕЙ =====================
    function matchPayment(rowData, crmPayments) {
        const tableSum = parseFloat(String(rowData[CONFIG.COL_SUM] || '').replace(',', '.')) || 0;
        const dayMonth = String(rowData[CONFIG.COL_DATE_DAY] || '').trim(); // "03.09"
        const year = String(rowData[CONFIG.COL_DATE_YEAR] || '').trim();    // "2025"

        let tableMonth = null, tableYear = null;
        if (dayMonth.includes('.') && year) {
            const parts = dayMonth.split('.');
            if (parts.length >= 2) {
                tableMonth = parseInt(parts[1], 10) - 1; // 0-based
                tableYear = parseInt(year, 10);
            }
        }

        if (tableSum <= 0) return null;

        // Фильтруем кандидатов по сумме (допуск 1 руб)
        const candidates = crmPayments.filter(p => Math.abs(p.sum - tableSum) <= 1.0);
        if (candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];

        // Несколько кандидатов с одинаковой суммой — уточняем по месяцу
        if (tableMonth !== null && tableYear !== null) {
            for (const p of candidates) {
                // Проверяем по дате истечения
                if (p.expiryDate && p.expiryDate.getMonth() === tableMonth && p.expiryDate.getFullYear() === tableYear) {
                    return p;
                }
                // Проверяем по дате платежа
                if (p.payDate && p.payDate.getMonth() === tableMonth && p.payDate.getFullYear() === tableYear) {
                    return p;
                }
            }
            // Проверяем совпадение месяца в дате истечения с месяцем из таблицы
            // (в таблице дата платежа 03.09, в CRM истекает 26.09 — месяц совпадает)
            for (const p of candidates) {
                if (p.expiryDate && p.expiryDate.getMonth() === tableMonth) {
                    return p;
                }
            }
        }

        // Если не нашли по дате — берём первого кандидата
        return candidates[0];
    }

    // ===================== ОБРАБОТКА СТРОКИ =====================
    async function processRow(sheet, rowIndex, rowData, crmPayments, counts, orderId, changedIds) {
        const matched = matchPayment(rowData, crmPayments);
        if (!matched) {
            log(`  ⓘ стр.${rowIndex}: не сопоставлен (сумма=${rowData[CONFIG.COL_SUM]}, дата=${rowData[CONFIG.COL_DATE_DAY]}.${rowData[CONFIG.COL_DATE_YEAR]})`);
            return;
        }

        // Удаляем использованный платёж чтобы не сопоставить его повторно
        const usedIdx = crmPayments.indexOf(matched);
        if (usedIdx !== -1) crmPayments.splice(usedIdx, 1);

        const debtor = isDebtor(matched);
        const currentStatus = String(rowData[CONFIG.COL_STATUS] || '').trim().toLowerCase();
        const alreadyDebtor = currentStatus.includes('долж');

        if (debtor && !alreadyDebtor) {
            counts.debtors++;
            setStat('st-debtors', counts.debtors);
            log(`  🔴 стр.${rowIndex}: статус CRM="${matched.status}" → Должник`);
            try {
                await resetCellFormat(sheet, rowIndex, CONFIG.COL_STATUS);
                await updateCell(sheet, rowIndex, CONFIG.COL_STATUS, 'Должник');
                counts.updated++;
                setStat('st-updated', counts.updated);
                if (orderId && changedIds && !changedIds.includes(orderId)) changedIds.push(orderId);
                log(`  ✓ стр.${rowIndex}: записано`);
            } catch (e) {
                log(`  ✗ стр.${rowIndex}: ОШИБКА ЗАПИСИ: ${e.message}`);
                console.error('[DebtorChecker] ошибка записи:', e);
            }
        } else if (debtor && alreadyDebtor) {
            counts.debtors++;
            setStat('st-debtors', counts.debtors);
        }
        // не должник — не трогаем
    }

    // ===================== ЗАПУСТИТЬ ВСЕ =====================
    async function runAll() {
        if (running) return;
        if (!accessToken || Date.now() >= tokenExpiry) { log('⚠ Нужна авторизация!'); return; }

        stopFlag = false;
        setRunning(true);
        setProgress(0);
        setStat('st-checked', 0); setStat('st-debtors', 0); setStat('st-updated', 0);
        const counts = { checked: 0, debtors: 0, updated: 0 };
        const changedIds = []; // ID где были изменения

        try {
            log('📋 Читаем листы...', false);
            const sheets = await getSheetNames();
            const allAvailable = sheets.filter(s => !CONFIG.SKIP_SHEETS.includes(s));
            const selected = getSelectedSheets();
            if (!selected || selected.length === 0) {
                log('⚠ Выберите хотя бы один лист!');
                setRunning(false);
                return;
            }
            const targetSheets = selected;
            log(`✓ Листов: ${targetSheets.length} (${targetSheets.join(', ')})`);

            const allBlocks = [];
            for (const sheet of targetSheets) {
                if (stopFlag) break;
                const rows = await getSheetValues(sheet);
                const blocks = groupRowsById(rows, sheet);
                log(`  "${sheet}": ${blocks.length} клиентов`);
                allBlocks.push(...blocks);
            }
            log(`📊 Всего клиентов: ${allBlocks.length}`);

            const crmCache = {};
            for (let bi = 0; bi < allBlocks.length; bi++) {
                if (stopFlag) break;
                const block = allBlocks[bi];
                setProgress((bi / allBlocks.length) * 100);

                if (!(block.id in crmCache)) {
                    try {
                        await sleep(CONFIG.REQUEST_DELAY);
                        const html = await fetchCRMOrder(block.id);
                        if (!html) { crmCache[block.id] = null; log(`⚠ #${block.id} не найден`); continue; }
                        const payments = parseCRMPayments(html);
                        crmCache[block.id] = payments;
                        if (!payments) log(`⚠ #${block.id}: платежи не распарсены`);
                    } catch (e) {
                        crmCache[block.id] = null;
                        log(`✗ #${block.id}: ${e.message}`);
                    }
                }

                const crmPayments = crmCache[block.id];
                if (!crmPayments) continue;

                const crmPaymentsCopy = [...crmPayments];
                counts.checked++;
                setStat('st-checked', counts.checked);
                log(`🔍 #${block.id} (${block.sheet}): ${block.paymentRows.length} строк, CRM: ${crmPaymentsCopy.length} платежей`);

                for (const { rowIndex, rowData } of block.paymentRows) {
                    if (stopFlag) break;
                    await processRow(block.sheet, rowIndex, rowData, crmPaymentsCopy, counts, block.id, changedIds);
                }

                // Проверяем остались ли несопоставленные просроченные платежи в CRM
                const unpaired = crmPaymentsCopy.filter(p => isDebtor(p));
                if (unpaired.length > 0 && block.paymentRows.length > 0) {
                    const lastRow = block.paymentRows[block.paymentRows.length - 1];
                    const lastStatus = String(lastRow.rowData[CONFIG.COL_STATUS] || '').trim().toLowerCase();
                    const alreadyDebtor = lastStatus.includes('долж');
                    if (!alreadyDebtor) {
                        log(`  🔴 #${block.id}: найден непарный просроченный платёж (${unpaired[0].sum} руб, "${unpaired[0].status}") → Должник на стр.${lastRow.rowIndex}`);
                        try {
                            counts.debtors++;
                            setStat('st-debtors', counts.debtors);
                            await resetCellFormat(block.sheet, lastRow.rowIndex, CONFIG.COL_STATUS);
                            await updateCell(block.sheet, lastRow.rowIndex, CONFIG.COL_STATUS, 'Должник');
                            counts.updated++;
                            setStat('st-updated', counts.updated);
                            if (!changedIds.includes(block.id)) changedIds.push(block.id);
                            log(`  ✓ стр.${lastRow.rowIndex}: записано`);
                        } catch (e) {
                            log(`  ✗ стр.${lastRow.rowIndex}: ОШИБКА: ${e.message}`);
                        }
                    } else {
                        counts.debtors++;
                        setStat('st-debtors', counts.debtors);
                        log(`  🔴 #${block.id}: непарный просроченный платёж, стр.${lastRow.rowIndex} уже Должник`);
                    }
                }
            }

            setProgress(100);
            log(`\n✅ Готово! Клиентов: ${counts.checked}, Должников: ${counts.debtors}, Обновлено: ${counts.updated}`);
            if (changedIds.length > 0) {
                log(`\n📝 ID с изменениями (${changedIds.length}):`);
                log(changedIds.join(', '));
            } else {
                log(`📝 Изменений не было`);
            }
        } catch (e) {
            log(`✗ Ошибка: ${e.message}`);
            console.error('[DebtorChecker]', e);
        } finally {
            setRunning(false);
        }
    }

    // ===================== ПРОВЕРИТЬ ТЕКУЩИЙ ЗАКАЗ =====================
    async function checkCurrentOrder() {
        const m = window.location.pathname.match(/\/order\/view\/(\d+)/);
        if (!m) { log('⚠ Откройте страницу заказа'); return; }
        if (!accessToken || Date.now() >= tokenExpiry) { log('⚠ Нужна авторизация!'); return; }

        const orderId = parseInt(m[1], 10);
        log(`🔍 Заказ #${orderId}...`, false);

        try {
            const crmPayments = parseCRMPayments(document.documentElement.outerHTML);
            if (!crmPayments || crmPayments.length === 0) { log('⚠ Платежи не найдены на странице'); return; }

            log(`✓ Платежей в CRM: ${crmPayments.length}`);
            crmPayments.forEach((p, i) => {
                const mark = isDebtor(p) ? '🔴 ДОЛЖНИК' : '🟢 OK';
                log(`  ${i+1}. ${p.sum} руб | статус: "${p.status}" | истекает: ${p.expiryText||'—'} | ${mark}`);
            });

            log(`\n📋 Ищем в таблице...`);
            const sheets = await getSheetNames();
            const targetSheets = sheets.filter(s => !CONFIG.SKIP_SHEETS.includes(s));
            const counts = { checked: 0, debtors: 0, updated: 0 };

            for (const sheet of targetSheets) {
                const rows = await getSheetValues(sheet);
                const blocks = groupRowsById(rows, sheet).filter(b => b.id === orderId);
                if (blocks.length === 0) continue;

                log(`  Лист "${sheet}": ${blocks.reduce((s,b)=>s+b.paymentRows.length,0)} строк платежей`);
                for (const block of blocks) {
                    counts.checked++;
                    const crmPaymentsCopy = [...crmPayments];
                    for (const { rowIndex, rowData } of block.paymentRows) {
                        await processRow(sheet, rowIndex, rowData, crmPaymentsCopy, counts);
                    }
                    // Проверяем непарные просроченные платежи
                    const unpaired = crmPaymentsCopy.filter(p => isDebtor(p));
                    if (unpaired.length > 0 && block.paymentRows.length > 0) {
                        const lastRow = block.paymentRows[block.paymentRows.length - 1];
                        const lastStatus = String(lastRow.rowData[CONFIG.COL_STATUS] || '').trim().toLowerCase();
                        if (!lastStatus.includes('долж')) {
                            log(`  🔴 непарный просроченный платёж (${unpaired[0].sum} руб) → стр.${lastRow.rowIndex}`);
                            try {
                                counts.debtors++;
                                setStat('st-debtors', counts.debtors);
                                await resetCellFormat(sheet, lastRow.rowIndex, CONFIG.COL_STATUS);
                                await updateCell(sheet, lastRow.rowIndex, CONFIG.COL_STATUS, 'Должник');
                                counts.updated++;
                                setStat('st-updated', counts.updated);
                            } catch (e) {
                                log(`  ✗ ОШИБКА: ${e.message}`);
                            }
                        }
                    }
                }
            }

            if (counts.checked === 0) log(`⚠ Заказ #${orderId} не найден в таблице`);
            else log(`\n✅ Готово! Должников: ${counts.debtors}, Обновлено: ${counts.updated}`);

        } catch (e) {
            log(`✗ Ошибка: ${e.message}`);
            console.error('[DebtorChecker]', e);
        }
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ===================== СТАРТ =====================
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createPanel);
    else createPanel();

})();
